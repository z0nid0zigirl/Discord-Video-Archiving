const { escapeHtml: esc, encodePath, formatBytes } = require('./utils');
const { KINDS, countLabel } = require('./media');

// Photo formats browsers can't show inline; linked instead
const NOT_INLINE = /\.(heic|heif|tiff?)$/i;

const STYLES = `
    :root { color-scheme: dark; }
    body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        max-width: 1100px; margin: 0 auto; padding: 20px;
        background-color: #36393f; color: #dcddde;
    }
    a { color: #00aff4; }
    .header { background-color: #2f3136; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    .header h1 { margin: 0 0 6px 0; color: #ffffff; word-break: break-word; }
    .crumbs { color: #b9bbbe; font-size: 14px; margin-bottom: 8px; }
    .stats { color: #b9bbbe; font-size: 14px; display: flex; flex-wrap: wrap; gap: 4px 16px; }
    .search-box { margin: 0 0 20px; }
    .search-box input {
        width: 100%; box-sizing: border-box; padding: 10px; background-color: #202225;
        border: 1px solid #202225; border-radius: 4px; color: #dcddde; font-size: 14px;
    }
    .search-box input:focus { outline: none; border-color: #7289da; }
    .threads { background-color: #2f3136; padding: 12px 20px; border-radius: 8px; margin-bottom: 20px; }
    .threads ul { margin: 6px 0 0; padding-left: 20px; }
    .msg {
        background-color: #2f3136; padding: 12px 15px; margin-bottom: 8px;
        border-radius: 8px; border-left: 3px solid #7289da;
    }
    .msg.system { border-left-color: #4f545c; color: #96989d; font-style: italic; }
    .msg:target { outline: 2px solid #faa61a; }
    .meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; margin-bottom: 6px; }
    .name { font-weight: bold; color: #ffffff; }
    .handle, .time, .edited { color: #72767d; font-size: 12px; }
    .time { text-decoration: none; }
    .uid { color: #72767d; font-size: 11px; font-family: ui-monospace, Menlo, Consolas, monospace; }
    .bot { background-color: #5865f2; color: white; padding: 1px 5px; border-radius: 3px; font-size: 10px; text-transform: uppercase; }
    .reply { color: #b9bbbe; font-size: 13px; margin-bottom: 4px; }
    .content { line-height: 1.45; white-space: pre-wrap; word-wrap: break-word; }
    .media { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .media img, .media video { max-width: min(100%, 420px); max-height: 360px; border-radius: 4px; background: #202225; }
    .media audio { width: min(100%, 420px); }
    .file { display: block; padding: 8px 10px; background-color: #202225; border-radius: 4px; text-decoration: none; }
    .missing { color: #b9bbbe; }
    .embed { margin-top: 8px; padding: 8px 12px; border-left: 4px solid #4f545c; background: #2b2d31; border-radius: 4px; }
    .embed-title { font-weight: bold; color: #ffffff; }
    .forwarded { margin-top: 6px; padding: 6px 12px; border-left: 3px solid #4f545c; }
    .embed-description { font-size: 14px; white-space: pre-wrap; }
    .stickers, .thread-link { margin-top: 6px; font-size: 13px; }
    .reactions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 5px; }
    .reaction { background-color: #202225; padding: 3px 8px; border-radius: 4px; font-size: 12px; color: #b9bbbe; }
    .empty { color: #96989d; }
`;

function page(title, body, script = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <style>${STYLES}${body.styles ?? ''}</style>
</head>
<body>
${body.html}
${script}
</body>
</html>
`;
}

// Only http(s) links are ever put in an href; a bot's embed could carry javascript: or file: URLs
function safeUrl(url) {
    return /^https?:\/\//i.test(String(url ?? '')) ? String(url) : null;
}

// Turns links into <a> tags; everything else is escaped. Only http(s) links are linked.
function linkify(text) {
    return text.split(/(https?:\/\/[^\s<>"]+)/g).map((part, index) => {
        if (index % 2 === 0) return esc(part);
        const [, url, trailing] = part.match(/^(.*?)([.,!?:;)\]]*)$/);
        return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>${esc(trailing)}`;
    }).join('');
}

// <@123> → @name, <#123> → #channel, <@&123> → @role, <:emoji:123> → :emoji:, so the text reads like it does in Discord
function readableContent(message, { channels = new Map(), roles = new Map() } = {}) {
    const users = new Map((message.mentions ?? []).map((m) => [m.user_id, m.username]));
    return message.content
        .replace(/<@!?(\d+)>/g, (match, id) => (users.has(id) ? `@${users.get(id)}` : match))
        .replace(/<@&(\d+)>/g, (match, id) => (roles.has(id) ? `@${roles.get(id)}` : match))
        .replace(/<#(\d+)>/g, (match, id) => (channels.has(id) ? `#${channels.get(id)}` : match))
        .replace(/<a?:(\w+):\d+>/g, ':$1:');
}

function mediaTag(kind, href, label) {
    if (kind === 'photos' && !NOT_INLINE.test(href)) return `<a href="${href}" target="_blank"><img src="${href}" alt="${esc(label)}" loading="lazy"></a>`;
    if (kind === 'photos') return `<a class="file" href="${href}" target="_blank">🖼️ ${esc(label)}</a>`;
    if (kind === 'videos') return `<video src="${href}" controls preload="metadata" title="${esc(label)}"></video>`;
    if (kind === 'audio') return `<audio src="${href}" controls preload="none" title="${esc(label)}"></audio>`;
    return `<a class="file" href="${href}" target="_blank">📎 ${esc(label)}</a>`;
}

// Attachments and embeds of a message (or a forwarded copy, whose file keys carry `prefix`)
function renderMedia(message, prefix, localFile, messageId = message.message_id) {
    const media = message.attachments.map((attachment) => {
        const file = localFile(messageId, `${prefix}a:${attachment.id}`);
        return file
            ? mediaTag(file.kind, file.href, attachment.name)
            : `<a class="file missing"${safeUrl(attachment.url) ? ` href="${esc(attachment.url)}"` : ''} target="_blank" rel="noopener noreferrer">📎 ${esc(attachment.name)} (${formatBytes(attachment.size)}, not downloaded; Discord links expire)</a>`;
    });

    const embeds = message.embeds.map((embed, index) => {
        const saved = ['video', 'image', 'thumbnail']
            .map((field) => localFile(messageId, `${prefix}e:${index}:${field}`))
            .filter(Boolean)
            .map((file) => mediaTag(file.kind, file.href, embed.title || 'embed'));
        const text = embed.title || embed.description
            ? `${embed.title ? `<div class="embed-title">${safeUrl(embed.url) ? `<a href="${esc(embed.url)}" target="_blank" rel="noopener noreferrer">${esc(embed.title)}</a>` : esc(embed.title)}</div>` : ''}
               ${embed.description ? `<div class="embed-description">${esc(embed.description)}</div>` : ''}`
            : '';
        if (!text && !saved.length) return '';
        return `<div class="embed">${text}${saved.length ? `<div class="media">${saved.join('')}</div>` : ''}</div>`;
    }).join('');

    return { media, embeds };
}

function renderMessage(message, { localFile, threadLink, byId, names }) {
    const name = message.display_name || message.username;
    const search = `${message.username} ${message.display_name ?? ''} ${message.user_id} ${message.content}`.toLowerCase();

    let reply = '';
    if (message.reference?.message_id) {
        const target = byId.get(message.reference.message_id);
        reply = target
            ? `<div class="reply">↪ replying to <a href="#m${esc(target.message_id)}">@${esc(target.username)}</a>: ${esc(target.content.slice(0, 120))}</div>`
            : `<div class="reply">↪ reply to a message not in this archive</div>`;
    }

    const { media, embeds } = renderMedia(message, '', localFile);
    const forwarded = (message.forwarded ?? []).map((snapshot, index) => {
        const parts = renderMedia(snapshot, `f:${index}:`, localFile, message.message_id);
        return `
        <div class="forwarded">
            <div class="handle">↪ Forwarded</div>
            ${snapshot.content ? `<div class="content">${linkify(readableContent(snapshot, names))}</div>` : ''}
            ${parts.media.length ? `<div class="media">${parts.media.join('')}</div>` : ''}${parts.embeds}
        </div>`;
    }).join('');

    const stickers = message.stickers?.length
        ? `<div class="stickers">Sticker: ${message.stickers.map((s) => esc(s.name)).join(', ')}</div>` : '';
    const reactions = message.reactions.length
        ? `<div class="reactions">${message.reactions.map((r) => `<span class="reaction">${esc(r.emoji)} ${r.count}</span>`).join('')}</div>` : '';
    const thread = message.thread_id && threadLink(message.thread_id);
    const threadHtml = thread ? `<div class="thread-link">🧵 <a href="${thread.href}">${esc(thread.name)}</a></div>` : '';

    const content = message.content
        ? `<div class="content">${linkify(readableContent(message, names))}</div>`
        : (message.system ? `<div class="content">${esc(message.type)}</div>` : '');

    return `
    <article class="msg${message.system ? ' system' : ''}" id="m${esc(message.message_id)}" data-search="${esc(search)}">
        <div class="meta">
            <span class="name">${esc(name)}</span>
            ${message.display_name ? `<span class="handle">@${esc(message.username)}</span>` : ''}
            ${message.is_bot ? '<span class="bot">Bot</span>' : ''}
            <span class="uid" title="User ID">${esc(message.user_id)}</span>
            <a class="time" href="#m${esc(message.message_id)}" title="${esc(message.timestamp_iso)}">${esc(message.timestamp)}</a>
            ${message.edited_timestamp_iso ? `<span class="edited" title="${esc(message.edited_timestamp_iso)}">(edited)</span>` : ''}
        </div>
        ${reply}${content}
        ${media.length ? `<div class="media">${media.join('')}</div>` : ''}
        ${embeds}${forwarded}${stickers}${threadHtml}${reactions}
    </article>`;
}

function statsLine(stats) {
    const parts = [countLabel(stats.messages, 'messages')];
    for (const kind of KINDS) if (stats[kind]) parts.push(countLabel(stats[kind], kind));
    return parts.map((p) => `<span>${esc(p)}</span>`).join('');
}

const SEARCH_SCRIPT = `<script>
    document.getElementById('search').addEventListener('input', (event) => {
        const query = event.target.value.toLowerCase();
        document.querySelectorAll('.msg').forEach((el) => {
            el.style.display = el.dataset.search.includes(query) ? '' : 'none';
        });
    });
</script>`;

// messages.html for one channel or thread
function channelPage({ title, crumbs, indexHref, messages, stats, threads, localFile, threadLink, archivedAt, names, isForum }) {
    const byId = new Map(messages.map((m) => [m.message_id, m]));
    const body = messages.length
        ? messages.map((m) => renderMessage(m, { localFile, threadLink, byId, names })).join('')
        : (isForum ? '' : '<p class="empty">No messages.</p>');
    const threadList = threads.length ? `
    <nav class="threads">
        <strong>${isForum ? 'Posts' : 'Threads'} (${threads.length})</strong>
        <ul>${threads.map((t) => `<li><a href="${t.href}">${esc(t.name)}</a></li>`).join('')}</ul>
    </nav>` : '';

    return page(title, {
        html: `
    <header class="header">
        <div class="crumbs"><a href="${indexHref}">${esc(crumbs[0])}</a>${crumbs.slice(1).map((c) => ` › ${esc(c)}`).join('')}</div>
        <h1>${esc(title)}</h1>
        <div class="stats">${isForum ? '' : statsLine(stats)}<span>Archived ${esc(archivedAt)}</span></div>
    </header>
    ${threadList}
    <div class="search-box"><input type="search" id="search" placeholder="Search by name, user ID or text..."></div>
    <main id="messages">${body}
    </main>`
    }, SEARCH_SCRIPT);
}

const INDEX_STYLES = `
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 0 0 20px; }
    .stat-box { background-color: #2f3136; padding: 14px; border-radius: 8px; text-align: center; }
    .stat-number { font-size: 26px; font-weight: bold; color: #7289da; }
    .stat-label { color: #b9bbbe; font-size: 13px; margin-top: 4px; }
    .category { background-color: #2f3136; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; }
    .category h2 { margin: 0 0 10px; color: #ffffff; font-size: 15px; text-transform: uppercase; letter-spacing: .04em; }
    .channel { background-color: #202225; padding: 12px 14px; margin-bottom: 8px; border-radius: 6px; }
    .channel-name { font-weight: bold; color: #ffffff; }
    .channel-stats { color: #b9bbbe; font-size: 13px; margin: 4px 0; }
    .links { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 13px; }
    details { margin-top: 6px; font-size: 13px; }
    details ul { margin: 6px 0 0; padding-left: 18px; }
    details li { margin-bottom: 4px; }
    .skipped li { color: #b9bbbe; }
`;

function countsText(stats, { skipEmptyMessages = false } = {}) {
    const parts = skipEmptyMessages && !stats.messages ? [] : [countLabel(stats.messages, 'messages')];
    for (const kind of KINDS) if (stats[kind]) parts.push(countLabel(stats[kind], kind));
    return parts.join(' · ');
}

const isForumType = (type) => type === 'forum' || type === 'media';

function entryLinks(entry) {
    const links = [];
    if (entry.files.html) links.push(`<a href="${encodePath(entry.files.html)}">View</a>`);
    if (entry.files.json) links.push(`<a href="${encodePath(entry.files.json)}">JSON</a>`);
    if (entry.files.txt) links.push(`<a href="${encodePath(entry.files.txt)}">TXT</a>`);
    for (const kind of KINDS) {
        if (entry.stats[kind]) links.push(`<a href="${encodePath(`${entry.folder}/${kind}`)}/">${kind}/</a>`);
    }
    return links.join('');
}

// index.html for the whole server
function indexPage({ serverName, totals, categories, skipped, archivedAt }) {
    const boxes = [
        ['Channels', totals.channels], ['Threads', totals.threads], ['Messages', totals.messages],
        ...KINDS.filter((k) => totals[k]).map((k) => [k[0].toUpperCase() + k.slice(1), totals[k]]),
        ['Users', totals.users]
    ];

    const sections = categories.map((category) => `
    <section class="category">
        <h2>${esc(category.name)}</h2>
        ${category.channels.map((channel) => `
        <div class="channel">
            <div class="channel-name">${isForumType(channel.type) ? '💬' : '#'} ${esc(channel.name)}</div>
            <div class="channel-stats">${esc(countsText(channel.stats, { skipEmptyMessages: isForumType(channel.type) }))}</div>
            <div class="links">${entryLinks(channel)}</div>
            ${channel.threads.length ? `
            <details>
                <summary>${countLabel(channel.threads.length, isForumType(channel.type) ? 'posts' : 'threads')}</summary>
                <ul>${channel.threads.map((thread) => `
                    <li>🧵 ${thread.files.html ? `<a href="${encodePath(thread.files.html)}">${esc(thread.name)}</a>` : esc(thread.name)}
                        <span class="channel-stats">· ${esc(countsText(thread.stats))}</span></li>`).join('')}
                </ul>
            </details>` : ''}
        </div>`).join('')}
    </section>`).join('');

    const skippedHtml = skipped.length ? `
    <section class="category skipped">
        <h2>Not archived</h2>
        <ul>${skipped.map((s) => `<li>#${esc(s.name)}${s.category ? ` (${esc(s.category)})` : ''}: ${esc(s.reason)}</li>`).join('')}</ul>
    </section>` : '';

    return page(`${serverName} archive`, {
        styles: INDEX_STYLES,
        html: `
    <header class="header">
        <h1>${esc(serverName)}</h1>
        <div class="stats"><span>Archived ${esc(archivedAt)}</span><a href="users.json">users.json</a><a href="server.json">server.json</a></div>
    </header>
    <div class="summary">${boxes.map(([label, value]) => `
        <div class="stat-box"><div class="stat-number">${Number(value).toLocaleString()}</div><div class="stat-label">${esc(label)}</div></div>`).join('')}
    </div>
    ${sections || '<p class="empty">Nothing archived yet.</p>'}
    ${skippedHtml}`
    });
}

module.exports = { channelPage, indexPage, linkify, readableContent, safeUrl };
