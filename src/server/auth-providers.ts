/**
 * Extra Fracital Accounts sign-in methods, each enabled only when its env is set:
 *
 * - OAuth: Google, Discord, GitHub, Microsoft (<PROVIDER>_CLIENT_ID + <PROVIDER>_CLIENT_SECRET;
 *   optional MICROSOFT_TENANT_ID). Redirect URI: <BETTER_AUTH_URL>/api/auth/callback/<provider>.
 * - Passkeys (always on; bound to PASSKEY_RP_ID, default the BETTER_AUTH_URL hostname).
 * - Terbium Accounts (TERBIUM_AUTH_URL, a better-auth server): credentials are checked
 *   server-side against it and the Terbium account is linked like any other provider.
 */
import { passkey } from "@better-auth/passkey";
import type { BetterAuthOptions, BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

const env = (key: string) => process.env[key]?.trim() || "";

export const SOCIAL_PROVIDERS = ["google", "discord", "github", "microsoft"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

const warned = new Set<string>();

/** better-auth `socialProviders` for every provider with credentials configured. */
export function socialProviders(): NonNullable<BetterAuthOptions["socialProviders"]> {
	const out: Record<string, Record<string, string>> = {};
	for (const id of SOCIAL_PROVIDERS) {
		const clientId = env(`${id.toUpperCase()}_CLIENT_ID`);
		const clientSecret = env(`${id.toUpperCase()}_CLIENT_SECRET`);
		if (!clientId || !clientSecret) {
			if ((clientId || clientSecret) && !warned.has(id)) {
				warned.add(id);
				console.warn(`Sign-in with ${id} is off: set both ${id.toUpperCase()}_CLIENT_ID and ${id.toUpperCase()}_CLIENT_SECRET`);
			}
			continue;
		}
		out[id] = { clientId, clientSecret };
		if (id === "microsoft") out[id].tenantId = env("MICROSOFT_TENANT_ID") || "common";
	}
	return out as NonNullable<BetterAuthOptions["socialProviders"]>;
}

export const enabledSocialProviders = () => Object.keys(socialProviders()) as SocialProvider[];

/** Passkeys only work on the relying party's host (and its subdomains). */
export function passkeyRpId() {
	const explicit = env("PASSKEY_RP_ID");
	if (explicit) return explicit;
	const base = env("BETTER_AUTH_URL");
	return base ? new URL(base).hostname : "localhost";
}

export const passkeyPlugin = () => passkey({ rpID: passkeyRpId(), rpName: env("PASSKEY_RP_NAME") || "Fracital" });

// ============================================================
// Terbium Accounts
// ============================================================

export const terbiumUrl = () => env("TERBIUM_AUTH_URL").replace(/\/+$/, "");
export const terbiumEnabled = () => !!terbiumUrl();

interface TerbiumUser {
	id: string;
	email: string;
	name?: string;
	image?: string | null;
	emailVerified?: boolean;
}

/** Checks credentials against the Terbium auth server. null = wrong credentials; throws when it's unreachable. */
async function terbiumVerify(email: string, password: string): Promise<TerbiumUser | null> {
	const base = terbiumUrl();
	const origin = env("BETTER_AUTH_URL") ? new URL(env("BETTER_AUTH_URL")).origin : new URL(base).origin;
	const res = await fetch(`${base}/api/auth/sign-in/email`, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json", Origin: origin },
		body: JSON.stringify({ email, password, rememberMe: false }),
		signal: AbortSignal.timeout(8000),
	});
	if (res.status === 400 || res.status === 401 || res.status === 403) return null;
	if (!res.ok) throw new Error(`Terbium ${res.status}`);
	const data = (await res.json().catch(() => null)) as { user?: Partial<TerbiumUser> } | null;
	const user = data?.user;
	if (!user?.id || !user.email) throw new Error("Unexpected Terbium response");

	// Drop the upstream session this check created (best-effort).
	const cookie = res.headers
		.getSetCookie()
		.map(c => c.split(";")[0])
		.join("; ");
	if (cookie) void fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { Cookie: cookie, Origin: origin }, signal: AbortSignal.timeout(5000) }).catch(() => {});
	return { id: String(user.id), email: user.email.toLowerCase(), name: user.name, image: user.image ?? null, emailVerified: !!user.emailVerified };
}

export const terbiumPlugin = (onLinked: (userId: string) => void): BetterAuthPlugin => ({
	id: "terbium",
	endpoints: {
		terbiumSignIn: createAuthEndpoint("/terbium/sign-in", { method: "POST", body: z.object({ email: z.string().email().max(320), password: z.string().min(1).max(200), mode: z.enum(["signin", "link"]).default("signin") }) }, async ctx => {
			if (!terbiumEnabled()) throw new APIError("NOT_FOUND", { message: "Terbium sign-in isn't enabled on this server" });
			let tb: TerbiumUser | null;
			try {
				tb = await terbiumVerify(ctx.body.email.trim(), ctx.body.password);
			} catch {
				throw new APIError("BAD_GATEWAY", { message: "Terbium Accounts are unavailable right now. Try again later." });
			}
			if (!tb) throw new APIError("UNAUTHORIZED", { message: "Wrong Terbium email or password" });

			const adapter = ctx.context.internalAdapter;
			const existing = await adapter.findAccountByKey({ providerId: "terbium", accountId: tb.id });

			if (ctx.body.mode === "link") {
				const current = await getSessionFromCtx(ctx);
				if (!current) throw new APIError("UNAUTHORIZED", { message: "Sign in to Fracital first" });
				if (existing && existing.userId !== current.user.id) throw new APIError("CONFLICT", { message: "That Terbium account is already connected to another Fracital account" });
				if (!existing) await adapter.linkAccount({ userId: current.user.id, providerId: "terbium", accountId: tb.id });
				onLinked(current.user.id);
				return ctx.json({ ok: true });
			}

			let userId = existing?.userId;
			if (!userId) {
				// Never merge into an existing account by email alone: the owner has to link it themselves.
				if (await adapter.findUserByEmail(tb.email)) {
					throw new APIError("CONFLICT", { message: "A Fracital Account already uses this email. Sign in to it, then connect Terbium from your account page." });
				}
				const created = await adapter.createOAuthUser({ name: tb.name || tb.email.split("@")[0], email: tb.email, emailVerified: !!tb.emailVerified, image: tb.image || null }, { providerId: "terbium", accountId: tb.id });
				userId = created.user.id;
			}
			const user = await adapter.findUserById(userId);
			if (!user) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Couldn't find your account" });
			const session = await adapter.createSession(user.id);
			if (!session) throw new APIError("FORBIDDEN", { message: "This account can't sign in" });
			await setSessionCookie(ctx, { session, user });
			return ctx.json({ ok: true });
		}),
	},
	rateLimit: [{ pathMatcher: path => path.startsWith("/terbium/"), window: 15 * 60, max: 20 }],
});
