import React, { forwardRef } from "react";

type ShellButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & Record<string, any>;

export const ShellButton = forwardRef<HTMLButtonElement, ShellButtonProps>(({ className, children, ...rest }, ref) => {
  return (
    <button
      ref={ref}
      className={
        "flex items-center justify-center p-2 rounded-lg bg-(--secondary) text-(--text-secondary) hover:text-(--text-primary) cursor-pointer duration-200 " +
        "inset-shadow-(--inset-shadow-secondary) hover:inset-shadow-[0_0_0_2px_var(--accent)] " +
        (className ? className : "")
      }
      {...rest}
    >
      {children}
    </button>
  );
});

ShellButton.displayName = "ShellButton";
