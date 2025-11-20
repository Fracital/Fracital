import { useEffect, useRef, useState } from "react";

interface InputProps {
	title: string;
	type: React.HTMLInputTypeAttribute;
	value?: string;
	onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
	onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export const Input = ({ title, type, value, onChange, onKeyDown }: InputProps) => {
	const titleRef = useRef<HTMLInputElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const [hasText, setHasText] = useState<boolean>(false);
	const [active, setActive] = useState<boolean>(false);

	useEffect(() => {
		if (hasText) {
			setTimeout(() => {
				titleRef.current?.classList.add("-translate-x-3");
			}, 150);
		}
	}, [hasText]);

	return (
		<div className="relative flex flex-col justify-center w-full gap-1">
			<span
				ref={titleRef}
				className={
					"absolute left-3 font-medium pointer-events-none duration-150" +
					" " +
					`
                ${hasText ? "opacity-0" : "opacity-70"}
            `
				}
			>
				{title}
			</span>
			<input
				ref={inputRef}
				type={type ? type : "text"}
				value={value}
				className={
					"flex p-2 pl-3 w-full bg-[#00000038] text-xl inset-shadow-[0_0_1px_2px_#ffffff28] outline-none rounded-lg duration-150" +
					" " +
					`
                ${active ? "inset-shadow-[0_0_1px_2px_var(--accent)]" : "inset-shadow-[0_0_1px_2px_#ffffff28]"}
            `
				}
				onFocus={() => {
					setActive(true);
				}}
				onBlur={() => {
					setActive(false);
				}}
				onChange={e => {
					console.log(e.target.value);
					if (e.target.value !== "") setHasText(true);
					else setHasText(false);
					onChange?.(e);
				}}
				onKeyDown={onKeyDown}
			/>
		</div>
	);
};
