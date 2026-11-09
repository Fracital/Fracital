/**
 * Fracital's Terms of Service (/tos) and Privacy Policy (/privacy), as standalone server-rendered
 * pages on the direct hosts (never on decoy hosts; see backend.ts).
 *
 * Plain on purpose: sign-in providers, ad partners and crawlers have to be able to read these, and
 * so do screen readers, so they aren't obfuscated like the app's UI text. They aren't part of the
 * client bundle. Keep them true to what the code does; when a feature that collects or shares data
 * changes, update the policy and EFFECTIVE.
 */

const EFFECTIVE = "November 9, 2026";
const CONTACT = "contact@fracit.al";

export type LegalPage = "tos" | "privacy";

const TITLES: Record<LegalPage, string> = { tos: "Terms of Service", privacy: "Privacy Policy" };

const mail = `<a href="mailto:${CONTACT}">${CONTACT}</a>`;

const TOS = `
<p>These terms are an agreement between you and Fracital about your use of Fracital: the website at fracit.al, our other sites that run the same service, and everything you can do there. By using Fracital you agree to these terms and to our <a href="/privacy">Privacy Policy</a>. If you don't agree, please don't use Fracital.</p>

<h2>1. Who can use Fracital</h2>
<p>You must be at least 13 years old, or older if the law where you live sets a higher minimum age for using online services without a parent's consent. If you're under 18, you need permission from a parent or guardian, and they agree to these terms for you.</p>

<h2>2. What Fracital is</h2>
<p>Fracital is a free, ad-supported workspace in your browser. It includes a web proxy that loads other websites through our servers, browser games, a music player, a file manager and text editor, and optional accounts that sync your settings and library and connect services like Last.fm, ListenBrainz and Discord.</p>

<h2>3. Your account</h2>
<ul>
<li>You can use much of Fracital without an account. If you create one, give accurate information and keep your sign-in methods secure. You're responsible for what happens on your account.</li>
<li>Signing in with Google, Discord, GitHub, Microsoft, Last.fm or Terbium is also covered by that service's own terms.</li>
<li>We may suspend or close accounts that break these terms or put Fracital or its users at risk.</li>
</ul>

<h2>4. Acceptable use</h2>
<p>Don't use Fracital, including its proxy, to:</p>
<ul>
<li>break any law or anyone else's rights, including copyright;</li>
<li>attack, overload, scan or break into any website, network or service, ours included;</li>
<li>send spam, spread malware, phish, or scrape websites at scale;</li>
<li>harass, threaten or exploit anyone, or share content that sexualizes minors;</li>
<li>get around Fracital's own limits, security or ads in ways we haven't offered, or resell Fracital.</li>
</ul>
<p>You're responsible for following the rules of any network or device you use Fracital on, such as a school's or employer's.</p>

<h2>5. Other websites, games and music</h2>
<p>Websites you open through the proxy, games, music and other third-party content belong to their owners, and their terms apply. Fracital doesn't control that content, isn't affiliated with those services unless we say so, and isn't responsible for it. Music in Fracital is for personal listening only; don't record, download or redistribute it.</p>

<h2>6. Content you add</h2>
<p>You keep ownership of what you add to Fracital, such as your profile, artist pages and uploaded media, saved music and game saves. You give us permission to store, copy, display and transmit it as needed to run Fracital and show it where you choose to share it. Only add content you have the right to share. We may remove content that breaks these terms.</p>

<h2>7. Copyright complaints</h2>
<p>If you believe something on Fracital infringes your copyright, email ${mail} with the content's location, the work you own, your contact details, and a statement that you have a good-faith belief its use isn't authorized. We'll remove infringing material and close the accounts of repeat infringers.</p>

<h2>8. Ads and premium</h2>
<p>Fracital is free and paid for by ads, which our ad partners provide (see the <a href="/privacy#ads">Privacy Policy</a>). We may offer ad-free premium accounts; we decide who gets premium and may change or end it.</p>

<h2>9. Changes to Fracital</h2>
<p>We may add, change or remove features, or stop offering Fracital, at any time. We don't promise that Fracital or any feature will always be available.</p>

<h2>10. Disclaimer</h2>
<p>Fracital is provided "as is" and "as available", without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy and non-infringement, to the fullest extent the law allows.</p>

<h2>11. Limitation of liability</h2>
<p>To the fullest extent the law allows, Fracital and the people who run it aren't liable for indirect, incidental, special, consequential or punitive damages, or for lost data, profits or goodwill, arising from your use of Fracital or third-party content. Our total liability for any claim is limited to the greater of what you paid us in the 12 months before the claim or US$10.</p>

<h2>12. Ending</h2>
<p>You can stop using Fracital at any time, and you can delete your account from your account page (see the <a href="/privacy#rights">Privacy Policy</a>). We may suspend, end your access or delete your account if you break these terms; if we delete it, you can still download your data for 30 days. Sections 5 through 11 continue to apply after that.</p>

<h2>13. Changes to these terms</h2>
<p>We may update these terms. We'll post the new version here with a new effective date, and for significant changes we'll try to give notice in Fracital. If you keep using Fracital after a change, you accept the new terms.</p>

<h2>14. Contact</h2>
<p>Questions about these terms: ${mail}.</p>
`;

const PRIVACY = `
<p>This policy explains what Fracital collects when you use it (the website at fracit.al, our other sites that run the same service, and our Discord bot), how we use it, who we share it with, and the choices you have. See also our <a href="/tos">Terms of Service</a>.</p>

<h2>1. What we collect</h2>
<h3>When you create or use an account</h3>
<ul>
<li><strong>Profile:</strong> your display name, email address, username and profile picture.</li>
<li><strong>Sign-in:</strong> your password, stored only as a secure hash; passkeys, of which we store only the public key; and, if you sign in with Google, Discord, GitHub, Microsoft or Terbium, your account ID there and the access tokens that keep the connection working.</li>
<li><strong>Music services you connect:</strong> for Last.fm, your username and session key; for ListenBrainz, your username and the user token you paste in. With them we read your listening library and send the songs you play (scrobbles), "now playing" and likes to that service.</li>
<li><strong>What you save:</strong> your settings, saved songs, albums and artists, game save backups, and anything you put on an artist page, including uploaded media.</li>
<li><strong>Sessions:</strong> when you sign in, the IP address and browser information of that session, used to keep your account secure.</li>
</ul>
<h3>Discord</h3>
<ul>
<li>If you connect Discord, we store your Discord account ID so we can match you.</li>
<li><strong>On Discord:</strong> our Discord bot sees what Discord shares with bots about members of the servers it's in: online status, activities (such as the game you're playing or what you're listening to) and the voice channel you're in. We keep this in memory only while the bot is running; it isn't saved to our database. We show yours only to you, on your account page, and only if your Discord account is connected. You can turn this off on your account page.</li>
<li><strong>Discord status:</strong> if you turn on showing your Fracital music as your Discord status, we use the permission you grant Discord to set it, and we send Discord the song you're playing.</li>
</ul>
<h3>When you use Fracital, with or without an account</h3>
<ul>
<li><strong>Proxy:</strong> pages you open through the proxy pass through our servers so they can load. We don't save the sites you visit to your account or keep a browsing history.</li>
<li><strong>Plays:</strong> when you play a song, we record the song, the artist, the time, a random ID stored in your browser, and your account if you're signed in. We use this for play counts and artists' statistics, which only ever show totals, never who played what.</li>
<li><strong>Technical logs:</strong> our servers and our network and security provider (Cloudflare) keep short-lived logs, such as IP addresses, times and errors, to run Fracital and protect it from abuse.</li>
<li><strong>On your device:</strong> files you add, your settings and other preferences, and songs waiting to be scrobbled are stored in your browser. They stay on your device unless you sign in to sync your settings.</li>
</ul>

<h2 id="cookies">2. Cookies and similar storage</h2>
<ul>
<li><strong>Essential:</strong> cookies that keep you signed in, protect sign-ins in progress, and hold the key used to encrypt the app's requests; and, if you leave "Stay signed in across sites" on, a cookie on our sign-in site that signs you in on our other sites.</li>
<li><strong>Preferences:</strong> browser storage for your settings and choices.</li>
<li><strong>Advertising:</strong> cookies and identifiers set by our ad partners (see below).</li>
</ul>

<h2 id="ads">3. Ads</h2>
<p>Fracital shows ads from RevIQ, which runs Google Ad Manager and auctions among other ad companies, and from Adsterra. These partners may use cookies, device identifiers, your IP address and information about the page to show ads, limit how often you see them, measure them and prevent fraud, and some may personalize ads to your interests. Where the law requires it, you'll be asked for consent. You can control personalized ads through <a href="https://adssettings.google.com" rel="noopener">Google's ad settings</a>, <a href="https://optout.aboutads.info" rel="noopener">aboutads.info</a> or <a href="https://www.youronlinechoices.eu" rel="noopener">youronlinechoices.eu</a>. Premium accounts don't see ads.</p>

<h2>4. How we use information</h2>
<ul>
<li>to run Fracital and its features, including sign-in, sync, your library, scrobbling and Discord features;</li>
<li>to keep accounts and Fracital secure and to stop abuse and enforce our terms;</li>
<li>to send emails you ask for, such as verification and password resets;</li>
<li>to show ads that pay for Fracital;</li>
<li>to understand how Fracital is used and to fix problems.</li>
</ul>

<h2>5. Who we share it with</h2>
<ul>
<li><strong>Services you connect,</strong> as needed for what you asked: sign-in providers, Last.fm, ListenBrainz and Discord.</li>
<li><strong>Providers that run Fracital for us:</strong> hosting, database, Cloudflare and email delivery. They may use your information only to provide their service.</li>
<li><strong>Ad partners,</strong> as described above.</li>
<li><strong>Music and media sources,</strong> such as Deezer and YouTube. When you play or look up music, we request that song or artist from them.</li>
<li><strong>When the law requires it,</strong> or to protect the rights, safety and security of our users, the public or Fracital.</li>
</ul>
<p>We don't sell your account information.</p>

<h2>6. How long we keep it</h2>
<p>We keep your account information until your account is deleted. Then we keep one copy of your data for 30 days so you can download it (we email you the link), after which it's erased for good; plays recorded with your account are kept only as anonymous totals. Sign-in sessions expire after 30 days without use. Discord activity isn't stored. Library data we fetch from connected services is cached for up to 30 minutes, and technical logs are kept briefly. Information in your browser stays until you clear it.</p>

<h2 id="rights">7. Your choices and rights</h2>
<ul>
<li>You can see and change your profile, disconnect services, and turn off "On Discord", your Discord status and cross-site sign-in on your account page.</li>
<li>You can delete your account on your account page; we email you a code to confirm it's you. Deleting it removes your profile, saved music, playlists, settings and game backups, disconnects every service you connected (so you can connect them again to a new account), and keeps your past plays only as anonymous totals. We email you a link to download a copy of your data, which works for 30 days; then the copy is erased for good. If your account has no email address, email ${mail} with your username.</li>
<li>We may delete accounts that break our <a href="/tos">Terms of Service</a>. The same applies: you're emailed a link to download your data, kept for 30 days.</li>
<li>Depending on where you live, you may have rights to access, correct, delete, move or object to the use of your information, and to complain to a data protection authority. To use them, email ${mail}. We won't treat you differently for using them.</li>
</ul>

<h2>8. Children</h2>
<p>Fracital isn't directed to children under 13, and we don't knowingly collect personal information from them. If you think a child under 13 has given us personal information, email ${mail} and we'll delete it.</p>

<h2>9. Security</h2>
<p>We use encryption in transit (HTTPS), store passwords only as hashes, and limit who can access our systems. No service is perfectly secure, so we can't guarantee the security of your information.</p>

<h2>10. Where it's processed</h2>
<p>Fracital and its providers may process your information in countries other than yours, including the United States, where data protection laws may differ.</p>

<h2>11. Changes to this policy</h2>
<p>We'll post any changes here with a new effective date, and for significant changes we'll try to give notice in Fracital.</p>

<h2>12. Contact</h2>
<p>Questions or requests about your privacy: ${mail}.</p>
`;

const STYLE = `
:root{color-scheme:dark;--bg:#1a1a1d;--fg:#e8e8ea;--muted:#a3a3ab;--line:#ffffff1f;--link:#8ab4ff}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#fafafa;--fg:#1d1d20;--muted:#5d5d66;--line:#0000001a;--link:#1f5fd6}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 20px 64px}
nav{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:32px;font-size:15px}
nav .brand{font-weight:800;letter-spacing:.02em;margin-right:auto;color:var(--fg);text-decoration:none}
h1{font-size:34px;line-height:1.2;margin:0 0 6px}
.meta{color:var(--muted);margin:0 0 28px;font-size:14px}
h2{font-size:20px;margin:34px 0 8px;padding-top:18px;border-top:1px solid var(--line)}
h3{font-size:16px;margin:20px 0 4px}
ul{padding-left:22px}li{margin:4px 0}
a{color:var(--link)}
footer{margin-top:48px;color:var(--muted);font-size:14px}
`;

export function renderLegalPage(page: LegalPage): string {
	const other: LegalPage = page === "tos" ? "privacy" : "tos";
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLES[page]} · Fracital</title>
<meta name="description" content="Fracital's ${TITLES[page]}.">
<link rel="icon" type="image/svg+xml" href="/icon.svg">
<style>${STYLE}</style></head>
<body><main>
<nav><a class="brand" href="/">Fracital</a><a href="/${other}">${TITLES[other]}</a></nav>
<h1>${TITLES[page]}</h1>
<p class="meta">Effective ${EFFECTIVE}</p>
${page === "tos" ? TOS : PRIVACY}
<footer>© Fracital 2026 · <a href="/tos">Terms</a> · <a href="/privacy">Privacy</a> · ${mail}</footer>
</main></body></html>`;
}
