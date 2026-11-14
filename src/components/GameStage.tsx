import { ChevronDownIcon, ChevronUpIcon, LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/solid";
import { type ReactNode, type RefObject, useRef } from "react";
import { useHolyAttr } from "../libs/holy-attr";
import { BarOpenHandle, BarSettingsMenu, useCollapsibleBar, useHoverReveal } from "./CollapsibleBar";

/**
 * A bar icon button whose label is obfuscated (it's also the button's only accessible name). `quiet` drops its
 * hover and active backgrounds (the icon moves instead, styled by the caller through group-hover). `shape` replaces its
 * padding and rounding (the halves of a split button); `expanded` makes it a menu's button.
 */
export const GameBarButton = ({
	label,
	onClick,
	onContextMenu,
	active,
	expanded,
	quiet,
	shape = "p-2 rounded-lg",
	children,
	dark,
}: {
	label: string;
	onClick: () => void;
	onContextMenu?: React.MouseEventHandler;
	active?: boolean;
	expanded?: boolean;
	quiet?: boolean;
	shape?: string;
	children: ReactNode;
	dark: boolean;
}) => {
	const { ref, placeholder } = useHolyAttr({ title: label, "aria-label": label });
	return (
		<button
			ref={ref}
			{...placeholder}
			aria-pressed={expanded === undefined ? active : undefined}
			aria-haspopup={expanded === undefined ? undefined : "dialog"}
			aria-expanded={expanded}
			onClick={onClick}
			onContextMenu={onContextMenu}
			className={`group flex shrink-0 items-center justify-center ${shape} text-(--text-primary) cursor-pointer duration-150 ${quiet ? "" : `${active ? (dark ? "bg-[#ffffff22]" : "bg-[#00000018]") : ""} ${dark ? "hover:bg-[#ffffff18]" : "hover:bg-[#00000012]"}`}`}
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
				{/* Like the top bar's: pin (or close) the bar, with its settings dropping down from the chevron beside it. */}
				<BarSettingsMenu
					bar={bar}
					dark={dark}
					title="Game bar"
					trigger={(toggle, open) => {
						const openMenu = (e: React.MouseEvent) => {
							e.preventDefault();
							toggle();
						};
						return (
							<div className={`flex items-center rounded-lg duration-150 ${open ? (dark ? "bg-[#ffffff18]" : "bg-[#00000012]") : ""}`}>
								{bar.mode === "hover" ? (
									<GameBarButton label={bar.pinned ? "Auto-hide the bar" : "Keep the bar open"} active={bar.pinned} shape="p-2 rounded-lg" onClick={() => bar.setPinned(!bar.pinned)} onContextMenu={openMenu} dark={dark}>
										{bar.pinned ? <LockClosedIcon className="size-5" /> : <LockOpenIcon className="size-5" />}
									</GameBarButton>
								) : (
									<GameBarButton label="Close the bar" shape="p-2 rounded-lg" onClick={() => bar.setOpen(false)} onContextMenu={openMenu} dark={dark}>
										<ChevronUpIcon className="size-5" />
									</GameBarButton>
								)}
								<GameBarButton label="Bar settings" expanded={open} quiet shape="self-stretch pl-0.5 pr-1.5 rounded-r-lg" onClick={toggle} dark={dark}>
									<ChevronDownIcon className={`size-4 duration-200 ${open ? "rotate-180" : "group-hover:translate-y-0.5"}`} />
								</GameBarButton>
							</div>
						);
					}}
				/>
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
