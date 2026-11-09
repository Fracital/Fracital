import { CheckCircleIcon, HeartIcon, MinusCircleIcon } from "@heroicons/react/24/solid";
import { HeartIcon as HeartOutlineIcon, MinusCircleIcon as MinusCircleOutlineIcon, PlusCircleIcon } from "@heroicons/react/24/outline";
import { useEffect } from "react";
import { ensurePlaylistsLoaded, isDisliked, isLiked, toggleDislike, toggleLike, trackFromPlayer, usePlaylistStore } from "../libs/playlists";
import { ensureSavedLoaded, useSavedStore } from "../libs/savedLibrary";
import type { Track } from "../types";

interface SongFeedbackProps {
	track: Track | null;
	/** Classes for each button (sized and coloured like the controls next to it). */
	buttonClassName: string;
	iconClassName?: string;
	/** Also show the save-to-library button (the big player; the side panel has its own). */
	showSave?: boolean;
}

/**
 * Save, "don't recommend" and like buttons for the song that's playing (src/libs/playlists.ts).
 * Liking adds it to Liked Songs; "don't recommend" skips it and keeps radio from playing it again.
 */
export const SongFeedback = ({ track, buttonClassName, iconClassName = "size-6", showSave = false }: SongFeedbackProps) => {
	useEffect(() => {
		ensurePlaylistsLoaded();
		ensureSavedLoaded();
	}, []);
	const artist = track ? (Array.isArray(track.artists) ? track.artists.join(", ") : track.artists) : "";
	const liked = usePlaylistStore(s => !!track && isLiked(s, track.title, artist));
	const disliked = usePlaylistStore(s => !!track && isDisliked(s, track.title, artist));
	const songId = track?.title ? trackFromPlayer(track).id : "";
	const saved = useSavedStore(s => !!songId && s.tracks.some(t => t.id === songId));
	if (!track?.title || !artist) return null;

	// Plain titles: each is its icon button's only accessible name.
	return (
		<>
			{showSave && (
				<button title={saved ? "Remove from library" : "Save to library"} aria-pressed={saved} className={`${buttonClassName} ${saved ? "opacity-100!" : ""}`} onClick={() => useSavedStore.getState().toggleTrack(trackFromPlayer(track))}>
					{saved ? <CheckCircleIcon className={`${iconClassName} text-[#3d91ff]`} /> : <PlusCircleIcon className={iconClassName} />}
				</button>
			)}
			<button title={disliked ? "Recommend again" : "Don't recommend: skip it, and radio won't play it again"} aria-pressed={disliked} className={`${buttonClassName} ${disliked ? "opacity-100!" : ""}`} onClick={() => toggleDislike(trackFromPlayer(track))}>
				{disliked ? <MinusCircleIcon className={iconClassName} /> : <MinusCircleOutlineIcon className={iconClassName} />}
			</button>
			<button title={liked ? "Remove from Liked Songs" : "Like: add to Liked Songs"} aria-pressed={liked} className={`${buttonClassName} ${liked ? "opacity-100! text-[#ff3b5c]!" : ""}`} onClick={() => toggleLike(trackFromPlayer(track))}>
				{liked ? <HeartIcon className={iconClassName} /> : <HeartOutlineIcon className={iconClassName} />}
			</button>
		</>
	);
};
