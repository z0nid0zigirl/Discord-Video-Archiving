// Archives a whole server, or chosen channels: messages, photos, videos and audio,
// in folders by category and channel. Run it again to continue or update.
// Usage: npm run archive -- [options]   (npm run archive -- --help for the list)

const { runWithClient } = require('./lib/client');
const { ConfigError } = require('./lib/errors');
const { parseOptions, HELP } = require('./lib/options');
const { archiveServer } = require('./lib/run');

// `preset` lets the older npm scripts reuse this with their own defaults
function main(preset = {}) {
    let options;
    try {
        options = parseOptions(process.argv.slice(2), process.env, preset);
    } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        console.error(`ERROR: ${error.message}`);
        process.exit(1);
    }
    if (options.help) {
        console.log(HELP);
        return;
    }

    const controller = new AbortController();
    process.on('SIGINT', () => {
        if (controller.signal.aborted) process.exit(130);
        console.log('\n⏸️  Stopping after the current step and saving progress... (Ctrl+C again to quit now)');
        controller.abort();
    });

    runWithClient((client) => archiveServer(client, { ...options, signal: controller.signal }));
}

if (require.main === module) main();

module.exports = { main };
