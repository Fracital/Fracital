import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { holyDecrypt } from "../../libs/holy-decrypt";
import { getObfuscatedCiphertext } from "../../libs/obfuscated-strings";
import { HolyText } from "./HolyText";

export interface HolyLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
	href: string;
	encryptedHref?: string;
	text?: string;
	encryptedText?: string;
	target?: string;
	children?: React.ReactNode;
}

export const HolyLink: React.FC<HolyLinkProps> = ({
	href,
	encryptedHref,
	text,
	encryptedText,
	target,
	children,
	className = "",
	// Destructure the event props so the `{...props}` spread below can never
	// clobber this component's own handlers (A4). Caller handlers are invoked
	// from inside ours.
	onClick,
	onAuxClick,
	onPointerDown,
	onPointerLeave,
	onFocus,
	onBlur,
	...props
}) => {
	const cipherHref = encryptedHref || getObfuscatedCiphertext(href);
	const anchorRef = useRef<HTMLAnchorElement>(null);
	const navigate = useNavigate();

	const resolveHref = (): string => {
		if (cipherHref) {
			return holyDecrypt(cipherHref);
		}
		return href;
	};

	// "Hash until interaction" (D3 / A5): the anchor shows href="#" at rest, so
	// the real destination is not sitting in the DOM for scrapers. The moment the
	// user actually interacts (pointer down, keyboard focus) we drop the real
	// href in, so native copy-link, open-in-new-tab and drag all work. We restore
	// "#" once the interaction ends.
	const revealHref = () => {
		anchorRef.current?.setAttribute("href", resolveHref());
	};
	const hideHref = () => {
		anchorRef.current?.setAttribute("href", "#");
	};

	const handlePointerDown = (e: React.PointerEvent<HTMLAnchorElement>) => {
		revealHref();
		onPointerDown?.(e);
	};

	const handlePointerLeave = (e: React.PointerEvent<HTMLAnchorElement>) => {
		hideHref();
		onPointerLeave?.(e);
	};

	const handleFocus = (e: React.FocusEvent<HTMLAnchorElement>) => {
		revealHref();
		onFocus?.(e);
	};

	const handleBlur = (e: React.FocusEvent<HTMLAnchorElement>) => {
		hideHref();
		onBlur?.(e);
	};

	const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		if (onClick) {
			onClick(e);
			if (e.defaultPrevented) return;
		}

		e.preventDefault();
		const targetUrl = resolveHref();

		if (e.ctrlKey || e.metaKey || target === "_blank") {
			window.open(targetUrl, "_blank");
			return;
		}

		const cleanPath = targetUrl.replace(/^\/+/, "").split("?")[0].split("#")[0];

		// In-app paths navigate through the router; everything else is external.
		if (targetUrl === "/" || targetUrl === "") {
			navigate("/");
			return;
		}
		if (!target && !/^(?:https?:)?\/\//.test(targetUrl) && !/^[a-z]+:/i.test(targetUrl)) {
			navigate("/" + cleanPath);
			return;
		}

		if (target) {
			window.open(targetUrl, target);
		} else {
			window.open(targetUrl, "_blank");
		}
	};

	const handleAuxClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
		if (onAuxClick) {
			onAuxClick(e);
			if (e.defaultPrevented) return;
		}

		if (e.button === 1) {
			e.preventDefault();
			window.open(resolveHref(), "_blank");
		}
	};

	const content = text ? <HolyText text={text} encrypted={encryptedText} /> : children;

	return (
		<a ref={anchorRef} href="#" data-eclink={cipherHref} target={target} onClick={handleClick} onAuxClick={handleAuxClick} onPointerDown={handlePointerDown} onPointerLeave={handlePointerLeave} onFocus={handleFocus} onBlur={handleBlur} className={`holy-link ${className}`.trim()} {...props}>
			{content}
		</a>
	);
};

export default HolyLink;
