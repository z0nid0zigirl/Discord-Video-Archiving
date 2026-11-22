const fs = require('fs');
const path = require('path');

// All archives are written under <repo>/output
const OUTPUT_ROOT = path.resolve(__dirname, '..', '..', 'output');

// Delay between 100-message history requests (discord.js also handles rate limits itself)
const FETCH_DELAY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitizeFilename(name) {
    return String(name).replace(/[^a-z0-9_\-\.]/gi, '_');
}

// 2024-01-15T10-30-00 (safe for filenames)
function filenameTimestamp(date) {
    return date.toISOString().replace(/:/g, '-').split('.')[0];
}

// 01/15/2024, 10:30:00 AM
function displayDate(date) {
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

// 2024-01-15
function today() {
    return new Date().toISOString().split('T')[0];
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Returns a name not already in `used`; falls back to appending the channel ID
function uniqueName(baseName, used, id) {
    let name = sanitizeFilename(baseName);
    if (used.has(name)) name = `${name}_${id}`;
    used.add(name);
    return name;
}

// Returns a file path that doesn't overwrite an existing file
function uniqueFilePath(dir, filename) {
    const ext = path.extname(filename);
    const stem = filename.slice(0, filename.length - ext.length);
    let candidate = path.join(dir, filename);
    let counter = 1;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${stem}_${counter}${ext}`);
        counter++;
    }
    return candidate;
}

// Yields batches of up to 100 messages, newest first, until the channel's history is exhausted
async function* fetchAllMessages(channel) {
    let before;
    while (true) {
        const options = { limit: 100 };
        if (before) options.before = before;

        const batch = await channel.messages.fetch(options);
        if (batch.size === 0) break;

        yield batch;
        before = batch.last().id;
        await sleep(FETCH_DELAY_MS);
    }
}

module.exports = {
    OUTPUT_ROOT,
    sleep,
    sanitizeFilename,
    filenameTimestamp,
    displayDate,
    today,
    ensureDir,
    escapeHtml,
    uniqueName,
    uniqueFilePath,
    fetchAllMessages
};
