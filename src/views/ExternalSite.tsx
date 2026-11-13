import { useCallback, useEffect, useRef } from "react";
import type { Frame } from "@mercuryworkshop/scramjet-controller";
import { unrewriteUrl } from "@mercuryworkshop/scramjet";
import { useTabAudioStore, useTabLoadingStore, useTabsStore } from "../store";
import { decodeUvUrl, encodeUvUrl, UV_PREFIX } from "../libs/uvEngine";
import { applyPageStyles, runPageScripts } from "../extensions/runtime";
import { ExtensionsPlugin } from "../extensions/scramjet";

const LOAD_STUCK_MS = 45_000;
// A single-page navigation's bar: shown at least SPA_MIN_MS, ended once the page's requests are quiet for
// SPA_QUIET_MS, and never longer than SPA_MAX_MS.
const SPA_MIN_MS = 300;
const SPA_QUIET_MS = 600;
const SPA_MAX_MS = 10_000;

const stripHash = (href: string) => href.split("#")[0];

interface ExternalSiteProps {
	url: string | undefined;
	className?: string;
	current?: boolean;
	id: string;
	/** Scramjet (default) or UV: both load into a plain iframe and are read the same way. */
	engine?: "sj" | "uv";
}

/** What the view needs from an engine: where its URLs live, how to open one, and how to read one back. */
interface EngineFrame {
	prefix: string;
	go: (url: string) => void;
	unrewrite: (href: string) => string;
}

const getIconUrl = (doc: Document | null | undefined, pageUrl: string, frame: EngineFrame): string | null => {
	const link = doc?.querySelector<HTMLLinkElement>("link[rel~='icon'], link[rel='apple-touch-icon']");
	try {
		if (!link?.getAttribute("href")) return new URL("/favicon.ico", pageUrl).href;
		const resolved = new URL(link.href);
		// Store the real URL; proxied URLs are tied to this session's controller id.
		if (resolved.origin === window.location.origin && resolved.pathname.startsWith(frame.prefix)) return frame.unrewrite(resolved.href);
		return resolved.href;
	} catch {
		return null;
	}
};

/** The page's document and its same-origin subframes' documents. */
const collectDocs = (doc: Document | null | undefined, out: Document[] = [], depth = 0): Document[] => {
	if (!doc || depth > 4) return out;
	out.push(doc);
	for (const frame of doc.querySelectorAll("iframe, frame")) {
		try {
			collectDocs((frame as HTMLIFrameElement).contentDocument, out, depth + 1);
		} catch {
			// cross-origin subframe
		}
	}
	return out;
};

// Media events don't bubble, but a capturing listener on a document hears them from every element in it. A
// subframe's load is caught the same way, so its document gets watched too.
const AUDIO_EVENTS = ["play", "playing", "pause", "ended", "emptied", "volumechange", "load"] as const;

/**
 * Marks the tab audible while its page plays sound and enforces the tab's mute, re-checking only when a media
 * element starts, stops or changes volume, or a document loads. Only media elements in the DOM are seen; Web
 * Audio and detached `new Audio()` playback can't be detected from outside the page.
 */
const useTabAudio = (frameRef: React.RefObject<HTMLIFrameElement | null>, id: string, hasFrame: boolean) => {
	const muted = useTabAudioStore(state => Boolean(state.muted[id]));
	const setAudible = useTabAudioStore(state => state.setAudible);
	// Elements this tab muted, so unmuting doesn't unmute what the page muted itself.
	const mutedByTab = useRef(new WeakSet<HTMLMediaElement>());

	useEffect(() => {
		const iframe = frameRef.current;
		if (!hasFrame || !iframe) return;
		const watched = new Set<Document>();

		const update = () => {
			let docs: Document[];
			try {
				docs = collectDocs(iframe.contentDocument);
			} catch {
				// The frame is showing a cross-origin page.
				docs = [];
			}
			// Drop documents the page navigated away from; watch the ones it loaded.
			for (const doc of watched) {
				if (docs.includes(doc)) continue;
				for (const type of AUDIO_EVENTS) doc.removeEventListener(type, onEvent, true);
				watched.delete(doc);
			}
			let audible = false;
			for (const doc of docs) {
				if (!watched.has(doc)) {
					for (const type of AUDIO_EVENTS) doc.addEventListener(type, onEvent, true);
					watched.add(doc);
				}
				for (const el of doc.querySelectorAll<HTMLMediaElement>("audio, video")) {
					if (muted && !el.muted) {
						el.muted = true;
						mutedByTab.current.add(el);
					} else if (!muted && mutedByTab.current.has(el)) {
						el.muted = false;
						mutedByTab.current.delete(el);
					}
					const silenced = el.muted && !mutedByTab.current.has(el);
					if (!el.paused && !el.ended && el.volume > 0 && !silenced) audible = true;
				}
			}
			setAudible(id, audible);
		};
		// Images fire load too; only a subframe's load can bring in a new document.
		const onEvent = (e: Event) => {
			const name = (e.target as Element | null)?.localName;
			if (e.type !== "load" || name === "iframe" || name === "frame") update();
		};

		update();
		// The frame's own load (a new page) replaces its document.
		iframe.addEventListener("load", update);
		return () => {
			iframe.removeEventListener("load", update);
			for (const doc of watched) for (const type of AUDIO_EVENTS) doc.removeEventListener(type, onEvent, true);
		};
	}, [frameRef, hasFrame, id, muted, setAudible]);
};

const ExternalSite = ({ url, className, current, id, engine = "sj" }: ExternalSiteProps) => {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const sjFrameRef = useRef<Frame | null>(null);
	const engineFrameRef = useRef<EngineFrame | null>(null);
	const navigatedUrlRef = useRef<string | undefined>(undefined);
	const updateTab = useTabsStore(state => state.updateTab);
	const loading = useTabLoadingStore(state => Boolean(state.loading[id]));
	const setLoading = useTabLoadingStore(state => state.setLoading);
	useTabAudio(frameRef, id, url !== undefined);

	// Never leave the bar running forever if a load event never arrives.
	useEffect(() => {
		if (!loading) return;
		const timer = setTimeout(() => setLoading(id, false), LOAD_STUCK_MS);
		return () => clearTimeout(timer);
	}, [loading, id, setLoading]);

	const getSjFrame = useCallback((): EngineFrame | null => {
		const iframe = frameRef.current;
		if (!iframe) return null;
		if (engine === "uv") {
			engineFrameRef.current ??= { prefix: UV_PREFIX, go: target => void (iframe.src = encodeUvUrl(target)), unrewrite: href => decodeUvUrl(href) ?? href };
			return engineFrameRef.current;
		}
		const controller = window.scramjetController;
		if (!controller) return null;
		if (sjFrameRef.current?.element !== iframe) {
			const frame = controller.createFrame(iframe, { plugins: [new ExtensionsPlugin()] });
			sjFrameRef.current = frame;
			engineFrameRef.current = { prefix: frame.prefix, go: target => frame.go(target), unrewrite: href => unrewriteUrl(href, frame.context) };
			navigatedUrlRef.current = undefined;
		}
		return engineFrameRef.current;
	}, [engine]);

	useEffect(() => {
		if (url === undefined) return;
		const frame = getSjFrame();
		// StrictMode re-runs effects; skip the duplicate go() so the first load isn't aborted.
		if (!frame || navigatedUrlRef.current === url) return;
		navigatedUrlRef.current = url;
		setLoading(id, true);
		frame.go(url);
	}, [url, getSjFrame, id, setLoading]);

	useEffect(() => {
		const iframe = frameRef.current;
		if (!iframe) return;

		// Link clicks and in-page redirects start inside the frame; the page's beforeunload is the earliest signal.
		const markLoading = () => {
			if (iframe.isConnected) setLoading(id, true);
		};

		// What the address bar and the tab last showed, so only a change is written.
		let shownHref: string | undefined;
		let shownTitle: string | undefined;

		/**
		 * Reads where the page is and shows it: on load, and when a single-page site changes its URL without
		 * loading (history.pushState, as YouTube does between videos) or its title. `push` adds a back/forward
		 * entry; `replace` rewrites the current one; `pop` (the page went back or forward itself) moves to
		 * the neighbouring entry when it's that URL.
		 */
		const sync = (kind: "push" | "replace" | "pop") => {
			try {
				const frame = getSjFrame();
				const doc = iframe.contentDocument;
				const href = iframe.contentWindow?.location?.href;
				if (!frame || !href || href === "about:blank" || href === "about:srcdoc") return;
				const title = doc?.title || "New Tab";
				if (href === shownHref && title === shownTitle) return;
				shownHref = href;
				shownTitle = title;
				const realUrl = frame.unrewrite(href);
				const icon = getIconUrl(doc, realUrl, frame);
				updateTab(id, {
					title,
					icon,
					displayUrl: realUrl,
				});
				const store = useTabsStore.getState();
				const history = store.getHistory(id) ?? [];
				const index = store.getHistoryIndex(id);
				if (kind === "pop") {
					const step = history[index - 1]?.url === realUrl ? -1 : history[index + 1]?.url === realUrl ? 1 : 0;
					if (step) store.setHistoryIndex(id, index + step);
				}
				const currentEntry = store.getHistory(id)?.[store.getHistoryIndex(id)];
				const entry = { url: realUrl, title, icon: icon || undefined };
				// Reloads and back/forward land on the current history entry; don't push a duplicate.
				if (currentEntry?.url === realUrl || kind === "replace") store.replaceHistory(id, entry);
				else store.pushHistory(id, entry);
				window.dispatchEvent(
					new CustomEvent("updatedTab", {
						detail: JSON.stringify({ id, title, icon }),
					}),
				);
			} catch {
				window.dispatchEvent(
					new CustomEvent("updatedTab", {
						detail: JSON.stringify({ id, title: null, icon: null }),
					}),
				);
			}
		};

		// A single-page navigation (pushState, back/forward) loads its content without a page load, so the bar
		// runs while the page keeps fetching: until its requests have been quiet for a moment, at most a while.
		let quiet: { observer?: PerformanceObserver; timer: number } | null = null;
		const stopQuiet = () => {
			if (!quiet) return;
			quiet.observer?.disconnect();
			window.clearInterval(quiet.timer);
			quiet = null;
		};
		const loadUntilQuiet = () => {
			stopQuiet();
			const started = performance.now();
			let lastActivity = started;
			let observer: PerformanceObserver | undefined;
			try {
				const Observer = (iframe.contentWindow as (Window & typeof globalThis) | null)?.PerformanceObserver;
				if (Observer) {
					observer = new Observer(() => {
						lastActivity = performance.now();
					});
					observer.observe({ type: "resource" });
				}
			} catch {
				// cross-origin document: the time limits below still end it
			}
			setLoading(id, true);
			const timer = window.setInterval(() => {
				const now = performance.now();
				if ((now - started > SPA_MIN_MS && now - lastActivity > SPA_QUIET_MS) || now - started > SPA_MAX_MS) {
					stopQuiet();
					setLoading(id, false);
				}
			}, 100);
			quiet = { observer, timer };
		};

		// Tells push from replace for the page's own history calls; the poll below catches anything else.
		const watchHistory = () => {
			try {
				const history = iframe.contentWindow?.history;
				if (!history || (history as History & { __watched?: true }).__watched) return;
				for (const [method, kind] of [
					["pushState", "push"],
					["replaceState", "replace"],
				] as const) {
					const original = history[method];
					history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
						const before = iframe.contentWindow?.location.href;
						const result = original.apply(this, args);
						queueMicrotask(() => sync(kind));
						// A new page within the site, not a hash or state tweak.
						if (kind === "push" && before && iframe.contentWindow && stripHash(before) !== stripHash(iframe.contentWindow.location.href)) loadUntilQuiet();
						return result;
					};
				}
				(history as History & { __watched?: true }).__watched = true;
				iframe.contentWindow?.addEventListener("popstate", () => {
					sync("pop");
					loadUntilQuiet();
				});
			} catch {
				// cross-origin document
			}
		};

		/**
		 * On UV the extensions' CSS goes in once a page has loaded (UV has no hook at a page's start), and is checked
		 * again on the poll below, for frames added later. Scramjet pages get it as they start (ExtensionsPlugin).
		 */
		const styleUvPages = () => {
			if (engine !== "uv") return;
			const frame = getSjFrame();
			if (!frame) return;
			for (const doc of collectDocs(iframe.contentDocument)) {
				try {
					const pageUrl = frame.unrewrite(doc.location.href);
					// Late on UV (after the page's own scripts): fixes that must run first only help on later changes.
					runPageScripts(doc, pageUrl);
					applyPageStyles(doc, pageUrl);
				} catch {
					// cross-origin document
				}
			}
		};

		const handleLoad = () => {
			let loadedHref: string | undefined;
			try {
				loadedHref = iframe.contentWindow?.location.href;
			} catch {
				loadedHref = undefined;
			}
			// The iframe's initial about:blank isn't the page we're waiting on.
			if (loadedHref !== "about:blank" && loadedHref !== "about:srcdoc") {
				setLoading(id, false);
				try {
					iframe.contentWindow?.addEventListener("beforeunload", markLoading);
				} catch {
					// cross-origin document; reload/navigation from the shell still signal
				}
			}
			stopQuiet();
			shownHref = undefined;
			sync("push");
			watchHistory();
			styleUvPages();
		};

		// Titles change after a single-page navigation, and some URL changes (location.hash) make no history call.
		const poll = window.setInterval(() => {
			try {
				const href = iframe.contentWindow?.location?.href;
				if (href && href !== shownHref) sync("push");
				else if (iframe.contentDocument?.title && iframe.contentDocument.title !== shownTitle) sync("replace");
			} catch {
				// cross-origin document
			}
			styleUvPages();
		}, 750);

		const reloadTab = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail?.tab !== id) return;
			const frame = getSjFrame();
			if (!frame) return;
			setLoading(id, true);
			// location.reload() only reloads the committed document. That is useless when the iframe is still on
			// about:blank (first load stalled) and throws when it shows a cross-origin error page, so re-navigate
			// to the tab's real URL in those cases.
			try {
				const href = iframe.contentWindow?.location.href;
				if (href && new URL(href).pathname.startsWith(frame.prefix)) {
					iframe.contentWindow!.location.reload();
					return;
				}
			} catch {
				// cross-origin document; fall through
			}
			const store = useTabsStore.getState();
			const entry = store.getHistory(id)?.[store.getHistoryIndex(id)];
			const tab = store.tabs.find(t => t.id === id);
			const target = [entry?.url, tab?.displayUrl, url].find(u => u && /^https?:/i.test(u));
			if (target) frame.go(target);
		};

		window.addEventListener("reload-tab", reloadTab);
		iframe.addEventListener("load", handleLoad);
		return () => {
			stopQuiet();
			window.clearInterval(poll);
			window.removeEventListener("reload-tab", reloadTab);
			iframe.removeEventListener("load", handleLoad);
		};
	}, [url, updateTab, id, getSjFrame, setLoading]);

	return (
		<>
			{url !== undefined && current ? (
				<div aria-hidden="true" className="pointer-events-none absolute left-0.5 right-0.5 top-0.5 z-10 h-[3px] overflow-hidden rounded-t-2xl">
					<div className={`relative h-full origin-left overflow-hidden rounded-r-full bg-(--accent) shadow-[0_0_10px_var(--accent)] ${loading ? "view-load-bar" : "view-load-done"}`} />
				</div>
			) : null}
			{url !== undefined ? (
				<iframe ref={frameRef} className={`size-[calc(100%-4px)] left-0.5 top-0.5 rounded-2xl duration-150 ${className ?? ""}` + " " + (current ? "" : "opacity-0 translate-y-3 pointer-events-none")} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation" />
			) : null}
		</>
	);
};

export default ExternalSite;
