/**
 * Fracital Accounts client. Accounts live on the Fracital server itself
 * (/api/auth via better-auth, /api/me for profile, settings and Last.fm).
 */
import { cryptoFetch } from "./api-crypto-fetch";
import { createAuthClient } from "better-auth/client";
import { saveLogin, clearLogin } from "../types";
import { compressImage, IMAGE_PRESETS } from "./compressImage";
import { connectLastfmInProxy, lastfmProxyAvailable } from "./lastfmProxy";

export const authClient = createAuthClient({
	baseURL: typeof window !== "undefined" ? window.location.origin : undefined,
	basePath: "/api/auth",
	fetchOptions: { credentials: "include" },
});

export const { signIn, signUp } = authClient;

export interface LastfmProfile {
	username: string;
	image: string;
	playcount: number;
	url: string;
	registered?: number;
}

export interface Me {
	user: { id: string; name: string; email: string | null; image: string | null };
	hasPassword: boolean;
	lastfm: LastfmProfile | null;
	lastfmAvailable: boolean;
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
	if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error || `Request failed (${res.status})`), { status: res.status });
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
		await saveLogin({ id: me.user.id, display: me.user.name, handle: me.username || me.lastfm?.username || me.user.email || me.user.name, avatar: me.user.image || me.lastfm?.image || null });
	} catch (err) {
		meCache = null;
		const status = (err as { status?: number }).status;
		if (status === 401 || status === 503) await clearLogin();
	}
	window.dispatchEvent(new Event("account-upd"));
	return me;
}

export async function signOut(): Promise<void> {
	await authClient.signOut().catch(() => {});
	meCache = null;
	await clearLogin();
	window.dispatchEvent(new Event("account-upd"));
}

/**
 * Runs Last.fm's web auth. `signin` signs in (creating an account on first use);
 * `link` connects Last.fm to the signed-in account. With the stomp engine active
 * the sign-in happens in a proxy tab (lastfmProxy.ts); otherwise, or when that
 * cannot start, in a popup. Resolves once the account is refreshed.
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
export function connectLastfmPopup(mode: "signin" | "link"): Promise<void> {
	return new Promise((resolve, reject) => {
		const popup = window.open(`/api/auth/lastfm/start?mode=${mode}`, "fracital-lastfm", "popup,width=520,height=720");
		if (!popup) return reject(new Error("Allow pop-ups for Fracital to connect Last.fm"));
		const cleanup = () => {
			window.removeEventListener("message", onMessage);
			window.clearInterval(closedPoll);
		};
		const onMessage = (e: MessageEvent) => {
			if (e.origin !== window.location.origin || e.data?.type !== "fracital:lastfm") return;
			settled = true;
			cleanup();
			if (e.data.status === "ok") void refreshMe().then(() => resolve());
			else reject(new Error(e.data.message || "Last.fm sign-in failed"));
		};
		// Closing the popup without finishing counts as a cancel (after a grace period,
		// since the popup posts its result right before closing itself).
		let settled = false;
		const closedPoll = window.setInterval(() => {
			if (!popup.closed || settled) return;
			settled = true;
			window.setTimeout(() => {
				cleanup();
				reject(new Error("Last.fm sign-in was cancelled"));
			}, 600);
		}, 500);
		window.addEventListener("message", onMessage);
	});
}

export async function disconnectLastfm(): Promise<void> {
	await meFetch("/api/me/lastfm", { method: "DELETE" });
	await refreshMe();
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
