const fs = require('fs');
const path = require('path');
const { compareIds, ensureDir, sleep, uniqueFilePath } = require('./utils');
const { mediaFileName } = require('./names');
const { kindOf, isMediaType, mediaJobs, withExtension } = require('./media');
const { downloadToFile, mapLimit, NotMediaError } = require('./download');
const { serializeMessage } = require('./serialize');

const PAGE_SIZE = 100;

const isNewer = (id, cursor) => cursor === null || compareIds(id, cursor) > 0;
// The earliest of the text and media cursors; null means "from the first message"
function oldestCursor(cursors) {
    if (cursors.some((cursor) => cursor === null)) return null;
    return cursors.reduce((a, b) => (compareIds(a, b) <= 0 ? a : b));
}

function emptyStats() {
    return { messages: 0, photos: 0, videos: 0, audio: 0, files: 0, duplicates: 0, failed: 0 };
}

// Downloads one batch of files in parallel, then files them in message order,
// so the copy kept for a duplicate is always the earliest one
async function saveMedia(store, items, { options, hashes, stats, signal, channelName }) {
    const results = await mapLimit(items, options.concurrency, async ({ message, job }, index) => {
        const temp = store.tempFile(`${message.id}-${index}`);
        const result = await downloadToFile(job.urls, temp, {
            accept: job.source === 'embed' ? isMediaType : null,
            retryDelayMs: options.retryDelayMs,
            signal
        });
        return { ...result, temp };
    });

    const entries = [];
    items.forEach(({ message, job }, index) => {
        const { value, error } = results[index];
        const entry = {
            key: job.key,
            source: job.source,
            original_filename: job.name,
            kind: job.kind,
            username: message.author.username,
            display_name: message.author.globalName ?? null,
            user_id: message.author.id,
            is_bot: message.author.bot,
            timestamp: message.createdAt.toISOString(),
            message_content: message.content || '',
            message_id: message.id,
            channel_name: channelName,
            url: job.url ?? null,
            file_size: null,
            file_hash: null,
            filename: null,
            path: null,
            duplicate: false
        };

        if (error) {
            if (signal?.aborted) return; // stopped by the user: retry on the next run instead of logging a failure
            if (error instanceof NotMediaError) {
                // A link that turned out to be a web page; nothing to keep
                entries.push({ ...entry, skipped: error.message });
                return;
            }
            stats.failed++;
            entries.push({ ...entry, error: error.message });
            return;
        }

        if (job.source === 'embed') entry.kind = kindOf(value.contentType, job.name);
        entry.file_size = value.bytes;
        entry.file_hash = value.hash;

        const existing = options.dedupe === 'none' ? null : hashes.get(value.hash);
        if (existing) {
            fs.rmSync(value.temp, { force: true });
            stats.duplicates++;
            entries.push({ ...entry, duplicate: true, duplicate_of: existing });
            return;
        }

        const kindDir = ensureDir(path.join(store.dir, entry.kind));
        const name = mediaFileName({
            date: message.createdAt,
            username: message.author.username,
            userId: message.author.id,
            originalName: withExtension(job.name, value.contentType)
        });
        const finalPath = uniqueFilePath(kindDir, name);
        fs.renameSync(value.temp, finalPath);

        entry.filename = path.basename(finalPath);
        entry.path = `${entry.kind}/${entry.filename}`;
        hashes.set(value.hash, `${store.folder}/${entry.path}`);
        stats[entry.kind]++;
        entries.push(entry);
    });
    return entries;
}

// Gives downloads that failed on an earlier run another go, with fresh file links
async function retryFailedMedia(channel, store, context) {
    const failed = store.readMedia().filter((entry) => entry.error);
    const byMessage = new Map();
    for (const entry of failed) {
        if (!byMessage.has(entry.message_id)) byMessage.set(entry.message_id, new Set());
        byMessage.get(entry.message_id).add(entry.key);
    }

    for (const [messageId, keys] of byMessage) {
        if (context.signal?.aborted) return;
        let message;
        try {
            message = await channel.messages.fetch({ message: messageId, cache: false });
        } catch {
            continue; // deleted since the last run
        }
        const items = mediaJobs(message, context.options)
            .filter((job) => keys.has(job.key))
            .map((job) => ({ message, job }));
        if (items.length) store.appendMedia(await saveMedia(store, items, context));
    }
}

// Archives one channel or thread, oldest message first, saving progress after every page.
// Stopping (Ctrl+C) or crashing loses at most one page; the next run picks up from there.
async function archiveChannel(channel, store, { options, hashes, signal, onProgress }) {
    const wantText = !options.mediaOnly;
    const wantMedia = !options.textOnly;
    const stats = emptyStats();
    const context = { options, hashes, stats, signal, channelName: channel.name };

    if (wantMedia) await retryFailedMedia(channel, store, context);

    const cursors = [];
    if (wantText) cursors.push(store.state.text_cursor);
    if (wantMedia) cursors.push(store.state.media_cursor);
    let after = oldestCursor(cursors);

    while (!signal?.aborted) {
        const batch = await channel.messages.fetch({ after: after ?? '0', limit: PAGE_SIZE, cache: false });
        if (batch.size === 0) break;

        // Discord returns pages newest first; work oldest first
        const messages = [...batch.values()].sort((a, b) => compareIds(a.id, b.id));

        let mediaEntries = [];
        if (wantMedia) {
            const items = [];
            for (const message of messages) {
                if (!isNewer(message.id, store.state.media_cursor)) continue;
                for (const job of mediaJobs(message, options)) {
                    if (!store.hasMedia(message.id, job.key)) items.push({ message, job });
                }
            }
            if (items.length) mediaEntries = await saveMedia(store, items, context);
            if (signal?.aborted) {
                // Keep what finished, but don't move the cursor past files that didn't
                store.appendMedia(mediaEntries);
                break;
            }
        }

        const fresh = messages.filter((m) =>
            (wantText && isNewer(m.id, store.state.text_cursor)) || (wantMedia && isNewer(m.id, store.state.media_cursor)));
        const records = wantText
            ? messages.filter((m) => isNewer(m.id, store.state.text_cursor)).map(serializeMessage)
            : [];

        store.appendMedia(mediaEntries);
        store.appendMessages(records);

        const newest = messages[messages.length - 1].id;
        if (wantText) store.state.text_cursor = newest;
        if (wantMedia) store.state.media_cursor = newest;
        store.save();

        stats.messages += fresh.length;
        after = newest;
        onProgress?.(stats);
        if (options.fetchDelayMs) await sleep(options.fetchDelayMs);
    }

    return stats;
}

module.exports = { archiveChannel, emptyStats, oldestCursor };
