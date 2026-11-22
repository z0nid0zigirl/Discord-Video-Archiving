// Downloads media attachments from every readable channel in a server,
// one folder per channel, skipping duplicate files, then zips the result.
// Usage: set GUILD_ID in .env, then `npm run media`

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const archiver = require('archiver');
const { runWithClient, getEnv, getEnvList, getGuild, getArchivableChannels, ConfigError } = require('./lib/client');
const {
    OUTPUT_ROOT, ensureDir, sanitizeFilename, filenameTimestamp, today,
    uniqueName, uniqueFilePath, fetchAllMessages
} = require('./lib/utils');

const DEFAULT_EXTENSIONS = ['.mp3', '.mp4', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

function getAllowedExtensions() {
    const custom = getEnvList('MEDIA_EXTENSIONS')
        .map((ext) => ext.toLowerCase())
        .map((ext) => (ext.startsWith('.') ? ext : `.${ext}`));
    return new Set(custom.length ? custom : DEFAULT_EXTENSIONS);
}

async function downloadFile(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
}

function hashBuffer(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function zipDirectory(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve(archive.pointer()));
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

runWithClient(async (client) => {
    const guildId = getEnv('GUILD_ID');
    if (!guildId) {
        throw new ConfigError(
            'GUILD_ID is not set in .env.\n' +
            'Enable Developer Mode in Discord (Settings → Advanced), right-click the server icon and choose "Copy Server ID".'
        );
    }

    const guild = getGuild(client, guildId);
    const channels = [...getArchivableChannels(guild).values()];
    const allowedExtensions = getAllowedExtensions();

    const archiveDir = path.join(OUTPUT_ROOT, 'media', `${sanitizeFilename(guild.name)}_${today()}`);
    if (fs.existsSync(archiveDir)) {
        console.log(`Replacing today's earlier archive at ${archiveDir}`);
        fs.rmSync(archiveDir, { recursive: true });
    }
    ensureDir(archiveDir);

    console.log(`\n🚀 Archiving media from ${guild.name}`);
    console.log(`   Channels: ${channels.length}`);
    console.log(`   File types: ${[...allowedExtensions].join(', ')}`);

    const seenHashes = new Set();
    const usedFolderNames = new Set();
    const serverMetadata = {
        server_name: guild.name,
        server_id: guild.id,
        archive_date: new Date().toISOString(),
        file_types: [...allowedExtensions],
        channels: []
    };

    let totalSaved = 0;
    let totalDuplicates = 0;
    let totalFailed = 0;

    for (const [index, channel] of channels.entries()) {
        console.log(`\n[${index + 1}/${channels.length}] #${channel.name}`);

        const folderName = uniqueName(channel.name, usedFolderNames, channel.id);
        const channelDir = path.join(archiveDir, folderName);
        const channelMetadata = {
            channel_name: channel.name,
            channel_id: channel.id,
            folder: folderName,
            files: []
        };

        try {
            for await (const batch of fetchAllMessages(channel)) {
                for (const message of batch.values()) {
                    for (const attachment of message.attachments.values()) {
                        const ext = path.extname(attachment.name || '').toLowerCase();
                        if (!allowedExtensions.has(ext)) continue;

                        const entry = {
                            original_filename: attachment.name,
                            username: message.author.username,
                            user_id: message.author.id,
                            timestamp: message.createdAt.toISOString(),
                            message_content: message.content || '',
                            message_id: message.id,
                            channel_name: channel.name,
                            file_size: attachment.size
                        };

                        try {
                            const buffer = await downloadFile(attachment.url);
                            const hash = hashBuffer(buffer);
                            entry.file_hash = hash;

                            if (seenHashes.has(hash)) {
                                totalDuplicates++;
                                channelMetadata.files.push({ ...entry, filename: null, duplicate: true });
                                console.log(`   ⏭️  Duplicate: ${attachment.name}`);
                                continue;
                            }
                            seenHashes.add(hash);

                            ensureDir(channelDir);
                            const filename = `${filenameTimestamp(message.createdAt)}_${sanitizeFilename(message.author.username)}_${sanitizeFilename(attachment.name)}`;
                            const filePath = uniqueFilePath(channelDir, filename);
                            fs.writeFileSync(filePath, buffer);

                            totalSaved++;
                            channelMetadata.files.push({ ...entry, filename: path.basename(filePath), duplicate: false });
                            console.log(`   ✅ Saved: ${path.basename(filePath)}`);
                        } catch (error) {
                            totalFailed++;
                            channelMetadata.files.push({ ...entry, filename: null, error: error.message });
                            console.error(`   ❌ Failed: ${attachment.name} (${error.message})`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`   ❌ Could not read #${channel.name}: ${error.message}`);
        }

        if (channelMetadata.files.length) {
            ensureDir(channelDir);
            fs.writeFileSync(path.join(channelDir, '_metadata.json'), JSON.stringify(channelMetadata, null, 2));
            serverMetadata.channels.push({
                channel_name: channel.name,
                channel_id: channel.id,
                folder: folderName,
                files_found: channelMetadata.files.length
            });
        }
    }

    const totalFound = totalSaved + totalDuplicates + totalFailed;
    Object.assign(serverMetadata, {
        files_found: totalFound,
        files_saved: totalSaved,
        duplicates_skipped: totalDuplicates,
        downloads_failed: totalFailed
    });
    fs.writeFileSync(path.join(archiveDir, '_server_metadata.json'), JSON.stringify(serverMetadata, null, 2));

    console.log('\n🗜️  Creating ZIP...');
    const zipPath = `${archiveDir}.zip`;
    const bytes = await zipDirectory(archiveDir, zipPath);

    console.log(`\n✅ Archive complete`);
    console.log(`   Channels with media: ${serverMetadata.channels.length}`);
    console.log(`   Files found:         ${totalFound}`);
    console.log(`   Unique files saved:  ${totalSaved}`);
    console.log(`   Duplicates skipped:  ${totalDuplicates}`);
    if (totalFailed) console.log(`   Failed downloads:    ${totalFailed} (see _metadata.json files)`);
    console.log(`   Folder: ${archiveDir}`);
    console.log(`   ZIP:    ${zipPath} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
});
