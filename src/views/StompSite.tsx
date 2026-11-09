import { useCallback, useEffect, useRef } from "react";
import { useTabsStore } from "../store";
import { hostOf, useStompStore, type StompFrame, type StompNavigateInfo } from "../libs/stompEngine";

// A tab on the stomp engine: the counterpart of ExternalSite (Scramjet). The
// same props and the same tab-store writes, so the shell drives both alike;
// the difference is where the page's state comes from. Scramjet's view reads
// the frame's document on load; stomp's frame reports URL, title, icon and
// history state itself (the `navigate` event), which is what the address bar
// and the tab follow.
interface StompSiteProps {
	url: string | undefined;
	// Bumped by the store for every navigation the user asks for, so the same url again still runs a go().
	navNonce?: number;
	className?: string;
	current?: boolean;
	id: string;
}

// The page's icon as it declared it (resolved by the engine), else the site's /favicon.ico like ExternalSite.
const iconFor = (info: StompNavigateInfo): string | null => {
	if (info.icon) return info.icon;
	try {
		return new URL("/favicon.ico", info.url).href;
	} catch {
		return null;
	}
};

const StompSite = ({ url, navNonce, className, current, id }: StompSiteProps) => {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const stFrameRef = useRef<StompFrame | null>(null);
	// The last navigation request run (nonce and url), not the page's current URL.
	const navigatedRef = useRef<string | undefined>(undefined);
	const updateTab = useTabsStore(state => state.updateTab);
	const controller = useStompStore(state => state.controller);

	const getFrame = useCallback(() => {
		const iframe = frameRef.current;
		if (!iframe || !controller) return null;
		if (stFrameRef.current?.element !== iframe) {
			stFrameRef.current = controller.createFrame(iframe);
			navigatedRef.current = undefined;
		}
		return stFrameRef.current;
	}, [controller]);

	// One go() per navigation request. Page-made navigations only update the
	// display (handleNavigate below) and leave url and navNonce alone, so asking
	// for the url the tab was last sent to, or the page's own URL, still goes.
	useEffect(() => {
		if (url === undefined) return;
		const frame = getFrame();
		const request = `${navNonce ?? 0} ${url}`;
		// StrictMode re-runs effects; skip the duplicate go() so the first load isn't aborted.
		if (!frame || navigatedRef.current === request) return;
		navigatedRef.current = request;
		frame.go(url).catch(error => console.warn("stomp navigation failed:", url, error));
	}, [url, navNonce, getFrame]);

	useEffect(() => {
		const frame = getFrame();
		if (!frame) return;

		// The page reported where it is: on load, pushState, hashchange, a title
		// change or an icon change. The first report comes at document start, so
		// the title may still be empty; the hostname stands in until the page
		// says more.
		const handleNavigate = (e: Event) => {
			const info = (e as CustomEvent<StompNavigateInfo>).detail;
			if (!info?.url) return;
			const title = info.title || hostOf(info.url);
			const icon = iconFor(info);
			updateTab(id, { title, displayUrl: info.url, icon });
			const store = useTabsStore.getState();
			// Reloads, back/forward and title changes land on the current entry; don't push a duplicate.
			const currentEntry = store.getHistory(id)?.[store.getHistoryIndex(id)];
			if (currentEntry?.url !== info.url) store.pushHistory(id, { url: info.url, title, icon: icon ?? undefined });
			window.dispatchEvent(new CustomEvent("updatedTab", { detail: JSON.stringify({ id, title, icon }) }));
		};

		const reloadTab = (e: Event) => {
			const detail = (e as CustomEvent).detail;
			if (detail?.tab === id) void frame.reload();
		};

		frame.addEventListener("navigate", handleNavigate);
		window.addEventListener("reload-tab", reloadTab);
		return () => {
			frame.removeEventListener("navigate", handleNavigate);
			window.removeEventListener("reload-tab", reloadTab);
		};
	}, [updateTab, id, getFrame]);

	// The sandbox attribute is stomp's to set (createFrame applies its default).
	return <>{url !== undefined ? <iframe ref={frameRef} className={`size-[calc(100%-4px)] left-0.5 top-0.5 rounded-2xl duration-150 ${className ?? ""}` + " " + (current ? "" : "opacity-0 translate-y-3 pointer-events-none")} /> : null}</>;
};

export default StompSite;
