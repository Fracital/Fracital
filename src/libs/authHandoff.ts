/**
 * Signing in through the auth host from any other of our hosts (server side:
 * src/server/auth-handoff.ts). The auth host's handoff page runs in a stomp
 * proxy tab, so it works even where that host is blocked. When the user has
 * signed in there, the page navigates to this origin's landing URL with a
 * one-time code; the proxy refuses to proxy its own origin, which is the signal
 * we wait for (as in lastfmProxy.ts). We then redeem the code here with the
 * verifier only this page holds, which gives this host its own session.
 */
import { createId } from "@paralleldrive/cuid2";
import { authClient, refreshMe } from "./auth";
import { bootStomp, type StompRequestInfo } from "./stompEngine";
import { useTabsStore } from "../store";

const LANDING = "/api/me/handoff/land";

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

const codeFrom = (url: string): string | null => {
	if (!url.startsWith(`${location.origin}${LANDING}`)) return null;
	try {
		return new URL(url).searchParams.get("code");
	} catch {
		return null;
	}
};

async function redeem(code: string, verifier: string): Promise<void> {
	const res = await authClient.$fetch<{ ok: boolean }>("/handoff/redeem", { method: "POST", body: { code, verifier } });
	if (res.error) throw new Error(res.error.message || "Sign-in failed");
	await refreshMe();
}

/**
 * Opens the auth host's sign-in page (`handoffUrl`, from the auth options) in a
 * proxy tab and resolves once this host is signed in. `method` starts that
 * sign-in method right away ("google", "lastfm", …); omit it to let the user pick.
 * Rejects as cancelled when the tab is closed first.
 */
export async function signInViaHandoff(handoffUrl: string, method?: string): Promise<void> {
	const controller = await bootStomp();
	const { verifier, challenge } = await pkcePair();
	const url = `${handoffUrl}?return=${encodeURIComponent(location.origin)}&challenge=${challenge}${method ? `&method=${encodeURIComponent(method)}` : ""}`;

	return new Promise((resolve, reject) => {
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
		const sawUrl = (reported: string) => {
			const code = codeFrom(reported);
			if (!code) return;
			settle(() => {
				useTabsStore.getState().closeTab(tabId);
				redeem(code, verifier).then(resolve, reject);
			});
		};
		const onRequest = (e: Event) => sawUrl(((e as CustomEvent).detail as StompRequestInfo).url);
		const onNavigate = (e: Event) => sawUrl(((e as CustomEvent).detail as { info: { url: string } }).info.url);
		const unsubscribe = useTabsStore.subscribe(state => {
			if (!state.tabs.some(t => t.id === tabId)) settle(() => reject(new Error("Sign-in was cancelled")));
		});
		controller.addEventListener("request", onRequest);
		controller.addEventListener("navigate", onNavigate);
		useTabsStore.getState().newTab({ id: tabId, url, displayUrl: url, title: "Sign in", icon: null, current: true, engine: "st" });
	});
}
