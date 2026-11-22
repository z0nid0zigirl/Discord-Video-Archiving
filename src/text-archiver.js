// Archives the text history of a single channel.
// Usage: set CHANNEL_ID in .env, then `npm run text`

const path = require('path');
const { runWithClient, getEnv, getChannel, ConfigError } = require('./lib/client');
const { collectMessages, writeChannelArchive } = require('./lib/text-archive');
const { OUTPUT_ROOT, ensureDir, sanitizeFilename, today } = require('./lib/utils');

runWithClient(async (client) => {
    const channelId = getEnv('CHANNEL_ID');
    if (!channelId) {
        throw new ConfigError(
            'CHANNEL_ID is not set in .env.\n' +
            'Enable Developer Mode in Discord (Settings → Advanced), right-click the channel and choose "Copy Channel ID".'
        );
    }

    const channel = await getChannel(client, channelId);
    if (!channel || !channel.isTextBased()) {
        throw new ConfigError(
            `Could not open a text channel with ID ${channelId}.\n` +
            'Check that the ID is correct, the bot is in that server, and it can view the channel.'
        );
    }

    console.log(`\nArchiving #${channel.name} (${channel.id})`);
    const messages = await collectMessages(channel, {
        onProgress: (count) => console.log(`  Fetched ${count} messages...`)
    });

    const outDir = ensureDir(path.join(OUTPUT_ROOT, 'text'));
    const baseName = `${sanitizeFilename(channel.name)}_${today()}`;
    const stats = writeChannelArchive(channel, messages, outDir, baseName);

    console.log(`\n✅ Archive complete`);
    console.log(`   Channel:  #${stats.channel_name}`);
    console.log(`   Messages: ${stats.message_count.toLocaleString()}`);
    console.log(`   Users:    ${stats.unique_users}`);
    console.log(`   Files:    ${Object.values(stats.files).map((f) => path.join(outDir, f)).join('\n             ')}`);
});
