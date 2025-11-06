import { type ReactNode } from "react";

export const Modal = ({ children }: { children: ReactNode }) => {
	return <div className="w-full max-w-md">{children}</div>;
};
