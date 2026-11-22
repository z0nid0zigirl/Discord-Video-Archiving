const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { compareIds } = require('./utils');

const VOICE_TYPES = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
// Channels whose threads are worth looking for
const THREAD_PARENTS = new Set([
    ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia
]);

function typeLabel(channel) {
    switch (channel.type) {
        case ChannelType.GuildForum: return 'forum';
        case ChannelType.GuildMedia: return 'media';
        case ChannelType.GuildAnnouncement: return 'announcement';
        case ChannelType.GuildVoice: return 'voice';
        case ChannelType.GuildStageVoice: return 'stage';
        case ChannelType.PublicThread: return 'thread';
        case ChannelType.PrivateThread: return 'private thread';
        case ChannelType.AnnouncementThread: return 'thread';
        default: return 'text';
    }
}

// Why the bot can't read a channel, or null if it can
function unreadableReason(channel, me) {
    const permissions = channel.permissionsFor(me);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel)) return 'no View Channel permission';
    if (!permissions.has(PermissionFlagsBits.ReadMessageHistory)) return 'no Read Message History permission';
    return null;
}

// Sidebar order: channels without a category first, text before voice, then Discord's position
function bySidebarOrder(a, b) {
    return (VOICE_TYPES.has(a.type) - VOICE_TYPES.has(b.type))
        || (a.rawPosition ?? 0) - (b.rawPosition ?? 0)
        || compareIds(a.id, b.id);
}

async function fetchArchivedThreads(channel, type) {
    const found = new Map();
    let before;
    while (true) {
        const { threads, hasMore } = await channel.threads.fetchArchived({ type, fetchAll: true, before, limit: 100 });
        for (const thread of threads.values()) found.set(thread.id, thread);
        if (!hasMore || threads.size === 0) break;
        // Pages are ordered by archive time; continue from the oldest one seen
        const oldest = Math.min(...threads.map((t) => t.archiveTimestamp ?? Date.now()));
        before = new Date(oldest);
    }
    return [...found.values()];
}

// Finds every category, channel and thread, and works out which ones the bot can read.
// `selection` (channel, category or thread IDs) narrows the run; empty means the whole server.
async function discover(guild, { selection = [], skip = [], threads: includeThreads = true } = {}) {
    await guild.channels.fetch();
    const me = guild.members.me ?? await guild.members.fetchMe();
    const notes = [];

    // Selected IDs that aren't cached are usually archived threads; fetching them caches them
    for (const id of selection) {
        if (guild.channels.cache.has(id)) continue;
        const found = await guild.channels.fetch(id).catch(() => null);
        if (!found) notes.push(`${id} is not a channel, category or thread the bot can see in ${guild.name}`);
    }
    const all = [...guild.channels.cache.values()];

    const skipSet = new Set(skip.map((s) => s.toLowerCase()));
    const isSkipped = (channel) => skipSet.has(channel.id) || skipSet.has(channel.name.toLowerCase());
    const selected = new Set(selection);
    const wanted = (channel) => !selected.size || selected.has(channel.id) || selected.has(channel.parentId);

    const containers = all
        .filter((c) => !c.isThread() && (c.isTextBased() || c.isThreadOnly()))
        .sort(bySidebarOrder);

    const skipped = [];
    const readable = new Map(); // container id → { channel, threads }

    for (const channel of containers) {
        // A selected thread pulls in its parent's folder, but not the parent's own messages
        const selectedForThreads = all.some((t) => t.isThread() && t.parentId === channel.id && selected.has(t.id));
        if (!wanted(channel) && !selectedForThreads) continue;
        if (isSkipped(channel)) continue;
        const reason = unreadableReason(channel, me);
        if (reason) {
            skipped.push({ id: channel.id, name: channel.name, type: typeLabel(channel), category: channel.parent?.name ?? null, reason });
            continue;
        }
        readable.set(channel.id, {
            channel,
            ownMessages: channel.isTextBased() && wanted(channel),
            threads: []
        });
    }

    if (includeThreads) {
        const threads = new Map();
        try {
            const active = await guild.channels.fetchActiveThreads();
            for (const thread of active.threads.values()) threads.set(thread.id, thread);
        } catch (error) {
            notes.push(`Could not list active threads: ${error.message}`);
        }

        let privateSkipped = 0;
        for (const { channel } of readable.values()) {
            if (!THREAD_PARENTS.has(channel.type)) continue;
            const types = ['public'];
            if (channel.type === ChannelType.GuildText) {
                if (channel.permissionsFor(me).has(PermissionFlagsBits.ManageThreads)) types.push('private');
                else privateSkipped++;
            }
            for (const type of types) {
                try {
                    for (const thread of await fetchArchivedThreads(channel, type)) threads.set(thread.id, thread);
                } catch (error) {
                    notes.push(`#${channel.name}: could not list archived ${type} threads (${error.message})`);
                }
            }
        }

        if (privateSkipped) {
            notes.push(`Archived private threads skipped in ${privateSkipped} channel(s): the bot needs Manage Threads to see them`);
        }

        for (const thread of [...threads.values()].sort((a, b) => compareIds(a.id, b.id))) {
            const parent = readable.get(thread.parentId);
            if (!parent) continue;
            const parentSelected = !selected.size || selected.has(thread.parentId) || selected.has(parent.channel.parentId);
            if (!parentSelected && !selected.has(thread.id)) continue;
            if (isSkipped(thread)) continue;
            parent.threads.push(thread);
        }
    }

    // Group by category, in sidebar order
    const categories = all
        .filter((c) => c.type === ChannelType.GuildCategory)
        .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0) || compareIds(a.id, b.id));
    const groups = [{ category: null, channels: [] }, ...categories.map((category) => ({ category, channels: [] }))];
    for (const entry of readable.values()) {
        const group = groups.find((g) => (g.category?.id ?? null) === (entry.channel.parentId ?? null)) ?? groups[0];
        // Forums and channels with nothing selectable are only kept if they have threads
        if (!entry.ownMessages && !entry.threads.length) continue;
        group.channels.push(entry);
    }

    return { groups: groups.filter((g) => g.channels.length), skipped, notes };
}

module.exports = { discover, typeLabel, unreadableReason };
