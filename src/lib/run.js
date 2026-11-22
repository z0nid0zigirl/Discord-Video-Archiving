const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { ConfigError } = require('./errors');
const { ensureDir, readJsonFile, writeJsonAtomic } = require('./utils');
const { safeName, FolderMap } = require('./names');
const { ChannelStore } = require('./store');
const { discover, typeLabel } = require('./discover');
const { archiveChannel, emptyStats } = require('./archive-channel');
const { writeChannelOutputs, addUsers, summarize } = require('./outputs');
const { indexPage } = require('./render');
const { KINDS, countLabel } = require('./media');

const UNCATEGORIZED = { id: 'uncategorized', name: 'No Category' };

async function resolveGuild(client, options) {
    if (options.guildId) {
        const guild = client.guilds.cache.get(options.guildId);
        if (guild) return guild;
        const available = client.guilds.cache.map((g) => `  - ${g.name} (ID: ${g.id})`).join('\n');
        throw new ConfigError(`The bot is not in a server with ID ${options.guildId}.\nServers the bot can see:\n${available || '  (none)'}`);
    }
    for (const id of options.channelIds) {
        const channel = await client.channels.fetch(id).catch(() => null);
        if (channel?.guild) return channel.guild;
    }
    if (options.channelIds.length) {
        throw new ConfigError('None of the channel IDs could be opened. Check the IDs and that the bot can view those channels.');
    }
    throw new ConfigError(
        'Set GUILD_ID in .env (whole server) or pass --channels.\n' +
        'Enable Developer Mode in Discord (Settings → Advanced), right-click the server icon and choose "Copy Server ID".'
    );
}

// "<Server name> (<id>)". An earlier archive of the same server is reused even if the server was renamed.
function serverFolder(outDir, guild) {
    ensureDir(outDir);
    const suffix = ` (${guild.id})`;
    const existing = fs.readdirSync(outDir, { withFileTypes: true })
        .find((entry) => entry.isDirectory() && entry.name.endsWith(suffix));
    return path.join(outDir, existing ? existing.name : `${safeName(guild.name, 80)}${suffix}`);
}

// Flattens the discovered tree into the order channels are archived: each channel, then its threads
function planTargets(tree, folders) {
    const targets = [];
    for (const group of tree.groups) {
        const category = group.category ?? UNCATEGORIZED;
        const categoryFolder = folders.assign(category.id, '', category.name);
        for (const entry of group.channels) {
            const channelFolder = folders.assign(entry.channel.id, categoryFolder, entry.channel.name);
            const channelTarget = {
                channel: entry.channel, folder: channelFolder, ownMessages: entry.ownMessages,
                category, parent: null, threads: []
            };
            targets.push(channelTarget);
            for (const thread of entry.threads) {
                const threadTarget = {
                    channel: thread, folder: folders.assign(thread.id, `${channelFolder}/threads`, thread.name),
                    ownMessages: true, category, parent: channelTarget, threads: []
                };
                channelTarget.threads.push(threadTarget);
                targets.push(threadTarget);
            }
        }
    }
    return targets;
}

function printPlan(guild, tree, options) {
    console.log(`\n${guild.name} (${guild.id})`);
    let channels = 0;
    let threads = 0;
    for (const group of tree.groups) {
        console.log(`  ${(group.category ?? UNCATEGORIZED).name}`);
        for (const entry of group.channels) {
            const icon = entry.ownMessages ? '#' : '💬';
            const extra = entry.threads.length ? `  + ${entry.threads.length} thread${entry.threads.length === 1 ? '' : 's'}` : '';
            console.log(`    ✓ ${icon}${entry.channel.name}${extra}`);
            if (entry.ownMessages) channels++;
            threads += entry.threads.length;
        }
    }
    if (tree.skipped.length) {
        console.log('\n  Can\'t read:');
        for (const s of tree.skipped) console.log(`    ✗ #${s.name}${s.category ? ` (${s.category})` : ''}: ${s.reason}`);
    }
    for (const note of tree.notes) console.log(`  ! ${note}`);
    console.log(`\nWould archive ${channels} channel(s) and ${threads} thread(s)` +
        `${options.textOnly ? ', messages only' : options.mediaOnly ? ', media only' : ''}. Nothing was downloaded.`);
}

function progressWriter() {
    const tty = process.stdout.isTTY;
    return {
        update(text) {
            if (tty) process.stdout.write(`\r\x1b[K${text}`);
        },
        done(text) {
            if (tty) process.stdout.write('\r\x1b[K');
            console.log(text);
        }
    };
}

function resultLine(stats, options) {
    const parts = [`${stats.messages.toLocaleString()} new message${stats.messages === 1 ? '' : 's'}`];
    if (!options.textOnly) {
        for (const kind of KINDS) if (stats[kind]) parts.push(countLabel(stats[kind], kind));
        if (stats.duplicates) parts.push(`${stats.duplicates} duplicate${stats.duplicates === 1 ? '' : 's'} skipped`);
        if (stats.failed) parts.push(`${stats.failed} failed`);
    }
    return parts.join(' · ');
}

function zipDirectory(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve(archive.pointer()));
        archive.on('error', reject);
        archive.pipe(output);
        // Resume state stays out of the ZIP
        archive.glob('**/*', { cwd: sourceDir, ignore: ['_state/**', '**/_state/**'] }, { prefix: path.basename(sourceDir) });
        archive.finalize();
    });
}

function existingFiles(dir, folder) {
    const files = {};
    for (const [key, name] of [['html', 'messages.html'], ['json', 'messages.json'], ['txt', 'messages.txt'], ['media', 'media.json']]) {
        if (fs.existsSync(path.join(dir, name))) files[key] = `${folder}/${name}`;
    }
    return files;
}

// Archives a server: discovers channels, archives each one, then writes the index, users and server files.
async function archiveServer(client, options) {
    const guild = await resolveGuild(client, options);
    const tree = await discover(guild, {
        selection: options.channelIds,
        skip: options.skip,
        threads: options.threads
    });

    if (options.dryRun) {
        printPlan(guild, tree, options);
        return { dryRun: true, tree };
    }

    const serverDir = serverFolder(options.outDir, guild);
    const indexFile = path.join(serverDir, '_state', 'folders.json');
    const saved = readJsonFile(indexFile, { folders: {}, first_archived: null });
    const folders = new FolderMap(saved.folders);
    const targets = planTargets(tree, folders);
    writeJsonAtomic(indexFile, { ...saved, folders: folders.toJSON() });

    console.log(`\n🚀 Archiving ${guild.name}`);
    console.log(`   ${targets.filter((t) => !t.parent).length} channel(s), ${targets.filter((t) => t.parent).length} thread(s)` +
        `${options.textOnly ? ' · messages only' : options.mediaOnly ? ' · media only' : ''}`);
    console.log(`   Folder: ${serverDir}`);
    for (const note of tree.notes) console.log(`   ! ${note}`);

    const stores = new Map(targets.map((t) => [t.folder, new ChannelStore(path.join(serverDir, t.folder), t.folder)]));

    // With --dedupe server, one list of file hashes is shared by every channel
    let serverHashes = null;
    if (options.dedupe === 'server') {
        serverHashes = new Map();
        for (const folder of Object.values(folders.toJSON())) {
            const store = stores.get(folder) ?? new ChannelStore(path.join(serverDir, folder), folder);
            for (const [hash, file] of store.savedHashes()) if (!serverHashes.has(hash)) serverHashes.set(hash, file);
        }
    }

    const progress = progressWriter();
    const totals = emptyStats();
    const failures = [];
    let position = 0;

    const channelCount = targets.filter((t) => !t.parent).length;
    for (const target of targets) {
        if (options.signal?.aborted) break;
        const { channel } = target;
        if (!target.parent) {
            const icon = target.ownMessages ? '#' : '💬';
            console.log(`\n[${++position}/${channelCount}] ${target.category.name} › ${icon}${channel.name}`);
        }
        if (!target.ownMessages) continue; // forums have no messages of their own, only posts
        if (target.parent) console.log(`     🧵 ${channel.name}`);

        const store = stores.get(target.folder);
        try {
            const stats = await archiveChannel(channel, store, {
                options,
                hashes: serverHashes ?? store.savedHashes(),
                signal: options.signal,
                onProgress: (s) => progress.update(`       ${resultLine(s, options)}...`)
            });
            for (const key of Object.keys(totals)) totals[key] += stats[key];
            progress.done(`       ${options.signal?.aborted ? '⏸️ ' : '✅'} ${resultLine(stats, options)}`);
        } catch (error) {
            if (options.signal?.aborted) break;
            failures.push({ id: channel.id, name: channel.name, error: error.message });
            progress.done(`       ❌ Could not archive: ${error.message}`);
        }
    }

    // Write each page, and gather counts and users from every channel archived so far
    console.log('\n📝 Writing pages...');
    const archivedAt = new Date().toISOString();
    const users = new Map();
    const listed = new Set();
    // For showing <#channel> and <@&role> mentions by name
    const names = {
        channels: new Map(guild.channels.cache.map((c) => [c.id, c.name])),
        roles: new Map(guild.roles.cache.map((r) => [r.id, r.name]))
    };

    const describe = (target) => {
        const store = stores.get(target.folder);
        const meta = {
            id: target.channel.id,
            name: target.channel.name,
            type: typeLabel(target.channel),
            category_id: target.category.id,
            category_name: target.category.name,
            parent_id: target.parent?.channel.id ?? null,
            parent_name: target.parent?.channel.name ?? null,
            folder: target.folder
        };
        listed.add(target.folder);

        const threadInfo = target.threads
            .filter((t) => stores.get(t.folder).exists())
            .map((t) => ({ id: t.channel.id, name: t.channel.name, folder: t.folder }));

        if (!store.exists() && !threadInfo.length) {
            return { ...meta, stats: emptyStats(), files: {} };
        }
        if (store.exists()) {
            store.state.meta = meta;
            store.save();
        }
        ensureDir(store.dir);
        const result = writeChannelOutputs(store, {
            ...meta,
            serverName: guild.name,
            serverId: guild.id,
            categoryName: target.category.name,
            parent: target.parent ? { id: target.parent.channel.id, name: target.parent.channel.name } : null,
            title: target.parent ? target.channel.name : `#${target.channel.name}`,
            crumbs: [guild.name, target.category.name, ...(target.parent ? [`#${target.parent.channel.name}`] : [])],
            threads: threadInfo,
            names
        }, archivedAt);
        addUsers(users, result.messages, result.media);
        return { ...meta, stats: result.stats, files: result.files };
    };

    const categories = [];
    const categoryFor = (id, name) => {
        let category = categories.find((c) => c.id === id);
        if (!category) categories.push(category = { id, name, channels: [] });
        return category;
    };
    for (const target of targets) {
        if (target.parent) continue;
        const entry = describe(target);
        entry.threads = target.threads.map(describe);
        categoryFor(target.category.id, target.category.name).channels.push(entry);
    }

    // Channels archived on earlier runs but not part of this one (deleted, or left out with --channels)
    const leftovers = Object.values(folders.toJSON())
        .filter((folder) => !listed.has(folder))
        .map((folder) => new ChannelStore(path.join(serverDir, folder), folder))
        .filter((store) => store.exists() && store.state.meta);
    for (const store of leftovers.filter((s) => !s.state.meta.parent_id)) {
        const messages = store.readMessages();
        const media = store.readMedia();
        addUsers(users, messages, media);
        const meta = store.state.meta;
        const entry = { ...meta, stats: summarize(messages, media), files: existingFiles(store.dir, store.folder), threads: [] };
        categoryFor(meta.category_id, meta.category_name).channels.push(entry);
    }
    for (const store of leftovers.filter((s) => s.state.meta.parent_id)) {
        const messages = store.readMessages();
        const media = store.readMedia();
        addUsers(users, messages, media);
        const meta = store.state.meta;
        const entry = { ...meta, stats: summarize(messages, media), files: existingFiles(store.dir, store.folder) };
        const parent = categories.flatMap((c) => c.channels).find((c) => c.id === meta.parent_id);
        if (parent) parent.threads.push(entry);
        else categoryFor(meta.category_id, meta.category_name).channels.push({ ...entry, threads: [] });
    }

    const allEntries = categories.flatMap((c) => c.channels.flatMap((ch) => [ch, ...ch.threads]));
    const sum = (key) => allEntries.reduce((n, e) => n + e.stats[key], 0);
    const serverTotals = {
        channels: categories.reduce((n, c) => n + c.channels.length, 0),
        threads: categories.reduce((n, c) => n + c.channels.reduce((m, ch) => m + ch.threads.length, 0), 0),
        messages: sum('messages'),
        ...Object.fromEntries([...KINDS, 'duplicates', 'failed'].map((k) => [k, sum(k)])),
        users: users.size
    };

    const userList = [...users.values()].sort((a, b) => b.message_count - a.message_count || a.username.localeCompare(b.username));
    writeJsonAtomic(path.join(serverDir, 'users.json'), {
        server_name: guild.name,
        server_id: guild.id,
        user_count: userList.length,
        users: userList
    });

    const stoppedEarly = Boolean(options.signal?.aborted);
    writeJsonAtomic(path.join(serverDir, 'server.json'), {
        server_name: guild.name,
        server_id: guild.id,
        first_archived: saved.first_archived ?? archivedAt,
        last_archived: archivedAt,
        last_run: {
            mode: options.textOnly ? 'text' : options.mediaOnly ? 'media' : 'all',
            dedupe: options.dedupe,
            embeds: options.embeds,
            all_files: options.allFiles,
            stopped_early: stoppedEarly,
            failures
        },
        totals: serverTotals,
        categories,
        skipped: tree.skipped,
        notes: tree.notes
    });
    writeJsonAtomic(indexFile, { folders: folders.toJSON(), first_archived: saved.first_archived ?? archivedAt });

    fs.writeFileSync(path.join(serverDir, 'index.html'), indexPage({
        serverName: guild.name,
        totals: serverTotals,
        categories: categories.filter((c) => c.channels.length),
        skipped: tree.skipped,
        archivedAt: new Date(archivedAt).toLocaleString()
    }));

    let zipPath = null;
    if (options.zip) {
        console.log('🗜️  Creating ZIP...');
        zipPath = `${serverDir}.zip`;
        await zipDirectory(serverDir, zipPath);
    }

    console.log(stoppedEarly ? '\n⏸️  Stopped early. Run the same command again to pick up where it left off.' : '\n✅ Archive complete');
    console.log(`   This run:  ${resultLine(totals, options)}`);
    console.log(`   Archive:   ${countLabel(serverTotals.channels, 'channels')} · ${countLabel(serverTotals.threads, 'threads')} · ` +
        `${countLabel(serverTotals.messages, 'messages')} · ` +
        `${KINDS.filter((k) => serverTotals[k]).map((k) => countLabel(serverTotals[k], k)).join(' · ')}${KINDS.some((k) => serverTotals[k]) ? ' · ' : ''}` +
        `${countLabel(serverTotals.users, 'users')}`);
    if (failures.length) console.log(`   Failed:    ${failures.map((f) => `#${f.name} (${f.error})`).join(', ')}`);
    if (tree.skipped.length) console.log(`   Skipped:   ${tree.skipped.length} channel(s) the bot can't read (listed in index.html)`);
    console.log(`   Open:      ${path.join(serverDir, 'index.html')}`);
    if (zipPath) console.log(`   ZIP:       ${zipPath}`);

    return { serverDir, totals: serverTotals, run: totals, failures, stoppedEarly, zipPath };
}

module.exports = { archiveServer, resolveGuild, serverFolder, planTargets };
