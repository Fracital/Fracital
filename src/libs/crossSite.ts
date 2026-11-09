/**
 * Staying signed in across our sites (server side: src/server/cross-site.ts).
 * A hidden frame on the hub remembers this browser once it opts in; a signed-out
 * site asks it for a one-time code and redeems it on its own server. On by
 * default; turning it off is remembered by the hub for this browser. Everything
 * here fails quietly: no hub, a blocked hub, or blocked third-party cookies all
 * just mean "not linked".
 */
import { authClient, getAuthOptions, refreshMe } from "./auth";

type HubOp = "status" | "link" | "bridge" | "unlink";
type HubResult = { linked?: boolean; off?: boolean; code?: string; error?: string };

const TIMEOUT_MS = 8000;

/** Fired on window after this browser was linked or unlinked, so views showing the state re-read it. */
export const CROSS_SITE_EVENT = "cross-site-upd";
const changed = () => window.dispatchEvent(new Event(CROSS_SITE_EVENT));

let framePromise: Promise<{ origin: string; win: Window } | null> | null = null;

const hubOrigin = async (): Promise<string | null> => (await getAuthOptions().catch(() => null))?.hub ?? null;

/** The hub frame, loaded once and kept (hidden). null when there is no hub or it doesn't answer. */
function hubFrame(): Promise<{ origin: string; win: Window } | null> {
	framePromise ??= (async () => {
		const origin = await hubOrigin();
		if (!origin) return null;
		return new Promise(resolve => {
			const iframe = document.createElement("iframe");
			iframe.src = `${origin}/api/me/hub/frame`;
			iframe.setAttribute("aria-hidden", "true");
			iframe.tabIndex = -1;
			iframe.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
			const done = (value: { origin: string; win: Window } | null) => {
				window.removeEventListener("message", onReady);
				window.clearTimeout(timer);
				if (!value) iframe.remove();
				resolve(value);
			};
			const onReady = (e: MessageEvent) => {
				if (e.origin === origin && e.source === iframe.contentWindow && e.data?.type === "fr:hub" && e.data.ready && iframe.contentWindow) done({ origin, win: iframe.contentWindow });
			};
			const timer = window.setTimeout(() => done(null), TIMEOUT_MS);
			window.addEventListener("message", onReady);
			document.documentElement.appendChild(iframe);
		});
	})();
	return framePromise;
}

let nextId = 0;

async function ask(op: HubOp, data: Record<string, unknown> = {}): Promise<HubResult | null> {
	const frame = await hubFrame();
	if (!frame) return null;
	const id = ++nextId;
	return new Promise(resolve => {
		const done = (value: HubResult | null) => {
			window.removeEventListener("message", onReply);
			window.clearTimeout(timer);
			resolve(value);
		};
		const onReply = (e: MessageEvent) => {
			if (e.origin === frame.origin && e.source === frame.win && e.data?.type === "fr:hub" && e.data.id === id) done((e.data.result as HubResult) ?? null);
		};
		const timer = window.setTimeout(() => done(null), TIMEOUT_MS);
		window.addEventListener("message", onReply);
		frame.win.postMessage({ type: "fr:hub", op, id, ...data }, frame.origin);
	});
}

const base64url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
	const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

/** Whether this browser is linked, and whether the user turned it off here. null when the hub can't be reached. */
export async function crossSiteStatus(): Promise<{ linked: boolean; off: boolean } | null> {
	const res = await ask("status");
	return res && !res.error ? { linked: !!res.linked, off: !!res.off } : null;
}

/**
 * Links this browser to the signed-in account at the hub. `reason`: "toggle" (the
 * user's switch; also undoes turning it off), "signin" (right after signing in),
 * "startup" (a signed-in site on load; not after the user signed out somewhere).
 */
export async function linkCrossSite(reason: "toggle" | "signin" | "startup"): Promise<boolean> {
	const origin = await hubOrigin();
	if (!origin) return false;
	const { verifier, challenge } = await pkcePair();
	const issued = await authClient.$fetch<{ code: string }>("/handoff/code", { method: "POST", body: { returnTo: origin, challenge } }).catch(() => null);
	const code = issued?.data?.code;
	if (!code) return false;
	const linked = !!(await ask("link", { code, verifier, reason }))?.linked;
	changed();
	return linked;
}

/** Unlinks this browser. `off`: the user turned it off (only the toggle relinks); otherwise a sign-out (the next sign-in relinks). */
export async function unlinkCrossSite(off = false): Promise<void> {
	await ask("unlink", { off });
	changed();
}

/** Signs this site in from the hub when this browser is linked. Resolves true when it did. */
export async function crossSiteSignIn(): Promise<boolean> {
	if (!(await hubOrigin())) return false;
	const { verifier, challenge } = await pkcePair();
	const code = (await ask("bridge", { challenge }))?.code;
	if (!code) return false;
	const res = await authClient.$fetch<{ ok: boolean }>("/handoff/redeem", { method: "POST", body: { code, verifier } }).catch(() => null);
	return !!res?.data?.ok;
}

/**
 * OAuth from a site that isn't the auth host: runs the provider's sign-in on the auth host in
 * `popup` (opened by the caller inside the click), which comes back to this origin with the
 * result (server side: cross-site.ts). Signing in redeems a one-time code for a session here;
 * connecting (`link`) first signs the popup in on the auth host as this account.
 */
export async function oauthThroughAuthHost(popup: Window, authHost: string, provider: string, mode: "signin" | "link", scopes?: string[]): Promise<void> {
	const { verifier, challenge } = await pkcePair();
	const params = new URLSearchParams({ method: provider, mode, return: location.origin, challenge, ...(scopes?.length ? { scopes: scopes.join(" ") } : {}) });
	let fragment = "";
	if (mode === "link") {
		const signIn = await pkcePair();
		const issued = await authClient.$fetch<{ code: string }>("/handoff/code", { method: "POST", body: { returnTo: authHost, challenge: signIn.challenge } });
		if (!issued.data?.code) throw new Error(issued.error?.message || "Couldn't start connecting");
		fragment = `#${new URLSearchParams({ c: issued.data.code, v: signIn.verifier })}`;
	}
	popup.location.href = `${authHost}/api/me/hub/signin?${params}${fragment}`;

	const complete = async (result: Record<string, string>) => {
		if (result.e) throw new Error(result.e);
		if (mode === "link") return;
		const res = await authClient.$fetch<{ ok: boolean }>("/handoff/redeem", { method: "POST", body: { code: result.c, verifier } });
		if (!res.data?.ok) throw new Error(res.error?.message || "Sign-in didn't finish. Try again.");
	};

	const result = await new Promise<Record<string, string>>((resolve, reject) => {
		const channel = new BroadcastChannel("frh");
		let settled = false;
		const stopWatching = () => {
			window.removeEventListener("focus", onFocus);
			window.clearInterval(closedPoll);
			window.clearTimeout(timeout);
		};
		channel.onmessage = e => {
			if (e.data?.s !== challenge) return;
			channel.close();
			stopWatching();
			if (!settled) {
				settled = true;
				resolve(e.data as Record<string, string>);
				return;
			}
			// Already reported as cancelled, but the user finished in the popup after all.
			void complete(e.data as Record<string, string>).then(
				() => refreshMe(),
				() => undefined,
			);
		};
		// Providers' pages can cut a popup off from this window, which then looks closed while the
		// user is still signing in. Back here with the popup gone means they closed it; a result
		// that arrives later still completes (above), until the timeout.
		const cancelSoon = () =>
			window.setTimeout(() => {
				if (settled) return;
				settled = true;
				reject(new Error("Sign-in was cancelled"));
			}, 3000);
		const onFocus = () => popup.closed && cancelSoon();
		const closedPoll = window.setInterval(() => popup.closed && document.hasFocus() && !settled && cancelSoon(), 1000);
		const timeout = window.setTimeout(() => {
			channel.close();
			stopWatching();
			if (!settled) {
				settled = true;
				reject(new Error("Sign-in timed out. Try again."));
			}
		}, 10 * 60_000);
		window.addEventListener("focus", onFocus);
	});
	await complete(result);
}
