export const isColorBright = (hex: string): "light" | "dark" => {
	hex = hex.replace(/^#/, "");

	if (hex.length === 3) {
		hex = hex
			.split("")
			.map(c => c + c)
			.join("");
	}

	if (hex.length !== 6) {
		throw new Error(`Invalid hex color: ${hex}`);
	}

	const r = parseInt(hex.slice(0, 2), 16);
	const g = parseInt(hex.slice(2, 4), 16);
	const b = parseInt(hex.slice(4, 6), 16);

	const distanceFromWhite = Math.sqrt(Math.pow(255 - r, 2) + Math.pow(255 - g, 2) + Math.pow(255 - b, 2));

	return distanceFromWhite < 100 ? "dark" : "light";
};
