import { useEffect, useRef } from "react";
import { useTabsStore } from "../store";
import XOR from "../libs/XOR";

interface ExternalSiteProps {
    url: string | undefined
    className?: string
    current?: boolean
    id: string
}

const ExternalSite = ({ url, className, current, id }: ExternalSiteProps) => {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const updateTab = useTabsStore(state => state.updateTab)

    useEffect(() => {
        const iframe = frameRef.current;
        if (!iframe) return;

        const handleLoad = () => {
            try {
                const doc = iframe.contentDocument;
                const href = iframe.contentWindow?.location?.href;
                if (!href || href === "about:blank" || href === "about:srcdoc") return;
                const title = doc?.title ?? "New Tab";
                const icon = (doc?.querySelector("link[rel~='icon']") as HTMLLinkElement | null)?.href ?? null;
                const url = XOR.decode(href.replace(/(^https?:\/\/[^/]+)|\/(?:uv\/)?service\//g, ""));
                updateTab(id, {
                    title,
                    icon,
                    displayUrl: url
                });
                useTabsStore.getState().setHistory(id, [
                    ...(useTabsStore.getState().getHistory(id) || []),
                    { url: url, title: title, icon: icon || undefined }
                ]);
                window.dispatchEvent(new CustomEvent("updatedTab", { detail: JSON.stringify({
                    id: id,
                    title: title,
                    icon: icon,
                }) }));
            } catch {
                window.dispatchEvent(new CustomEvent("updatedTab", { detail: JSON.stringify({
                    id: id,
                    title: null,
                    icon: null,
                }) }));
            }
        };

        const proxChange = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            iframe.src = iframe.src.replace(/\/(?:uv\/)?service\//, detail?.proxy === "uv" ? "/uv/service/" : "/service/");
        };

        const reloadTab = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.tab === id) {
                iframe.contentWindow?.location.reload();
            }
        };

        window.addEventListener("proxy-change", proxChange);
        window.addEventListener("reload-tab", reloadTab);
        iframe.addEventListener("load", handleLoad);
        return () => {
            window.removeEventListener("proxy-change", proxChange);
            window.removeEventListener("reload-tab", reloadTab);
            iframe.removeEventListener("load", handleLoad);
        };
    }, [url, updateTab, id]);

    return (
        <>
            {
                url !== undefined ? <iframe
                    ref={frameRef}
                    className={`w-full h-full duration-150 ${className ?? ""}` + " " + (current ? "" : "opacity-0 translate-y-3 pointer-events-none")}
                    src={url}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
                /> : null
            }
        </>
    );
}

export default ExternalSite;