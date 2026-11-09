# Fracital

The NEW age of Fracital

## Features

- Music Player (with a full-tab player and synced lyrics — add an LRC, SRT or TXT file from the library's track menu, or let it fetch synced lyrics from LRCLIB or NetEase Cloud Music; the uploader and the track menu's **Find Info Online** also fill in missing album, genre, year and cover art from Apple Music or Deezer)
- Vertical Tabs
- Sleek Design
- Modern & Fast

## Installation

Using the package manager of your choise install the dependencies by running, for this example npm will be used

```js
npm i
```

## Usage

If your developing Fracital, use the dev server availible at `npm run dev`

If your using Fracital in Production, use `npm run start`

### Fracital Accounts

Accounts (email/password or **Continue with Last.fm**) live on the Fracital server and are stored in Postgres. They sync your settings and, with Last.fm connected, power **Your Library** in the Digital Library: liked songs, recently played, top songs/artists/albums, recommendations, your personal play counts, ♥ likes that sync back to Last.fm, and scrobbling of everything you play. Accounts are managed at `about:account`.

Add to `.env` (see `.env.example` for every option):

```sh
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/fracital
BETTER_AUTH_SECRET=   # openssl rand -hex 32
BETTER_AUTH_URL=https://your-domain   # production only
LASTFM_API_KEY=your_key
LASTFM_API_SECRET=your_shared_secret
```

Tables are created automatically on first start. Without `DATABASE_URL`, accounts are disabled.

More ways to sign in, each turned on by its env keys in `.env.example`:

- **Google, Discord, GitHub, Microsoft**: set `<PROVIDER>_CLIENT_ID` and `<PROVIDER>_CLIENT_SECRET`. Register `<BETTER_AUTH_URL>/api/auth/callback/<provider>` as the redirect URI with each provider.
- **Passkeys**: always on, but tied to one domain (`PASSKEY_RP_ID`, which defaults to the `BETTER_AUTH_URL` hostname).
- **Terbium Accounts**: set `TERBIUM_AUTH_URL`.
- **Password reset and email verification**: need SMTP (`SMTP_HOST` and related keys).

OAuth and Last.fm sign-in finish on the `BETTER_AUTH_URL` host, so the buttons only appear there. Signed-in users can link or unlink providers and passkeys in `about:account`. Removing the last sign-in method on an account is blocked.

Scrobbles wait in a queue on the device until they're sent. That covers being offline, Last.fm being down, and revoked Last.fm access ("Reconnect" in `about:account`). Loved songs from any public Last.fm profile can be imported into the library without connecting it.

### Last.fm stats

Digital Library artist pages show song play counts and artist listener counts from Last.fm. Get a free API key and shared secret at https://www.last.fm/api/account/create. Without a key, song plays fall back to YouTube view counts and artists show Deezer fan counts.

## Credits

Made with ❤️ by the Fracital Team

&copy; Copyright 2026 Fracital Development

Licensed Under the [AGPL License](./LICENSE)
