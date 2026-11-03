export interface detailProps {
	title: string;
	url: string;
	icon: string | React.ReactNode | null;
	id: string;
	displayUrl: string;
}

export const navigationEvent = (detail: detailProps) => {
	const event = new CustomEvent("navigate", { detail });
	window.dispatchEvent(event);
};
