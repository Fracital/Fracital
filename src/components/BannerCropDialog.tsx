/**
 * Crops a picked image to the banner's shape (Cropper.js): the frame is fixed at 2.5:1 and the image moves and zooms
 * under it. A still is rendered to BANNER_SIZE and encoded under the tier's cap; a GIF keeps its pixels (re-encoding
 * would drop the animation) and uploads with the chosen window, which the banner then shows.
 */
import Cropper from "cropperjs";
import "cropperjs/dist/cropper.css";
import { useEffect, useRef, useState } from "react";
import { BANNER_ASPECT, BANNER_BYTES, BANNER_SIZE, type BannerCrop, bannerBytes, bannerMb } from "../libs/banner-limits";
import { encodeBanner } from "../libs/compressImage";
import { useHolyAttr } from "../libs/holy-attr";
import { type ProfileSettings, profiles } from "../libs/profiles";
import { HolyDynamic, HolyRich } from "./common/HolyRich";
import { HolyText } from "./common/HolyText";
import { useModal } from "./Modal/ModalContext";

const ZOOM_MAX = 4;
const button = "flex items-center justify-center gap-1.5 text-sm font-semibold px-3.5 py-1.5 rounded-full disabled:opacity-50 cursor-pointer duration-150";
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);

export const BannerCropDialog = ({ file, premium, onDone }: { file: File; premium: boolean; onDone: (settings: ProfileSettings) => void }) => {
	const { closeModal } = useModal();
	const image = useRef<HTMLImageElement>(null);
	const cropper = useRef<Cropper | null>(null);
	// The image's scale: `fit` is where it just covers the frame, `zoom` the current one.
	const [fit, setFit] = useState(0);
	const [zoom, setZoom] = useState(0);
	const [busy, setBusy] = useState(false);
	const [tooBig, setTooBig] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const gif = file.type === "image/gif";
	const cap = bannerBytes(premium);
	// Pre-hydration these read as dashes (HOLYTEXT.md); the controls also have visible labels, so nothing is lost.
	const { ref: previewRef, placeholder: previewAttrs } = useHolyAttr({ "aria-label": "Banner preview: drag to move, scroll to zoom" });
	const { ref: zoomRef, placeholder: zoomAttrs } = useHolyAttr({ "aria-label": "Zoom" });

	useEffect(() => {
		const el = image.current;
		if (!el) return;
		// The object URL lives exactly as long as this cropper (React's dev double-mount would otherwise revoke it under
		// the second instance), so the image gets its src here rather than from a prop.
		const url = URL.createObjectURL(file);
		el.src = url;
		let ready = false;
		const instance = new Cropper(el, {
			aspectRatio: BANNER_ASPECT,
			// The whole image, scaled to fit, with the 2.5:1 frame drawn over it: everything outside the frame is dimmed,
			// the frame has grid lines and a center mark, and it can be dragged or resized (the shape stays locked).
			// Dragging outside the frame moves the image; the wheel zooms it.
			viewMode: 1,
			dragMode: "move",
			autoCropArea: 1,
			cropBoxMovable: true,
			cropBoxResizable: true,
			toggleDragModeOnDblclick: false,
			modal: true,
			guides: true,
			center: true,
			highlight: true,
			background: false,
			ready: () => {
				ready = true;
				const d = instance.getImageData();
				const ratio = d.width / d.naturalWidth;
				setFit(ratio);
				setZoom(ratio);
			},
			zoom: e => setZoom(e.detail.ratio),
		});
		cropper.current = instance;
		// Cropper only re-measures on window resize; the preview can change size after it built (styles arriving late,
		// the dialog reflowing), which would leave the frame sized to the old box.
		// resize() is on Cropper's prototype (its window-resize handler) but left out of its typings. It needs the built
		// cropper, and an observer reports once as soon as it starts watching, so wait for ready.
		const observer = new ResizeObserver(() => ready && (instance as unknown as { resize: () => void }).resize());
		if (el.parentElement) observer.observe(el.parentElement);
		return () => {
			observer.disconnect();
			instance.destroy();
			cropper.current = null;
			URL.revokeObjectURL(url);
		};
	}, [file]);

	const use = async () => {
		const c = cropper.current;
		if (!c) return;
		setError(null);
		setTooBig(false);
		if (gif && file.size > cap) {
			setTooBig(true);
			return;
		}
		setBusy(true);
		try {
			let settings: ProfileSettings;
			if (gif) {
				const d = c.getData(true);
				const i = c.getImageData();
				const clamp = (v: number) => Math.min(1, Math.max(0, v));
				const crop: BannerCrop = { x: clamp(d.x / i.naturalWidth), y: clamp(d.y / i.naturalHeight), w: clamp(d.width / i.naturalWidth), h: clamp(d.height / i.naturalHeight) };
				settings = await profiles.uploadBanner(file, crop);
			} else {
				const canvas = c.getCroppedCanvas({ width: BANNER_SIZE.width, height: BANNER_SIZE.height, imageSmoothingQuality: "high" });
				settings = await profiles.uploadBanner(await encodeBanner(canvas, premium));
			}
			onDone(settings);
			closeModal();
		} catch (e) {
			// The server's or encoder's message: a data value.
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<HolyText as="h2" className="font-bold" text="Crop your banner" />
			<div ref={previewRef} {...previewAttrs} className="h-64 w-full overflow-hidden rounded-lg bg-black/40">
				<img ref={image} alt="" className="block max-w-full opacity-0" />
			</div>
			<HolyText as="p" className="text-xs text-(--text-secondary)" text="Drag the frame or its corners to choose what shows. Drag outside it to move the image; scroll to zoom." />
			<div className="flex items-center gap-2 text-xs text-(--text-secondary)">
				<HolyText text="Zoom" />
				<input ref={zoomRef} {...zoomAttrs} type="range" min={fit || 0} max={(fit || 1) * ZOOM_MAX} step={(fit || 1) / 100} value={zoom} disabled={!fit} className="flex-1 accent-(--accent)" onChange={e => cropper.current?.zoomTo(Number(e.target.value))} />
				<button type="button" className={`${button} bg-[#ffffff15] hover:bg-[#ffffff25]`} onClick={() => cropper.current?.reset()}>
					<HolyText text="Fit" />
				</button>
			</div>
			{gif && <HolyText as="p" className="text-xs text-(--text-tertiary)" text="GIFs keep their animation; the frame you choose is what the banner shows." />}
			{tooBig && (
				<HolyRich as="p" className="text-sm text-red-400">
					This GIF is <HolyDynamic>{mb(file.size)}</HolyDynamic> MB; GIFs are up to <HolyDynamic>{String(bannerMb(cap))}</HolyDynamic> MB
					{premium ? (
						""
					) : (
						<HolyRich>
							{" "}
							(<HolyDynamic>{String(bannerMb(BANNER_BYTES.premium))}</HolyDynamic> MB with Premium)
						</HolyRich>
					)}
					. Try a shorter or smaller one.
				</HolyRich>
			)}
			{error && <p className="text-sm text-red-400">{error}</p>}
			<div className="flex justify-end gap-2">
				<button type="button" className={`${button} bg-[#ffffff15] hover:bg-[#ffffff25]`} disabled={busy} onClick={closeModal}>
					<HolyText text="Cancel" />
				</button>
				<button type="button" className={`${button} bg-(--accent) text-white hover:brightness-110`} disabled={busy || !fit} onClick={() => void use()}>
					<HolyText text={busy ? "Uploading…" : "Use banner"} />
				</button>
			</div>
		</div>
	);
};
