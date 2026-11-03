import { useCallback, useEffect, useRef } from "react";
import type { Frame } from "@mercuryworkshop/scramjet-controller";
import { unrewriteUrl } from "@mercuryworkshop/scramjet";
import { useTabsStore } from "../store";

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

const ExternalSite = ({ url, className, current, id }: ExternalSiteProps) => {
	const frameRef = useRef<HTMLIFrameElement>(null);
	const sjFrameRef = useRef<Frame | null>(null);
	const navigatedUrlRef = useRef<string | undefined>(undefined);
	const updateTab = useTabsStore(state => state.updateTab);

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
		frame.go(url);
	}, [url, getSjFrame]);

	useEffect(() => {
		const iframe = frameRef.current;
		if (!iframe) return;

		const handleLoad = () => {
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
			if (detail?.tab === id) getSjFrame()?.reload();
		};

		window.addEventListener("reload-tab", reloadTab);
		iframe.addEventListener("load", handleLoad);
		return () => {
			window.removeEventListener("reload-tab", reloadTab);
			iframe.removeEventListener("load", handleLoad);
		};
	}, [url, updateTab, id, getSjFrame]);

	return <>{url !== undefined ? <iframe ref={frameRef} className={`size-[calc(100%-4px)] left-0.5 top-0.5 rounded-2xl duration-150 ${className ?? ""}` + " " + (current ? "" : "opacity-0 translate-y-3 pointer-events-none")} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation" /> : null}</>;
};

export default ExternalSite;
