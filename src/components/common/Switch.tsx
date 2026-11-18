import { useHolyAttr } from "../../libs/holy-attr";

/** An on/off switch with an obfuscated accessible name (see HOLYTEXT.md on the pre-hydration tradeoff). */
export const Switch = ({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) => {
	const { ref, placeholder } = useHolyAttr({ "aria-label": label });
	return (
		<button
			ref={ref}
			{...placeholder}
			type="button"
			role="switch"
			aria-checked={on}
			disabled={disabled}
			onClick={() => onChange(!on)}
			className={`relative inline-block w-12 h-7 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 cursor-pointer ${on ? "bg-(--accent)" : "bg-[#ffffff15] hover:bg-[#ffffff25]"}`}
		>
			<span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow transition-transform duration-200 ${on ? "translate-x-5" : ""}`} />
		</button>
	);
};
