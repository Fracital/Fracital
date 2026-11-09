import { ChevronUpIcon, Cog6ToothIcon, LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/solid";
import { useRef, type ReactNode, type RefObject } from "react";
import { BarOpenHandle, BarSettingsMenu, useCollapsibleBar, useHoverReveal } from "./CollapsibleBar";
import { useHolyAttr } from "../libs/holy-attr";

/** A bar icon button whose label is obfuscated (it's also the button's only accessible name). */
export const GameBarButton = ({ label, onClick, active, children, dark }: { label: string; onClick: () => void; active?: boolean; children: ReactNode; dark: boolean }) => {
	const { ref, placeholder } = useHolyAttr({ title: label, "aria-label": label });
	return (
		<button
			ref={ref}
			{...placeholder}
			aria-pressed={active}
			onClick={onClick}
			className={`flex shrink-0 items-center justify-center p-2 rounded-lg text-(--text-primary) cursor-pointer duration-150 ${active ? (dark ? "bg-[#ffffff22]" : "bg-[#00000018]") : ""} ${dark ? "hover:bg-[#ffffff18]" : "hover:bg-[#00000012]"}`}
		>
			{children}
		</button>
	);
};

interface GameStageProps {
	/** The fullscreen target: the bar and the game together. */
	containerRef: RefObject<HTMLDivElement | null>;
	/** Controls shown on the left of the bar (back, title). */
	barStart: ReactNode;
	/** Controls shown on the right of the bar (volume, fullscreen, details). */
	barEnd: ReactNode;
	dark: boolean;
	fullscreen: boolean;
	children: ReactNode;
}

/** The game with its collapsible control bar above it (see CollapsibleBar for the modes). */
export const GameStage = ({ containerRef, barStart, barEnd, dark, fullscreen, children }: GameStageProps) => {
	const bar = useCollapsibleBar("gamesBar");
	const barRef = useRef<HTMLDivElement>(null);

	useHoverReveal({
		enabled: bar.autoHide,
		threshold: bar.threshold,
		target: () => containerRef.current,
		frames: () => containerRef.current,
		edge: () => containerRef.current?.getBoundingClientRect().top ?? 0,
		barBottom: () => barRef.current?.getBoundingClientRect().bottom ?? 0,
		setRevealed: bar.setRevealed,
	});

	const surface = dark ? "bg-[#1e1e1ef0] border border-[#ffffff1a]" : "bg-[#fafafaf0] border border-[#00000014]";

	const content = (
		<div ref={barRef} className={`flex items-center justify-between gap-2 p-1.5 rounded-xl ${bar.inFlow ? (dark ? "bg-[#ffffff10]" : "bg-[#00000010]") : `${surface} shadow-[0_8px_30px_#00000060] backdrop-blur-md`}`}>
			<div className="flex min-w-0 items-center gap-2">{barStart}</div>
			<div className="flex shrink-0 items-center gap-1">
				{barEnd}
				<span className={`mx-1 h-5 w-px ${dark ? "bg-[#ffffff22]" : "bg-[#00000022]"}`} />
				<BarSettingsMenu
					bar={bar}
					dark={dark}
					title="Game bar"
					trigger={(toggle, open) => (
						<GameBarButton label="Bar settings" active={open} onClick={toggle} dark={dark}>
							<Cog6ToothIcon className="size-5" />
						</GameBarButton>
					)}
				/>
				{bar.mode === "hover" ? (
					<GameBarButton label={bar.pinned ? "Auto-hide the bar" : "Keep the bar open"} active={bar.pinned} onClick={() => bar.setPinned(!bar.pinned)} dark={dark}>
						{bar.pinned ? <LockClosedIcon className="size-5" /> : <LockOpenIcon className="size-5" />}
					</GameBarButton>
				) : (
					<GameBarButton label="Close the bar" onClick={() => bar.setOpen(false)} dark={dark}>
						<ChevronUpIcon className="size-5" />
					</GameBarButton>
				)}
			</div>
		</div>
	);

	return (
		<div ref={containerRef} className={`relative flex flex-1 flex-col min-h-0 ${bar.inFlow ? "gap-2" : ""} ${fullscreen ? "bg-(--primary) p-2" : ""}`}>
			{bar.inFlow && content}
			<div className="relative flex-1 min-h-0 rounded-xl overflow-hidden bg-black">
				{children}
				{/* Auto-hidden, the bar slides over the game so the game never resizes. */}
				{bar.autoHide && <div className={`absolute inset-x-2 top-2 z-20 duration-200 ease-out ${bar.shown ? "translate-y-0 opacity-100" : "-translate-y-[calc(100%+0.5rem)] opacity-0 pointer-events-none"}`}>{content}</div>}
				{bar.mode === "button" && !bar.open && <BarOpenHandle dark={dark} onOpen={() => bar.setOpen(true)} />}
			</div>
		</div>
	);
};
