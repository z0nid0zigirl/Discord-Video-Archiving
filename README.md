# Discord Server Archiver

A Node.js tool for preserving a Discord server: every message, photo, video and audio file, in folders by category and channel, with a record of who posted what.

```bash
npm run archive
```

- **Folders like the sidebar:** `Server / Category / channel /`, with `photos/`, `videos/` and `audio/` inside each channel and threads and forum posts under `threads/`.
- **Every photo and video:** files are sorted by the type Discord reports, so `.mov`, `.webm`, `.heic` and friends are kept. Files in forwarded messages, GIFs from Tenor and Giphy, and images posted as links are saved too.
- **Who posted what:** every message and every file carries the poster's user ID, username and display name. File names include them, and `users.json` lists every poster.
- **Browsable offline:** each channel gets an HTML page that shows its photos and videos from the saved files, plus JSON and plain text. `index.html` ties the server together.
- **Safe to stop:** progress is saved as it goes. Run it again after a crash or Ctrl+C and it carries on; run it next month and it only fetches what's new.

---

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- A Discord bot you've created and invited to the server (steps below)
- Permission from the server owner to archive it

## Setup

### 1. Create the bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and click **New Application**.
2. Open the **Bot** page.
3. Click **Reset Token** and copy the token. Keep it private; anyone with it can control the bot.
4. Under **Privileged Gateway Intents**, turn on **Message Content Intent** and click **Save Changes**.

> Without Message Content Intent the bot fails to start with `Used disallowed intents`.

### 2. Install and configure

```bash
npm install
```

Copy `.env.example` to `.env` (on Windows PowerShell: `Copy-Item .env.example .env`) and fill in `DISCORD_TOKEN` and `GUILD_ID`.

To get IDs, turn on **Settings → Advanced → Developer Mode** in Discord. Then:

- **Server ID:** right-click the server icon → **Copy Server ID**
- **Channel ID:** right-click a channel → **Copy Channel ID**

### 3. Invite the bot to your server

```bash
npm run invite
```

This prints an invite link with exactly the permissions the bot needs: **View Channels** and **Read Message History**. Open it, pick your server and authorize. It also prints a second link that adds **Manage Threads**, which is only needed to archive private threads that have been archived.

The bot can only archive channels it can see. For private channels, give the bot's role access to them.

### 4. Check what it can see

```bash
npm run archive -- --dry-run
```

Lists every category, channel and thread the bot will archive, and every channel it can't read and why. Nothing is downloaded.

---

## Usage

Run commands from the project folder. Everything is written to the `output/` folder.

```bash
npm run archive                                  # the whole server
npm run archive -- --channels 1234,5678          # only these channels, categories or threads
npm run archive -- --text-only                   # messages only, no downloads
npm run archive -- --media-only --zip            # files only, plus a ZIP
```

| Option | What it does |
|---|---|
| `--channels <ids>` | Only these channels, categories or threads (comma-separated IDs). A channel brings its threads; a category brings its channels. Default: `CHANNEL_IDS` from `.env`, otherwise the whole server |
| `--text-only` | Messages only; downloads nothing |
| `--media-only` | Files only; no message pages |
| `--all-files` | Also download other attachments (PDFs, ZIPs, ...) |
| `--no-embeds` | Skip media from links (Tenor and Giphy GIFs, image links) |
| `--no-threads` | Skip threads and forum posts |
| `--dedupe <mode>` | `channel` (default): identical files are stored once per channel. `server`: once per server; reposts elsewhere point to the first copy. `none`: keep every copy |
| `--zip` | Also write a ZIP of the archive (without the resume data) |
| `--out <folder>` | Where archives go (default `./output`) |
| `--dry-run` | List what would be archived; download nothing |

### What you get

```
output/My Server (123456789012345678)/
├── index.html                ← start here
├── server.json               ← categories, channels, counts, anything skipped
├── users.json                ← every poster: user ID, names, message and file counts
├── No Category/              ← channels that aren't in a category
│   └── welcome/
├── INFO/                     ← a category
│   └── general/              ← a channel
│       ├── messages.html     ← photos and videos shown from the saved files
│       ├── messages.json
│       ├── messages.txt
│       ├── media.json        ← every file: who posted it, when, its hash
│       ├── photos/
│       │   └── 2024-01-15_10-30-00_alice_987654321098765432_cat.jpg
│       ├── videos/
│       ├── audio/
│       └── threads/
│           └── cat appreciation/   ← same layout as a channel
└── 📸┃MEDIA/
    └── help-forum/
        └── threads/          ← forum posts
```

- **File names** are `<date and time (UTC)>_<username>_<user ID>_<original name>`.
- **Folder names** keep emoji and non-English letters; only characters a filesystem can't store are replaced with `_`. If two channels share a name, the second gets its ID added.
- **Empty channels** don't get a folder; they're still listed in `index.html`.

Each message in `messages.json`:

```json
{
  "message_id": "112233445566778899",
  "user_id": "987654321098765432",
  "username": "alice",
  "display_name": "Alice",
  "is_bot": false,
  "timestamp": "01/15/2024, 10:30:00 AM",
  "timestamp_iso": "2024-01-15T10:30:00.000Z",
  "edited_timestamp_iso": null,
  "type": "Default",
  "pinned": false,
  "content": "my cat",
  "mentions": [],
  "attachments": [
    { "name": "cat.jpg", "kind": "photos", "size": 52133, "local_path": "photos/2024-01-15_10-30-00_alice_987654321098765432_cat.jpg", "...": "..." }
  ],
  "embeds": [],
  "stickers": [],
  "reactions": [{ "emoji": "🔥", "count": 3 }],
  "reference": null,
  "forwarded": [],
  "thread_id": null
}
```

`forwarded` holds the text and files of a forwarded message.

Each file in `media.json` records `original_filename`, `kind`, `user_id`, `username`, `timestamp`, `message_id`, `message_content`, `file_size`, `file_hash` (SHA-256) and `path`. A duplicate has `"duplicate": true` and `duplicate_of` (the kept copy, relative to the server folder). A failed download has an `error`.

### Running it again

The archive folder doesn't change between runs, so running the same command again:

- **continues** an archive that was stopped (Ctrl+C) or crashed, from the last saved page;
- **updates** a finished archive with messages posted since;
- **retries** downloads that failed last time.

To archive a channel from scratch, delete its folder. To start over completely, delete the server's folder.

### Duplicates

Every file is hashed (SHA-256). By default, a file posted twice in the same channel is stored once, so every channel folder is complete on its own. The copy kept is always the earliest post. With `--dedupe server`, a file is stored once for the whole server and reposts in other channels point to it.

### The original commands

These still work and now write the same folder layout:

| Command | Same as |
|---|---|
| `npm run media` | `npm run archive -- --media-only --dedupe server --zip` (whole server, `GUILD_ID`) |
| `npm run text` | `npm run archive -- --text-only --channels <CHANNEL_ID>` |
| `npm run text:multi` | `npm run archive -- --text-only` (`CHANNEL_IDS`, otherwise `GUILD_ID`) |

You can add options to them too, e.g. `npm run media -- --no-embeds`.

---

## Configuration

`.env` settings (see `.env.example`):

| Variable | Notes |
|---|---|
| `DISCORD_TOKEN` | Required |
| `GUILD_ID` | Server to archive |
| `CHANNEL_ID` | One channel, for `npm run text` |
| `CHANNEL_IDS` | Comma-separated channel IDs. If set, used instead of the whole server |
| `SKIP_CHANNELS` | Comma-separated channel names or IDs to leave out |
| `MEDIA_EXTENSIONS` | Only download these file types, e.g. `.mp4,.mov`. Default: every photo, video and audio file |
| `OUTPUT_DIR` | Where archives go. Default `./output` |
| `DOWNLOAD_CONCURRENCY` | Files downloaded at once. Default `3` |
| `FETCH_DELAY_MS` | Pause between 100-message pages. Default `250`; discord.js also handles Discord's rate limits itself |
| `CLIENT_ID` | Only for `npm run invite`, if it can't work the ID out from the token |

## Troubleshooting

**`Used disallowed intents`**
Message Content Intent is off. See Setup step 1.4.

**`Could not log in` / invalid token**
Check `DISCORD_TOKEN` in `.env`. If you reset the token in the Developer Portal, the old one stops working.

**`The bot is not in a server with ID …`**
The bot hasn't been invited, or `GUILD_ID` is wrong. The error lists the servers the bot can see.

**A channel is missing**
Run `npm run archive -- --dry-run`: it lists every channel the bot can't read and why. Give the bot's role access, or check `SKIP_CHANNELS`.

**Messages show as empty**
Message Content Intent is off or was turned on after the bot connected. Turn it on, save, delete the affected folders and run again.

**It's slow**
Discord returns 100 messages per request. Large servers take a while, and downloads add to it. Progress is printed as it goes, and you can stop and continue at any time.

## Limitations

- **Deleted messages** can't be archived.
- **Edits and reactions** on messages that are already archived aren't refreshed by later runs; only new messages are fetched. Delete a channel's folder to re-archive it.
- **Folders keep their first name.** A channel that's renamed or moved to another category stays in its original folder.
- **Private threads** that have been archived need the bot to have Manage Threads (see `npm run invite`).
- **Link previews** of web pages (article thumbnails, YouTube) aren't saved, and YouTube videos aren't downloaded. Media from links is fetched only from Discord's cached copy; if Discord doesn't have one, it's skipped. Stickers are recorded by name only.
- **Discord file links expire.** With `--text-only`, pages link to Discord's copy, which stops working after a while. Run without it (or with `--media-only` later) to keep the files.
- **Memory:** pages for one channel are built in memory, so very large channels need a correspondingly sized machine. Downloads stream straight to disk.

## Development

```bash
npm test
```

The tests run the archiver end to end against a fake Discord (`test/helpers/fake-discord.js`) using the real discord.js client, so no bot or network is needed.

```
src/
├── archive.js                 npm run archive
├── media-archiver.js          npm run media
├── text-archiver.js           npm run text
├── multi-channel-archiver.js  npm run text:multi
├── invite.js                  npm run invite
└── lib/
    ├── client.js              Discord login and .env loading
    ├── options.js             Command-line options
    ├── run.js                 Archives a server and writes the index
    ├── discover.js            Finds categories, channels and threads the bot can read
    ├── archive-channel.js     Archives one channel: pages, downloads, duplicates
    ├── store.js               Saved progress for resuming
    ├── download.js            Streaming downloads with retries
    ├── media.js               Sorts files into photos, videos, audio
    ├── names.js               Safe folder and file names
    ├── serialize.js           Message → JSON
    ├── outputs.js             Writes messages.json/.html/.txt and media.json
    ├── render.js              HTML pages
    └── utils.js               Shared helpers
```

## Privacy

Archives contain usernames, user IDs, message content and files people posted. Only archive servers you own or have permission to archive, store the output somewhere private, and follow Discord's Terms of Service. This tool only works with a bot token; it never uses a personal account. It only connects to Discord: media from links comes from Discord's cached copy, never from the linked site.

## License

[MIT](LICENSE) © 2026 z0ni
