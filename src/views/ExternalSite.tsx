import { useEffect, useRef, type IframeHTMLAttributes } from "react";
import XOR from "../libs/XOR";

interface ExternalSiteProps {
    url: string | undefined;
    className?: string
}

const ExternalSite: React.FC<ExternalSiteProps> = ({ url, className }) => {
    const frameRef = useRef<HTMLIFrameElement>(null)

    useEffect(() => {
        const iframe = frameRef.current;
        if (!iframe) return;

        const handleLoad = () => {
            try {
                const contentWindow = iframe.contentWindow;
                const contentDocument = iframe.contentDocument;
                const input = document.querySelector<HTMLInputElement>("#input")

                const rawHref = contentWindow?.location?.href ?? "";
                const replacedHref = rawHref.replace(window.location.origin + "/uv/service", "");
                const newUrl = XOR.decode(replacedHref) ?? iframe.src;
                const title = contentDocument?.title ?? "New Tab";
                const icon = (contentDocument?.querySelector("link[rel~='icon']") as HTMLLinkElement | null)?.href ?? null;

                // if (input) {
                //     input.value = newUrl;
                // }
                window.dispatchEvent(new CustomEvent("proxy-navigate", {
                    detail: {
                        url: newUrl,
                        title,
                        icon
                    }
                }));
            } catch (err) {
                // Cross-origin protection fallback
                window.dispatchEvent(new CustomEvent("proxy-navigate", {
                    detail: {
                        url: iframe.src
                    }
                }));
            }
        };

        iframe.addEventListener("load", handleLoad);
        return () => iframe.removeEventListener("load", handleLoad);
    }, []);

    return (
        <>
            {
                url !== undefined ?<iframe
                    ref={frameRef}
                    className={`w-full h-full ${className ?? ""}`}
                    src={url}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                /> : null
            }
        </>
    );
}

export default ExternalSite;