/**
 * Fracital Accounts client. Accounts live on the Fracital server itself
 * (/api/auth via better-auth, /api/me for profile, settings, Last.fm/ListenBrainz and Discord status).
 */
import { passkeyClient } from "@better-auth/passkey/client";
import { cryptoFetch } from "./api-crypto-fetch";
import { createAuthClient } from "better-auth/client";
import { saveLogin, clearLogin } from "../types";
import { compressImage, IMAGE_PRESETS } from "./compressImage";
import { connectLastfmInProxy, lastfmProxyAvailable } from "./lastfmProxy";

export const authClient = createAuthClient({
	baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
	basePath: "/api/auth",
	fetchOptions: { credentials: "include" },
	plugins: [passkeyClient()],
});

export const { signIn, signUp } = authClient;

export type SocialProvider = "google" | "discord" | "github" | "microsoft";

export interface AuthOptions {
	social: SocialProvider[];
	lastfm: boolean;
	terbium: boolean;
	/** Passkeys work on this host (they're bound to one domain). */
	passkeys: boolean;
	/** Password reset and verification emails can be sent. */
	mail: boolean;
	/** OAuth providers call back to this host, so OAuth runs right here. */
	redirectOk: boolean;
	/** The origin that keeps this browser signed in across our sites (crossSite.ts); null when off. */
	hub: string | null;
	/** Off the auth host: its origin, where OAuth runs in a popup and hands the session back (crossSite.ts). */
	authHost: string | null;
}

const NO_OPTIONS: AuthOptions = { social: [], lastfm: false, terbium: false, passkeys: false, mail: false, redirectOk: false, hub: null, authHost: null };
let optionsCache: Promise<AuthOptions> | null = null;

/** Sign-in methods this server offers. */
export function getAuthOptions(): Promise<AuthOptions> {
	optionsCache ??= meFetch<AuthOptions>("/api/me/options").catch(() => {
		optionsCache = null;
		return NO_OPTIONS;
	});
	return optionsCache;
}

/** OAuth sign-in and connecting work here: on the auth host, or through it. */
export const oauthUsable = (options: AuthOptions | null) => !!options && (options.redirectOk || !!options.authHost);

export const passkeysUsable = (options: AuthOptions) => options.passkeys && typeof window.PublicKeyCredential !== "undefined";

export interface LastfmProfile {
	username: string;
	image: string;
	playcount: number;
	url: string;
	registered?: number;
	/** Last.fm access was revoked; scrobbles queue up until it's reconnected. */
	needsReconnect?: boolean;
}

export interface ListenbrainzProfile {
	username: string;
	listenCount: number;
	url: string;
	/** ListenBrainz stopped accepting the token (it was reset); listens queue up until it's reconnected. */
	needsReconnect?: boolean;
}

/** The opt-in Discord status; null when the server doesn't offer it. */
export interface DiscordPresenceState {
	/** Discord is a sign-in method on this account. */
	discord: boolean;
	/** Discord granted permission to set the status. */
	connected: boolean;
	enabled: boolean;
	/** Why the last update was refused (until reconnected or turned back on). */
	error?: string;
}

export interface Me {
	user: { id: string; name: string; email: string | null; image: string | null; emailVerified?: boolean };
	hasPassword: boolean;
	/** Linked sign-in providers ("credential", "lastfm", "google", "terbium", …). */
	providers?: string[];
	passkeys?: number;
	lastfm: LastfmProfile | null;
	lastfmAvailable: boolean;
	listenbrainz?: ListenbrainzProfile | null;
	discordPresence?: DiscordPresenceState | null;
	/** The server runs the bot behind "On Discord" (getDiscordActivity). */
	discordActivity?: boolean;
	isAdmin?: boolean;
	username?: string | null;
	premium?: boolean;
}

/** fetch() against the Fracital server with the session cookie. */
export async function meFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await cryptoFetch(path, {
		...init,
		credentials: "include",
		headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		// The session expired while the app thought it was signed in: update the account state once.
		if (res.status === 401 && path !== "/api/me" && meCache) void refreshMe();
		throw Object.assign(new Error((data as { error?: string }).error || `Request failed (${res.status})`), { status: res.status, data });
	}
	return data as T;
}

let meCache: Promise<Me | null> | null = null;

/** The signed-in account (cached until `refreshMe`); null when signed out or accounts are disabled. */
export function getMe(): Promise<Me | null> {
	const pending = (meCache ??= meFetch<Me>("/api/me").catch(() => null));
	// If the account changed while this was in flight (sign out/in), resolve to the newer answer
	// so a slow, stale lookup can't overwrite fresh state.
	return pending.then(me => (meCache && meCache !== pending ? getMe() : me));
}

/**
 * Re-reads the account, updates the cached profile used by the shell, and notifies listeners.
 * Only a definite "signed out" (401/503) clears the local login — a flaky network keeps it.
 */
export async function refreshMe(): Promise<Me | null> {
	let me: Me | null = null;
	try {
		me = await meFetch<Me>("/api/me");
		meCache = Promise.resolve(me);
		await saveLogin({ id: me.user.id, display: me.user.name, handle: me.username || me.lastfm?.username || me.listenbrainz?.username || me.user.email || me.user.name, avatar: me.user.image || me.lastfm?.image || null });
	} catch (err) {
		meCache = null;
		const status = (err as { status?: number }).status;
		if (status === 401 || status === 503) await clearLogin();
	}
	window.dispatchEvent(new Event("account-upd"));
	return me;
}

export async function signOut(): Promise<void> {
	// Signing out also unlinks this browser from cross-site sign-in, or the next site would sign it back in.
	await import("./crossSite").then(m => m.unlinkCrossSite()).catch(() => {});
	await authClient.signOut().catch(() => {});
	meCache = null;
	await clearLogin();
	window.dispatchEvent(new Event("account-upd"));
}

/** Opens the sign-in popup right away (inside the click), so pop-up blockers allow it. */
function openPopup(url = "about:blank"): Window {
	const popup = window.open(url, "fracital-auth", "popup,width=520,height=720");
	if (!popup) throw new Error("Allow pop-ups for Fracital to continue");
	return popup;
}

/** Resolves when the popup's landing page reports success; rejects on failure or when it's closed. */
function waitForPopup(popup: Window, type: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const cleanup = () => {
			window.removeEventListener("message", onMessage);
			window.clearInterval(closedPoll);
		};
		const onMessage = (e: MessageEvent) => {
			if (e.origin !== window.location.origin || e.data?.type !== type) return;
			settled = true;
			cleanup();
			if (e.data.status === "ok") resolve();
			else reject(new Error(e.data.message || "Sign-in didn't finish"));
		};
		// Closing the popup without finishing counts as a cancel (after a grace period,
		// since the popup posts its result right before closing itself).
		const closedPoll = window.setInterval(() => {
			if (!popup.closed || settled) return;
			settled = true;
			window.setTimeout(() => {
				cleanup();
				reject(new Error("Sign-in was cancelled"));
			}, 600);
		}, 500);
		window.addEventListener("message", onMessage);
	});
}

/**
 * Runs Last.fm's web auth. `signin` signs in (creating an account on first use);
 * `link` connects (or reconnects) Last.fm on the signed-in account. With the stomp
 * engine active the sign-in happens in a proxy tab (lastfmProxy.ts); otherwise, or
 * when that cannot start, in a popup. Resolves once the account is refreshed.
 */
export async function connectLastfm(mode: "signin" | "link"): Promise<void> {
	if (lastfmProxyAvailable()) {
		try {
			await connectLastfmInProxy(mode);
		} catch (err) {
			// The server declined to begin (not configured, signed out): the popup path
			// gets the same answer from the same server, so only a failure to start falls
			// back; a failed or cancelled sign-in is the user's answer.
			if ((err as { status?: number }).status === undefined) throw err;
			return connectLastfmPopup(mode);
		}
		await refreshMe();
		return;
	}
	return connectLastfmPopup(mode);
}

/** The popup path: /api/auth/lastfm/start redirects to Last.fm, the done page reports back by postMessage. */
export async function connectLastfmPopup(mode: "signin" | "link"): Promise<void> {
	const popup = openPopup(`/api/auth/lastfm/start?mode=${mode}`);
	await waitForPopup(popup, "fracital:lastfm");
	await refreshMe();
}

/** Signs in with (or, signed in, connects) an OAuth provider in a popup. `scopes` adds to the provider's defaults when linking. */
export async function connectSocial(provider: SocialProvider, mode: "signin" | "link", scopes?: string[]): Promise<void> {
	const popup = openPopup();
	const { authHost } = await getAuthOptions();
	if (authHost) {
		try {
			await import("./crossSite").then(m => m.oauthThroughAuthHost(popup, authHost, provider, mode, scopes));
		} finally {
			if (!popup.closed) popup.close();
		}
		await refreshMe();
		return;
	}
	try {
		const urls = { callbackURL: "/api/me/oauth/done?status=ok", errorCallbackURL: "/api/me/oauth/done?status=error", disableRedirect: true };
		const res = mode === "link" ? await authClient.linkSocial({ provider, scopes, ...urls }) : await authClient.signIn.social({ provider, newUserCallbackURL: urls.callbackURL, ...urls });
		const url = res.data && "url" in res.data ? res.data.url : undefined;
		if (res.error || !url) throw new Error(res.error?.message || "Couldn't start sign-in");
		popup.location.href = url;
	} catch (err) {
		popup.close();
		throw err;
	}
	await waitForPopup(popup, "fracital:oauth");
	await refreshMe();
}

export async function disconnectProvider(providerId: string): Promise<void> {
	await meFetch(`/api/me/accounts/${encodeURIComponent(providerId)}`, { method: "DELETE" });
	await refreshMe();
}

/** Checks Terbium Account credentials on the server; signs in, or links Terbium to the signed-in account. */
export async function terbiumAuth(email: string, password: string, mode: "signin" | "link"): Promise<void> {
	const res = await authClient.$fetch<{ ok: boolean }>("/terbium/sign-in", { method: "POST", body: { email, password, mode } });
	if (res.error) throw new Error(res.error.message || "Terbium sign-in failed");
	await refreshMe();
}

export async function signInWithPasskey(): Promise<void> {
	const res = await authClient.signIn.passkey();
	if (res.error) throw new Error(res.error.message || "Passkey sign-in failed");
	await refreshMe();
}

export interface PasskeyInfo {
	id: string;
	name?: string | null;
	createdAt: string | Date;
	deviceType?: string;
}

export async function listPasskeys(): Promise<PasskeyInfo[]> {
	const res = await authClient.passkey.listUserPasskeys();
	return (res.data as PasskeyInfo[] | null) ?? [];
}

export async function addPasskey(name?: string): Promise<void> {
	const res = await authClient.passkey.addPasskey({ name });
	if (res?.error) throw new Error(res.error.message || "Couldn't add the passkey");
	await refreshMe();
}

export async function deletePasskey(id: string): Promise<void> {
	const res = await authClient.passkey.deletePasskey({ id });
	if (res.error) throw new Error(res.error.message || "Couldn't remove the passkey");
	await refreshMe();
}

/** Emails a reset link (if the address has an account). The link opens about:account?reset=… */
export async function requestPasswordReset(email: string): Promise<void> {
	const res = await authClient.requestPasswordReset({ email, redirectTo: "/?account=reset" });
	if (res.error) throw new Error(res.error.message || "Couldn't send the reset email");
}

/** A first password for a signed-in account that has none. */
export async function setAccountPassword(newPassword: string): Promise<void> {
	await meFetch("/api/me/password", { method: "POST", body: JSON.stringify({ newPassword }) });
	await refreshMe();
}

/** Changes the password; other devices are signed out. */
export async function changeAccountPassword(currentPassword: string, newPassword: string): Promise<void> {
	const res = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
	if (res.error) throw new Error(res.error.message || "Couldn't change your password");
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
	const res = await authClient.resetPassword({ token, newPassword });
	if (res.error) throw new Error(res.error.message || "Couldn't reset your password");
}

export async function sendVerificationEmail(email: string): Promise<void> {
	const res = await authClient.sendVerificationEmail({ email, callbackURL: "/?account=verified" });
	if (res.error) throw new Error(res.error.message || "Couldn't send the email");
}

/** Re-reads the Last.fm profile (scrobble count, picture) now. */
export async function refreshLastfm(): Promise<void> {
	await meFetch("/api/me/lastfm/refresh", { method: "POST" });
	await refreshMe();
}

/** Adds Last.fm loved tracks to the Fracital library, from the linked account or any public profile. */
export function importLastfmLoved(username?: string): Promise<{ username: string; found: number; added: number }> {
	return meFetch("/api/me/lastfm/import", { method: "POST", body: JSON.stringify(username ? { username } : {}) });
}

export async function disconnectLastfm(): Promise<void> {
	await meFetch("/api/me/lastfm", { method: "DELETE" });
	await refreshMe();
}

/** Connects ListenBrainz with the user token from listenbrainz.org/settings. */
export async function connectListenbrainz(token: string): Promise<void> {
	await meFetch("/api/me/listenbrainz", { method: "POST", body: JSON.stringify({ token }) });
	await refreshMe();
}

export async function disconnectListenbrainz(): Promise<void> {
	await meFetch("/api/me/listenbrainz", { method: "DELETE" });
	await refreshMe();
}

/** Adds ListenBrainz loved songs to the Fracital library, from the linked account or any username. */
export function importListenbrainzLoved(username?: string): Promise<{ username: string; found: number; added: number }> {
	return meFetch("/api/me/listenbrainz/import", { method: "POST", body: JSON.stringify(username ? { username } : {}) });
}

/** Asks Discord for permission to set the status (links Discord when it isn't yet), then turns it on. */
export async function connectDiscordPresence(): Promise<void> {
	await connectSocial("discord", "link", ["activities.write"]);
	await setDiscordPresence(true);
}

export async function setDiscordPresence(enabled: boolean): Promise<void> {
	await meFetch("/api/me/presence/settings", { method: "PUT", body: JSON.stringify({ enabled }) });
	await refreshMe();
}

export interface DiscordActivity {
	/** 0 Playing, 1 Streaming, 2 Listening, 3 Watching, 4 Custom status, 5 Competing. */
	type: number;
	name: string;
	details?: string;
	state?: string;
	start?: number;
	end?: number;
	image?: string;
	imageText?: string;
	emoji?: string;
	url?: string;
}

export interface DiscordActivityState {
	available: boolean;
	/** Discord is connected to this account. */
	connected?: boolean;
	/** The user turned "On Discord" off. */
	disabled?: boolean;
	bot?: "off" | "connecting" | "ready" | "failed";
	/** null: the bot doesn't share a server with this Discord account. */
	presence?: {
		status: "online" | "idle" | "dnd" | "offline";
		activities: DiscordActivity[];
		voice: { guild: string; channel: string; video: boolean; stream: boolean; muted: boolean; deafened: boolean } | null;
	} | null;
}

/** What the signed-in user is doing on Discord, as Fracital's bot sees it (server: discord-bot.ts). */
export const getDiscordActivity = () => meFetch<DiscordActivityState>("/api/me/discord/activity");

export const setDiscordActivityShown = (enabled: boolean) => meFetch("/api/me/discord/activity/settings", { method: "PUT", body: JSON.stringify({ enabled }) });

/** Emails a 6-digit code that confirms deleting the account. */
export function requestAccountDeletion(): Promise<{ ok: true; email: string }> {
	return meFetch("/api/me/delete/request", { method: "POST" });
}

/**
 * Deletes the account and everything connected to it, then signs this browser out. Returns the
 * link to download a copy of the data, which is kept for 30 days (also emailed).
 */
export async function confirmAccountDeletion(code: string): Promise<{ download?: string; expires?: string; emailed?: boolean }> {
	const res = await meFetch<{ download?: string; expires?: string; emailed?: boolean }>("/api/me/delete/confirm", { method: "POST", body: JSON.stringify({ code }) });
	await signOut();
	return res;
}

/** Updates display name, username and/or profile picture URL. */
export async function updateProfile(change: { name?: string; username?: string | null; image?: string | null }): Promise<Me | null> {
	await meFetch("/api/me/profile", { method: "PUT", body: JSON.stringify(change) });
	return refreshMe();
}

/** Uploads a new profile picture and makes it the account's avatar. */
/** Uploads a new profile picture (compressed in the browser first, so any size works). */
export async function uploadAvatar(input: File): Promise<Me | null> {
	const file = await compressImage(input, IMAGE_PRESETS.avatar);
	const res = await fetch("/api/me/avatar", { method: "POST", credentials: "include", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
	const data = (await res.json().catch(() => ({}))) as { error?: string };
	if (!res.ok) throw new Error(data.error || "Upload failed");
	return refreshMe();
}
