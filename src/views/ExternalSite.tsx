import { useCallback, useEffect, useRef } from "react";
import type { Frame } from "@mercuryworkshop/scramjet-controller";
import { unrewriteUrl } from "@mercuryworkshop/scramjet";
import { useTabAudioStore, useTabLoadingStore, useTabsStore } from "../store";

const LOAD_STUCK_MS = 45_000;

interface ExternalSiteProps {
	url: string | undefined;
	className?: string;
	current?: boolean;
	id: string;
}

const getIconUrl = (doc: Document | null | undefined, pageUrl: string, frame: Frame): string | null => {
	const link = doc?.querySelector<HTMLLinkElement>("link[rel~='icon'], link[rel='apple-touch-icon']");
	try {
		if (!link?.getAttribute("href")) return new URL("/favicon.ico", pageUrl).href;
		const resolved = new URL(link.href);
		// Store the real URL; proxied URLs are tied to this session's controller id.
		if (resolved.origin === window.location.origin && resolved.pathname.startsWith(frame.prefix)) return unrewriteUrl(resolved.href, frame.context);
		return resolved.href;
	} catch {
		return null;
	}
};

/** Every <audio>/<video> in the page and its same-origin subframes. */
const collectMedia = (doc: Document | null | undefined, out: HTMLMediaElement[] = [], depth = 0): HTMLMediaElement[] => {
	if (!doc || depth > 4) return out;
	out.push(...doc.querySelectorAll<HTMLMediaElement>("audio, video"));
	for (const frame of doc.querySelectorAll("iframe, frame")) {
		try {
			collectMedia((frame as HTMLIFrameElement).contentDocument, out, depth + 1);
		} catch {
			// cross-origin subframe
		}
	}
	return out;
};

const AUDIO_POLL_MS = 1000;

/**
 * Marks the tab audible while its page plays sound and enforces the tab's mute. Only media elements in the
 * DOM are seen; Web Audio and detached `new Audio()` playback can't be detected from outside the page.
 */
const useTabAudio = (frameRef: React.RefObject<HTMLIFrameElement | null>, id: string) => {
	const muted = useTabAudioStore(state => Boolean(state.muted[id]));
	const setAudible = useTabAudioStore(state => state.setAudible);
	// Elements this tab muted, so unmuting doesn't unmute what the page muted itself.
	const mutedByTab = useRef(new WeakSet<HTMLMediaElement>());

	useEffect(() => {
		const check = () => {
			let media: HTMLMediaElement[];
			try {
				media = collectMedia(frameRef.current?.contentDocument);
			} catch {
				// The frame is showing a cross-origin page.
				media = [];
			}
			let audible = false;
			for (const el of media) {
				if (muted && !el.muted) {
					el.muted = true;
					mutedByTab.current.add(el);
				} else if (!muted && mutedByTab.current.has(el)) {
					el.muted = false;
					mutedByTab.current.delete(el);
				}
				const silenced = el.muted && !mutedByTab.current.has(el);
				if (!el.paused && !el.ended && el.readyState >= 2 && el.volume > 0 && !silenced) audible = true;
			}
			setAudible(id, audible);
		};
		check();
		const timer = window.setInterval(check, AUDIO_POLL_MS);
		return () => window.clearInterval(timer);
	}, [frameRef, id, muted, setAudible]);
};

const ExternalSite = ({ url, className, current, id }: ExternalSiteProps) => {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const sjFrameRef = useRef<Frame | null>(null);
	const navigatedUrlRef = useRef<string | undefined>(undefined);
	const updateTab = useTabsStore(state => state.updateTab);
	const loading = useTabLoadingStore(state => Boolean(state.loading[id]));
	const setLoading = useTabLoadingStore(state => state.setLoading);
	useTabAudio(frameRef, id);

	// Never leave the bar running forever if a load event never arrives.
	useEffect(() => {
		if (!loading) return;
		const timer = setTimeout(() => setLoading(id, false), LOAD_STUCK_MS);
		return () => clearTimeout(timer);
	}, [loading, id, setLoading]);

	const getSjFrame = useCallback(() => {
		const iframe = frameRef.current;
		const controller = window.scramjetController;
		if (!iframe || !controller) return null;
		if (sjFrameRef.current?.element !== iframe) {
			sjFrameRef.current = controller.createFrame(iframe);
			navigatedUrlRef.current = undefined;
		}
		return sjFrameRef.current;
	}, []);

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
			try {
				const frame = getSjFrame();
				const doc = iframe.contentDocument;
				const href = iframe.contentWindow?.location?.href;
				if (!frame || !href || href === "about:blank" || href === "about:srcdoc") return;
				const title = doc?.title || "New Tab";
				const realUrl = unrewriteUrl(href, frame.context);
				const icon = getIconUrl(doc, realUrl, frame);
				updateTab(id, {
					title,
					icon,
					displayUrl: realUrl,
				});
				const store = useTabsStore.getState();
				// Reloads and back/forward land on the current history entry; don't push a duplicate.
				const currentEntry = store.getHistory(id)?.[store.getHistoryIndex(id)];
				if (currentEntry?.url !== realUrl) store.pushHistory(id, { url: realUrl, title, icon: icon || undefined });
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
