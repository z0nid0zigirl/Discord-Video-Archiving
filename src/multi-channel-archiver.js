// Archives the messages of several channels (CHANNEL_IDS), or every readable channel in a server (GUILD_ID),
// with a browsable index page. If both are set, CHANNEL_IDS wins.
// Same as `npm run archive -- --text-only`.
// Usage: set CHANNEL_IDS or GUILD_ID in .env, then `npm run text:multi`

const { main } = require('./archive');
const { PRESETS } = require('./lib/options');

main(PRESETS.textMulti);
