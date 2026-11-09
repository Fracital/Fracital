/** Outgoing mail over SMTP. Env: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM. */
import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

/** Mail needs a host and, when a login user is configured, its password (otherwise every send fails). */
export const mailEnabled = () => !!process.env.SMTP_HOST?.trim() && (!process.env.SMTP_USER?.trim() || !!process.env.SMTP_PASS);

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

async function sendLinkEmail(to: string, subject: string, intro: string, linkText: string, url: string, outro: string) {
	await getTransporter().sendMail({
		from: process.env.MAIL_FROM || process.env.SMTP_USER,
		to,
		subject,
		text: `${intro}\n\n${url}\n\n${outro}`,
		html: `<div style="background:#fff;padding:20px;font-family:Helvetica,Arial,sans-serif;color:#111"><p>${esc(intro)}</p><p><a href="${esc(url)}">${esc(linkText)}</a></p><p>${esc(outro)}</p></div>`,
	});
}

export const sendVerificationEmail = (to: string, url: string) => sendLinkEmail(to, "Verify your email address", "Open this link to verify your email address:", "Verify your email", url, "If you didn't create an account, you can ignore this email.");

export const sendPasswordResetEmail = (to: string, url: string) => sendLinkEmail(to, "Reset your password", "Open this link to choose a new password. It expires in an hour.", "Reset your password", url, "If you didn't ask to reset your password, you can ignore this email.");
