// Prints the link for adding the bot to a server, with only the permissions it needs.
// Usage: set DISCORD_TOKEN (or CLIENT_ID) in .env, then `npm run invite`

const { PermissionFlagsBits } = require('discord.js');
const { getEnv } = require('./lib/client');

// A bot token starts with the bot's user ID in base64; for bots that is also the application ID
function applicationId() {
    const fromEnv = getEnv('CLIENT_ID');
    if (fromEnv) return fromEnv;
    const token = getEnv('DISCORD_TOKEN');
    if (!token) return null;
    const id = Buffer.from(token.split('.')[0], 'base64').toString('utf8');
    return /^\d{17,20}$/.test(id) ? id : null;
}

const id = applicationId();
if (!id) {
    console.error(
        'ERROR: Set DISCORD_TOKEN in .env, or CLIENT_ID (Developer Portal → your app → General Information → Application ID).'
    );
    process.exit(1);
}

const basic = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
const withPrivateThreads = basic | PermissionFlagsBits.ManageThreads;
const link = (permissions) => `https://discord.com/oauth2/authorize?client_id=${id}&scope=bot&permissions=${permissions}`;

console.log('Invite link (View Channels + Read Message History):');
console.log(`  ${link(basic)}\n`);
console.log('Or, to also archive private threads that have been archived (adds Manage Threads, which also lets');
console.log('the bot edit and delete threads, so only use it if you need those):');
console.log(`  ${link(withPrivateThreads)}\n`);
console.log('Also turn on Message Content Intent (Developer Portal → Bot → Privileged Gateway Intents),');
console.log('or messages come back empty.');
