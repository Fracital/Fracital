import { Cog6ToothIcon, HomeIcon, NoSymbolIcon, ViewfinderCircleIcon } from "@heroicons/react/24/solid";
import { HolyDynamic, HolyRich } from "../components/common/HolyRich";
import { HolyText } from "../components/common/HolyText";
import { useModal } from "../components/Modal/ModalContext";
import { ProfileSettingsDialog } from "../gui/TabProfiles";
import type { BlockReason } from "../libs/profileRules";
import { MAIN_PROFILE_ID, useTabProfiles } from "../libs/tabProfiles";
import { useTabsStore } from "../store";

const hostOf = (url: string) => {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return url.replace(/^about:/, "");
	}
};

/** about:blocked?reason=<focus|block|allow>&url=<where the tab was going>: why the active profile stopped it. */
const Blocked = ({ query, className = "" }: { query?: string; className?: string }) => {
	const params = new URLSearchParams(query ?? "");
	const reason = (params.get("reason") ?? "block") as BlockReason;
	const url = params.get("url") ?? "";
	const profile = useTabProfiles(state => state.profiles.find(p => p.id === state.activeId));
	const { openModal, closeModal } = useModal();
	const site = hostOf(url);
	// Main's name is ours; the others are the user's own (data values).
	const profileName = profile?.id === MAIN_PROFILE_ID ? <HolyText text="Main" /> : profile?.name;

	const goHome = () => {
		const tab = useTabsStore.getState().tabs.find(t => t.current);
		if (tab) useTabsStore.getState().navigateTab(tab.id, { url: "about:newtab", displayUrl: "about:newtab", title: "New Tab", icon: null });
	};

	return (
		<div className={`flex size-full items-center justify-center overflow-y-auto p-6 ${className}`}>
			<div className="flex max-w-md flex-col items-center gap-3 text-center">
				{reason === "focus" ? <ViewfinderCircleIcon className="size-14 text-(--accent)" /> : <NoSymbolIcon className="size-14 text-(--text-tertiary)" />}
				<HolyText as="h1" className="text-2xl font-bold" text={reason === "focus" ? "Stay focused" : "This site is blocked"} />
				<p className="text-sm text-(--text-secondary)">
					{reason === "focus" ? (
						<HolyRich>
							Focus mode is on in the <HolyDynamic>{profileName}</HolyDynamic> profile, so <HolyDynamic>{site}</HolyDynamic> won't open right now.
						</HolyRich>
					) : reason === "allow" ? (
						<HolyRich>
							<HolyDynamic>{site}</HolyDynamic> isn't on the <HolyDynamic>{profileName}</HolyDynamic> profile's list of allowed sites.
						</HolyRich>
					) : (
						<HolyRich>
							<HolyDynamic>{site}</HolyDynamic> is blocked in the <HolyDynamic>{profileName}</HolyDynamic> profile.
						</HolyRich>
					)}
				</p>
				<div className="mt-2 flex flex-wrap justify-center gap-2">
					<button type="button" className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-(--accent) text-white hover:brightness-110 cursor-pointer duration-150" onClick={goHome}>
						<HomeIcon className="size-4" />
						<HolyText text="New tab page" />
					</button>
					{profile && (
						<button type="button" className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold bg-[#8882] hover:bg-[#8883] cursor-pointer duration-150" onClick={() => openModal(<ProfileSettingsDialog id={profile.id} onDone={closeModal} />)}>
							<Cog6ToothIcon className="size-4" />
							<HolyText text="Profile settings" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
};

export default Blocked;
