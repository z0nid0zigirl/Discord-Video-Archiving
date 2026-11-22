// A small stand-in for Discord's REST API and gateway, so the archiver can be tested end to end
// with the real discord.js client and no network. It implements only what the archiver uses.

const http = require('http');
const { WebSocketServer } = require('ws');

const DISCORD_EPOCH = 1420070400000n;
const PERMISSIONS = { ViewChannel: 1n << 10n, SendMessages: 1n << 11n, ReadMessageHistory: 1n << 16n, ManageThreads: 1n << 34n };
const CHANNEL_TYPES = { text: 0, voice: 2, category: 4, announcement: 5, publicThread: 11, privateThread: 12, forum: 15 };

class FakeDiscord {
    constructor({ guildName = 'Test Server', everyonePermissions } = {}) {
        this.counter = 0n;
        this.clock = Date.parse('2024-01-01T00:00:00Z');
        this.guild = { id: this.snowflake(), name: guildName };
        this.bot = { id: this.snowflake(), username: 'archive-bot', global_name: null, discriminator: '0', avatar: null, bot: true };
        this.everyonePermissions = everyonePermissions
            ?? (PERMISSIONS.ViewChannel | PERMISSIONS.SendMessages | PERMISSIONS.ReadMessageHistory);
        this.channels = new Map();   // id → channel payload (threads included)
        this.messages = new Map();   // channel id → [message payloads]
        this.files = new Map();      // path → { body, contentType, failTimes, status }
        this.requests = [];          // every REST and file request, for assertions
        this.users = new Map();
        this.onRequest = null;     // optional hook, called with each request
    }

    // Snowflakes that increase with the fake clock, like Discord's
    snowflake(time = this.clock) {
        this.counter++;
        return String(((BigInt(time) - DISCORD_EPOCH) << 22n) | (this.counter & 0x3fffffn));
    }

    tick(ms = 60_000) {
        this.clock += ms;
        return this.clock;
    }

    user(username, globalName = null) {
        const user = { id: this.snowflake(), username, global_name: globalName, discriminator: '0', avatar: null };
        this.users.set(user.id, user);
        return user;
    }

    channel(name, { type = 'text', parent = null, deny = 0n, position = this.channels.size } = {}) {
        const channel = {
            id: this.snowflake(),
            type: CHANNEL_TYPES[type],
            guild_id: this.guild.id,
            name,
            position,
            parent_id: parent?.id ?? null,
            permission_overwrites: deny ? [{ id: this.guild.id, type: 0, allow: '0', deny: String(deny) }] : [],
            nsfw: false,
            rate_limit_per_user: 0,
            flags: 0
        };
        if (type === 'forum') Object.assign(channel, { available_tags: [], default_reaction_emoji: null, default_sort_order: null, default_forum_layout: 0 });
        this.channels.set(channel.id, channel);
        this.messages.set(channel.id, []);
        return channel;
    }

    // A thread; pass `from` to start it from an existing message (thread ID = message ID)
    thread(parent, name, { archived = false, from = null, type = 'publicThread' } = {}) {
        const id = from ? from.id : this.snowflake();
        if (from) from.flags |= 1 << 5; // HAS_THREAD
        const thread = {
            id,
            type: CHANNEL_TYPES[type],
            guild_id: this.guild.id,
            parent_id: parent.id,
            owner_id: this.bot.id,
            name,
            rate_limit_per_user: 0,
            message_count: 0,
            member_count: 1,
            flags: 0,
            total_message_sent: 0,
            thread_metadata: {
                archived,
                auto_archive_duration: 1440,
                archive_timestamp: new Date(this.clock).toISOString(),
                locked: false,
                create_timestamp: new Date(this.clock).toISOString()
            }
        };
        this.channels.set(id, thread);
        this.messages.set(id, []);
        return thread;
    }

    file(name, body, contentType, { failTimes = 0, status = 200, rateLimitTimes = 0 } = {}) {
        const filePath = `/files/${this.snowflake()}/${encodeURIComponent(name)}`;
        this.files.set(filePath, { body: Buffer.from(body), contentType, failTimes, status, rateLimitTimes });
        return { url: `${this.base}${filePath}`, path: filePath };
    }

    attachment(name, body, contentType, fileOptions) {
        const file = this.file(name, body, contentType, fileOptions);
        const attachment = { id: this.snowflake(), filename: name, size: Buffer.byteLength(body), url: file.url, proxy_url: file.url };
        if (contentType) attachment.content_type = contentType;
        return attachment;
    }

    message(channel, author, content = '', extra = {}) {
        this.tick();
        const message = {
            id: this.snowflake(),
            channel_id: channel.id,
            type: 0,
            content,
            author,
            timestamp: new Date(this.clock).toISOString(),
            edited_timestamp: null,
            tts: false,
            mention_everyone: false,
            mentions: [],
            mention_roles: [],
            attachments: [],
            embeds: [],
            pinned: false,
            flags: 0,
            ...extra
        };
        this.messages.get(channel.id).push(message);
        return message;
    }

    guildPayload() {
        const all = [...this.channels.values()];
        return {
            id: this.guild.id,
            name: this.guild.name,
            icon: null,
            owner_id: '1',
            afk_timeout: 300,
            verification_level: 0,
            default_message_notifications: 0,
            explicit_content_filter: 0,
            mfa_level: 0,
            nsfw_level: 0,
            premium_tier: 0,
            system_channel_flags: 0,
            preferred_locale: 'en-US',
            features: [],
            roles: [{
                id: this.guild.id, name: '@everyone', permissions: String(this.everyonePermissions),
                position: 0, color: 0, hoist: false, managed: false, mentionable: false, flags: 0
            }],
            emojis: [],
            stickers: [],
            members: [{ user: this.bot, roles: [], joined_at: new Date(0).toISOString(), deaf: false, mute: false, flags: 0 }],
            member_count: 2,
            large: false,
            unavailable: false,
            joined_at: new Date(0).toISOString(),
            channels: all.filter((c) => !c.thread_metadata),
            threads: all.filter((c) => c.thread_metadata && !c.thread_metadata.archived),
            presences: [],
            voice_states: [],
            stage_instances: [],
            guild_scheduled_events: [],
            premium_progress_bar_enabled: false
        };
    }

    canRead(channelId) {
        const channel = this.channels.get(channelId);
        const source = channel?.thread_metadata ? this.channels.get(channel.parent_id) : channel;
        if (!source) return false;
        let perms = this.everyonePermissions;
        for (const overwrite of source.permission_overwrites ?? []) {
            perms &= ~BigInt(overwrite.deny);
            perms |= BigInt(overwrite.allow);
        }
        return (perms & PERMISSIONS.ViewChannel) && (perms & PERMISSIONS.ReadMessageHistory);
    }

    // Discord's message paging: always newest first in the response
    pageMessages(channelId, query) {
        const all = [...this.messages.get(channelId)].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
        const limit = Math.min(Number(query.get('limit') ?? 50), 100);
        let page;
        if (query.has('after')) {
            const after = BigInt(query.get('after'));
            page = all.filter((m) => BigInt(m.id) > after).slice(0, limit);
        } else {
            const before = query.has('before') ? BigInt(query.get('before')) : null;
            page = all.filter((m) => before === null || BigInt(m.id) < before).slice(-limit);
        }
        return page.reverse();
    }

    route(method, pathname, query) {
        const api = pathname.replace(/^\/api\/v\d+/, '');
        let match;
        if (api === '/gateway/bot') {
            return [200, { url: this.base.replace('http', 'ws'), shards: 1, session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 } }];
        }
        if (api === '/users/@me') return [200, this.bot];
        if ((match = api.match(/^\/guilds\/(\d+)\/channels$/))) {
            return [200, [...this.channels.values()].filter((c) => !c.thread_metadata)];
        }
        if ((match = api.match(/^\/guilds\/(\d+)\/members\/@me$/))) return [200, this.guildPayload().members[0]];
        if ((match = api.match(/^\/guilds\/(\d+)\/threads\/active$/))) {
            const threads = [...this.channels.values()].filter((c) => c.thread_metadata && !c.thread_metadata.archived && this.canRead(c.id));
            return [200, { threads, members: [] }];
        }
        if ((match = api.match(/^\/channels\/(\d+)\/threads\/archived\/(public|private)$/))) {
            const [, parentId, kind] = match;
            if (!this.canRead(parentId)) return [403, { message: 'Missing Access', code: 50001 }];
            const wantedType = kind === 'public' ? CHANNEL_TYPES.publicThread : CHANNEL_TYPES.privateThread;
            const before = query.has('before') ? Date.parse(query.get('before')) : Infinity;
            const limit = Number(query.get('limit') ?? 50);
            const matching = [...this.channels.values()]
                .filter((c) => c.parent_id === parentId && c.thread_metadata?.archived && c.type === wantedType)
                .filter((c) => Date.parse(c.thread_metadata.archive_timestamp) < before)
                .sort((a, b) => Date.parse(b.thread_metadata.archive_timestamp) - Date.parse(a.thread_metadata.archive_timestamp));
            return [200, { threads: matching.slice(0, limit), members: [], has_more: matching.length > limit }];
        }
        if ((match = api.match(/^\/channels\/(\d+)\/messages\/(\d+)$/))) {
            const [, channelId, messageId] = match;
            if (!this.canRead(channelId)) return [403, { message: 'Missing Access', code: 50001 }];
            const message = this.messages.get(channelId)?.find((m) => m.id === messageId);
            return message ? [200, message] : [404, { message: 'Unknown Message', code: 10008 }];
        }
        if ((match = api.match(/^\/channels\/(\d+)\/messages$/))) {
            const [, channelId] = match;
            if (!this.channels.has(channelId)) return [404, { message: 'Unknown Channel', code: 10003 }];
            if (!this.canRead(channelId)) return [403, { message: 'Missing Access', code: 50001 }];
            return [200, this.pageMessages(channelId, query)];
        }
        if ((match = api.match(/^\/channels\/(\d+)$/))) {
            const channel = this.channels.get(match[1]);
            return channel ? [200, channel] : [404, { message: 'Unknown Channel', code: 10003 }];
        }
        return [404, { message: `Fake Discord has no route for ${method} ${api}`, code: 0 }];
    }

    handle(req, res) {
        const url = new URL(req.url, this.base);
        const request = { method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams) };
        this.requests.push(request);
        this.onRequest?.(request);

        const file = this.files.get(url.pathname);
        if (file) {
            if (file.rateLimitTimes > 0) {
                file.rateLimitTimes--;
                res.writeHead(429, { 'retry-after': '0', 'content-type': 'text/plain' }).end('slow down');
                return;
            }
            if (file.failTimes > 0) {
                file.failTimes--;
                res.writeHead(500, { 'content-type': 'text/plain' }).end('oops');
                return;
            }
            if (file.status !== 200) {
                res.writeHead(file.status, { 'content-type': 'text/plain' }).end('gone');
                return;
            }
            const headers = { 'content-length': file.body.length };
            if (file.contentType) headers['content-type'] = file.contentType;
            res.writeHead(200, headers).end(file.body);
            return;
        }

        const [status, body] = this.route(req.method, url.pathname, url.searchParams);
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    }

    // Just enough gateway for discord.js to log in: HELLO → IDENTIFY → READY + GUILD_CREATE
    handleSocket(socket) {
        let sequence = 0;
        const send = (payload) => socket.send(JSON.stringify(payload));
        const dispatch = (t, d) => send({ op: 0, t, s: ++sequence, d });
        send({ op: 10, d: { heartbeat_interval: 41_250 } });
        socket.on('message', (raw) => {
            const payload = JSON.parse(raw);
            if (payload.op === 1) send({ op: 11 });
            if (payload.op === 2) {
                dispatch('READY', {
                    v: 10,
                    user: this.bot,
                    guilds: [{ id: this.guild.id, unavailable: true }],
                    session_id: 'fake-session',
                    resume_gateway_url: this.base.replace('http', 'ws'),
                    shard: [0, 1],
                    application: { id: this.bot.id, flags: 0 }
                });
                dispatch('GUILD_CREATE', this.guildPayload());
            }
        });
    }

    async start() {
        this.server = http.createServer((req, res) => this.handle(req, res));
        this.wss = new WebSocketServer({ server: this.server });
        this.wss.on('connection', (socket) => this.handleSocket(socket));
        await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
        this.base = `http://127.0.0.1:${this.server.address().port}`;
        return this;
    }

    async stop() {
        for (const client of this.wss.clients) client.terminate();
        this.wss.close();
        await new Promise((resolve) => this.server.close(resolve));
    }
}

module.exports = { FakeDiscord, PERMISSIONS };
