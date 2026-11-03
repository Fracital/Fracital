declare global {
	interface Window {
		XOR: typeof XOR;
	}
}

const XOR = {
	encode(input: string): string {
		let result = "";
		let len = input.length;
		for (let i = 0; i < len; i++) {
			const char = input[i];
			result += i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char;
		}
		return encodeURIComponent(result);
	},
	decode(input: string): string {
		if (!input) return input;
		input = decodeURIComponent(input);
		let result = "";
		let len = input.length;
		for (let i = 0; i < len; i++) {
			const char = input[i];
			result += i % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char;
		}
		return result;
	},
};
window.XOR = XOR;

export default XOR;
