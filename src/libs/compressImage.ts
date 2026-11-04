/**
 * Shrinks any image the browser can decode to fit an upload limit, using Compressor.js.
 * Resizes to a max dimension, then lowers quality and size step by step until it fits.
 * Transparent formats stay transparent (WebP); photos become JPEG. Small GIFs pass through
 * untouched so animations survive.
 */
import Compressor from "compressorjs";

export interface CompressOptions {
	/** Longest side in pixels. */
	maxDimension: number;
	/** Target size in bytes (must stay under the server's limit). */
	maxBytes: number;
}

/** Presets matching each upload's server limit, with headroom. */
export const IMAGE_PRESETS = {
	avatar: { maxDimension: 512, maxBytes: 1.5 * 1024 * 1024 },
	banner: { maxDimension: 2400, maxBytes: 4 * 1024 * 1024 },
	photo: { maxDimension: 1600, maxBytes: 4 * 1024 * 1024 },
	logo: { maxDimension: 1200, maxBytes: 4 * 1024 * 1024 },
} satisfies Record<string, CompressOptions>;

const run = (file: Blob, opts: Compressor.Options) =>
	new Promise<Blob>((resolve, reject) => {
		new Compressor(file, { ...opts, success: resolve, error: reject });
	});

export async function compressImage(file: File, { maxDimension, maxBytes }: CompressOptions): Promise<File> {
	if (file.type === "image/gif" && file.size <= maxBytes) return file;

	const transparent = /^image\/(png|webp|gif|svg\+xml|avif)$/.test(file.type);
	const mimeType = transparent ? "image/webp" : "image/jpeg";
	const ext = transparent ? "webp" : "jpg";

	let quality = 0.86;
	let dimension = maxDimension;
	for (let attempt = 0; attempt < 10; attempt++) {
		let out: Blob;
		try {
			out = await run(file, {
				quality,
				maxWidth: dimension,
				maxHeight: dimension,
				mimeType,
				// Always re-encode (Compressor otherwise keeps PNGs under 5MB as PNG).
				convertSize: Infinity,
				checkOrientation: true,
			});
		} catch {
			throw new Error("That file couldn't be read as an image. Try a PNG, JPEG, WebP or GIF.");
		}
		if (out.size <= maxBytes) {
			const name = file.name.replace(/\.[^.]+$/, "") || "image";
			return new File([out], `${name}.${ext}`, { type: out.type || mimeType });
		}
		// Too big: drop quality first, then dimensions.
		if (quality > 0.55) quality -= 0.12;
		else dimension = Math.round(dimension * 0.75);
	}
	throw new Error("Couldn't shrink that image enough. Try a smaller one.");
}
