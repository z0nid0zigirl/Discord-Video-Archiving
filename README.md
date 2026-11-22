# Discord Server Archiver

A small set of Node.js tools for preserving a Discord server: its media files and its message history, organized by channel and by who posted what.

| Command | What it does |
|---|---|
| `npm run media` | Downloads media attachments from every channel in a server into one folder per channel, skips duplicate files, and zips the result |
| `npm run text` | Archives the full message history of one channel as HTML, JSON and plain text |
| `npm run text:multi` | Archives the message history of several channels, or every channel in a server, with a browsable index page |

All three use the same bot and the same `.env` file.

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

### 2. Invite the bot to your server

1. Open **OAuth2 → URL Generator**.
2. Under **Scopes**, tick `bot`.
3. Under **Bot Permissions**, tick **View Channels** and **Read Message History**.
4. Open the generated URL, pick your server and authorize.

The bot can only archive channels it can see. For private channels, give the bot's role access to them.

### 3. Get IDs

In Discord, turn on **Settings → Advanced → Developer Mode**. Then:

- **Server ID:** right-click the server icon → **Copy Server ID**
- **Channel ID:** right-click a channel → **Copy Channel ID**

### 4. Install and configure

```bash
npm install
```

Copy `.env.example` to `.env` (on Windows PowerShell: `Copy-Item .env.example .env`) and fill in:

| Variable | Used by | Notes |
|---|---|---|
| `DISCORD_TOKEN` | all | Required |
| `GUILD_ID` | `media`, `text:multi` | Server to archive |
| `CHANNEL_ID` | `text` | One channel |
| `CHANNEL_IDS` | `text:multi` | Comma-separated channel IDs. If set, used instead of `GUILD_ID` |
| `SKIP_CHANNELS` | `media`, `text:multi` | Optional. Comma-separated channel names to leave out of a whole-server run |
| `MEDIA_EXTENSIONS` | `media` | Optional. Comma-separated file types, e.g. `.mp3,.mp4,.wav`. Defaults to `.mp3 .mp4 .jpg .jpeg .png .gif .webp .bmp` |

---

## Usage

Run commands from the project folder. Each tool logs in, does its work, prints a summary and exits. Everything is written to the `output/` folder.

### Media archive

```bash
npm run media
```

Goes through every readable channel in `GUILD_ID`, downloads matching attachments, and builds a ZIP.

**Deduplication:** every downloaded file is hashed (SHA-256). If the same file was posted again anywhere in the server, only the first copy is kept. The repost is still recorded in that channel's `_metadata.json` with `"duplicate": true`, so you keep the record of who posted it and when.

```
output/media/
├── My_Server_2026-11-21/
│   ├── _server_metadata.json
│   ├── general/
│   │   ├── _metadata.json
│   │   ├── 2019-03-02T18-44-10_alice_song.mp3
│   │   └── 2021-07-15T09-01-55_bob_clip.mp4
│   └── memes/
│       └── ...
└── My_Server_2026-11-21.zip
```

Files are named `<timestamp>_<username>_<original name>`.

Each file entry in `_metadata.json` looks like this:

```json
{
  "original_filename": "song.mp3",
  "username": "alice",
  "user_id": "987654321098765432",
  "timestamp": "2019-03-02T18:44:10.000Z",
  "message_content": "check this out",
  "message_id": "112233445566778899",
  "channel_name": "general",
  "file_size": 5242880,
  "file_hash": "9f86d081884c7d65...",
  "filename": "2019-03-02T18-44-10_alice_song.mp3",
  "duplicate": false
}
```

Duplicates have `"filename": null` and `"duplicate": true`. Failed downloads have `"filename": null` and an `"error"` field.

Running the media archive twice on the same day replaces that day's folder and ZIP.

### Single-channel text archive

```bash
npm run text
```

Archives every message in `CHANNEL_ID`:

```
output/text/
├── general_2026-11-21.html
├── general_2026-11-21.json
└── general_2026-11-21.txt
```

### Multi-channel text archive

```bash
npm run text:multi
```

- With `CHANNEL_IDS` set, archives just those channels.
- Otherwise archives every readable channel in `GUILD_ID` (minus `SKIP_CHANNELS`).

```
output/text/My_Server_2026-11-21/
├── index.html               ← start here
├── _archive_summary.json
├── general.html
├── general.json
├── general.txt
└── ...
```

If two channels share a name, the second gets its channel ID added to the filename.

### Text archive formats

- **HTML:** Discord-style dark page with a search box that filters by username or message text. Shows attachments, embeds, reactions and bot tags. Opens offline in any browser.
- **JSON:** every message with its ID, author, timestamps, content, attachments, embeds, reactions and reply reference.
- **TXT:** one line per message, `[timestamp] username: message`, with attachments and reactions underneath.

---

## Troubleshooting

**`Used disallowed intents`**
Message Content Intent is off. See Setup step 1.4.

**`Could not log in` / invalid token**
Check `DISCORD_TOKEN` in `.env`. If you reset the token in the Developer Portal, the old one stops working.

**`The bot is not in a server with ID …`**
The bot hasn't been invited, or `GUILD_ID` is wrong. The error lists the servers the bot can see.

**A channel is missing from a whole-server run**
The bot can't view that channel or read its history. Give the bot's role access, or check `SKIP_CHANNELS`.

**Messages show as empty**
Message Content Intent is off or was turned on after the bot connected. Turn it on, save, and run again.

**It's slow**
Discord returns 100 messages per request and the tools wait one second between requests to stay within rate limits. A channel with 100,000 messages takes roughly 20 minutes to read; the media archive also spends time downloading. Progress is printed as it goes.

---

## Limitations

- **Deleted messages** can't be archived.
- **Threads and forum posts** are only included if they're active when the tool runs. Archived threads are not fetched.
- **Attachment links in text archives expire.** Discord's file URLs are signed and stop working after a while. To keep the actual files, use the media archive.
- **Memory:** the text archivers hold one channel's messages in memory while writing, and the media archiver holds one file at a time. Very large channels need a correspondingly sized machine.

## Customization

- **Request delay:** `FETCH_DELAY_MS` in `src/lib/utils.js`.
- **Output location:** `OUTPUT_ROOT` in `src/lib/utils.js`.
- **HTML look:** the templates are in `src/lib/html.js`.

## Project layout

```
src/
├── media-archiver.js          npm run media
├── text-archiver.js           npm run text
├── multi-channel-archiver.js  npm run text:multi
└── lib/
    ├── client.js              Discord login, .env loading, channel selection
    ├── text-archive.js        Message collection and HTML/JSON/TXT writing
    ├── html.js                HTML page templates
    └── utils.js               Shared helpers
```

## Privacy

Archives contain usernames, user IDs and message content. Only archive servers you own or have permission to archive, store the output somewhere private, and follow Discord's Terms of Service.

## License

[MIT](LICENSE) © 2026 z0ni
