const path = require('path');
const { parseArgs } = require('util');
const { ConfigError } = require('./errors');

const DEFAULT_OUTPUT = path.resolve(__dirname, '..', '..', 'output');

const HELP = `Archive a Discord server: messages, photos, videos and audio, in folders by category and channel.

Usage: npm run archive -- [options]

  --channels <ids>   Only these channels, categories or threads (comma-separated IDs).
                     Default: CHANNEL_IDS from .env, otherwise the whole server (GUILD_ID).
  --text-only        Messages only; download nothing
  --media-only       Media only; no message pages
  --all-files        Also download other attachments (PDFs, ZIPs, ...)
  --no-embeds        Skip media from links (Tenor/Giphy GIFs, image links)
  --no-threads       Skip threads and forum posts
  --dedupe <mode>    channel: store identical files once per channel (default)
                     server:  once per server; reposts elsewhere point to the first copy
                     none:    keep every copy
  --zip              Also write a ZIP of the archive
  --out <folder>     Where archives go (default: ./output)
  --dry-run          List what would be archived and what the bot can't read; download nothing
  -h, --help         Show this help

Running it again continues where the last run stopped and only fetches new messages.`;

// The original npm scripts, as options for the new archiver
const PRESETS = {
    media: { mediaOnly: true, dedupe: 'server', zip: true, channelIds: [] },
    text: (channelId) => ({ textOnly: true, channelIds: [channelId] }),
    textMulti: { textOnly: true }
};

function list(value) {
    return String(value ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

function envValue(env, name) {
    const value = env[name];
    return value && value.trim() ? value.trim() : null;
}

function positiveInt(value, name, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new ConfigError(`${name} must be a whole number, got "${value}"`);
    return number;
}

// Options come from, in rising priority: defaults, .env, the calling script (`preset`), then command-line flags
function parseOptions(argv = [], env = process.env, preset = {}) {
    let parsed;
    try {
        parsed = parseArgs({
            args: argv,
            allowPositionals: false,
            options: {
                channels: { type: 'string' },
                'text-only': { type: 'boolean' },
                'media-only': { type: 'boolean' },
                'all-files': { type: 'boolean' },
                'no-embeds': { type: 'boolean' },
                'no-threads': { type: 'boolean' },
                dedupe: { type: 'string' },
                zip: { type: 'boolean' },
                out: { type: 'string' },
                'dry-run': { type: 'boolean' },
                help: { type: 'boolean', short: 'h' }
            }
        }).values;
    } catch (error) {
        throw new ConfigError(`${error.message}\nRun with --help to see the options.`);
    }

    const extensions = list(envValue(env, 'MEDIA_EXTENSIONS'))
        .map((ext) => ext.toLowerCase())
        .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));

    const options = {
        guildId: envValue(env, 'GUILD_ID'),
        channelIds: list(envValue(env, 'CHANNEL_IDS')),
        skip: list(envValue(env, 'SKIP_CHANNELS')),
        textOnly: false,
        mediaOnly: false,
        allFiles: false,
        embeds: true,
        threads: true,
        dedupe: 'channel',
        zip: false,
        outDir: envValue(env, 'OUTPUT_DIR') ? path.resolve(envValue(env, 'OUTPUT_DIR')) : DEFAULT_OUTPUT,
        dryRun: false,
        help: false,
        extensions: extensions.length ? new Set(extensions) : null,
        concurrency: Math.max(1, positiveInt(envValue(env, 'DOWNLOAD_CONCURRENCY'), 'DOWNLOAD_CONCURRENCY', 3)),
        fetchDelayMs: positiveInt(envValue(env, 'FETCH_DELAY_MS'), 'FETCH_DELAY_MS', 250),
        retryDelayMs: 1000,
        ...preset
    };

    if (parsed.channels !== undefined) options.channelIds = list(parsed.channels);
    if (parsed['text-only']) options.textOnly = true;
    if (parsed['media-only']) options.mediaOnly = true;
    if (parsed['all-files']) options.allFiles = true;
    if (parsed['no-embeds']) options.embeds = false;
    if (parsed['no-threads']) options.threads = false;
    if (parsed.dedupe !== undefined) options.dedupe = parsed.dedupe;
    if (parsed.zip) options.zip = true;
    if (parsed.out !== undefined) options.outDir = path.resolve(parsed.out);
    if (parsed['dry-run']) options.dryRun = true;
    if (parsed.help) options.help = true;

    if (options.textOnly && options.mediaOnly) {
        throw new ConfigError('--text-only and --media-only can\'t be used together. Leave both off to archive everything.');
    }
    if (!['channel', 'server', 'none'].includes(options.dedupe)) {
        throw new ConfigError(`--dedupe must be channel, server or none, got "${options.dedupe}"`);
    }
    if (options.channelIds.some((id) => !/^\d{17,20}$/.test(id))) {
        throw new ConfigError(`Channel IDs are long numbers, like 123456789012345678. Got: ${options.channelIds.join(', ')}`);
    }
    return options;
}

module.exports = { parseOptions, PRESETS, HELP, DEFAULT_OUTPUT };
