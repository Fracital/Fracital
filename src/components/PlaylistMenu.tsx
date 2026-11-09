import { ListBulletIcon, MusicalNoteIcon, PlusIcon } from "@heroicons/react/24/solid";
import { useState } from "react";
import type { MenuItem } from "./ContextMenu";
import { HolyText } from "./common/HolyText";
import { useModal } from "./Modal/ModalContext";
import { useHolyAttr } from "../libs/holy-attr";
import type { MusicTrack } from "../libs/music-service";
import { addToPlaylist, createPlaylist, ensurePlaylistsLoaded, renamePlaylist, requireSignIn, usePlaylistStore } from "../libs/playlists";

/** Names a new playlist (adding `track` to it), or renames `playlist`. Shown in the app's modal. */
export const PlaylistNameDialog = ({ track, playlist, onDone }: { track?: MusicTrack; playlist?: { id: string; name: string }; onDone?: (id: string) => void }) => {
	const { closeModal } = useModal();
	const [name, setName] = useState(playlist?.name ?? "");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const { ref, placeholder } = useHolyAttr({ placeholder: "Playlist name", "aria-label": "Playlist name" });

	const save = async () => {
		if (!name.trim()) return;
		setBusy(true);
		setError("");
		try {
			if (playlist) {
				await renamePlaylist(playlist.id, name.trim());
				onDone?.(playlist.id);
			} else {
				const created = await createPlaylist(name.trim(), track);
				if (created) onDone?.(created.id);
			}
			closeModal();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong");
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-lg font-bold">
				<HolyText text={playlist ? "Rename playlist" : "New playlist"} />
			</h2>
			{error && <span className="text-sm text-red-400">{error}</span>}
			<input
				ref={ref}
				{...placeholder}
				// biome-ignore lint/a11y/noAutofocus: the dialog exists to type this one name
				autoFocus
				maxLength={100}
				value={name}
				onChange={e => setName(e.target.value)}
				onKeyDown={e => e.key === "Enter" && !busy && void save()}
				className="w-full px-3 py-2 rounded-xl text-sm outline-none bg-[#ffffff10] focus:bg-[#ffffff18]"
			/>
			<div className="flex justify-end gap-2">
				<button className="px-3 py-1.5 rounded-full text-sm font-semibold bg-[#ffffff15] hover:bg-[#ffffff25] cursor-pointer duration-150" onClick={closeModal}>
					<HolyText text="Cancel" />
				</button>
				<button className="px-3 py-1.5 rounded-full text-sm font-semibold text-white bg-(--accent) hover:brightness-110 disabled:opacity-50 cursor-pointer duration-150" disabled={busy || !name.trim()} onClick={() => void save()}>
					<HolyText text={playlist ? "Save" : "Create"} />
				</button>
			</div>
		</div>
	);
};

/**
 * Builds the "Add to playlist" entry for song menus: each playlist (most recently changed first)
 * plus "New playlist…". Signed out, picking any of them opens the sign-in page.
 */
export function usePlaylistMenu(): (track: MusicTrack) => MenuItem {
	const { openModal } = useModal();
	ensurePlaylistsLoaded();
	return track => ({
		title: <HolyText text="Add to playlist" />,
		icon: <ListBulletIcon className="size-5" />,
		onClick: () => undefined,
		children: [
			{ title: <HolyText text="New playlist…" />, icon: <PlusIcon className="size-4" />, onClick: () => requireSignIn() && openModal(<PlaylistNameDialog track={track} />) },
			...usePlaylistStore
				.getState()
				.playlists.slice(0, 15)
				// Playlist names are the user's own text (data), shown as-is.
				.map(p => ({ title: p.name, icon: <MusicalNoteIcon className="size-4 opacity-60" />, onClick: () => void addToPlaylist(p.id, track).catch(() => undefined) })),
		],
	});
}
