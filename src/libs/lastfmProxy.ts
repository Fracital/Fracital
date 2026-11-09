/**
 * Last.fm's web auth inside the stomp proxy. The popup path (auth.ts) opens
 * /api/auth/lastfm/start in a raw popup and gets its answer by postMessage
 * from the done page. Under the stomp engine the same sign-in runs in a
 * Fracital tab instead: the server hands us Last.fm's auth URL (/lastfm/url),
 * the tab shows it through the proxy, and when Last.fm sends the browser to
 * our callback the proxy refuses to proxy its own origin, which is the signal
 * we wait for. The host then calls the callback first-party with the token,
 * so the server exchanges it exactly as it does for the popup, and closes
 * the tab.
 */
import { createId } from "@paralleldrive/cuid2";
import { cryptoFetch } from "./api-crypto-fetch";
import { useStompStore, type StompRequestInfo } from "./stompEngine";
import { useTabsStore } from "../store";

interface LastfmStart {
	url: string;
	callback: string;
}

/** The engine is the active one and has a controller to open tabs on. */
export const lastfmProxyAvailable = (): boolean => {
	const { active, status, controller } = useStompStore.getState();
	return active && status === "ready" && !!controller;
};

/** Asks the server to begin Last.fm's auth and hand back the URL (instead of redirecting to it). */
async function beginLastfm(mode: "signin" | "link"): Promise<LastfmStart> {
	const res = await cryptoFetch(`/api/auth/lastfm/url?mode=${mode}`, { credentials: "include" });
	const data = (await res.json().catch(() => ({}))) as Partial<LastfmStart> & { error?: string; message?: string };
	if (!res.ok || !data.url || !data.callback) throw Object.assign(new Error(data.message || data.error || `Request failed (${res.status})`), { status: res.status });
	return { url: data.url, callback: data.callback };
}

/**
 * Calls our callback first-party with the token Last.fm issued. The server
 * answers like it does for the popup: a redirect to the done page carrying
 * the status, which fetch follows; the status is read from the final URL.
 * Plain fetch, as the browser navigation was: the answer is a page, not a
 * sealed API body.
 */
async function finishLastfm(callback: string, token: string): Promise<void> {
	const res = await fetch(`${callback}?token=${encodeURIComponent(token)}`, { credentials: "include", redirect: "follow" });
	const done = (() => {
		try {
			return new URL(res.url);
		} catch {
			return null;
		}
	})();
	if (done?.pathname === "/api/me/lastfm/done") {
		if (done.searchParams.get("status") === "ok") return;
		throw new Error(done.searchParams.get("message") || "Last.fm sign-in failed");
	}
	const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
	throw new Error(data.message || data.error || (res.ok ? "Last.fm sign-in failed" : `Request failed (${res.status})`));
}

const tokenFrom = (url: string, callback: string): string | null => {
	if (!url.startsWith(callback)) return null;
	try {
		return new URL(url).searchParams.get("token");
	} catch {
		return null;
	}
};

/**
 * Runs the sign-in in a proxy tab and resolves once the server has exchanged
 * the token (the caller refreshes the account). Rejects with the same messages
 * the popup path produces: cancelled when the tab is closed first, the
 * server's message when the exchange fails.
 */
export function connectLastfmInProxy(mode: "signin" | "link"): Promise<void> {
	return new Promise((resolve, reject) => {
		void (async () => {
			const controller = useStompStore.getState().controller;
			if (!controller) throw new Error("The proxy engine is not running");
			const { url, callback } = await beginLastfm(mode);

			const tabId = createId();
			let settled = false;
			const settle = (fn: () => void) => {
				if (settled) return;
				settled = true;
				controller.removeEventListener("request", onRequest);
				controller.removeEventListener("navigate", onNavigate);
				unsubscribe();
				fn();
			};
			// The browser reached our callback through the proxy: the worker refused it
			// (kind "refused", the real URL), and that URL carries the token.
			const sawUrl = (reported: string) => {
				const token = tokenFrom(reported, callback);
				if (token === null) return;
				settle(() => {
					useTabsStore.getState().closeTab(tabId);
					finishLastfm(callback, token).then(resolve, reject);
				});
			};
			const onRequest = (e: Event) => sawUrl(((e as CustomEvent).detail as StompRequestInfo).url);
			const onNavigate = (e: Event) => sawUrl(((e as CustomEvent).detail as { info: { url: string } }).info.url);
			// Closing the tab before Last.fm answered counts as a cancel, like closing the popup.
			const unsubscribe = useTabsStore.subscribe(state => {
				if (!state.tabs.some(t => t.id === tabId)) settle(() => reject(new Error("Last.fm sign-in was cancelled")));
			});
			controller.addEventListener("request", onRequest);
			controller.addEventListener("navigate", onNavigate);
			useTabsStore.getState().newTab({ id: tabId, url, displayUrl: url, title: "Last.fm", icon: null, current: true });
		})().catch(reject);
	});
}
