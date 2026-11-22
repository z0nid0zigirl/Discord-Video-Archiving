// A small server that exercises everything the archiver handles
const { Client, GatewayIntentBits } = require('discord.js');
const { FakeDiscord, PERMISSIONS } = require('./fake-discord');

const JPEG = Buffer.from('ffd8ffe000104a464946000101fake-jpeg-cat', 'hex').toString('latin1') + 'cat';

async function buildScenario({ manageThreads = false } = {}) {
    const fake = await new FakeDiscord({
        everyonePermissions: PERMISSIONS.ViewChannel | PERMISSIONS.SendMessages | PERMISSIONS.ReadMessageHistory
            | (manageThreads ? PERMISSIONS.ManageThreads : 0n)
    }).start();
    const alice = fake.user('alice', 'Alice ✨');
    const bob = fake.user('bob');
    const carol = fake.user('carol');

    const info = fake.channel('INFO', { type: 'category', position: 0 });
    const mediaCat = fake.channel('📸┃MEDIA', { type: 'category', position: 1 });
    const staff = fake.channel('STAFF', { type: 'category', position: 2 });

    const welcome = fake.channel('welcome', { position: 0 });
    const general = fake.channel('general', { parent: info, position: 1 });
    const generalUpper = fake.channel('General', { parent: info, position: 2 });
    const announcements = fake.channel('📢┃announcements', { parent: info, type: 'announcement', position: 3 });
    const photos = fake.channel('photos', { parent: mediaCat, position: 0 });
    const forum = fake.channel('help-forum', { parent: mediaCat, type: 'forum', position: 1 });
    const lounge = fake.channel('Lounge', { parent: mediaCat, type: 'voice', position: 2 });
    const secret = fake.channel('secret', { parent: staff, deny: PERMISSIONS.ViewChannel, position: 0 });
    const noHistory = fake.channel('no-history', { parent: staff, deny: PERMISSIONS.ReadMessageHistory, position: 1 });

    fake.message(welcome, alice, `Welcome! Read <#${general.id}> and say hi to <@${bob.id}>`, { mentions: [bob] });
    const hello = fake.message(welcome, bob, 'hi https://example.com/page.');
    fake.message(welcome, carol, 'replying', { type: 19, message_reference: { message_id: hello.id, channel_id: welcome.id } });

    // general: every kind of media, a repost, embeds, and enough messages for three pages
    const catFile = fake.attachment('cat.jpg', JPEG, 'image/jpeg');
    const first = fake.message(general, alice, 'my cat', { attachments: [catFile] });
    fake.message(general, bob, 'iphone video', { attachments: [fake.attachment('IMG_0001.MOV', 'mov-bytes', 'video/quicktime')] });
    fake.message(general, bob, 'no type reported', { attachments: [fake.attachment('IMG_0002.HEIC', 'heic-bytes', null)] });
    fake.message(general, carol, 'clip', { attachments: [fake.attachment('clip.webm', 'webm-bytes', 'video/webm')] });
    fake.message(general, carol, 'song', { attachments: [fake.attachment('song.mp3', 'mp3-bytes', 'audio/mpeg')] });
    fake.message(general, carol, 'a pdf', { attachments: [fake.attachment('rules.pdf', 'pdf-bytes', 'application/pdf')] });
    fake.message(general, bob, 'reposting the cat', { attachments: [fake.attachment('cat (1).jpg', JPEG, 'image/jpeg')] });
    fake.message(general, alice, 'flaky host', { attachments: [fake.attachment('flaky.png', 'png-bytes', 'image/png', { failTimes: 2 })] });
    fake.message(general, alice, 'rate limited', { attachments: [fake.attachment('busy.gif', 'gif-bytes', 'image/gif', { rateLimitTimes: 1 })] });
    const broken = fake.attachment('gone.png', 'gone-bytes', 'image/png', { status: 404 });
    fake.message(general, alice, 'broken link', { attachments: [broken] });

    const tenor = fake.file('tenor.mp4', 'tenor-gif-bytes', 'video/mp4');
    fake.message(general, bob, 'https://tenor.com/view/dance', {
        embeds: [{ type: 'gifv', url: 'https://tenor.com/view/dance', provider: { name: 'Tenor' },
            thumbnail: { url: 'https://media.tenor.com/x/tenor.png', proxy_url: tenor.url.replace('tenor.mp4', 'thumb'), width: 1, height: 1 },
            video: { url: 'https://media.tenor.com/x/tenor.mp4', proxy_url: tenor.url, width: 1, height: 1 } }]
    });
    fake.message(general, bob, 'https://youtube.com/watch?v=x', {
        embeds: [{ type: 'video', url: 'https://youtube.com/watch?v=x', title: 'A video',
            thumbnail: { url: 'https://i.ytimg.com/x.jpg', proxy_url: fake.file('yt.jpg', 'yt', 'image/jpeg').url },
            video: { url: 'https://www.youtube.com/embed/x' } }]
    });
    const imageLink = fake.file('meme.png', 'meme-bytes', 'image/png');
    fake.message(general, carol, 'https://i.example.com/meme.png', {
        embeds: [{ type: 'image', url: 'https://i.example.com/meme.png', thumbnail: { url: 'https://i.example.com/meme.png', proxy_url: imageLink.url } }]
    });
    const notMedia = fake.file('page', '<html>', 'text/html');
    fake.message(general, carol, 'bad image embed', {
        embeds: [{ type: 'image', url: 'https://x.example/page', thumbnail: { url: 'https://x.example/page', proxy_url: notMedia.url } }]
    });
    fake.message(general, alice, 'edited', { edited_timestamp: new Date(fake.clock + 1000).toISOString(), reactions: [{ count: 3, me: false, emoji: { id: null, name: '🔥' }, count_details: { burst: 0, normal: 3 }, burst_colors: [], me_burst: false, burst_count: 0 }] });
    for (let i = 0; i < 230; i++) fake.message(general, [alice, bob, carol][i % 3], `filler ${i}`);

    const starter = fake.message(general, alice, 'thread starter');
    const activeThread = fake.thread(general, 'cat appreciation', { from: starter });
    fake.message(activeThread, bob, 'in the thread', { attachments: [fake.attachment('thread-cat.png', 'thread-cat', 'image/png')] });
    const oldThread = fake.thread(general, 'old: thread', { archived: true });
    fake.message(oldThread, carol, 'archived thread message');
    // Only visible to a bot with Manage Threads
    const privateThread = fake.thread(general, 'mods only', { archived: true, type: 'privateThread' });
    fake.message(privateThread, alice, 'private thread message', { attachments: [fake.attachment('private.png', 'private-bytes', 'image/png')] });

    fake.message(generalUpper, bob, 'same name, different case');
    // A forwarded message: Discord copies the original's content and files into a snapshot
    fake.message(generalUpper, carol, '', {
        message_reference: { type: 1, message_id: first.id, channel_id: general.id, guild_id: fake.guild.id },
        message_snapshots: [{ message: {
            type: 0, content: 'my cat', timestamp: first.timestamp, edited_timestamp: null, flags: 0,
            mentions: [], mention_roles: [], embeds: [],
            attachments: [fake.attachment('cat.jpg', JPEG, 'image/jpeg')]
        } }]
    });
    fake.message(announcements, alice, 'big news');

    // The same cat in another channel: kept here unless --dedupe server
    fake.message(photos, carol, 'cat again', { attachments: [fake.attachment('cat.jpg', JPEG, 'image/jpeg')] });

    const post1 = fake.thread(forum, 'How do I export?');
    fake.message(post1, bob, 'question', { attachments: [fake.attachment('screenshot.png', 'shot', 'image/png')] });
    const post2 = fake.thread(forum, 'Solved: login', { archived: true });
    fake.message(post2, alice, 'fixed it');

    fake.message(secret, alice, 'hidden');
    fake.message(noHistory, alice, 'hidden too');

    return {
        fake, users: { alice, bob, carol },
        channels: { info, mediaCat, staff, welcome, general, generalUpper, announcements, photos, forum, lounge, secret, noHistory },
        threads: { activeThread, oldThread, privateThread, post1, post2 },
        files: { catFile, broken },
        firstCatMessage: first
    };
}

async function connect(fake) {
    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
        rest: { api: `${fake.base}/api`, retries: 0 }
    });
    const ready = new Promise((resolve) => client.once('clientReady', resolve));
    await client.login('fake-token');
    await ready;
    return client;
}

module.exports = { buildScenario, connect };
