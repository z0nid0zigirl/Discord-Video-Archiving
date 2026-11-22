const { escapeHtml: esc } = require('./utils');

const BASE_STYLES = `
    body {
        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        max-width: 1200px;
        margin: 0 auto;
        padding: 20px;
        background-color: #36393f;
        color: #dcddde;
    }
    a { color: #00aff4; }
    .header {
        background-color: #2f3136;
        padding: 20px;
        border-radius: 8px;
        margin-bottom: 20px;
    }
    .header h1 { margin: 0 0 10px 0; color: #ffffff; }
    .stats { color: #b9bbbe; font-size: 14px; }
`;

function channelPage(channelName, messages, { backLink } = {}) {
    const messageHtml = messages.map((msg) => {
        const searchText = `${msg.username} ${msg.content}`.toLowerCase();

        const attachments = msg.attachments.length ? `
            <div class="attachments">
                <strong>Attachments:</strong>
                ${msg.attachments.map((att) => `<a href="${esc(att.url)}" class="attachment" target="_blank" rel="noopener">📎 ${esc(att.name)} (${(att.size / 1024).toFixed(2)} KB)</a>`).join('')}
            </div>` : '';

        const embeds = msg.embeds.length ? `
            <div class="embeds">
                ${msg.embeds.map((embed) => `
                <div class="embed-title">${esc(embed.title || 'Embed')}</div>
                <div class="embed-description">${esc(embed.description || '')}</div>`).join('')}
            </div>` : '';

        const reactions = msg.reactions.length ? `
            <div class="reactions">
                ${msg.reactions.map((r) => `<span class="reaction">${esc(r.emoji)} ${r.count}</span>`).join('')}
            </div>` : '';

        return `
        <div class="message" data-search="${esc(searchText)}">
            <div class="message-header">
                <span class="username">${esc(msg.username)}</span>
                ${msg.is_bot ? '<span class="bot-tag">Bot</span>' : ''}
                <span class="timestamp">${esc(msg.timestamp)}</span>
            </div>
            <div class="message-content">${msg.content ? esc(msg.content) : '<em>No text content</em>'}</div>
            ${attachments}${embeds}${reactions}
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>#${esc(channelName)} - Message Archive</title>
    <style>
        ${BASE_STYLES}
        .message {
            background-color: #2f3136;
            padding: 15px;
            margin-bottom: 10px;
            border-radius: 8px;
            border-left: 3px solid #7289da;
        }
        .message-header { display: flex; align-items: center; margin-bottom: 8px; }
        .username { font-weight: bold; color: #ffffff; margin-right: 10px; }
        .timestamp { color: #72767d; font-size: 12px; }
        .message-content { line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; }
        .attachments { margin-top: 10px; padding: 10px; background-color: #202225; border-radius: 4px; }
        .attachment { text-decoration: none; display: block; margin: 5px 0; }
        .attachment:hover { text-decoration: underline; }
        .reactions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 5px; }
        .reaction { background-color: #202225; padding: 4px 8px; border-radius: 4px; font-size: 12px; color: #b9bbbe; }
        .embeds { margin-top: 10px; padding: 10px; border-left: 4px solid #7289da; }
        .embed-title { font-weight: bold; color: #ffffff; margin-bottom: 5px; }
        .embed-description { font-size: 14px; white-space: pre-wrap; }
        .bot-tag {
            background-color: #5865f2; color: white; padding: 2px 6px; border-radius: 3px;
            font-size: 10px; margin-right: 8px; text-transform: uppercase;
        }
        .search-box { margin: 20px 0; padding: 10px; background-color: #2f3136; border-radius: 8px; }
        .search-box input {
            width: 100%; box-sizing: border-box; padding: 10px; background-color: #202225;
            border: 1px solid #202225; border-radius: 4px; color: #dcddde; font-size: 14px;
        }
        .search-box input:focus { outline: none; border-color: #7289da; }
    </style>
</head>
<body>
    <div class="header">
        ${backLink ? `<p><a href="${esc(backLink)}">← All channels</a></p>` : ''}
        <h1>#${esc(channelName)}</h1>
        <div class="stats">
            <p>Total Messages: ${messages.length.toLocaleString()}</p>
            <p>Archive Date: ${esc(new Date().toLocaleString())}</p>
        </div>
    </div>

    <div class="search-box">
        <input type="text" id="searchInput" placeholder="Search messages..." oninput="searchMessages()">
    </div>

    <div id="messages">${messageHtml}
    </div>

    <script>
        function searchMessages() {
            const query = document.getElementById('searchInput').value.toLowerCase();
            document.querySelectorAll('.message').forEach((msg) => {
                msg.style.display = msg.getAttribute('data-search').includes(query) ? 'block' : 'none';
            });
        }
    </script>
</body>
</html>`;
}

function indexPage(serverName, channelStats) {
    const totalMessages = channelStats.reduce((sum, ch) => sum + ch.message_count, 0);

    const channelHtml = channelStats.map((ch) => `
        <div class="channel-item">
            <div class="channel-name">#${esc(ch.channel_name)}</div>
            <div class="channel-stats">📊 ${ch.message_count.toLocaleString()} messages · 👥 ${ch.unique_users} users</div>
            <div class="file-links">
                <a href="${esc(ch.files.html)}" class="file-link">📄 View HTML</a>
                <a href="${esc(ch.files.json)}" class="file-link">📊 JSON</a>
                <a href="${esc(ch.files.txt)}" class="file-link">📝 TXT</a>
            </div>
        </div>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(serverName)} - Archive Index</title>
    <style>
        ${BASE_STYLES}
        .header { text-align: center; padding: 30px; }
        .header h1 { font-size: 32px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 20px 0; }
        .stat-box { background-color: #202225; padding: 15px; border-radius: 8px; text-align: center; }
        .stat-number { font-size: 28px; font-weight: bold; color: #7289da; }
        .stat-label { color: #b9bbbe; font-size: 14px; margin-top: 5px; }
        .channel-list { background-color: #2f3136; padding: 20px; border-radius: 8px; }
        .channel-item {
            background-color: #202225; padding: 15px; margin-bottom: 10px;
            border-radius: 8px; border-left: 3px solid #7289da;
        }
        .channel-name { font-size: 18px; font-weight: bold; color: #ffffff; margin-bottom: 10px; }
        .channel-stats { color: #b9bbbe; font-size: 14px; margin-bottom: 10px; }
        .file-links { display: flex; gap: 10px; flex-wrap: wrap; }
        .file-link {
            background-color: #5865f2; color: white; padding: 8px 15px; border-radius: 4px;
            text-decoration: none; font-size: 14px;
        }
        .file-link:hover { background-color: #4752c4; }
    </style>
</head>
<body>
    <div class="header">
        <h1>📚 ${esc(serverName)}</h1>
        <p class="stats">Message Archive Index · Generated ${esc(new Date().toLocaleString())}</p>
    </div>

    <div class="summary">
        <div class="stat-box">
            <div class="stat-number">${channelStats.length}</div>
            <div class="stat-label">Channels Archived</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${totalMessages.toLocaleString()}</div>
            <div class="stat-label">Total Messages</div>
        </div>
    </div>

    <div class="channel-list">
        <h2 style="color: #ffffff; margin-top: 0;">Archived Channels</h2>${channelHtml}
    </div>
</body>
</html>`;
}

module.exports = { channelPage, indexPage };
