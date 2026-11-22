const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
const { Client, Events, GatewayIntentBits } = require('discord.js');
const { ConfigError } = require('./errors');

function getEnv(name) {
    const value = process.env[name];
    return value && value.trim() ? value.trim() : null;
}

function runWithClient(task) {
    const token = getEnv('DISCORD_TOKEN');
    if (!token) {
        console.error('ERROR: DISCORD_TOKEN is not set in .env');
        process.exit(1);
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });

    client.once(Events.ClientReady, async () => {
        console.log(`Logged in as ${client.user.tag}`);
        let exitCode = 0;
        try {
            await task(client);
        } catch (error) {
            exitCode = 1;
            if (error instanceof ConfigError) {
                console.error(`\nERROR: ${error.message}`);
            } else {
                console.error('\n❌ Archive failed:', error);
            }
        } finally {
            await client.destroy();
            process.exit(exitCode);
        }
    });

    client.login(token).catch((error) => {
        console.error(`\n❌ Could not log in: ${error.message}`);
        if (/disallowed intents/i.test(error.message)) {
            console.error('Turn on "Message Content Intent" under Bot → Privileged Gateway Intents in the Discord Developer Portal.');
        } else if (/token/i.test(error.message)) {
            console.error('Check DISCORD_TOKEN in .env. If you reset the token in the Developer Portal, paste the new one.');
        }
        process.exit(1);
    });
}

module.exports = { ConfigError, getEnv, runWithClient };
