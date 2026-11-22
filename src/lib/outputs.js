const fs = require('fs');
const path = require('path');
const { encodePath, writeJsonAtomic } = require('./utils');
const { KINDS } = require('./media');
const { channelPage } = require('./render');

function toPlainText(messages) {
    return messages.map((msg) => {
        const name = msg.display_name && msg.display_name !== msg.username
            ? `${msg.display_name} (@${msg.username})` : msg.username;
        let text = `[${msg.timestamp}] ${name} <${msg.user_id}>${msg.is_bot ? ' [BOT]' : ''}: ${msg.content || (msg.system ? `(${msg.type})` : '(no text)')}`;
        if (msg.attachments.length) text += `\n  Attachments: ${msg.attachments.map((a) => a.local_path || a.name).join(', ')}`;
        for (const snapshot of msg.forwarded ?? []) {
            text += `\n  Forwarded: ${snapshot.content || '(no text)'}`;
            if (snapshot.attachments.length) text += `\n    Attachments: ${snapshot.attachments.map((a) => a.local_path || a.name).join(', ')}`;
        }
        if (msg.stickers?.length) text += `\n  Stickers: ${msg.stickers.map((s) => s.name).join(', ')}`;
        if (msg.reactions.length) text += `\n  Reactions: ${msg.reactions.map((r) => `${r.emoji} (${r.count})`).join(', ')}`;
        return text;
    }).join('\n\n') + '\n';
}

// Counts for one channel or thread, read back from its logs
function summarize(messages, media) {
    const stats = { messages: messages.length, photos: 0, videos: 0, audio: 0, files: 0, duplicates: 0, failed: 0 };
    for (const entry of media) {
        if (entry.error) stats.failed++;
        else if (entry.duplicate) stats.duplicates++;
        else if (entry.path) stats[entry.kind]++;
    }
    return stats;
}

// Writes messages.json/.html/.txt and media.json for one channel or thread.
// `info`: { serverName, serverId, folder, crumbs, title, channel meta, threads: [{ id, name, folder }] }
function writeChannelOutputs(store, info, archivedAt) {
    const messages = store.readMessages();
    const media = store.readMedia();
    const stats = summarize(messages, media);
    const files = {};

    // Link to a saved file, relative to this channel's folder
    const mediaByKey = new Map(media.map((entry) => [`${entry.message_id}:${entry.key}`, entry]));
    const localPath = (messageId, key) => {
        const entry = mediaByKey.get(`${messageId}:${key}`);
        if (!entry || entry.error) return null;
        if (entry.path) return { kind: entry.kind, path: entry.path };
        if (entry.duplicate_of) return { kind: entry.kind, path: path.posix.relative(info.folder, entry.duplicate_of) };
        return null;
    };
    const localFile = (messageId, key) => {
        const file = localPath(messageId, key);
        return file && { kind: file.kind, href: encodePath(file.path) };
    };

    const threadsById = new Map(info.threads.map((t) => [t.id, t]));
    const threadHref = (thread) => encodePath(path.posix.relative(info.folder, `${thread.folder}/messages.html`));
    const threadLink = (id) => {
        const thread = threadsById.get(id);
        return thread && { name: thread.name, href: threadHref(thread) };
    };

    if (messages.length) {
        // Saved file paths go into messages.json so scripts can find each message's media
        const addPaths = (messageId, part, prefix) => ({
            ...part,
            attachments: part.attachments.map((a) => ({ ...a, local_path: localPath(messageId, `${prefix}a:${a.id}`)?.path ?? null })),
            embeds: part.embeds.map((e, index) => {
                const saved = ['video', 'image', 'thumbnail']
                    .map((field) => localPath(messageId, `${prefix}e:${index}:${field}`)?.path)
                    .filter(Boolean);
                return saved.length ? { ...e, local_paths: saved } : e;
            })
        });
        const withPaths = messages.map((message) => ({
            ...addPaths(message.message_id, message, ''),
            forwarded: (message.forwarded ?? []).map((snapshot, index) => addPaths(message.message_id, snapshot, `f:${index}:`))
        }));

        fs.writeFileSync(path.join(store.dir, 'messages.json'), JSON.stringify({
            server_name: info.serverName,
            server_id: info.serverId,
            category: info.categoryName,
            channel_name: info.name,
            channel_id: info.id,
            channel_type: info.type,
            parent_channel: info.parent ?? null,
            archive_date: archivedAt,
            message_count: messages.length,
            messages: withPaths
        }, null, 2));
        fs.writeFileSync(path.join(store.dir, 'messages.txt'), toPlainText(withPaths));
        files.json = `${info.folder}/messages.json`;
        files.txt = `${info.folder}/messages.txt`;
    }

    if (messages.length || info.threads.length) {
        const indexHref = encodePath(path.posix.relative(info.folder, 'index.html'));
        fs.writeFileSync(path.join(store.dir, 'messages.html'), channelPage({
            title: info.title,
            crumbs: info.crumbs,
            indexHref,
            messages,
            stats,
            threads: info.threads.map((t) => ({ name: t.name, href: threadHref(t) })),
            localFile,
            threadLink,
            archivedAt: new Date(archivedAt).toLocaleString(),
            names: info.names,
            isForum: info.type === 'forum' || info.type === 'media'
        }));
        files.html = `${info.folder}/messages.html`;
    }

    if (media.length) {
        writeJsonAtomic(path.join(store.dir, 'media.json'), {
            channel_name: info.name,
            channel_id: info.id,
            folder: info.folder,
            counts: Object.fromEntries([...KINDS, 'duplicates', 'failed'].map((k) => [k, stats[k]])),
            files: media
        });
        files.media = `${info.folder}/media.json`;
    }

    return { stats, files, messages, media };
}

// Adds one channel's posters to the server-wide user list
function addUsers(users, messages, media) {
    const get = (record) => {
        let user = users.get(record.user_id);
        if (!user) {
            user = {
                user_id: record.user_id, username: record.username, display_name: record.display_name ?? null,
                names_seen: [], is_bot: Boolean(record.is_bot), message_count: 0,
                photos: 0, videos: 0, audio: 0, files: 0, first_seen: null, last_seen: null
            };
            users.set(record.user_id, user);
        }
        for (const name of [record.username, record.display_name]) {
            if (name && !user.names_seen.includes(name)) user.names_seen.push(name);
        }
        const time = record.timestamp_iso ?? record.timestamp;
        if (!user.first_seen || time < user.first_seen) user.first_seen = time;
        if (!user.last_seen || time > user.last_seen) {
            user.last_seen = time;
            user.username = record.username;
            user.display_name = record.display_name ?? user.display_name;
        }
        return user;
    };
    for (const message of messages) get(message).message_count++;
    // Reposts count too: the user still posted it, even if the file is stored once
    for (const entry of media) if (entry.file_hash && !entry.error) get(entry)[entry.kind]++;
}

module.exports = { writeChannelOutputs, addUsers, summarize, toPlainText };
