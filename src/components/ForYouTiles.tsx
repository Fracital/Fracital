/**
 * The For You page's tiles: a site, a game, a song or an artist, each a square picture with its name under it.
 * Names, hosts and artists are data values and stay plain; the labels around them are wrapped.
 */
import { GlobeAltIcon, MusicalNoteIcon, PlayIcon, PuzzlePieceIcon, UserCircleIcon } from "@heroicons/react/24/solid";
import type { ReactNode } from "react";
import { openLibraryPage } from "../libs/aboutPages";
import { navigationEvent } from "../libs/eventBus";
import type { InstalledGame } from "../libs/installedGames";
import type { MusicTrack } from "../libs/music-service";
import { hostOf } from "../libs/omni/rank";
import { siteIcon } from "../libs/quickLinks";
import { useTabsStore } from "../store";
import type { Track } from "../types";
import { HolyDynamic, HolyRich } from "./common/HolyRich";

const TILE = "group flex w-32 shrink-0 flex-col gap-1.5 p-1.5 rounded-xl text-left cursor-pointer hover:bg-[#8881] duration-150";
const PICTURE = "relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-[#8882] text-(--text-tertiary)";

const Picture = ({ src, round, fallback, badge }: { src?: string; round?: boolean; fallback: ReactNode; badge?: ReactNode }) => (
	<span className={`${PICTURE} ${round ? "rounded-full" : ""}`}>
		{src ? <img src={src} alt="" aria-hidden className="size-full object-cover" loading="lazy" onError={e => (e.currentTarget.style.display = "none")} /> : null}
		<span className={`absolute inset-0 flex items-center justify-center ${src ? "-z-10" : ""}`}>{fallback}</span>
		{badge}
	</span>
);

const Name = ({ title, subtitle }: { title: string; subtitle?: string }) => (
	<span className="flex min-w-0 flex-col">
		{/* A site's, game's or song's name: a data value. */}
		<span className="truncate text-sm font-semibold">{title}</span>
		{/* The host or artist: a data value. */}
		{subtitle && <span className="truncate text-xs text-(--text-tertiary)">{subtitle}</span>}
	</span>
);

const currentTabId = () => useTabsStore.getState().tabs.find(t => t.current)?.id;

export const SiteTile = ({ url, title, icon }: { url: string; title: string; icon?: string }) => (
	<button type="button" className={TILE} onClick={() => navigationEvent({ url, displayUrl: url, title, icon: icon ?? null, id: currentTabId() ?? "" })}>
		<Picture src={icon || siteIcon(url) || undefined} fallback={<GlobeAltIcon className="size-10" />} />
		<Name title={title} subtitle={hostOf(url)} />
	</button>
);

export const GameTile = ({ game, meta }: { game: InstalledGame; meta?: ReactNode }) => {
	const url = `about:games?g=${encodeURIComponent(game.id)}`;
	return (
		<button type="button" className={TILE} onClick={() => navigationEvent({ url, displayUrl: url, title: game.title, icon: null, id: currentTabId() ?? "" })}>
			<Picture src={game.thumbnail} fallback={<PuzzlePieceIcon className="size-10" />} />
			<Name title={game.title} subtitle={game.author} />
			{meta}
		</button>
	);
};

export const SongTile = ({ track, onPlay }: { track: MusicTrack | Track; onPlay: () => void }) => {
	const artwork = "artwork" in track ? track.artwork : track.cover;
	const artist = "artist" in track ? track.artist : Array.isArray(track.artists) ? track.artists.join(", ") : track.artists;
	return (
		<button type="button" className={TILE} onClick={onPlay}>
			<Picture
				src={artwork}
				fallback={<MusicalNoteIcon className="size-10" />}
				badge={
					<span className="absolute right-1.5 bottom-1.5 flex size-8 items-center justify-center rounded-full bg-(--accent) text-white opacity-0 shadow-md duration-150 group-hover:opacity-100">
						<PlayIcon className="size-4" />
					</span>
				}
			/>
			<Name title={track.title} subtitle={artist} />
		</button>
	);
};

export const ArtistTile = ({ name, picture, because }: { name: string; picture?: string; because?: string }) => (
	<button type="button" className={TILE} onClick={() => openLibraryPage(`artistName=${encodeURIComponent(name)}`, name)}>
		<Picture src={picture || undefined} round fallback={<UserCircleIcon className="size-10" />} />
		<Name title={name} />
		{because && (
			<HolyRich className="truncate text-xs text-(--text-tertiary)">
				Because you like <HolyDynamic>{because}</HolyDynamic>
			</HolyRich>
		)}
	</button>
);
