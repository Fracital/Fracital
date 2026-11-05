/**
 * Links from a playing Digital Library track back to its artist and album pages
 * (quick player and Now Playing). aboutPages is imported lazily: it registers the
 * player components, so a static import would be circular.
 */
import type { Track } from "../types";

const openLibrary = (query: string, title: string) => void import("./aboutPages").then(m => m.openLibraryPage(query, title));

export const isLinkable = (track: Track | null | undefined) => track?.source === "digital-library";

export const trackArtists = (track: Track): string[] => (Array.isArray(track.artists) ? track.artists : [track.artists]);

/** Opens an artist's page: by id for a solo credit, by name for collaborators. */
export const openTrackArtist = (track: Track, name: string) => {
	const solo = !Array.isArray(track.artists) || track.artists.length === 1;
	if (solo && track.artistId) openLibrary(`artist=${encodeURIComponent(track.artistId)}`, name);
	else openLibrary(`artistName=${encodeURIComponent(name)}`, name);
};

/** Opens the album or single the track comes from. */
export const openTrackAlbum = (track: Track) => {
	if (track.albumId) return openLibrary(`album=${encodeURIComponent(track.albumId)}`, track.album || track.title);
	openLibrary(`track=${encodeURIComponent(track.title)}&by=${encodeURIComponent(trackArtists(track)[0])}`, track.album || track.title);
};

/** Opens any credited person's artist page by name (producers, writers, featured artists). */
export const openArtistByName = (name: string) => openLibrary(`artistName=${encodeURIComponent(name)}`, name);
