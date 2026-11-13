import React, { forwardRef } from "react";

/** A top bar button that does one thing: just its icon, no pill. */
type ShellButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, any>;

export const ShellButton = forwardRef<HTMLButtonElement, ShellButtonProps>(({ className, children, ...rest }, ref) => {
	return (
		<button ref={ref} className={"flex shrink-0 items-center justify-center text-(--text-secondary) hover:text-(--text-primary) aria-pressed:text-(--text-primary) cursor-pointer duration-200 " + (className ? className : "")} {...rest}>
			{children}
		</button>
	);
});

ShellButton.displayName = "ShellButton";
