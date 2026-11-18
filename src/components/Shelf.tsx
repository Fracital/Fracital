import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid";
import { type ReactNode, useRef, useState } from "react";
import { useHolyAttr } from "../libs/holy-attr";
import { scrollBehavior } from "../libs/motion";
import { HolyText } from "./common/HolyText";

/**
 * A titled, horizontally scrollable shelf with chevron paging and a "Show All" grid toggle.
 * Lives at module scope so its expanded state and scroll position survive parent re-renders.
 */
export const Shelf = ({ title, count, dark, gridMin = 128, action, children }: { title: ReactNode; count?: number | string; dark: boolean; gridMin?: number; action?: ReactNode; children: ReactNode[] }) => {
	const [expanded, setExpanded] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const { ref: leftRef, placeholder: leftAttrs } = useHolyAttr({ title: "Scroll left", "aria-label": "Scroll left" });
	const { ref: rightRef, placeholder: rightAttrs } = useHolyAttr({ title: "Scroll right", "aria-label": "Scroll right" });
	if (children.length === 0) return null;
	const chip = dark ? "bg-[#ffffff1f] hover:bg-[#ffffff33]" : "bg-[#00000012] hover:bg-[#00000022]";
	const scrollBy = (dir: number) => {
		const el = scrollRef.current;
		if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: scrollBehavior() });
	};
	return (
		<section className="flex flex-col gap-2">
			<div className="flex items-center justify-between px-1">
				<div className="flex items-baseline gap-1.5">
					<h2 className="text-base font-bold">{title}</h2>
					{count !== undefined && <span className="text-xs text-(--text-tertiary)">{count}</span>}
				</div>
				<div className="flex items-center gap-1.5">
					{action}
					<button type="button" className={`text-[11px] font-semibold px-2.5 py-1 rounded-full duration-150 ${chip}`} onClick={() => setExpanded(e => !e)}>
						<HolyText text={expanded ? "Show Less" : "Show All"} />
					</button>
					{!expanded && (
						<>
							<button ref={leftRef} {...leftAttrs} type="button" className={`flex items-center justify-center size-6 rounded-full duration-150 ${chip}`} onClick={() => scrollBy(-1)}>
								<ChevronLeftIcon className="size-3" />
							</button>
							<button ref={rightRef} {...rightAttrs} type="button" className={`flex items-center justify-center size-6 rounded-full duration-150 ${chip}`} onClick={() => scrollBy(1)}>
								<ChevronRightIcon className="size-3" />
							</button>
						</>
					)}
				</div>
			</div>
			{expanded ? (
				<div className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin}px, 1fr))` }}>
					{children}
				</div>
			) : (
				<div ref={scrollRef} className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none]">
					{children}
				</div>
			)}
		</section>
	);
};
