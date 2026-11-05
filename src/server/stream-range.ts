/**
 * Browsers open WebM audio by also reading its end (where the seek index lives) with a
 * suffix range like "bytes=-1000". YouTube's servers reject those, which made playback
 * fail with no sound. Turn a suffix range into an absolute one using the stream's size.
 */

const SUFFIX = /^bytes=-(\d+)$/;

async function streamSize(url: string, headers: Record<string, string>): Promise<number | null> {
	// googlevideo URLs carry the byte length.
	const clen = Number(new URL(url).searchParams.get("clen"));
	if (clen > 0) return clen;
	try {
		const probe = await fetch(url, { headers: { ...headers, Range: "bytes=0-0" } });
		void probe.body?.cancel();
		const total = Number(probe.headers.get("content-range")?.split("/")[1]);
		return total > 0 ? total : null;
	} catch {
		return null;
	}
}

/** The Range header to send upstream for the browser's `range` (unchanged unless it's a suffix range). */
export async function upstreamRange(range: string | undefined, url: string, headers: Record<string, string>): Promise<string | undefined> {
	const m = range ? SUFFIX.exec(range.trim()) : null;
	if (!m) return range;
	const size = await streamSize(url, headers);
	if (!size) return "bytes=0-";
	return `bytes=${Math.max(0, size - Number(m[1]))}-${size - 1}`;
}
