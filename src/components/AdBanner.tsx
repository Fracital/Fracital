import { useEffect, useRef } from "react";

/**
 * Adsterra 300×250 banner, run directly in the page. invoke.js reads window.atOptions
 * and inserts the ad next to its own <script> tag, so the tag is injected into this
 * component's container on mount and cleared on unmount.
 */
const AD_KEY = "267f2250ca310d6a47a2dc5e59fc112a";
const WIDTH = 300;
const HEIGHT = 250;

declare global {
	interface Window {
		atOptions?: { key: string; format: string; height: number; width: number; params: Record<string, unknown> };
	}
}

export const AdBanner = ({ className = "" }: { className?: string }) => {
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = ref.current;
		if (!container) return;
		window.atOptions = { key: AD_KEY, format: "iframe", height: HEIGHT, width: WIDTH, params: {} };
		const script = document.createElement("script");
		script.src = `https://www.highrevenueformat.com/${AD_KEY}/invoke.js`;
		script.async = true;
		container.appendChild(script);
		return () => {
			container.replaceChildren();
		};
	}, []);

	return <div ref={ref} className={`flex items-center justify-center shrink-0 overflow-hidden ${className}`} style={{ width: WIDTH, height: HEIGHT }} />;
};
