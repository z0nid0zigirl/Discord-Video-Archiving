const fs = require('fs');
const path = require('path');
const { compareIds, ensureDir, readJsonFile, writeJsonAtomic } = require('./utils');

function readNdjson(file) {
    if (!fs.existsSync(file)) return [];
    const records = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
            records.push(JSON.parse(line));
        } catch {
            // A crash can leave a half-written last line; everything before it is intact
        }
    }
    return records;
}

function appendNdjson(file, records) {
    if (!records.length) return;
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

// Progress and raw records for one channel or thread, kept in <folder>/_state/.
// Messages and media are append-only logs; state.json holds how far each has got.
// The logs are the source of truth, so a crash between writes loses nothing.
class ChannelStore {
    constructor(dir, folder) {
        this.dir = dir;           // absolute path of the channel folder
        this.folder = folder;     // the same folder, relative to the server folder
        this.stateDir = path.join(dir, '_state');
        this.messagesLog = path.join(this.stateDir, 'messages.ndjson');
        this.mediaLog = path.join(this.stateDir, 'media.ndjson');
        this.stateFile = path.join(this.stateDir, 'state.json');

        this.state = readJsonFile(this.stateFile, { text_cursor: null, media_cursor: null, meta: null });
        this.media = new Map();   // "<message id>:<job key>" → entry
        for (const entry of readNdjson(this.mediaLog)) this.media.set(`${entry.message_id}:${entry.key}`, entry);

        // Leftovers from downloads interrupted by a crash
        if (fs.existsSync(this.stateDir)) {
            for (const name of fs.readdirSync(this.stateDir)) {
                if (name.endsWith('.part')) fs.rmSync(path.join(this.stateDir, name), { force: true });
            }
        }
    }

    exists() {
        return fs.existsSync(this.stateFile);
    }

    hasMedia(messageId, key) {
        const entry = this.media.get(`${messageId}:${key}`);
        return Boolean(entry && !entry.error);
    }

    // hash → saved file, relative to the server folder
    savedHashes() {
        const hashes = new Map();
        for (const entry of this.media.values()) {
            if (entry.path && entry.file_hash) hashes.set(entry.file_hash, `${this.folder}/${entry.path}`);
        }
        return hashes;
    }

    tempFile(name) {
        ensureDir(this.stateDir);
        return path.join(this.stateDir, `${name}.part`);
    }

    appendMessages(records) {
        appendNdjson(this.messagesLog, records);
    }

    appendMedia(entries) {
        appendNdjson(this.mediaLog, entries);
        for (const entry of entries) this.media.set(`${entry.message_id}:${entry.key}`, entry);
    }

    save() {
        writeJsonAtomic(this.stateFile, this.state);
    }

    // Messages oldest first, each once (a crash can log a batch twice)
    readMessages() {
        const byId = new Map();
        for (const record of readNdjson(this.messagesLog)) byId.set(record.message_id, record);
        return [...byId.values()].sort((a, b) => compareIds(a.message_id, b.message_id));
    }

    // Media entries oldest first, the latest attempt for each file
    readMedia() {
        return [...this.media.values()].sort((a, b) => compareIds(a.message_id, b.message_id));
    }
}

module.exports = { ChannelStore, readNdjson, appendNdjson };
