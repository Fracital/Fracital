import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LinkCard from "../components/LinkCard";
import { isColorBright } from "../libs/colorBright";
import { quickLinks } from "../libs/init";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import { ChatBubbleLeftRightIcon, MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useSettingsStore, useTabsStore } from "../store";
import { navigationEvent } from "../libs/eventBus";
import { useHolyAttr } from "../libs/holy-attr";
import { urlFromInput } from "../libs/searchEngines";
import { HolyText } from "../components/common/HolyText";
import { HolyLink } from "../components/common/HolyLink";
import { AD_UNITS, RevSlot } from "../components/AdBanner";

export interface linkProps {
	title: string;
	icon: string;
	color: string;
	href: string;
}

interface HomeProps {
	className?: string;
	/** This new tab is the one on screen (only it shows the video ad). */
	active?: boolean;
}

const Home = ({ className, active }: HomeProps) => {
	const settings = useSettingsStore(state => state.settings);

	const getLinks = () => {
		const stored = window.localStorage.getItem("quicklinks");
		try {
			return stored ? JSON.parse(stored) : quickLinks;
		} catch {
			return quickLinks;
		}
	};

	const [links, setLinks] = useState<linkProps[]>(getLinks());
	const { ref: searchRef, placeholder: searchAttrs } = useHolyAttr({ placeholder: "Search or type a web address", "aria-label": "Search or type a web address" });

	/** Opens what was typed in this tab, the way the address bar does. */
	const go = (query: string) => {
		const text = query.trim();
		const tab = useTabsStore.getState().tabs.find(t => t.current);
		if (!text || !tab) return;
		navigationEvent({ url: urlFromInput(text), icon: null, title: "New Tab", displayUrl: text, id: tab.id });
	};

	/** The community chat (about:chat): the open chat tab, or a new one. Offered only when the server runs it. */
	const chatOn = typeof window !== "undefined" && !!window.__FRX_CFG__?.talk;
	const openChat = () => {
		const { tabs, setCurrentTab, newTab } = useTabsStore.getState();
		const existing = tabs.find(t => t.url === "about:chat");
		if (existing) setCurrentTab(existing.id);
		else newTab({ id: createId(), url: "about:chat", displayUrl: "about:chat", title: "Chat", icon: <ChatBubbleLeftRightIcon className="size-4.5" />, current: true });
	};

	useEffect(() => {
		const handleLinksUpdate = () => {
			setLinks(getLinks());
		};

		window.addEventListener("links-upd", handleLinksUpdate);
		window.addEventListener("storage", handleLinksUpdate);

		return () => {
			window.removeEventListener("links-upd", handleLinksUpdate);
			window.removeEventListener("storage", handleLinksUpdate);
		};
	}, []);

	return (
		<div className={"@container flex flex-col items-center size-full p-2 overflow-y-auto" + " " + className}>
			<div className="flex flex-1 flex-col w-full items-center justify-center gap-4 py-6">
				<span className="text-5xl @lg:text-6xl @2xl:text-7xl font-black text-center text-accent text-stroke">
					<HolyText text="FRACITAL" />
				</span>
				<form
					className="flex w-full max-w-3xl items-center gap-2 px-4 rounded-full bg-(--secondary) inset-shadow-(--inset-shadow-secondary) focus-within:inset-shadow-(--inset-shadow-accent) duration-200"
					onSubmit={e => {
						e.preventDefault();
						go(new FormData(e.currentTarget).get("q")?.toString() ?? "");
					}}
				>
					<MagnifyingGlassIcon className="size-5 shrink-0 text-(--text-tertiary)" />
					<input ref={searchRef} {...searchAttrs} name="q" type="text" autoComplete="off" spellCheck={false} className="w-full min-w-0 py-3 bg-transparent outline-none text-(--text-primary) font-semibold placeholder:text-(--text-tertiary)" />
				</form>
				{chatOn && (
					<button type="button" onClick={openChat} className="flex items-center gap-2 px-4 py-2 rounded-full bg-(--secondary) inset-shadow-(--inset-shadow-secondary) hover:inset-shadow-(--inset-shadow-accent) text-(--text-secondary) hover:text-(--text-primary) font-semibold duration-200">
						<ChatBubbleLeftRightIcon className="size-5 shrink-0 text-accent" />
						<HolyText text="Chat with the community" />
					</button>
				)}
				<div className="grid w-full max-w-3xl grid-cols-2 @lg:grid-cols-3 gap-3 @lg:gap-4">{links.length > 0 && links.map((link, index) => <LinkCard key={index} title={link.title} icon={link.icon} color={link.color} href={link.href} edit={false} brightness={isColorBright(link.color)} />)}</div>
				{active && <RevSlot name="video" className="w-full max-w-xl" fallback={AD_UNITS.box} />}
			</div>
			<div className="flex shrink-0 flex-wrap items-center w-full overflow-hidden">
				<Link
					target="_blank"
					to="/LICENSE"
					className={
						"flex items-center h-full p-2 rounded-md leading-none text-(--text-quaternary) font-bold text-lg duration-150" +
						" " +
						`
                    ${settings.brightness === "dark" ? "hover:bg-[#ffffff18] hover:text-(--text-secondary)" : "hover:bg-[#00000025] hover:text-(--text-secondary)"}
                `
					}
				>
					<HolyText text="© Fracital 2026" />
				</Link>
				<div className="flex gap-1.5 p-1.5">
					<HolyLink href="https://discord.gg/fracital" target="_blank" className="flex items-center gap-1.5 text-(--text-quaternary) hover:text-(--text-tertiary) font-bold text-lg">
						<FontAwesomeIcon icon={faDiscord} className="text-current duration-150" />
						<span className="text-current duration-150">
							<HolyText text="Discord" />
						</span>
					</HolyLink>
				</div>
			</div>
		</div>
	);
};

export default Home;
