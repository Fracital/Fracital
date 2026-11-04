import { RadioIcon, XMarkIcon } from "@heroicons/react/24/solid";
import { enableRadio, stopRadio, useRadioStore } from "../libs/radio";
import { useMusicStore } from "../store";

/** Autoplay radio pill for queue views: what the queue follows, a re-tuning indicator, and an on/off switch. */
export const RadioStatus = ({ className = "" }: { className?: string }) => {
	const active = useRadioStore(s => s.active);
	const seed = useRadioStore(s => s.seed);
	const loading = useRadioStore(s => s.loading);
	const error = useRadioStore(s => s.error);
	const hasTrack = useMusicStore(s => !!s.currentTrack);
	if (!hasTrack) return null;
	if (!active) {
		return (
			<div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-[#ffffff0d] text-sm ${className}`}>
				<RadioIcon className="size-4 shrink-0 opacity-50" />
				<span className="flex-1 text-xs opacity-60">Autoplay radio is off</span>
				<button className="px-2 py-1 rounded-lg text-xs font-semibold hover:bg-[#ffffff1f] duration-150" title="Refresh the queue from each song you play" onClick={enableRadio}>
					Turn on
				</button>
			</div>
		);
	}
	return (
		<div className={`flex items-center gap-2 px-3 py-2 rounded-xl bg-[#ffffff14] text-sm ${className}`}>
			<RadioIcon className={`size-4 shrink-0 ${loading ? "animate-pulse" : ""}`} />
			<div className="flex flex-col min-w-0 flex-1 leading-tight">
				<span className="font-semibold">{loading ? "Refreshing queue…" : "Autoplay radio"}</span>
				<span className="text-xs opacity-60 truncate" title={error ?? undefined}>
					{error ? error : seed ? `Up next follows ${seed.title ? `“${seed.title}”` : seed.artist}` : "Up next follows whatever's playing"}
				</span>
			</div>
			<button className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold hover:bg-[#ffffff1f] duration-150" title="Turn autoplay radio off" onClick={stopRadio}>
				<XMarkIcon className="size-3.5" /> Off
			</button>
		</div>
	);
};
