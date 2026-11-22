// Archives the text history of several channels, or every readable channel in a server.
// Usage: set CHANNEL_IDS (specific channels) or GUILD_ID (whole server) in .env, then `npm run text:multi`
// If both are set, CHANNEL_IDS wins.

const fs = require('fs');
const path = require('path');
const {
    runWithClient, getEnv, getEnvList, getGuild, getChannel, getArchivableChannels, ConfigError
} = require('./lib/client');
const { collectMessages, writeChannelArchive } = require('./lib/text-archive');
const { indexPage } = require('./lib/html');
const { OUTPUT_ROOT, ensureDir, sanitizeFilename, today, uniqueName } = require('./lib/utils');

async function resolveChannels(client) {
    const channelIds = getEnvList('CHANNEL_IDS');

    if (channelIds.length) {
        const channels = [];
        for (const id of channelIds) {
            const channel = await getChannel(client, id);
            if (channel && channel.isTextBased()) {
                channels.push(channel);
            } else {
                console.warn(`⚠️  Skipping ${id}: not found or not a text channel`);
            }
        }
        if (!channels.length) throw new ConfigError('None of the IDs in CHANNEL_IDS could be opened.');
        return { channels, serverName: channels[0].guild?.name || 'Discord' };
    }

    const guildId = getEnv('GUILD_ID');
    if (!guildId) {
        throw new ConfigError(
            'Set either CHANNEL_IDS (comma-separated channel IDs) or GUILD_ID (whole server) in .env.'
        );
    }

    const guild = getGuild(client, guildId);
    return { channels: [...getArchivableChannels(guild).values()], serverName: guild.name };
}

runWithClient(async (client) => {
    const { channels, serverName } = await resolveChannels(client);

    const outDir = ensureDir(path.join(OUTPUT_ROOT, 'text', `${sanitizeFilename(serverName)}_${today()}`));

    console.log(`\n🚀 Archiving ${channels.length} channel(s) from ${serverName}`);

    const channelStats = [];
    const usedNames = new Set();

    for (const [index, channel] of channels.entries()) {
        console.log(`\n[${index + 1}/${channels.length}] #${channel.name}`);
        try {
            const messages = await collectMessages(channel, {
                onProgress: (count) => process.stdout.write(`\r   Fetched ${count} messages...`)
            });
            process.stdout.write('\n');

            const baseName = uniqueName(channel.name, usedNames, channel.id);
            const stats = writeChannelArchive(channel, messages, outDir, baseName, { backLink: 'index.html' });
            channelStats.push(stats);
            console.log(`   ✅ Saved ${stats.message_count.toLocaleString()} messages`);
        } catch (error) {
            console.error(`\n   ❌ Error archiving #${channel.name}: ${error.message}`);
        }
    }

    fs.writeFileSync(path.join(outDir, 'index.html'), indexPage(serverName, channelStats));

    const summary = {
        server_name: serverName,
        archive_date: new Date().toISOString(),
        total_channels: channelStats.length,
        total_messages: channelStats.reduce((sum, ch) => sum + ch.message_count, 0),
        channels: channelStats
    };
    fs.writeFileSync(path.join(outDir, '_archive_summary.json'), JSON.stringify(summary, null, 2));

    console.log(`\n✅ Archive complete`);
    console.log(`   Channels archived: ${summary.total_channels}`);
    console.log(`   Total messages:    ${summary.total_messages.toLocaleString()}`);
    console.log(`   Open:              ${path.join(outDir, 'index.html')}`);
});
