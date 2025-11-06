import { parse } from "svg-parser";
import React, { useEffect, useState, useRef } from "react";

interface ButtonProps {
	type: "icon" | "toggle";
	icon?: string | React.ReactNode | React.ReactNode[];
	title?: string[] | string;
	/**
	 * Allows for changing state of the toggle, with your own listener
	 * @param `setStateFn` set state
	 */
	registerListeners?: (setStateFn: React.Dispatch<React.SetStateAction<number>>) => void;
	onClick: () => void;
}

/**
 * ShellButton module, `this does not yet parse an array of "string" icons`
 * @param type `"icon"` | `"toggle"`
 * @returns React JSX element
 */

export const ShellButton = ({ type, icon, title, registerListeners, onClick }: ButtonProps) => {
	const [currentState, setCurrentState] = useState<number>(0);
	const [parsedIcon, setParsedIcon] = useState<[] | React.ReactNode | React.JSX.Element | null>(null);
	const icon1Ref = useRef<HTMLSpanElement | null>(null);
	const icon2Ref = useRef<HTMLSpanElement | null>(null);

	useEffect(() => {
		if (registerListeners) {
			registerListeners(setCurrentState);
		}
	}, [registerListeners]);

	if (typeof icon === "string") {
		// if (Array.isArray(icon) === true) {
		//     const parsed = parse(icon);
		//     useEffect(() => {
		//         if (Array.isArray(icon)) {
		//             const parsedIcons = icon.map((iconStr) => {
		//                 if (typeof iconStr === "string") {
		//                     const parsed = parse(iconStr);
		//                     const rawProps = (parsed as any).children[0].properties || {};
		//                     const svgProps: Record<string, any> = {};
		//                     for (const key in rawProps) {
		//                         svgProps[key === "class" ? "className" : key] = rawProps[key];
		//                     }
		//                     return (
		//                         <svg {...svgProps}>
		//                             {(parsed as any).children[0].children.map((child: any, idx: number) => {
		//                                 const { tagName, properties, children } = child;
		//                                 const reactProps: Record<string, any> = {};
		//                                 for (const key in properties) {
		//                                     reactProps[key === "class" ? "className" : key] = properties[key];
		//                                 }
		//                                 return (
		//                                     <React.Fragment key={idx}>
		//                                         {React.createElement(
		//                                             tagName,
		//                                             reactProps,
		//                                             children && children.length > 0
		//                                                 ? children.map((c: any, i: number) =>
		//                                                     typeof c === "string"
		//                                                         ? c
		//                                                         : React.createElement(
		//                                                             c.tagName,
		//                                                             { key: i, ...(c.properties || {}) },
		//                                                             c.children && c.children.length > 0 ? c.children : null
		//                                                         )
		//                                                 )
		//                                                 : null
		//                                         )}
		//                                     </React.Fragment>
		//                                 );
		//                             })}
		//                         </svg>
		//                     );
		//                 }
		//                 return iconStr;
		//             });
		//             setParsedIcon(parsedIcons);
		//         }
		//     }, [icon]);
		// } else {
		useEffect(() => {
			const parsed = parse(icon);
			const rawProps = (parsed as any).children[0].properties || {};
			const svgProps: Record<string, any> = {};
			for (const key in rawProps) {
				if (key === "class") {
					svgProps["className"] = rawProps[key];
				} else {
					svgProps[key] = rawProps[key];
				}
			}
			const svg = (
				<svg {...svgProps}>
					{(parsed as any).children[0].children.map((child: any, idx: number) => {
						const { tagName, properties, children } = child;
						const reactProps: Record<string, any> = {};
						for (const key in properties) {
							reactProps[key === "class" ? "className" : key] = properties[key];
						}
						return (
							<React.Fragment key={idx}>
								{React.createElement(tagName, reactProps, children && children.length > 0 ? children.map((c: any, i: number) => (typeof c === "string" ? c : React.createElement(c.tagName, { key: i, ...(c.properties || {}) }, c.children && c.children.length > 0 ? c.children : null))) : null)}
							</React.Fragment>
						);
					})}
				</svg>
			);
			setParsedIcon(svg);
		}, [icon]);
		// }
	}

	return (
		<button
			title={Array.isArray(title) ? title[currentState] : title}
			className={
				"flex items-center justify-center p-2 rounded-lg bg-(--secondary) text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-200" +
				" " +
				`
                inset-shadow-(--inset-shadow-secondary)
                hover:inset-shadow-[0_0_0_2px_var(--accent)]
                ${type === "toggle" ? "relative" : ""}
            `
			}
			onClick={() => {
				if (type === "toggle" && Array.isArray(icon) && icon.length === 2) {
					setCurrentState(prev => (prev === 0 ? 1 : 0));
					setTimeout(() => {
						if (currentState == 0) {
							icon1Ref.current?.classList.add("absolute");
							icon2Ref.current?.classList.remove("absolute");
						} else if (currentState == 1) {
							icon2Ref.current?.classList.add("absolute");
							icon1Ref.current?.classList.remove("absolute");
						}
					}, 200);
				}
				onClick();
			}}
		>
			{Array.isArray(icon) ? (
				icon.map((item, index) =>
					typeof item === "string" ? (
						<span ref={icon1Ref} key={index} className={currentState !== index ? "opacity-0 duration-150" : undefined}>
							{item}
						</span>
					) : (
						<span ref={icon2Ref} key={index} className={currentState !== index ? "absolute opacity-0 duration-150" : undefined}>
							{item}
						</span>
					),
				)
			) : typeof icon === "string" ? (
				<span>{parsedIcon}</span>
			) : (
				icon
			)}
		</button>
	);
};
