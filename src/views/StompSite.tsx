import { useCallback, useEffect, useRef } from "react";
import { useTabsStore } from "../store";
import { hostOf, STOMP_DIRECTORY, useStompStore, type StompFrame, type StompNavigateInfo } from "../libs/stompEngine";

// A tab on the stomp engine: the counterpart of ExternalSite (Scramjet). The
// same props and the same tab-store writes, so the shell drives both alike;
// the difference is where the page's state comes from. Scramjet's view reads
// the frame's document on load; stomp's frame reports URL, title and history
// state itself (the `navigate` event), which is what the address bar follows.
interface StompSiteProps {
	url: string | undefined;
	className?: string;
	current?: boolean;
	id: string;
}

// The page's icon, read from its document on load. The frame is same-origin,
// and the inject hooks make `link.href` answer with the real URL, so this is
// the address to store (a routed URL would be tied to this controller's id).
const getIconUrl = (doc: Document | null | undefined, pageUrl: string): string | null => {
	try {
		const link = doc?.querySelector<HTMLLinkElement>("link[rel~='icon'], link[rel='apple-touch-icon']");
		if (!link?.getAttribute("href")) return new URL("/favicon.ico", pageUrl).href;
		const href = link.href;
		if (href.startsWith(`${window.location.origin}${STOMP_DIRECTORY}`)) return new URL("/favicon.ico", pageUrl).href;
		return href;
	} catch {
		return null;
	}
};

const StompSite = ({ url, className, current, id }: StompSiteProps) => {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const stFrameRef = useRef<StompFrame | null>(null);
	const navigatedUrlRef = useRef<string | undefined>(undefined);
	const updateTab = useTabsStore(state => state.updateTab);
	const controller = useStompStore(state => state.controller);

	const getFrame = useCallback(() => {
		const iframe = frameRef.current;
		if (!iframe || !controller) return null;
		if (stFrameRef.current?.element !== iframe) {
			stFrameRef.current = controller.createFrame(iframe);
			navigatedUrlRef.current = undefined;
		}
		return stFrameRef.current;
	}, [controller]);

	useEffect(() => {
		if (url === undefined) return;
		const frame = getFrame();
		// StrictMode re-runs effects; skip the duplicate go() so the first load isn't aborted.
		if (!frame || navigatedUrlRef.current === url) return;
		navigatedUrlRef.current = url;
		frame.go(url).catch(error => console.warn("stomp navigation failed:", url, error));
	}, [url, getFrame]);

	useEffect(() => {
		const iframe = frameRef.current;
		const frame = getFrame();
		if (!iframe || !frame) return;

		// The page reported where it is: on load, pushState, hashchange and a
		// title change. The first report comes at document start, so the title
		// may still be empty; the hostname stands in until the page says more.
		const handleNavigate = (e: Event) => {
			const info = (e as CustomEvent<StompNavigateInfo>).detail;
			if (!info?.url) return;
			const title = info.title || hostOf(info.url);
			updateTab(id, { title, displayUrl: info.url });
			const store = useTabsStore.getState();
			// Reloads, back/forward and title changes land on the current entry; don't push a duplicate.
			const currentEntry = store.getHistory(id)?.[store.getHistoryIndex(id)];
			if (currentEntry?.url !== info.url) store.pushHistory(id, { url: info.url, title });
			window.dispatchEvent(new CustomEvent("updatedTab", { detail: JSON.stringify({ id, title, icon: null }) }));
		};

		const handleLoad = () => {
			try {
				const pageUrl = frame.url;
				if (!pageUrl) return;
				const icon = getIconUrl(iframe.contentDocument, pageUrl);
				const title = frame.title || hostOf(pageUrl);
				updateTab(id, { icon });
				window.dispatchEvent(new CustomEvent("updatedTab", { detail: JSON.stringify({ id, title, icon }) }));
			} catch {
				window.dispatchEvent(new CustomEvent("updatedTab", { detail: JSON.stringify({ id, title: null, icon: null }) }));
			}
		};

		const reloadTab = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail?.tab === id) void frame.reload();
		};

		frame.addEventListener("navigate", handleNavigate);
		iframe.addEventListener("load", handleLoad);
		window.addEventListener("reload-tab", reloadTab);
		return () => {
			frame.removeEventListener("navigate", handleNavigate);
			iframe.removeEventListener("load", handleLoad);
			window.removeEventListener("reload-tab", reloadTab);
		};
	}, [updateTab, id, getFrame]);

	// The sandbox attribute is stomp's to set (createFrame applies its default).
	return <>{url !== undefined ? <iframe ref={frameRef} className={`size-[calc(100%-4px)] left-0.5 top-0.5 rounded-2xl duration-150 ${className ?? ""}` + " " + (current ? "" : "opacity-0 translate-y-3 pointer-events-none")} /> : null}</>;
};

export default StompSite;
