/**
 * The stomp proxy engine (the second engine beside Scramjet), booted lazily:
 * nothing here runs until a tab is shown with stomp selected. One controller
 * per browser tab drives every Fracital tab's frame; its id lives in
 * sessionStorage so a reload passes the same id back and the frames' history
 * entries, which carry the id in their URL, keep resolving.
 *
 * The bundle is vendored under STOMP_DIRECTORY by vite.config.ts under neutral
 * names; `assets` tells stomp what the files are called, so no served URL
 * carries the package name. The controller module itself is imported from
 * there at boot, like Scramjet's controller script, so it stays out of the
 * app bundle and in the vendor set of the obfuscation pipeline.
 */
import { create } from "zustand";
import { createId } from "@paralleldrive/cuid2";
import type { Assets, Frame, HelperNames, NavigateInfo, RequestEvent, RequestRule, StaleInfo, StompController } from "stomp-rewrite";
import { useTabsStore } from "../store";
import { wispURL } from "../types";

// Minted per build in vite.config.ts (define); `error` is also written into err.html there.
declare const __STOMP_NAMES__: HelperNames;

declare global {
	interface Window {
		/** the booted engine, for the console and scripts/stomp-check.mjs (like scramjetController) */
		stompController?: StompController;
		/** the last requests the engine reported (newest last), for the console and the checks */
		stompRequestLog?: RequestEvent[];
	}
}

/** Where the bundle is served from and the service worker's scope (vite.config.ts STOMP_DIR). */
export const STOMP_DIRECTORY = "/vendor/rt/";
/** The vendored file names (vite.config.ts STOMP_FILES). */
const STOMP_ASSETS: Assets = {
	serviceWorker: "sw.js",
	injectDocument: "doc.js",
	injectWorker: "wk.js",
	transportWorker: "tw.js",
};
const CONTROLLER_MODULE = `${STOMP_DIRECTORY}api.mjs`;
/** The epoxy transport module (Fracital build), imported by stomp's transport worker, never by a page. */
const TRANSPORT_MODULE = `${STOMP_DIRECTORY}link.mjs`;
/** Shown by the service worker for a document it failed to produce (src/stomp/error.html, copied by vite). */
const ERROR_PAGE = `${STOMP_DIRECTORY}err.html`;
/** The controller id for this browser tab; one per tab, kept across reloads. */
const ID_KEY = "fracital:st-controller";

type StompModule = typeof import("stomp-rewrite");

export type StompStatus = "idle" | "booting" | "ready" | "failed";

/** The origin presented to the Last.fm hosts below as the first party. */
const FIRST_PARTY_ORIGIN = "https://fracital.xyz";
const firstParty = { Origin: FIRST_PARTY_ORIGIN, Referer: `${FIRST_PARTY_ORIGIN}/` };
/**
 * Request rules applied in the service worker to the real URL, first match
 * wins; `onRequest` reports the index applied as `rule`. Narrow on purpose:
 * Last.fm's auth page (/api/auth and its continuation) and the API host get
 * Fracital's first-party Origin and Referer, as a popup from fracital.xyz
 * would send; the login form (POST /login) and every other Last.fm page keep
 * the Origin the page itself implies, which their CSRF checks expect.
 */
export const STOMP_RULES: RequestRule[] = [
	{ match: { url: "https://www.last.fm/api/auth*" }, action: { requestHeaders: firstParty } },
	{ match: { url: "https://ws.audioscrobbler.com/*" }, action: { requestHeaders: firstParty } },
];

const REQUEST_LOG_SIZE = 200;
const requestLog: RequestEvent[] = [];
const logRequest = (info: RequestEvent) => {
	requestLog.push(info);
	if (requestLog.length > REQUEST_LOG_SIZE) requestLog.splice(0, requestLog.length - REQUEST_LOG_SIZE);
};

interface StompState {
	status: StompStatus;
	/** stomp is the engine the tabs run on (selected and allowed by the experimental setting) */
	active: boolean;
	controller: StompController | null;
	/** the controller bundle's build (version plus commit), once booted */
	build: string | null;
	/** set while an older service worker is still in charge after a deploy */
	stale: StaleInfo | null;
	error: string | null;
}

export const useStompStore = create<StompState>()(() => ({
	status: "idle",
	active: false,
	controller: null,
	build: null,
	stale: null,
	error: null,
}));

/** The id this browser tab's controller uses, minted once and kept in sessionStorage. */
const controllerId = (): string | undefined => {
	try {
		const saved = sessionStorage.getItem(ID_KEY);
		if (saved && /^[A-Za-z0-9_-]{1,32}$/.test(saved)) return saved;
		const id = createId().slice(0, 16);
		sessionStorage.setItem(ID_KEY, id);
		return id;
	} catch {
		// no sessionStorage: stomp mints one; history entries then last for the page's life only
		return undefined;
	}
};

/** A page asked for a new tab (window.open, target=_blank, a modifier click): it becomes a Fracital tab. */
const openTab = (url: string) => {
	useTabsStore.getState().newTab({ id: createId(), url, displayUrl: url, title: hostOf(url), icon: null, current: true });
};

export const hostOf = (url: string): string => {
	try {
		return new URL(url).hostname || url;
	} catch {
		return url;
	}
};

let bootPromise: Promise<StompController> | undefined;

/**
 * Boot the engine once (idempotent; a failed boot can be retried by the next
 * call). Resolves with the controller once the service worker has a server
 * for it; the store tracks the state for the UI.
 */
export const bootStomp = (): Promise<StompController> => {
	bootPromise ??= (async () => {
		useStompStore.setState({ status: "booting", error: null });
		try {
			if (!("serviceWorker" in navigator)) throw new Error("Service workers are not supported in this browser");
			if (!wispURL) throw new Error("No relay URL");
			// The default export is the controller class. The named export carries
			// the engine's name, which the build's proxy transform renames in
			// vendor files (scripts/obfuscate-build.mjs); the default has no name.
			const { default: StompController } = (await import(/* @vite-ignore */ CONTROLLER_MODULE)) as StompModule;
			// Scope: the directory; resolves once the worker is activated (30 s cap).
			const registration = await StompController.register(STOMP_DIRECTORY, { assets: STOMP_ASSETS });
			const controller = new StompController({
				serviceworker: registration,
				// A descriptor: the controller imports and constructs the transport
				// in its own worker, off this thread, which is what lets a proxied
				// page's synchronous XHR complete.
				transport: { module: TRANSPORT_MODULE, options: [{ wisp: wispURL }] },
				directory: STOMP_DIRECTORY,
				assets: STOMP_ASSETS,
				id: controllerId(),
				codec: "xor",
				cache: true,
				errorPage: ERROR_PAGE,
				names: __STOMP_NAMES__,
				rules: STOMP_RULES,
				onOpen: openTab,
				// One report per proxied request; also dispatched as the controller's
				// `request` event, which the Last.fm flow listens to.
				onRequest: logRequest,
			});
			await controller.wait();
			const syncStale = () => useStompStore.setState({ stale: controller.stale });
			controller.addEventListener("stale", syncStale);
			controller.addEventListener("rebind", syncStale);
			useStompStore.setState({ status: "ready", controller, build: controller.build, stale: controller.stale });
			window.stompController = controller;
			window.stompRequestLog = requestLog;
			return controller;
		} catch (error) {
			bootPromise = undefined;
			useStompStore.setState({ status: "failed", error: error instanceof Error ? error.message : String(error) });
			console.error("stomp engine failed to start:", error);
			throw error;
		}
	})();
	return bootPromise;
};

export type { Frame as StompFrame, NavigateInfo as StompNavigateInfo, RequestEvent as StompRequestInfo };
