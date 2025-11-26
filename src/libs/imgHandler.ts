export const handleImg = (src: string | React.ReactNode | null | undefined, callback: (result: string | undefined) => void): void => {
	if (typeof src !== "string") {
		callback(undefined);
		return;
	}
	if (src.startsWith("http://") || src.startsWith("https://")) {
		window.fr.net
			.fetch(src)
			.then(response => response.blob())
			.then(blob => callback(URL.createObjectURL(blob)));
		return;
	}
	callback(src);
};
