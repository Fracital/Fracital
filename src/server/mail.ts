/** Outgoing mail over SMTP. Env: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM. */
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

export const mailEnabled = () => !!process.env.SMTP_HOST?.trim();

function getTransporter() {
	if (transporter) return transporter;
	const host = process.env.SMTP_HOST!.trim();
	transporter = nodemailer.createTransport({
		host,
		port: Number(process.env.SMTP_PORT) || 465,
		secure: process.env.SMTP_SECURE !== "false",
		auth: { user: process.env.SMTP_USER || process.env.MAIL_FROM, pass: process.env.SMTP_PASS || "" },
		tls: { servername: host },
		connectionTimeout: 5000,
		greetingTimeout: 5000,
		socketTimeout: 8000,
	});
	return transporter;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

export async function sendVerificationEmail(to: string, url: string) {
	await getTransporter().sendMail({
		from: process.env.MAIL_FROM || process.env.SMTP_USER,
		to,
		subject: "Verify your email address",
		text: `Open this link to verify your email address:\n\n${url}\n\nIf you didn't create an account, you can ignore this email.`,
		html: `<div style="background:#fff;padding:20px;font-family:Helvetica,Arial,sans-serif;color:#111"><p>Click to verify your email address:</p><p><a href="${esc(url)}">Verify your email</a></p><p>If you didn't create an account, you can ignore this email.</p></div>`,
	});
}
