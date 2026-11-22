const fs = require('fs');
const path = require('path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

// Compares two Discord IDs (snowflakes) numerically; they are too big for Number
function compareIds(a, b) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
}

function readJsonFile(file, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw error;
    }
}

// Writes to a temp file first, so a crash mid-write never leaves a half-written file
function writeJsonAtomic(file, data) {
    ensureDir(path.dirname(file));
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

// Turns a relative path into a URL path that survives spaces, # and ? in file names
function encodePath(relativePath) {
    return relativePath.split(/[\\/]/).map(encodeURIComponent).join('/');
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '?';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

module.exports = {
    compareIds,
    readJsonFile,
    writeJsonAtomic,
    encodePath,
    formatBytes,
    sleep,
    displayDate,
    ensureDir,
    escapeHtml,
    uniqueFilePath
};
