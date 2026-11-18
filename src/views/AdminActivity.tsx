/**
 * Admin dashboard hourly charts: the "User activity" panel (active accounts, music listeners and signups) and the
 * "Plays" panel (plays, with listeners for context), each as a week of hourly columns or a day-of-week × hour
 * heatmap. Hours are in the server's clock (US Eastern), labelled by weekday and time of day, with one tooltip
 * (hover or arrow keys) listing every series for the hour.
 */
import { Fragment, type KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HolyDynamic, HolyRich } from "../components/common/HolyRich";
import { HolyText } from "../components/common/HolyText";
import type { ActivityHour } from "../libs/artistPanel";
import { formatCount } from "../libs/music-service";

type Series = "active" | "listeners" | "signups" | "plays";
type View = "week" | "pattern";
type Cell = { row: number; col: number };
type SeriesDef = { key: Series; label: string; dark: string; light: string };

// Validated categorical slots (dataviz palette), stepped for each surface. Each panel lists the series its
// tooltip shows; the first one is the one it draws by default.
const USER_SERIES: SeriesDef[] = [
	{ key: "active", label: "Active users", dark: "#3987e5", light: "#2a78d6" },
	{ key: "listeners", label: "Listeners", dark: "#d95926", light: "#eb6834" },
	{ key: "signups", label: "New accounts", dark: "#199e70", light: "#1baf7a" },
];
const MUSIC_SERIES: SeriesDef[] = [
	{ key: "plays", label: "Plays", dark: "#3987e5", light: "#2a78d6" },
	{ key: "listeners", label: "Listeners", dark: "#d95926", light: "#eb6834" },
];
const seriesColor = (defs: SeriesDef[], s: Series, dark: boolean) => {
	const def = defs.find(d => d.key === s) ?? defs[0];
	return dark ? def.dark : def.light;
};
const WEEK_DAYS = 7;
const DAY_HOURS = 24;
const HOURS = Array.from({ length: DAY_HOURS }, (_, h) => h);
const DOWS = Array.from({ length: WEEK_DAYS }, (_, d) => d + 1);
/** Fill steps of the heatmap: one hue, light to solid (hex alpha). */
const HEAT_STEPS = ["1f", "4d", "80", "bf", "ff"];
const TIP_WIDTH = 184;

// Weekday and month names come from the browser's locale, so they are data, not copy. 1 Jan 2024 was a Monday.
const weekdayName = (dow: number, style: "short" | "long") => new Intl.DateTimeFormat(undefined, { weekday: style }).format(new Date(2024, 0, dow, 12));
const dateName = (day: string) => {
	const [y, m, d] = day.split("-").map(Number);
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(y, m - 1, d, 12));
};
const clock = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
const hourRange = (h: number) => `${clock(h)}–${clock((h + 1) % DAY_HOURS)}`;
const tick = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
const fmtAvg = (v: number) => (v === 0 ? "0" : v < 10 ? String(Math.round(v * 10) / 10) : formatCount(Math.round(v)));

const chipClass = (dark: boolean, active: boolean) => `px-3 py-1 rounded-full text-xs font-semibold cursor-pointer duration-150 ${active ? (dark ? "bg-white text-black" : "bg-black text-white") : dark ? "bg-[#ffffff12] hover:bg-[#ffffff20]" : "bg-[#0000000c] hover:bg-[#00000016]"}`;

const ViewToggle = ({ view, onChange, dark }: { view: View; onChange: (v: View) => void; dark: boolean }) => (
	<div className="flex gap-1.5">
		<button type="button" className={chipClass(dark, view === "week")} onClick={() => onChange("week")}>
			<HolyText text="Week" />
		</button>
		<button type="button" className={chipClass(dark, view === "pattern")} onClick={() => onChange("pattern")}>
			<HolyText text="Pattern" />
		</button>
	</div>
);

/** Active accounts, listeners and signups; `hours` is null while the admin overview is still loading it. */
export const ActivityPanel = ({ hours: data, dark }: { hours: ActivityHour[] | null; dark: boolean }) => {
	const [view, setView] = useState<View>("week");
	const [series, setSeries] = useState<Series>("active");
	const color = (s: Series) => seriesColor(USER_SERIES, s, dark);

	const totals = useMemo<Partial<Record<Series, number>> | null>(() => {
		if (!data) return null;
		const last24 = data.slice(-DAY_HOURS);
		const last7d = data.slice(-WEEK_DAYS * DAY_HOURS);
		return {
			active: Math.max(0, ...last24.map(h => h.active)),
			listeners: Math.max(0, ...last24.map(h => h.listeners)),
			signups: last7d.reduce((n, h) => n + h.signups, 0),
		};
	}, [data]);

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col">
					<HolyText as="h2" className="font-bold" text="User activity" />
					<HolyText className="text-xs text-(--text-tertiary)" text="Hours in US Eastern, the streak clock" />
				</div>
				<ViewToggle view={view} onChange={setView} dark={dark} />
			</div>
			<div className="grid grid-cols-3 gap-3">
				{USER_SERIES.map(s => {
					const on = s.key === series;
					return (
						<button
							key={s.key}
							type="button"
							onClick={() => setSeries(s.key)}
							aria-pressed={on}
							className={`flex flex-col gap-0.5 rounded-xl p-3 text-left cursor-pointer duration-150 ${dark ? (on ? "bg-[#ffffff1a]" : "bg-[#ffffff0a] hover:bg-[#ffffff12]") : on ? "bg-[#00000012]" : "bg-[#00000006] hover:bg-[#0000000c]"}`}
							style={on ? { boxShadow: `inset 0 0 0 1px ${color(s.key)}` } : undefined}
						>
							<span className="flex items-center gap-1.5 text-xs font-semibold text-(--text-tertiary)">
								<span className="size-2 rounded-full shrink-0" style={{ background: color(s.key) }} />
								<HolyText text={s.label} />
							</span>
							<span className="text-2xl font-black">{totals ? formatCount(totals[s.key] ?? 0) : "–"}</span>
							<HolyText className="text-[11px] text-(--text-tertiary)" text={s.key === "signups" ? "last 7 days" : "peak hour · last 24 hours"} />
						</button>
					);
				})}
			</div>
			{!data && <HolyText className="text-sm text-(--text-tertiary)" text="Loading…" />}
			{data && view === "week" && <WeekChart data={data} defs={USER_SERIES} series={series} color={color(series)} dark={dark} />}
			{data && view === "pattern" && <PatternChart data={data} defs={USER_SERIES} series={series} color={color(series)} dark={dark} />}
		</div>
	);
};

/** Plays per hour, the music counterpart of the activity panel; the tooltip adds listeners for context. */
export const PlaysPanel = ({ hours: data, dark }: { hours: ActivityHour[] | null; dark: boolean }) => {
	const [view, setView] = useState<View>("week");
	const color = seriesColor(MUSIC_SERIES, "plays", dark);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex flex-col">
					<HolyText as="h2" className="font-bold" text="Plays" />
					<HolyText className="text-xs text-(--text-tertiary)" text="Plays per hour · US Eastern" />
				</div>
				<ViewToggle view={view} onChange={setView} dark={dark} />
			</div>
			{!data && <HolyText className="text-sm text-(--text-tertiary)" text="Loading…" />}
			{data && view === "week" && <WeekChart data={data} defs={MUSIC_SERIES} series="plays" color={color} dark={dark} />}
			{data && view === "pattern" && <PatternChart data={data} defs={MUSIC_SERIES} series="plays" color={color} dark={dark} />}
		</div>
	);
};

// --- Shared hover / keyboard model ---

type TipPos = { x: number; y: number };

/**
 * One hovered or focused cell for a grid of `rows` × `cols`. Arrow keys move it, pointer sets it, blur clears it.
 * The tooltip is measured off the cell's `data-cell` element so it can sit above any scroll container.
 */
const useCellHover = (rows: number, cols: number, initial: Cell | null) => {
	const root = useRef<HTMLDivElement>(null);
	const [cell, setCell] = useState<Cell | null>(null);
	const [pos, setPos] = useState<TipPos | null>(null);

	useLayoutEffect(() => {
		if (!cell || !root.current) return setPos(null);
		const el = root.current.querySelector<HTMLElement>(`[data-cell="${cell.row}-${cell.col}"]`);
		if (!el) return setPos(null);
		const r = el.getBoundingClientRect();
		const b = root.current.getBoundingClientRect();
		const half = TIP_WIDTH / 2;
		setPos({ x: Math.min(Math.max(r.left - b.left + r.width / 2, half), Math.max(half, b.width - half)), y: r.top - b.top });
	}, [cell]);

	const onKeyDown = (e: KeyboardEvent) => {
		const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
		if (!d) return;
		e.preventDefault();
		const c = cell ?? initial ?? { row: 0, col: 0 };
		let row = c.row + d[0];
		let col = c.col + d[1];
		if (col < 0 && row > 0) {
			row -= 1;
			col = cols - 1;
		}
		if (col >= cols && row < rows - 1) {
			row += 1;
			col = 0;
		}
		setCell({ row: Math.min(rows - 1, Math.max(0, row)), col: Math.min(cols - 1, Math.max(0, col)) });
	};
	const bind = {
		ref: root,
		tabIndex: 0,
		onKeyDown,
		onFocus: () => setCell(c => c ?? initial),
		onBlur: () => setCell(null),
		onPointerLeave: () => setCell(null),
		className: "relative outline-none focus-visible:ring-1 focus-visible:ring-(--text-tertiary) rounded-lg",
	};
	const cellProps = (row: number, col: number) => ({ "data-cell": `${row}-${col}`, onPointerEnter: () => setCell({ row, col }) });
	return { cell, pos, bind, cellProps };
};

const ChartTip = ({ pos, title, rows, selected, dark }: { pos: TipPos; title: React.ReactNode; rows: { key: Series; label: string; value: string; color: string }[]; selected: Series; dark: boolean }) => (
	<div role="tooltip" className={`absolute z-10 pointer-events-none rounded-lg px-2.5 py-1.5 text-xs shadow-lg border ${dark ? "bg-[#1f1f22] border-[#ffffff1a]" : "bg-white border-[#0000001a] text-black"}`} style={{ width: TIP_WIDTH, left: pos.x, top: pos.y, transform: "translate(-50%, calc(-100% - 6px))" }}>
		<div className={`mb-1 ${dark ? "text-(--text-secondary)" : "text-black/60"}`}>{title}</div>
		{rows.map(r => (
			<div key={r.key} className={`flex items-center gap-1.5 py-px ${r.key === selected ? "font-semibold" : dark ? "text-(--text-secondary)" : "text-black/60"}`}>
				<span className="w-2.5 h-0.5 rounded-full shrink-0" style={{ background: r.color }} />
				<span className="tabular-nums font-bold">{r.value}</span>
				<HolyText text={r.label} />
			</div>
		))}
	</div>
);

// --- Week: 7 days × 24 hourly columns ---

type ChartProps = { data: ActivityHour[]; defs: SeriesDef[]; series: Series; color: string; dark: boolean };

const WeekChart = ({ data, defs, series, color, dark }: ChartProps) => {
	// The last seven calendar days in the server's clock; today is partial, so empty slots keep the hours aligned.
	const days = useMemo(() => {
		const byDay = new Map<string, ActivityHour[]>();
		for (const h of data) byDay.set(h.day, [...(byDay.get(h.day) ?? []), h]);
		return [...byDay.entries()].slice(-WEEK_DAYS).map(([day, hours]) => {
			const slots: (ActivityHour | undefined)[] = Array.from({ length: DAY_HOURS });
			for (const h of hours) slots[h.hour] = h;
			return { day, dow: hours[0].dow, slots };
		});
	}, [data]);
	const max = Math.max(1, ...days.flatMap(d => d.slots.map(s => s?.[series] ?? 0)));
	const peak = useMemo<Cell | null>(() => {
		let best: Cell | null = null;
		let bestValue = 0;
		for (const [row, d] of days.entries()) {
			for (const [col, s] of d.slots.entries()) {
				if (s && s[series] > bestValue) {
					bestValue = s[series];
					best = { row, col };
				}
			}
		}
		return best;
	}, [days, series]);
	const { cell, pos, bind, cellProps } = useCellHover(days.length, DAY_HOURS, peak);
	const hovered = cell ? days[cell.row]?.slots[cell.col] : undefined;
	const hairline = dark ? "border-[#ffffff14]" : "border-[#00000014]";
	const dayTotal = (d: (typeof days)[number]) => (series === "signups" ? d.slots.reduce((n, s) => n + (s?.signups ?? 0), 0) : Math.max(0, ...d.slots.map(s => s?.[series] ?? 0)));

	return (
		<div {...bind}>
			<div className="overflow-x-auto">
				<div className="min-w-[640px] grid grid-cols-[2.25rem_1fr] gap-x-2">
					<div />
					<div className="grid grid-cols-7 gap-2 h-9">
						{days.map(d => (
							<div key={d.day} className="flex flex-col leading-tight">
								<span className="text-xs font-semibold text-(--text-secondary)">{weekdayName(d.dow, "short")}</span>
								<HolyRich className="text-[11px] text-(--text-tertiary)">
									<HolyDynamic>{dateName(d.day)}</HolyDynamic> · {series === "signups" ? "total" : "peak"} <HolyDynamic>{formatCount(dayTotal(d))}</HolyDynamic>
								</HolyRich>
							</div>
						))}
					</div>
					<div className="relative h-28 text-[10px] tabular-nums text-(--text-tertiary)">
						<span className="absolute right-0 top-0 -translate-y-1/2">{formatCount(max)}</span>
						<span className="absolute right-0 top-1/2 -translate-y-1/2">{formatCount(Math.round(max / 2))}</span>
						<span className="absolute right-0 bottom-0 translate-y-1/2">0</span>
					</div>
					<div className="relative h-28">
						<div className={`absolute inset-x-0 top-0 border-t ${hairline}`} />
						<div className={`absolute inset-x-0 top-1/2 border-t ${hairline}`} />
						<div className={`absolute inset-x-0 bottom-0 border-t ${dark ? "border-[#ffffff2a]" : "border-[#0000002a]"}`} />
						<div className="relative grid grid-cols-7 gap-2 h-full">
							{days.map((d, row) => (
								<div key={d.day} className="flex items-end gap-px h-full">
									{HOURS.map(col => {
										const s = d.slots[col];
										const v = s?.[series] ?? 0;
										const pct = (v / max) * 100;
										const on = cell?.row === row && cell?.col === col;
										const isPeak = peak?.row === row && peak?.col === col && v > 0;
										return (
											<div key={tick(col)} {...cellProps(row, col)} role="img" aria-label={s ? `${weekdayName(d.dow, "short")} ${hourRange(col)}: ${v}` : undefined} className="relative flex-1 h-full flex flex-col justify-end">
												{isPeak && !on && (
													<span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] leading-none tabular-nums font-semibold" style={{ bottom: `calc(${pct}% + 3px)` }}>
														{formatCount(v)}
													</span>
												)}
												{s && <div className="rounded-t-[3px] duration-100" style={{ height: `${pct}%`, minHeight: 1, background: color, filter: on ? "brightness(1.25)" : undefined }} />}
											</div>
										);
									})}
								</div>
							))}
						</div>
					</div>
					<div />
					<div className="grid grid-cols-7 gap-2 mt-1 text-[10px] text-(--text-tertiary) tabular-nums">
						{days.map(d => (
							<div key={d.day} className="grid grid-cols-4">
								{[0, 6, 12, 18].map(h => (
									<span key={h} className={h % 12 ? "hidden md:inline" : ""}>
										{tick(h)}
									</span>
								))}
							</div>
						))}
					</div>
				</div>
			</div>
			{cell && pos && hovered && (
				<ChartTip
					pos={pos}
					dark={dark}
					selected={series}
					title={
						<HolyDynamic>
							{weekdayName(hovered.dow, "short")}, {dateName(hovered.day)} · {hourRange(hovered.hour)}
						</HolyDynamic>
					}
					rows={defs.map(s => ({ key: s.key, label: s.label, value: hovered[s.key].toLocaleString(), color: dark ? s.dark : s.light }))}
				/>
			)}
		</div>
	);
};

// --- Pattern: day of week × hour of day, averaged over the window ---

type HeatCell = { n: number; active: number; listeners: number; plays: number; signups: number };
const avg = (c: HeatCell, s: Series) => (c.n ? c[s] / c.n : 0);

const PatternChart = ({ data, defs, series, color, dark }: ChartProps) => {
	const grid = useMemo(() => {
		const cells: HeatCell[][] = DOWS.map(() => HOURS.map(() => ({ n: 0, active: 0, listeners: 0, plays: 0, signups: 0 })));
		for (const h of data) {
			const c = cells[h.dow - 1][h.hour];
			c.n += 1;
			c.active += h.active;
			c.listeners += h.listeners;
			c.plays += h.plays;
			c.signups += h.signups;
		}
		return cells;
	}, [data]);
	const max = Math.max(...grid.flatMap(r => r.map(c => avg(c, series))));
	const peak = useMemo<Cell | null>(() => {
		let best: Cell | null = null;
		let bestValue = 0;
		for (const [row, r] of grid.entries()) {
			for (const [col, c] of r.entries()) {
				if (avg(c, series) > bestValue) {
					bestValue = avg(c, series);
					best = { row, col };
				}
			}
		}
		return best;
	}, [grid, series]);
	const { cell, pos, bind, cellProps } = useCellHover(WEEK_DAYS, DAY_HOURS, peak);
	const hovered = cell ? grid[cell.row][cell.col] : undefined;
	const empty = dark ? "#ffffff0a" : "#0000000a";
	const fill = (v: number) => (v <= 0 || max <= 0 ? empty : `${color}${HEAT_STEPS[Math.min(HEAT_STEPS.length - 1, Math.ceil((v / max) * HEAT_STEPS.length) - 1)]}`);
	// Active-user rows only exist since this was deployed, so the average runs low until four weeks have accrued.
	const activeSince = series === "active" ? data.find(h => h.active > 0) : undefined;
	const partial = activeSince && activeSince !== data[0] && data.indexOf(activeSince) > DAY_HOURS;

	return (
		<div {...bind}>
			<div className="overflow-x-auto">
				<div className="min-w-[640px] grid gap-0.5" style={{ gridTemplateColumns: `2.25rem repeat(${DAY_HOURS}, minmax(0, 1fr))` }}>
					{DOWS.map(dow => {
						const row = dow - 1;
						return (
							<Fragment key={dow}>
								<span className="text-xs font-semibold text-(--text-secondary) leading-5 pr-1">{weekdayName(dow, "short")}</span>
								{HOURS.map(col => {
									const v = avg(grid[row][col], series);
									const on = cell?.row === row && cell?.col === col;
									return (
										<div
											key={tick(col)}
											{...cellProps(row, col)}
											role="img"
											aria-label={`${weekdayName(dow, "short")} ${hourRange(col)}: ${fmtAvg(v)}`}
											className="h-5 rounded-[3px] duration-100"
											style={{ background: fill(v), boxShadow: on ? `inset 0 0 0 1px ${dark ? "#fff" : "#000"}` : undefined }}
										/>
									);
								})}
							</Fragment>
						);
					})}
					<div />
					{HOURS.map(h => (
						<span key={tick(h)} className="text-[10px] text-(--text-tertiary) tabular-nums whitespace-nowrap mt-0.5">
							{h % 3 === 0 ? tick(h) : ""}
						</span>
					))}
				</div>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2 mt-2 text-[11px] text-(--text-tertiary)">
				<span>
					{partial && (
						<HolyRich>
							Active-user history starts <HolyDynamic>{dateName(activeSince.day)}</HolyDynamic>, so those averages run low until four weeks have accrued.
						</HolyRich>
					)}
				</span>
				<span className="flex items-center gap-1">
					<HolyText text="less" />
					{HEAT_STEPS.map(a => (
						<span key={a} className="size-3 rounded-[2px]" style={{ background: `${color}${a}` }} />
					))}
					<HolyText text="more" />
				</span>
			</div>
			{cell && pos && hovered && (
				<ChartTip
					pos={pos}
					dark={dark}
					selected={series}
					title={
						<HolyRich>
							<HolyDynamic>{weekdayName(cell.row + 1, "long")}s</HolyDynamic> · <HolyDynamic>{hourRange(cell.col)}</HolyDynamic> · average of <HolyDynamic>{String(hovered.n)}</HolyDynamic> weeks
						</HolyRich>
					}
					rows={defs.map(s => ({ key: s.key, label: s.label, value: fmtAvg(avg(hovered, s.key)), color: dark ? s.dark : s.light }))}
				/>
			)}
		</div>
	);
};
