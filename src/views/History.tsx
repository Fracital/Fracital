import { ClockIcon, GlobeAltIcon, MagnifyingGlassIcon, TrashIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { createId } from "@paralleldrive/cuid2";
import { useEffect, useMemo, useState } from "react";
import { HolyText } from "../components/common/HolyText";
import { clearHistory, type HistoryVisit, removeVisit, useBrowsingHistory } from "../libs/browsingHistory";
import { useHolyAttr } from "../libs/holy-attr";
import { handleImg } from "../libs/imgHandler";
import { useSettingsStore, useTabsStore } from "../store";

/** Rows shown at first, and added by each "Show more". */
const PAGE = 150;
const HOUR = 60 * 60_000;

const startOfDay = (t: number) => {
	const d = new Date(t);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
};

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url;
	}
};

/** Icons load through the proxy (handleImg); each is fetched once however many visits show it. */
const iconCache = new Map<string, Promise<string | undefined>>();
const loadIcon = (src: string) => {
	let pending = iconCache.get(src);
	if (!pending) {
		pending = new Promise(resolve => handleImg(src, resolve));
		iconCache.set(src, pending);
	}
	return pending;
};

const Favicon = ({ src }: { src?: string }) => {
	const [loaded, setLoaded] = useState<{ src: string; url?: string } | null>(null);
	useEffect(() => {
		if (!src) return;
		let cancelled = false;
		void loadIcon(src).then(url => !cancelled && setLoaded({ src, url }));
		return () => {
			cancelled = true;
		};
	}, [src]);
	const url = loaded && loaded.src === src ? loaded.url : undefined;
	return url ? <img src={url} alt="" className="size-5 shrink-0 rounded" onError={() => src && setLoaded({ src })} /> : <GlobeAltIcon className="size-5 shrink-0 text-(--text-tertiary)" />;
};

const Row = ({ visit }: { visit: HistoryVisit }) => {
	const { ref, placeholder } = useHolyAttr({ "aria-label": "Remove from history", title: "Remove from history" });
	const open = () => useTabsStore.getState().newTab({ id: createId(), url: visit.url, displayUrl: visit.url, title: visit.title, icon: visit.icon ?? null, current: true });
	return (
		<li className="group flex items-center gap-1 rounded-xl hover:bg-[#8881] duration-150">
			<button type="button" className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left cursor-pointer" onClick={open}>
				{/* When, what and where: data values. */}
				<span className="w-16 shrink-0 text-xs tabular-nums text-(--text-tertiary)">{new Date(visit.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
				<Favicon src={visit.icon} />
				<span className="min-w-0 flex-1 truncate text-sm font-medium">{visit.title}</span>
				<span className="hidden max-w-[40%] shrink-0 truncate text-xs text-(--text-tertiary) sm:block">{hostOf(visit.url)}</span>
			</button>
			<button
				ref={ref}
				{...placeholder}
				type="button"
				className="mr-1.5 shrink-0 rounded-full p-1.5 text-(--text-tertiary) opacity-100 hover:bg-[#8882] hover:text-(--text-primary) cursor-pointer duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100"
				onClick={() => removeVisit(visit.id)}
			>
				<XMarkIcon className="size-4" />
			</button>
		</li>
	);
};

/** about:history: the sites tabs visited, by day, newest first, with search and clearing. */
const History = ({ className = "" }: { className?: string }) => {
	const visits = useBrowsingHistory(state => state.visits);
	const dark = useSettingsStore(state => state.settings.brightness !== "light");
	const [query, setQuery] = useState("");
	const [shown, setShown] = useState(PAGE);
	const [clearing, setClearing] = useState(false);
	const { ref: searchRef, placeholder: searchAttrs } = useHolyAttr({ placeholder: "Search history", "aria-label": "Search history" });

	const matches = useMemo(() => {
		const q = query.trim().toLowerCase();
		return q ? visits.filter(v => v.title.toLowerCase().includes(q) || v.url.toLowerCase().includes(q)) : visits;
	}, [visits, query]);

	// The rows shown, in runs by day.
	const days = useMemo(() => {
		const out: { day: number; visits: HistoryVisit[] }[] = [];
		for (const visit of matches.slice(0, shown)) {
			const day = startOfDay(visit.at);
			if (out[out.length - 1]?.day === day) out[out.length - 1].visits.push(visit);
			else out.push({ day, visits: [visit] });
		}
		return out;
	}, [matches, shown]);

	const today = startOfDay(Date.now());
	const dayLabel = (day: number) => {
		if (day === today) return <HolyText text="Today" />;
		if (day === startOfDay(today - 1)) return <HolyText text="Yesterday" />;
		// The date: a data value.
		return new Date(day).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", ...(new Date(day).getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
	};

	const pill = `flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold cursor-pointer duration-150 ${dark ? "bg-[#ffffff10] hover:bg-[#ffffff1c]" : "bg-[#00000010] hover:bg-[#0000001c]"}`;
	const clear = (since?: number) => {
		clearHistory(since);
		setClearing(false);
	};

	return (
		<div className={`size-full overflow-y-auto p-4 sm:p-6 ${className}`}>
			<div className="mx-auto flex max-w-3xl flex-col gap-4">
				<div className="flex flex-col gap-1">
					<HolyText as="h1" className="text-3xl font-bold" text="History" />
					<HolyText as="p" className="text-sm text-(--text-secondary)" text="The sites you've visited. It's kept in this browser only." />
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<label className={`flex min-w-0 flex-1 basis-60 items-center gap-2 px-4 rounded-full inset-shadow-(--inset-shadow-secondary) focus-within:inset-shadow-(--inset-shadow-accent) duration-150 ${dark ? "bg-[#ffffff08]" : "bg-[#00000008]"}`}>
						<MagnifyingGlassIcon className="size-5 shrink-0 text-(--text-tertiary)" />
						{/* What the user types: a form value. */}
						<input
							ref={searchRef}
							{...searchAttrs}
							type="search"
							value={query}
							onChange={e => {
								setQuery(e.target.value);
								setShown(PAGE);
							}}
							className="w-full min-w-0 bg-transparent py-2.5 text-sm font-medium outline-none placeholder:text-(--text-tertiary)"
						/>
					</label>
					{!!visits.length && !clearing && (
						<button type="button" className={pill} onClick={() => setClearing(true)}>
							<TrashIcon className="size-4" />
							<HolyText text="Clear history" />
						</button>
					)}
				</div>

				{clearing && (
					<div className={`flex flex-wrap items-center gap-2 rounded-2xl p-3 ${dark ? "bg-[#ffffff08]" : "bg-[#00000008]"}`}>
						<HolyText className="mr-auto text-sm font-semibold" text="Clear visits from:" />
						<button type="button" className={pill} onClick={() => clear(Date.now() - HOUR)}>
							<HolyText text="The last hour" />
						</button>
						<button type="button" className={pill} onClick={() => clear(today)}>
							<HolyText text="Today" />
						</button>
						<button type="button" className="px-3 py-1.5 rounded-full text-sm font-semibold bg-red-500/85 text-white hover:bg-red-500 cursor-pointer duration-150" onClick={() => clear()}>
							<HolyText text="All time" />
						</button>
						<button type="button" className="px-3 py-1.5 rounded-full text-sm font-semibold text-(--text-secondary) hover:text-(--text-primary) cursor-pointer" onClick={() => setClearing(false)}>
							<HolyText text="Cancel" />
						</button>
					</div>
				)}

				{!matches.length && (
					<div className="flex flex-col items-center gap-2 py-16 text-center text-(--text-tertiary)">
						<ClockIcon className="size-10" />
						<HolyText as="p" text={visits.length ? "Nothing in your history matches that." : "Sites you visit will show up here."} />
					</div>
				)}

				{days.map(({ day, visits: dayVisits }) => (
					<section key={day} className="flex flex-col gap-1">
						<h2 className="sticky top-0 z-10 -mx-1 px-1 py-1.5 text-sm font-bold text-(--text-secondary) bg-(--secondary)">{dayLabel(day)}</h2>
						<ul className="flex flex-col">
							{dayVisits.map(visit => (
								<Row key={visit.id} visit={visit} />
							))}
						</ul>
					</section>
				))}

				{matches.length > shown && (
					<button type="button" className={`${pill} self-center`} onClick={() => setShown(n => n + PAGE)}>
						<HolyText text="Show more" />
					</button>
				)}
			</div>
		</div>
	);
};

export default History;
