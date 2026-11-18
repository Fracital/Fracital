/**
 * Profile banner limits, shared by the crop dialog (src/components/BannerCropDialog.tsx) and the upload route
 * (src/server/profiles.ts). Dependency-free so the server can import it.
 */

/** Every banner is this shape; stills are rendered to BANNER_SIZE, GIFs keep their pixels and get a crop window. */
export const BANNER_ASPECT = 2.5;
export const BANNER_SIZE = { width: 1200, height: 480 } as const;
/** The uploaded file's size cap (a GIF as-is, or a still after the client encoded it), by tier. */
export const BANNER_BYTES = { free: 4 * 1024 * 1024, premium: 15 * 1024 * 1024 } as const;
export const bannerBytes = (premium: boolean) => (premium ? BANNER_BYTES.premium : BANNER_BYTES.free);
/** A cap in whole megabytes, for copy. */
export const bannerMb = (bytes: number) => Math.round(bytes / 1024 / 1024);
/** How far a crop window's ratio may stray from BANNER_ASPECT (rounding in the crop tool). */
export const BANNER_ASPECT_TOLERANCE = 0.03;
/** A GIF's crop window must cover at least this much of the source, in pixels, to be worth showing. */
export const BANNER_CROP_MIN = { width: 300, height: 120 } as const;

/** The window of a GIF banner that the header shows: fractions of the source image, 0..1. */
export type BannerCrop = { x: number; y: number; w: number; h: number };

export const isBannerAspect = (width: number, height: number) => height > 0 && Math.abs(width / height / BANNER_ASPECT - 1) <= BANNER_ASPECT_TOLERANCE;
