import { useState } from "react";
import { CloudArrowDownIcon, CloudArrowUpIcon, CloudIcon, ExclamationTriangleIcon } from "@heroicons/react/24/solid";
import { gameSaveKey, syncGame, useGameSaveStore, type SaveGame } from "../libs/gameSaves";
import { useSettingsStore } from "../store";
import { HolyText } from "./common/HolyText";
import { useHolyAttr } from "../libs/holy-attr";

interface GameCloudSaveProps {
	game: SaveGame;
	/** Swaps in the cloud save; the caller stops the game first so it can't overwrite it. */
	onRestore: () => Promise<void>;
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

/** Cloud backup status for the open game, with conflict resolution. */
export const GameCloudSave = ({ game, onRestore }: GameCloudSaveProps) => {
	const settings = useSettingsStore(state => state.settings);
	const info = useGameSaveStore(s => s.saves[gameSaveKey(game.title)]);
	const [busy, setBusy] = useState(false);
	const { ref: backupRef, placeholder: backupAttrs } = useHolyAttr({ title: "Back up this game's save now" });

	const button = `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold duration-150 disabled:opacity-50 ${settings.brightness === "dark" ? "bg-[#ffffff10] hover:bg-[#ffffff18]" : "bg-[#00000010] hover:bg-[#00000018]"} text-(--text-primary)`;
	const run = (fn: () => Promise<unknown>) => async () => {
		setBusy(true);
		try {
			await fn();
		} finally {
			setBusy(false);
		}
	};

	if (!info || info.status === "signed-out") {
		return (
			<div className="flex items-center gap-2 text-sm text-(--text-tertiary)">
				<CloudIcon className="size-5 shrink-0" />
				<HolyText text={info ? "Sign in to back up your saves" : "Checking cloud save…"} />
			</div>
		);
	}

	if (info.status === "conflict") {
		return (
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<ExclamationTriangleIcon className="size-5 shrink-0 text-yellow-400" />
				<HolyText className="text-(--text-secondary)" text="This device and your cloud save differ." />
				<button className={button} disabled={busy} onClick={run(onRestore)}>
					<CloudArrowDownIcon className="size-4" />
					<HolyText text="Use cloud save" />
				</button>
				<button className={button} disabled={busy} onClick={run(() => syncGame(game, "upload"))}>
					<CloudArrowUpIcon className="size-4" />
					<HolyText text="Keep this device's" />
				</button>
			</div>
		);
	}

	const label =
		info.status === "syncing"
			? "Backing up…"
			: info.status === "error"
				? info.error || "Backup failed"
				: info.status === "empty"
					? "No save yet — it backs up once you save in-game"
					: "Saved to your account";

	return (
		<div className="flex flex-wrap items-center gap-2 text-sm">
			{info.status === "error" ? <ExclamationTriangleIcon className="size-5 shrink-0 text-red-400" /> : <CloudIcon className={`size-5 shrink-0 ${info.status === "synced" ? "text-(--accent)" : "text-(--text-tertiary)"}`} />}
			<HolyText className="text-(--text-secondary)" text={label} />
			{info.status === "synced" && info.updatedAt && <span className="text-(--text-tertiary)">{when(info.updatedAt)}</span>}
			{info.status !== "syncing" && (
				<button ref={backupRef} {...backupAttrs} className={button} disabled={busy} onClick={run(() => syncGame(game, "upload"))}>
					<CloudArrowUpIcon className="size-4" />
					<HolyText text="Back up" />
				</button>
			)}
		</div>
	);
};
