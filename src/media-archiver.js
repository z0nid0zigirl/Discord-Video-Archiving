// Downloads every photo, video and audio file in a server into category/channel folders,
// stores each file once per server, and zips the result.
// Same as `npm run archive -- --media-only --dedupe server --zip`.
// Usage: set GUILD_ID in .env, then `npm run media`

const { main } = require('./archive');
const { PRESETS } = require('./lib/options');

main(PRESETS.media);
