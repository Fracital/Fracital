import { useEffect, useRef } from "react";
import XOR from "../libs/XOR";
import { useTabsStore } from "../store";

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
        const contentWindow = iframe.contentWindow;
        const contentDocument = iframe.contentDocument;

        const rawHref = contentWindow?.location?.href ?? "";
        const replacedHref = rawHref.replace(window.location.origin + "/uv/service", "");
        const newUrl = XOR.decode(replacedHref) ?? iframe.src;
        const title = contentDocument?.title ?? "New Tab";
        const icon = (contentDocument?.querySelector("link[rel~='icon']") as HTMLLinkElement | null)?.href ?? null;

        const handleLoad = () => {
            console.log(id)
            try {
                if (id) {
                    updateTab(id, {
                        title: title,
                        icon: icon,
                        displayUrl: newUrl
                    })
                }
            } catch (err) {
                if (id) {
                    updateTab(id, {
                        title: "New Tab",
                        icon: null,
                        displayUrl: "newtab"
                    })
                }
            }
        };
        const proxChange = (e: CustomEvent) => {
            iframe.src = iframe.src.replace(/\/(?:uv\/)?service\//, e.detail.proxy === "uv" ? "/uv/service/" : "/service/")
        };
        // @ts-expect-error Custom Event
        window.addEventListener("proxy-change", proxChange);
        iframe.addEventListener("load", handleLoad);
        return () => {
            // @ts-expect-error Custom Event
            window.removeEventListener("proxy-change", proxChange);
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
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                /> : null
            }
        </>
    );
}

export default ExternalSite;