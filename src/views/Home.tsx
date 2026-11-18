import { faDiscord } from "@fortawesome/free-brands-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { ChatBubbleLeftRightIcon, MagnifyingGlassIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { lazy, Suspense, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AD_UNITS, RevSlot } from "../components/AdBanner";
import { HolyLink } from "../components/common/HolyLink";
import { HolyText } from "../components/common/HolyText";
import { QuickLinksGrid } from "../components/LinkCard";
import { useOmniBox } from "../components/OmniBox";
import { PolicyNotice } from "../components/PolicyNotice";
import { PromoNotice } from "../components/StreakBadge";
import { navigationEvent } from "../libs/eventBus";
import { useHolyAttr } from "../libs/holy-attr";
import { urlFromInput } from "../libs/searchEngines";
import { useSettingsStore, useTabsStore } from "../store";

// Loaded when someone first switches to it, so the new tab page itself stays small.
const ForYou = lazy(() => import("./ForYou"));

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
	/** The part after "about:newtab?": "fyp" for the For You mode. */
	query?: string;
}

const Home = ({ className, active, query }: HomeProps) => {
	const settings = useSettingsStore(state => state.settings);
	const fyp = (query ?? "").split("&").includes("fyp");

	const { ref: searchRef, placeholder: searchAttrs } = useHolyAttr({ placeholder: "Search or type a web address", "aria-label": "Search or type a web address" });
	const inputRef = useRef<HTMLInputElement | null>(null);
	const formRef = useRef<HTMLFormElement | null>(null);
	const [q, setQ] = useState("");
	const [focused, setFocused] = useState(false);
	const currentTabId = () => useTabsStore.getState().tabs.find(t => t.current)?.id;

	/** Opens what was typed in this tab, the way the address bar does. */
	const go = (query: string) => {
		const text = query.trim();
		const id = currentTabId();
		if (!text || !id) return;
		navigationEvent({ url: urlFromInput(text), icon: null, title: "New Tab", displayUrl: text, id });
	};

	/** Switches this tab between the plain new tab page and For You; the address shows which, so back and forward work. */
	const setMode = (forYou: boolean) => {
		const id = currentTabId();
		if (!id || forYou === fyp) return;
		const url = forYou ? "about:newtab?fyp" : "about:newtab";
		navigationEvent({ url, displayUrl: url, title: "New Tab", icon: null, id });
	};

	// The same suggestions as the address bar, under the box.
	const omni = useOmniBox({
		inputRef,
		anchorRef: formRef,
		query: q,
		enabled: focused,
		onNavigate: target => {
			const id = currentTabId();
			if (id) navigationEvent({ ...target, id });
		},
		onFill: setQ,
		onSubmitPlain: go,
	});

	/** The community chat (about:chat): the open chat tab, or a new one. Offered only when the server runs it. */
	const chatOn = typeof window !== "undefined" && !!window.__FRX_CFG__?.talk;
	const openChat = () => {
		const { tabs, setCurrentTab, newTab } = useTabsStore.getState();
		const existing = tabs.find(t => t.url === "about:chat");
		if (existing) setCurrentTab(existing.id);
		else newTab({ id: createId(), url: "about:chat", displayUrl: "about:chat", title: "Chat", icon: <ChatBubbleLeftRightIcon className="size-4.5" />, current: true });
	};

	return (
		<div className={"@container flex flex-col items-center size-full p-2 overflow-y-auto" + " " + className}>
			<div className="flex flex-1 flex-col w-full items-center justify-center gap-4 py-6">
				<span className="text-5xl @lg:text-6xl @2xl:text-7xl font-black text-center text-accent text-stroke">
					<HolyText text="FRACITAL" />
				</span>
				<form
					ref={formRef}
					className="flex w-full max-w-3xl items-center gap-2 px-4 rounded-full bg-(--secondary) inset-shadow-(--inset-shadow-secondary) focus-within:inset-shadow-(--inset-shadow-accent) duration-200"
					onSubmit={e => {
						e.preventDefault();
						go(q);
					}}
				>
					<MagnifyingGlassIcon className="size-5 shrink-0 text-(--text-tertiary)" />
					<input
						ref={el => {
							inputRef.current = el;
							searchRef(el);
						}}
						{...searchAttrs}
						{...omni.inputProps}
						name="q"
						type="text"
						value={q}
						onChange={e => setQ(e.target.value)}
						onFocus={() => setFocused(true)}
						onBlur={() => setFocused(false)}
						onKeyDown={omni.onKeyDown}
						className="w-full min-w-0 py-3 bg-transparent outline-none text-(--text-primary) font-semibold placeholder:text-(--text-tertiary)"
					/>
				</form>
				{omni.dropdown}
				<div className="flex items-center gap-1 p-1 rounded-full bg-(--secondary) inset-shadow-(--inset-shadow-secondary)">
					{(
						[
							[false, "New tab"],
							[true, "For you"],
						] as const
					).map(([forYou, label]) => (
						<button key={label} type="button" aria-pressed={forYou === fyp} onClick={() => setMode(forYou)} className={`px-3.5 py-1 rounded-full text-sm font-semibold duration-150 cursor-pointer ${forYou === fyp ? "bg-(--accent) text-white" : "text-(--text-secondary) hover:text-(--text-primary)"}`}>
							<HolyText text={label} />
						</button>
					))}
				</div>
				<PromoNotice className="max-w-3xl" />
				<PolicyNotice className="max-w-3xl" />
				{chatOn && (
					<button type="button" onClick={openChat} className="flex items-center gap-2 px-4 py-2 rounded-full bg-(--secondary) inset-shadow-(--inset-shadow-secondary) hover:inset-shadow-(--inset-shadow-accent) text-(--text-secondary) hover:text-(--text-primary) font-semibold duration-200">
						<ChatBubbleLeftRightIcon className="size-5 shrink-0 text-accent" />
						<HolyText text="Chat with the community" />
					</button>
				)}
				{fyp ? (
					<Suspense fallback={<div className="h-44 w-full max-w-5xl rounded-2xl bg-[#8881] animate-pulse" aria-hidden="true" />}>
						<ForYou />
					</Suspense>
				) : (
					<>
						<QuickLinksGrid className="max-w-3xl" />
						{active && <RevSlot name="video" className="w-full max-w-xl" fallback={AD_UNITS.box} />}
					</>
				)}
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
