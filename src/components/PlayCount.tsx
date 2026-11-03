import { useEffect, useRef, useState } from "react";
import { formatCount, getTrackPlays, peekTrackPlays, type TrackPlays } from "../libs/music-service";

interface PlayCountProps {
	title: string;
	artist: string | string[];
	className?: string;
	/** Text after the number. */
	suffix?: string;
	/** Text before the number (only rendered with a count, e.g. a " · " separator). */
	prefix?: string;
	/** Show a pulsing bar while loading (default) or nothing. */
	skeleton?: boolean;
}

const tooltip = (p: TrackPlays) =>
	p.source === "lastfm" ? `${p.plays.toLocaleString()} Last.fm scrobbles${p.listeners ? ` from ${p.listeners.toLocaleString()} listeners` : ""}` : `${p.plays.toLocaleString()} YouTube views`;

/**
 * A song's total plays (Last.fm scrobbles, falling back to YouTube views), e.g. "20M plays".
 * Loads only once scrolled into view, so long lists don't fire every lookup at once,
 * and renders nothing when the count is unknown.
 */
export const PlayCount = ({ title, artist, className = "", suffix = " plays", prefix = "", skeleton = true }: PlayCountProps) => {
	const credit = Array.isArray(artist) ? artist.join(", ") : artist;
	const [plays, setPlays] = useState<TrackPlays | null | undefined>(() => (title && credit ? peekTrackPlays(title, credit) : null));
	const [visible, setVisible] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);

	// Re-sync when the song changes (e.g. the now-playing card).
	const [prevKey, setPrevKey] = useState(`${credit}|${title}`);
	if (prevKey !== `${credit}|${title}`) {
		setPrevKey(`${credit}|${title}`);
		setPlays(title && credit ? peekTrackPlays(title, credit) : null);
	}

	useEffect(() => {
		const el = ref.current;
		if (!el || visible) return;
		const io = new IntersectionObserver(entries => {
			if (entries.some(e => e.isIntersecting)) {
				setVisible(true);
				io.disconnect();
			}
		}, { rootMargin: "200px" });
		io.observe(el);
		return () => io.disconnect();
	}, [visible]);

	useEffect(() => {
		if (!visible || plays !== undefined || !title || !credit) return;
		let alive = true;
		getTrackPlays(title, credit).then(p => alive && setPlays(p));
		return () => {
			alive = false;
		};
	}, [visible, plays, title, credit]);

	if (plays === null) return <span ref={ref} />;
	return (
		<span ref={ref} className={`tabular-nums ${className}`} title={plays ? tooltip(plays) : undefined}>
			{plays ? `${prefix}${formatCount(plays.plays)}${suffix}` : skeleton ? <span className="inline-block h-[0.7em] w-14 rounded-full animate-pulse bg-current opacity-15 align-middle" /> : null}
		</span>
	);
};
