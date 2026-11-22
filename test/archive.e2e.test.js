// End-to-end: the real discord.js client against a fake Discord (test/helpers/fake-discord.js)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildScenario, connect } = require('./helpers/scenario');
const { archiveServer } = require('../src/lib/run');
const { parseOptions, PRESETS } = require('../src/lib/options');

async function withScenario(t, fn, scenarioOptions) {
    t.mock.method(console, 'log', () => {});
    const scenario = await buildScenario(scenarioOptions);
    const client = await connect(scenario.fake);
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discord-archive-test-'));
    const run = (preset = {}, argv = []) => archiveServer(client, parseOptions(argv, {}, {
        guildId: scenario.fake.guild.id, outDir, fetchDelayMs: 0, retryDelayMs: 5, ...preset
    }));
    try {
        await fn({ ...scenario, client, outDir, run });
    } finally {
        await client.destroy();
        await scenario.fake.stop();
        fs.rmSync(outDir, { recursive: true, force: true });
    }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const list = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const fileRequests = (fake) => fake.requests.filter((r) => r.path.startsWith('/files/'));

test('archives a whole server into category and channel folders', async (t) => {
    await withScenario(t, async ({ fake, run, channels, users }) => {
        const result = await run();
        const root = result.serverDir;
        assert.equal(path.basename(root), `Test Server (${fake.guild.id})`);

        // Folders by category, then channel; emoji kept, uncategorized channels grouped
        assert.deepEqual(list(root), ['INFO', 'No Category', '_state', 'index.html', 'server.json', 'users.json', '📸┃MEDIA']);
        assert.deepEqual(list(path.join(root, 'INFO')), [`General_${channels.generalUpper.id}`, 'general', '📢┃announcements']);
        assert.ok(fs.existsSync(path.join(root, 'No Category/welcome/messages.html')));

        // Photos, videos and audio in their own folders, found by file type with an extension fallback
        const general = path.join(root, 'INFO/general');
        assert.deepEqual(list(general), ['_state', 'audio', 'media.json', 'messages.html', 'messages.json', 'messages.txt', 'photos', 'threads', 'videos']);
        const photos = list(path.join(general, 'photos'));
        const videos = list(path.join(general, 'videos'));
        assert.equal(photos.length, 5);
        assert.ok(photos.some((f) => f.endsWith('_IMG_0002.HEIC')), 'HEIC with no reported type');
        assert.ok(videos.some((f) => f.endsWith('_IMG_0001.MOV')), 'iPhone .mov');
        assert.ok(videos.some((f) => f.endsWith('_clip.webm')));
        assert.ok(videos.some((f) => f.endsWith('_tenor.mp4')), 'Tenor GIF from an embed');
        assert.deepEqual(list(path.join(general, 'audio')).length, 1);
        assert.ok(!fs.existsSync(path.join(general, 'files')), 'PDFs are skipped by default');

        // File names carry the date, username and user ID
        assert.ok(photos.includes(`2024-01-01_00-04-00_alice_${users.alice.id}_cat.jpg`));

        // The repost is stored once, and the copy kept is the original post
        const media = readJson(path.join(general, 'media.json'));
        const cats = media.files.filter((f) => f.original_filename.startsWith('cat'));
        assert.equal(cats.length, 2);
        assert.equal(cats[0].username, 'alice');
        assert.equal(cats[0].duplicate, false);
        assert.equal(cats[1].duplicate, true);
        assert.equal(cats[1].duplicate_of, `INFO/general/${cats[0].path}`);
        // Same file in another channel: kept there too (dedupe is per channel by default)
        assert.equal(list(path.join(root, '📸┃MEDIA/photos/photos')).length, 1);

        // Retries got the flaky and rate-limited files; the dead link is recorded, the web page skipped
        assert.equal(media.counts.failed, 1);
        assert.match(media.files.find((f) => f.original_filename === 'gone.png').error, /404/);
        assert.match(media.files.find((f) => f.skipped).skipped, /not a media file/);
        assert.ok(photos.some((f) => f.endsWith('_flaky.png')));
        assert.ok(photos.some((f) => f.endsWith('_busy.gif')));
        assert.ok(!photos.some((f) => f.includes('yt')), 'YouTube thumbnails are not saved');

        // Every message, oldest first, with user ID and local file paths
        const messages = readJson(path.join(general, 'messages.json')).messages;
        assert.equal(messages.length, 246);
        assert.ok(messages.every((m) => /^\d+$/.test(m.user_id)));
        assert.ok(messages.every((m, i) => i === 0 || BigInt(m.message_id) > BigInt(messages[i - 1].message_id)));
        const repost = messages.find((m) => m.content === 'reposting the cat');
        assert.equal(repost.attachments[0].local_path, cats[0].path);
        const edited = messages.find((m) => m.content === 'edited');
        assert.ok(edited.edited_timestamp_iso);
        assert.deepEqual(edited.reactions, [{ emoji: '🔥', count: 3 }]);
        assert.equal(messages[0].display_name, 'Alice ✨');

        // Threads (active and archived) and forum posts sit under their channel
        assert.deepEqual(list(path.join(general, 'threads')), ['cat appreciation', 'old_ thread']);
        assert.deepEqual(list(path.join(root, '📸┃MEDIA/help-forum/threads')), ['How do I export_', 'Solved_ login']);
        assert.equal(list(path.join(root, '📸┃MEDIA/help-forum/threads/How do I export_/photos')).length, 1);

        // HTML shows media from the local files, user IDs, and links threads
        const html = fs.readFileSync(path.join(general, 'messages.html'), 'utf8');
        assert.match(html, /<video src="videos\/2024-01-01_00-05-00_bob_\d+_IMG_0001\.MOV"/);
        assert.match(html, new RegExp(`class="uid" title="User ID">${users.alice.id}<`));
        assert.match(html, /href="threads\/cat%20appreciation\/messages\.html"/);
        const welcome = fs.readFileSync(path.join(root, 'No Category/welcome/messages.html'), 'utf8');
        assert.match(welcome, /Read #general and say hi to @bob/);
        assert.match(welcome, /replying to <a href="#m\d+">@bob<\/a>/);

        // Channels the bot can't read are listed with the reason; empty channels make no folder
        const server = readJson(path.join(root, 'server.json'));
        assert.deepEqual(server.skipped.map((s) => [s.name, s.reason]), [
            ['secret', 'no View Channel permission'],
            ['no-history', 'no Read Message History permission']
        ]);
        assert.ok(!fs.existsSync(path.join(root, '📸┃MEDIA/Lounge')));
        assert.equal(server.totals.messages, 257);
        assert.equal(server.totals.threads, 4);

        // users.json: who posted what
        const usersFile = readJson(path.join(root, 'users.json'));
        const alice = usersFile.users.find((u) => u.user_id === users.alice.id);
        assert.deepEqual(alice.names_seen, ['alice', 'Alice ✨']);
        assert.ok(alice.message_count > 0 && alice.photos > 0);

        const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        assert.match(index, /📢┃announcements/);
        assert.match(index, /no View Channel permission/);
    });
});

test('a second run only fetches new messages and retries failed downloads', async (t) => {
    await withScenario(t, async ({ fake, run, channels, users, files }) => {
        const first = await run();
        const general = path.join(first.serverDir, 'INFO/general');
        const before = list(path.join(general, 'photos')).length;

        // The dead link comes back, and two new messages arrive
        fake.files.get(new URL(files.broken.url).pathname).status = 200;
        fake.message(channels.general, users.bob, 'new photo', { attachments: [fake.attachment('new.png', 'new-bytes', 'image/png')] });
        fake.message(channels.general, users.carol, 'new text');
        fake.requests.length = 0;

        const second = await run();
        assert.equal(second.run.messages, 2);

        const fetched = fileRequests(fake).map((r) => decodeURIComponent(r.path.split('/').pop()));
        assert.deepEqual(fetched.sort(), ['gone.png', 'new.png'], 'only the new file and the retry are downloaded');
        const pages = fake.requests.filter((r) => r.path.endsWith(`/channels/${channels.general.id}/messages`));
        assert.ok(pages.every((r) => r.query.after !== '0'), 'resumes from the saved position');

        assert.equal(list(path.join(general, 'photos')).length, before + 2);
        const media = readJson(path.join(general, 'media.json'));
        assert.equal(media.counts.failed, 0);
        assert.equal(readJson(path.join(general, 'messages.json')).messages.length, 248);
    });
});

test('stopping midway keeps progress, and the next run finishes without duplicates', async (t) => {
    await withScenario(t, async ({ fake, run, channels }) => {
        const controller = new AbortController();
        let pages = 0;
        fake.onRequest = (request) => {
            if (request.path.endsWith(`/channels/${channels.general.id}/messages`) && ++pages === 2) controller.abort();
        };
        const stopped = await run({ signal: controller.signal });
        assert.equal(stopped.stoppedEarly, true);
        fake.onRequest = null;

        const done = await run();
        assert.equal(done.stoppedEarly, false);
        const general = path.join(done.serverDir, 'INFO/general');
        const messages = readJson(path.join(general, 'messages.json')).messages;
        assert.equal(messages.length, 246);
        assert.equal(new Set(messages.map((m) => m.message_id)).size, 246);
        assert.equal(list(path.join(general, 'photos')).length, 5, 'no file saved twice');
        assert.equal(done.totals.messages, 257);
    });
});

test('--dedupe server stores a file once across the whole server', async (t) => {
    await withScenario(t, async ({ run }) => {
        const result = await run({}, ['--dedupe', 'server']);
        assert.ok(!fs.existsSync(path.join(result.serverDir, '📸┃MEDIA/photos/photos')));
        const media = readJson(path.join(result.serverDir, '📸┃MEDIA/photos/media.json'));
        assert.equal(media.files[0].duplicate_of.startsWith('INFO/general/photos/'), true);
        const html = fs.readFileSync(path.join(result.serverDir, '📸┃MEDIA/photos/messages.html'), 'utf8');
        assert.match(html, /src="\.\.\/\.\.\/INFO\/general\/photos\//, 'links to the kept copy');
    });
});

test('--text-only downloads nothing and --media-only writes no message pages', async (t) => {
    await withScenario(t, async ({ fake, run }) => {
        const text = await run({}, ['--text-only']);
        assert.equal(fileRequests(fake).length, 0);
        assert.ok(!fs.existsSync(path.join(text.serverDir, 'INFO/general/photos')));
        assert.ok(fs.existsSync(path.join(text.serverDir, 'INFO/general/messages.json')));

        // Media afterwards fills in the files the text run skipped
        const media = await run({}, ['--media-only']);
        assert.equal(list(path.join(media.serverDir, 'INFO/general/photos')).length, 5);
        const json = readJson(path.join(media.serverDir, 'INFO/general/messages.json'));
        const cat = json.messages.find((m) => m.content === 'my cat');
        assert.ok(cat.attachments[0].local_path.startsWith('photos/'), 'pages now link the downloaded files');
    });
});

test('--dry-run reports without writing anything', async (t) => {
    await withScenario(t, async ({ fake, run, outDir }) => {
        const result = await run({}, ['--dry-run']);
        assert.equal(result.dryRun, true);
        assert.deepEqual(list(outDir), []);
        assert.equal(fileRequests(fake).length, 0);
    });
});

test('--channels accepts a category or a single thread', async (t) => {
    await withScenario(t, async ({ run, channels, threads }) => {
        const category = await run({}, ['--channels', channels.mediaCat.id]);
        assert.deepEqual(list(category.serverDir).filter((f) => !f.includes('.') && f !== '_state'), ['📸┃MEDIA']);
        assert.ok(fs.existsSync(path.join(category.serverDir, '📸┃MEDIA/help-forum/threads/Solved_ login/messages.json')));

        const thread = await run({}, ['--channels', threads.oldThread.id]);
        const general = path.join(thread.serverDir, 'INFO/general');
        assert.ok(fs.existsSync(path.join(general, 'threads/old_ thread/messages.json')));
        assert.ok(!fs.existsSync(path.join(general, 'messages.json')), 'the parent channel itself is not archived');
        // Channels from the earlier run are still in the index
        assert.equal(readJson(path.join(thread.serverDir, 'server.json')).categories.length, 2);
    });
});

test('npm run media: media only, one copy per server, and a ZIP without resume data', async (t) => {
    await withScenario(t, async ({ run }) => {
        const result = await run(PRESETS.media);
        assert.ok(result.zipPath && fs.existsSync(result.zipPath));
        assert.equal(path.dirname(result.zipPath), path.dirname(result.serverDir));
        assert.ok(!fs.existsSync(path.join(result.serverDir, 'INFO/general/messages.json')), 'no message pages');
        assert.ok(!fs.existsSync(path.join(result.serverDir, '📸┃MEDIA/photos/photos')), 'the cat is stored once');

        // ZIP entry names are stored uncompressed, so they can be checked in the raw bytes
        const zip = fs.readFileSync(result.zipPath);
        const folder = path.basename(result.serverDir);
        assert.ok(zip.includes(Buffer.from(`${folder}/INFO/general/photos/2024-01-01_00-04-00_alice_`)));
        assert.ok(zip.includes(Buffer.from(`${folder}/index.html`)));
        assert.ok(!zip.includes(Buffer.from('_state')), 'resume data stays out of the ZIP');
    });
});

test('archived private threads are included when the bot has Manage Threads', async (t) => {
    await withScenario(t, async ({ run }) => {
        const result = await run();
        const thread = path.join(result.serverDir, 'INFO/general/threads/mods only');
        assert.equal(readJson(path.join(thread, 'messages.json')).messages[0].content, 'private thread message');
        assert.equal(list(path.join(thread, 'photos')).length, 1);
        assert.deepEqual(readJson(path.join(result.serverDir, 'server.json')).notes, []);
    }, { manageThreads: true });

    await withScenario(t, async ({ run }) => {
        const result = await run();
        assert.ok(!fs.existsSync(path.join(result.serverDir, 'INFO/general/threads/mods only')));
        assert.match(readJson(path.join(result.serverDir, 'server.json')).notes[0], /needs Manage Threads/);
    });
});

test('forwarded messages keep their text and files', async (t) => {
    await withScenario(t, async ({ run, channels }) => {
        const result = await run();
        const dir = path.join(result.serverDir, `INFO/General_${channels.generalUpper.id}`);
        const forward = readJson(path.join(dir, 'messages.json')).messages.find((m) => m.forwarded.length);
        assert.equal(forward.forwarded[0].content, 'my cat');
        assert.match(forward.forwarded[0].attachments[0].local_path, /^photos\/.*_carol_\d+_cat\.jpg$/);
        assert.equal(list(path.join(dir, 'photos')).length, 1);
        const html = fs.readFileSync(path.join(dir, 'messages.html'), 'utf8');
        assert.match(html, /↪ Forwarded/);
        assert.match(html, /<img src="photos\/[^"]*_cat\.jpg"/);
    });
});
