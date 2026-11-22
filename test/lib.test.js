const { test } = require('node:test');
const assert = require('node:assert/strict');
const { safeName, safeFileName, mediaFileName, FolderMap } = require('../src/lib/names');
const { kindOf, embedMedia, mediaJobs, withExtension } = require('../src/lib/media');
const { parseOptions, PRESETS } = require('../src/lib/options');
const { linkify, readableContent, safeUrl } = require('../src/lib/render');
const { mapLimit } = require('../src/lib/download');
const { oldestCursor } = require('../src/lib/archive-channel');
const { compareIds, encodePath } = require('../src/lib/utils');

test('safeName keeps emoji and letters, replaces only what filesystems refuse', () => {
    assert.equal(safeName('📢┃announcements'), '📢┃announcements');
    assert.equal(safeName('café 日本語'), 'café 日本語');
    assert.equal(safeName('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
    assert.equal(safeName('  spaced   out  '), 'spaced out');
    assert.equal(safeName('.hidden'), '_hidden');
    assert.equal(safeName('trailing...'), 'trailing');
    assert.equal(safeName('CON'), 'CON_');
    assert.equal(safeName('nul.txt'), 'nul.txt_');
    assert.equal(safeName(''), '_');
    assert.equal(Array.from(safeName('🔥'.repeat(100))).length, 60);
    assert.ok(Buffer.byteLength(safeName('🔥'.repeat(100))) <= 240);
});

test('safeFileName shortens the name but keeps the extension', () => {
    const name = safeFileName(`${'x'.repeat(300)}.jpeg`, 50);
    assert.ok(name.endsWith('.jpeg'));
    assert.equal(name.length, 50);
    assert.equal(safeFileName('weird.name.with.dots.mp4'), 'weird.name.with.dots.mp4');
});

test('mediaFileName is date, username, user ID, original name', () => {
    const name = mediaFileName({
        date: new Date('2024-01-15T10:30:00.123Z'), username: 'al/ice', userId: '123456789012345678', originalName: 'IMG 1.MOV'
    });
    assert.equal(name, '2024-01-15_10-30-00_al_ice_123456789012345678_IMG 1.MOV');
});

test('FolderMap keeps names stable and separates clashes case-insensitively', () => {
    const map = new FolderMap();
    assert.equal(map.assign('1', '', 'INFO'), 'INFO');
    assert.equal(map.assign('2', 'INFO', 'general'), 'INFO/general');
    assert.equal(map.assign('3', 'INFO', 'General'), 'INFO/General_3');
    assert.equal(map.assign('4', 'OTHER', 'general'), 'OTHER/general');
    assert.equal(map.assign('5', '', '_state'), '_state_5', 'reserved for resume data');

    // A later run reuses the saved names, even if the channel was renamed
    const again = new FolderMap(map.toJSON());
    assert.equal(again.assign('2', 'INFO', 'renamed'), 'INFO/general');
    assert.equal(again.assign('6', 'INFO', 'GENERAL'), 'INFO/GENERAL_6');
});

test('kindOf uses the reported type, then the extension', () => {
    assert.equal(kindOf('image/jpeg', 'x.bin'), 'photos');
    assert.equal(kindOf('video/quicktime', 'clip.MOV'), 'videos');
    assert.equal(kindOf('audio/ogg; codecs=opus', 'voice-message.ogg'), 'audio');
    assert.equal(kindOf(null, 'IMG_1.HEIC'), 'photos');
    assert.equal(kindOf('application/octet-stream', 'movie.mkv'), 'videos');
    assert.equal(kindOf('application/pdf', 'rules.pdf'), 'files');
    assert.equal(withExtension('tenor', 'video/mp4'), 'tenor.mp4');
    assert.equal(withExtension('a.gif', 'video/mp4'), 'a.gif');
});

function fakeEmbed(data) {
    const media = (m) => (m ? { url: m.url, proxyURL: m.proxy_url } : null);
    return { data, image: media(data.image), thumbnail: media(data.thumbnail), video: media(data.video) };
}

test('embedMedia keeps GIFs, image links and direct videos, not link previews', () => {
    const gif = fakeEmbed({ type: 'gifv', thumbnail: { url: 't', proxy_url: 'pt' }, video: { url: 'v', proxy_url: 'pv' } });
    assert.deepEqual(embedMedia(gif).map((m) => m.field), ['video']);
    assert.deepEqual(embedMedia(fakeEmbed({ type: 'image', thumbnail: { url: 'i', proxy_url: 'pi' } })).map((m) => m.field), ['thumbnail']);
    assert.deepEqual(embedMedia(fakeEmbed({ type: 'video', thumbnail: { url: 't', proxy_url: 'pt' }, video: { url: 'yt-player' } })), []);
    assert.deepEqual(embedMedia(fakeEmbed({ type: 'video', video: { url: 'a.mp4', proxy_url: 'p.mp4' } })).length, 1);
    assert.deepEqual(embedMedia(fakeEmbed({ type: 'article', thumbnail: { url: 'og.png', proxy_url: 'p' } })), []);
    assert.deepEqual(embedMedia(fakeEmbed({ type: 'rich', image: { url: 'bot.png', proxy_url: 'p' } })).map((m) => m.field), ['image']);
    // Only Discord's proxy is ever contacted, never the site an embed points to
    assert.deepEqual(embedMedia(fakeEmbed({ type: 'image', thumbnail: { url: 'https://tracker.example/x.png' } })), []);
});

test('mediaJobs skips other files unless asked, and honors MEDIA_EXTENSIONS', () => {
    const attachments = new Map([
        ['1', { id: '1', name: 'a.png', contentType: 'image/png', url: 'u1' }],
        ['2', { id: '2', name: 'b.pdf', contentType: 'application/pdf', url: 'u2' }]
    ]);
    const message = { attachments, embeds: [] };
    assert.deepEqual(mediaJobs(message).map((j) => j.name), ['a.png']);
    assert.deepEqual(mediaJobs(message, { allFiles: true }).map((j) => j.name), ['a.png', 'b.pdf']);
    assert.deepEqual(mediaJobs(message, { extensions: new Set(['.pdf']) }).map((j) => j.name), ['b.pdf']);
    assert.equal(mediaJobs(message)[0].key, 'a:1');
});

test('the original commands map onto the new options', () => {
    const env = { GUILD_ID: '111111111111111111', CHANNEL_IDS: '222222222222222222' };
    const media = parseOptions([], env, PRESETS.media);
    assert.deepEqual([media.mediaOnly, media.dedupe, media.zip, media.channelIds], [true, 'server', true, []]);
    const text = parseOptions([], env, PRESETS.text('333333333333333333'));
    assert.deepEqual([text.textOnly, text.channelIds], [true, ['333333333333333333']]);
    const multi = parseOptions([], env, PRESETS.textMulti);
    assert.deepEqual([multi.textOnly, multi.channelIds], [true, ['222222222222222222']]);
    assert.equal(parseOptions(['--no-embeds'], env, PRESETS.media).embeds, false, 'flags still apply');
});

test('options: defaults, .env, preset and flags in rising priority', () => {
    const env = { GUILD_ID: '111111111111111111', CHANNEL_IDS: '222222222222222222', MEDIA_EXTENSIONS: 'mp4, .MOV' };
    const fromEnv = parseOptions([], env);
    assert.deepEqual(fromEnv.channelIds, ['222222222222222222']);
    assert.deepEqual([...fromEnv.extensions], ['.mp4', '.mov']);
    assert.equal(fromEnv.dedupe, 'channel');

    const preset = parseOptions([], env, { channelIds: [], zip: true });
    assert.deepEqual(preset.channelIds, []);
    assert.equal(preset.zip, true);

    const flags = parseOptions(['--channels', '333333333333333333', '--no-embeds', '--dedupe', 'none'], env, { channelIds: [] });
    assert.deepEqual(flags.channelIds, ['333333333333333333']);
    assert.equal(flags.embeds, false);
    assert.equal(flags.dedupe, 'none');

    assert.throws(() => parseOptions(['--text-only', '--media-only'], {}), /can't be used together/);
    assert.throws(() => parseOptions(['--dedupe', 'maybe'], {}), /channel, server or none/);
    assert.throws(() => parseOptions(['--channels', 'general'], {}), /long numbers/);
    assert.throws(() => parseOptions(['--bogus'], {}), /--help/);
});

test('HTML helpers escape everything and only link http(s)', () => {
    assert.equal(linkify('<b>hi</b> https://x.com/a?b=1&c=2.'),
        '&lt;b&gt;hi&lt;/b&gt; <a href="https://x.com/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">https://x.com/a?b=1&amp;c=2</a>.');
    assert.equal(linkify('javascript:alert(1)'), 'javascript:alert(1)');
    assert.equal(linkify('"https://x.com/"'), '&quot;<a href="https://x.com/" target="_blank" rel="noopener noreferrer">https://x.com/</a>&quot;');
    assert.equal(safeUrl('javascript:alert(1)'), null);
    assert.equal(safeUrl('https://ok.example'), 'https://ok.example');
    assert.equal(readableContent({ content: 'hi <@42> <:blob:99> <@!7>', mentions: [{ user_id: '42', username: 'bob' }] }), 'hi @bob :blob: <@!7>');
    assert.equal(encodePath('photos/a #1?.png'), 'photos/a%20%231%3F.png');
});

test('mapLimit keeps order and caps concurrency', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([30, 10, 20, 0], 2, async (ms, i) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, ms));
        running--;
        if (i === 3) throw new Error('boom');
        return i;
    });
    assert.deepEqual(results.slice(0, 3).map((r) => r.value), [0, 1, 2]);
    assert.equal(results[3].error.message, 'boom');
    assert.equal(peak, 2);
});

test('ID helpers compare snowflakes exactly', () => {
    assert.equal(compareIds('1191168914227200001', '1191168914227200002'), -1);
    assert.equal(compareIds('99', '100'), -1, 'numeric, not string, order');
    assert.equal(oldestCursor(['500', '20']), '20');
    assert.equal(oldestCursor(['500', null]), null, 'null means start from the beginning');
});
