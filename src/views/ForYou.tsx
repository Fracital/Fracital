/**
 * The new tab page's For You mode (about:newtab?fyp): what to go back to, and games, music and sites picked from
 * what this browser and account have done (src/libs/forYou.ts). Shelves with nothing in them stay hidden.
 */
import { useEffect, useState } from "react";
import { HolyText } from "../components/common/HolyText";
import { ArtistTile, GameTile, SiteTile, SongTile } from "../components/ForYouTiles";
import { Shelf } from "../components/Shelf";
import { type ForYouData, loadForYou } from "../libs/forYou";
import { trackToFracital } from "../libs/music-service";
import { useMusicStore, useSettingsStore } from "../store";

const ForYou = () => {
	const dark = useSettingsStore(s => s.settings.brightness !== "light");
	const [data, setData] = useState<ForYouData | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let on = true;
		loadForYou()
			.then(d => on && setData(d))
			.catch(() => on && setFailed(true));
		return () => {
			on = false;
		};
	}, []);

	if (failed) return <HolyText as="p" className="py-8 text-center text-sm text-(--text-tertiary)" text="Nothing to show right now. Try again in a moment." />;
	if (!data)
		return (
			<div className="flex w-full max-w-5xl flex-col gap-4" aria-hidden="true">
				{[0, 1, 2].map(i => (
					<div key={i} className="h-44 rounded-2xl bg-[#8881] animate-pulse" />
				))}
			</div>
		);

	const { music } = data;
	const playPicks = (index: number) => useMusicStore.getState().playList(music.picks.map(trackToFracital), index);
	const games = [...data.games.recent, ...data.games.favorites, ...data.games.trending.map(t => t.installed).filter((g): g is NonNullable<typeof g> => !!g && !data.games.recent.includes(g) && !data.games.favorites.includes(g))];
	const trendingPlayers = new Map(data.games.trending.map(t => [t.key, t.players]));
	const empty = !data.jumpBackIn.length && !games.length && !music.picks.length && !music.artists.length && !data.sites.length;

	return (
		<div className="flex w-full max-w-5xl flex-col gap-6">
			{empty && <HolyText as="p" className="py-8 text-center text-sm text-(--text-tertiary)" text="Browse, play a game or listen to something, and your picks will show up here." />}
			<Shelf title={<HolyText text="Jump back in" />} dark={dark}>
				{data.jumpBackIn.map(item =>
					item.kind === "site" ? (
						<SiteTile key={`site:${item.url}`} url={item.url} title={item.title} icon={item.icon} />
					) : item.kind === "game" ? (
						<GameTile key={`game:${item.game.id}`} game={item.game} />
					) : (
						<SongTile key={`song:${item.track.id}`} track={item.track} onPlay={() => useMusicStore.getState().playTrack(item.track)} />
					),
				)}
			</Shelf>
			<Shelf title={<HolyText text="Games for you" />} dark={dark}>
				{games.map(game => (
					<GameTile key={game.id} game={game} meta={trendingPlayers.has(game.folderName.toLowerCase()) ? <HolyText className="truncate text-xs text-(--accent)" text="Trending this week" /> : undefined} />
				))}
			</Shelf>
			<Shelf title={<HolyText text={music.coldStart ? "Popular right now" : "Music for you"} />} dark={dark}>
				{music.picks.map((track, i) => (
					<SongTile key={track.id} track={track} onPlay={() => playPicks(i)} />
				))}
			</Shelf>
			<Shelf title={<HolyText text="Artists for you" />} dark={dark}>
				{music.artists.map(a => (
					<ArtistTile key={a.name} name={a.name} picture={a.picture} because={a.because} />
				))}
			</Shelf>
			<Shelf title={<HolyText text="Sites for you" />} dark={dark}>
				{data.sites.map(site => (
					<SiteTile key={site.canonical} url={site.url} title={site.title} icon={site.icon} />
				))}
			</Shelf>
		</div>
	);
};

export default ForYou;
