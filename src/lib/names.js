const path = require('path');

// Keeps whole paths comfortably under Windows' 260-character limit
const MAX_FOLDER_CHARS = 60;
const MAX_FILE_CHARS = 150;
// Most filesystems allow 255 bytes per name; emoji take 4 bytes each
const MAX_NAME_BYTES = 240;

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

function truncate(text, maxChars) {
    const chars = Array.from(text).slice(0, maxChars);
    while (chars.length && Buffer.byteLength(chars.join('')) > MAX_NAME_BYTES) chars.pop();
    return chars.join('');
}

// Makes a Discord name safe as a single file or folder name on Windows, macOS and Linux.
// Keeps emoji and non-Latin letters; only replaces characters filesystems refuse.
function safeName(value, maxChars = MAX_FOLDER_CHARS) {
    let name = String(value ?? '')
        .normalize('NFC')
        .replace(ILLEGAL, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\.+/, (dots) => '_'.repeat(dots.length)); // a leading dot hides the file on macOS and Linux

    name = truncate(name, maxChars).replace(/[. ]+$/, ''); // Windows drops trailing dots and spaces
    if (!name) return '_';
    if (WINDOWS_RESERVED.test(name)) name = `${name}_`;
    return name;
}

// Like safeName, but keeps the file extension intact when shortening
function safeFileName(fileName, maxChars = MAX_FILE_CHARS) {
    const raw = String(fileName ?? '').normalize('NFC');
    let ext = path.extname(raw);
    if (ext.length > 12 || !/^\.[\w-]+$/.test(ext)) ext = '';
    const stem = safeName(raw.slice(0, raw.length - ext.length), Math.max(1, maxChars - ext.length));
    return `${stem}${ext}`;
}

// 2024-01-15_10-30-00 (UTC, safe for file names)
function fileTimestamp(date) {
    return date.toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
}

// <date>_<username>_<user id>_<original name>
function mediaFileName({ date, username, userId, originalName }) {
    const prefix = `${fileTimestamp(date)}_${safeName(username, 32)}_${userId}_`;
    return prefix + safeFileName(originalName || 'file', MAX_FILE_CHARS - Array.from(prefix).length);
}

// Remembers which folder belongs to which Discord ID. A folder keeps the name it got on the
// first run, and two channels with the same name never share a folder (the second gets its ID
// appended). Paths are relative to the server folder and always use forward slashes.
class FolderMap {
    constructor(entries = {}) {
        this.byId = new Map(Object.entries(entries));
        // Names in the server folder that belong to the archiver itself
        this.taken = new Set(['_state', 'index.html', 'server.json', 'users.json']);
        for (const folder of this.byId.values()) this.taken.add(folder.toLowerCase());
    }

    get(id) {
        return this.byId.get(id) ?? null;
    }

    assign(id, parentFolder, displayName) {
        const existing = this.byId.get(id);
        if (existing) return existing;

        const join = (name) => (parentFolder ? `${parentFolder}/${name}` : name);
        let folder = join(safeName(displayName));
        // Compare case-insensitively: macOS and Windows treat "General" and "general" as one folder
        if (this.taken.has(folder.toLowerCase())) {
            folder = join(`${safeName(displayName, MAX_FOLDER_CHARS - id.length - 1)}_${id}`);
        }
        this.byId.set(id, folder);
        this.taken.add(folder.toLowerCase());
        return folder;
    }

    toJSON() {
        return Object.fromEntries(this.byId);
    }
}

module.exports = { safeName, safeFileName, fileTimestamp, mediaFileName, FolderMap, MAX_FOLDER_CHARS };
