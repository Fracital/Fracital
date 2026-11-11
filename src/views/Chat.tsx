import { UserCircleIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect } from "react";
import { HolyText } from "../components/common/HolyText";
import { useHolyAttr } from "../libs/holy-attr";
import { useTabsStore } from "../store";

/**
 * about:chat — the community chat (holt), bridged with Discord.
 *
 * The chatbox is holt's own page, served on this origin under the keyed chat path the server injects
 * (`__FRX_CFG__.talk`, src/server/chat-relay.ts), so it runs same-origin and the Fracital session cookie
 * signs the user in. It lives in a frame here; Fracital renders nothing of the chat itself.
 *
 * The chatbox sends account actions ("Sign in", "Account", "Settings", "Edit profile", the privacy link)
 * by setting the top page's hash to its view (`#/account`, …; holt's lib/navigate.ts). This page turns
 * those into Fracital tabs and takes the hash back off, so the address bar never keeps it.
 */

const ACCOUNT_VIEWS = new Set(["account", "settings", "verify-email"]);
// Absolute: on a decoy host a relative path would stay on the decoy, which doesn't serve it (Shell.tsx).
const LEGAL_PAGES: Record<string, string> = { privacy: "https://fracit.al/privacy", tos: "https://fracit.al/tos" };

const openTab = (url: string, title: string, icon: React.ReactNode = null) => {
	const { tabs, setCurrentTab, newTab } = useTabsStore.getState();
	const existing = tabs.find(t => t.url === url);
	if (existing) setCurrentTab(existing.id);
	else newTab({ id: createId(), url, displayUrl: url, title, icon, current: true });
};

/** One handler for every mounted chat tab, so a click opens one tab, not one per chat. */
let mounted = 0;
const windows = (): Window[] => {
	const out: Window[] = [window];
	try {
		// The app may itself be framed by a page of this origin; the chatbox then sets that page's hash.
		if (window.top && window.top !== window && window.top.location.origin === window.location.origin) out.push(window.top);
	} catch {
		// A cross-origin parent: its hash is not ours to read.
	}
	return out;
};

const onHashChange = (event: HashChangeEvent) => {
	const target = event.currentTarget as Window;
	const view = /^#\/([a-z][a-z-]{0,31})$/.exec(target.location.hash)?.[1];
	if (!view) return;
	target.history.replaceState(target.history.state, "", target.location.pathname + target.location.search);
	if (ACCOUNT_VIEWS.has(view)) openTab("about:account", "Fracital Account", <UserCircleIcon className="size-5" />);
	else if (LEGAL_PAGES[view]) openTab(LEGAL_PAGES[view], view === "privacy" ? "Privacy Policy" : "Terms of Service");
};

const useAccountLinks = () => {
	useEffect(() => {
		const targets = windows();
		if (mounted++ === 0) for (const w of targets) w.addEventListener("hashchange", onHashChange);
		return () => {
			if (--mounted === 0) for (const w of targets) w.removeEventListener("hashchange", onHashChange);
		};
	}, []);
};

export default function Chat({ className }: { className?: string }) {
	useAccountLinks();
	const src = typeof window !== "undefined" ? window.__FRX_CFG__?.talk : undefined;
	const { ref: frameRef, placeholder: frameAttrs } = useHolyAttr({ title: "Chat" });

	if (!src) {
		return (
			<div className={`${className ?? ""} flex flex-col items-center justify-center gap-2 p-6 text-center`}>
				<HolyText as="p" className="text-lg font-semibold" text="Chat isn't available right now" />
				<HolyText as="p" className="text-sm text-(--text-secondary)" text="Try again in a little while." />
			</div>
		);
	}

	return (
		<div className={className}>
			<iframe ref={frameRef} {...frameAttrs} src={src} className="size-full border-0 bg-(--secondary)" allow="clipboard-write; fullscreen; autoplay" />
		</div>
	);
}
