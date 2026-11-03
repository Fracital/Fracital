import { RadioIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { stopRadio, useRadioStore } from "../libs/radio";

/** "Radio on" pill for queue views: what the station follows, a re-tuning indicator, and an off switch. */
export const RadioStatus = ({ className = "" }: { className?: string }) => {
	const active = useRadioStore(s => s.active);
	const seed = useRadioStore(s => s.seed);
	const loading = useRadioStore(s => s.loading);
	const error = useRadioStore(s => s.error);
	if (!active) return null;
	return (
		<div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-[#ffffff14] text-sm ${className}`}>
			<RadioIcon className={`size-4 shrink-0 ${loading ? "animate-pulse" : ""}`} />
			<div className="flex flex-col min-w-0 flex-1 leading-tight">
				<span className="font-semibold">{loading ? "Re-tuning radio…" : "Radio on"}</span>
				<span className="text-xs opacity-60 truncate" title={error ?? undefined}>
					{error ? error : seed ? `Following ${seed.title ? `“${seed.title}”` : seed.artist}` : "Follows whatever's playing"}
				</span>
			</div>
			<button className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold hover:bg-[#ffffff1f] duration-150" title="Turn radio off" onClick={stopRadio}>
				<XMarkIcon className="size-3.5" /> Off
			</button>
		</div>
	);
};
