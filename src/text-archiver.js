// Archives the messages of a single channel (and its threads) as HTML, JSON and plain text.
// Same as `npm run archive -- --text-only --channels <CHANNEL_ID>`.
// Usage: set CHANNEL_ID in .env, then `npm run text`

const { main } = require('./archive');
const { getEnv } = require('./lib/client');
const { PRESETS } = require('./lib/options');

const channelId = getEnv('CHANNEL_ID');
if (!channelId) {
    console.error(
        'ERROR: CHANNEL_ID is not set in .env.\n' +
        'Enable Developer Mode in Discord (Settings → Advanced), right-click the channel and choose "Copy Channel ID".'
    );
    process.exit(1);
}

main(PRESETS.text(channelId));
