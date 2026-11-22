const fs = require('fs');
const path = require('path');
const { displayDate, fetchAllMessages } = require('./utils');
const { channelPage } = require('./html');

function serializeMessage(message) {
    return {
        message_id: message.id,
        username: message.author.username,
        user_id: message.author.id,
        is_bot: message.author.bot,
        timestamp: displayDate(message.createdAt),
        timestamp_iso: message.createdAt.toISOString(),
        content: message.content || '',
        attachments: message.attachments.map((att) => ({
            name: att.name,
            url: att.url,
            size: att.size,
            content_type: att.contentType
        })),
        embeds: message.embeds.map((embed) => ({
            title: embed.title,
            description: embed.description,
            url: embed.url,
            color: embed.color
        })),
        reactions: message.reactions.cache.map((reaction) => ({
            emoji: reaction.emoji.name || reaction.emoji.toString(),
            count: reaction.count
        })),
        reference: message.reference ? {
            message_id: message.reference.messageId,
            channel_id: message.reference.channelId
        } : null
    };
}

// Fetches a channel's full history and returns it oldest-first
async function collectMessages(channel, { onProgress } = {}) {
    const messages = [];
    for await (const batch of fetchAllMessages(channel)) {
        for (const message of batch.values()) {
            messages.push(serializeMessage(message));
        }
        if (onProgress) onProgress(messages.length);
    }
    return messages.reverse();
}

function toPlainText(messages) {
    return messages.map((msg) => {
        let text = `[${msg.timestamp}] ${msg.username}${msg.is_bot ? ' [BOT]' : ''}: ${msg.content || '(no text)'}`;
        if (msg.attachments.length) {
            text += `\n  Attachments: ${msg.attachments.map((a) => a.name).join(', ')}`;
        }
        if (msg.reactions.length) {
            text += `\n  Reactions: ${msg.reactions.map((r) => `${r.emoji} (${r.count})`).join(', ')}`;
        }
        return text;
    }).join('\n\n');
}

// Writes <baseName>.json / .html / .txt into outDir and returns stats for the index
function writeChannelArchive(channel, messages, outDir, baseName, htmlOptions = {}) {
    const files = {
        json: `${baseName}.json`,
        html: `${baseName}.html`,
        txt: `${baseName}.txt`
    };

    const jsonData = {
        channel_name: channel.name,
        channel_id: channel.id,
        server_name: channel.guild?.name,
        archive_date: new Date().toISOString(),
        message_count: messages.length,
        messages
    };

    fs.writeFileSync(path.join(outDir, files.json), JSON.stringify(jsonData, null, 2));
    fs.writeFileSync(path.join(outDir, files.html), channelPage(channel.name, messages, htmlOptions));
    fs.writeFileSync(path.join(outDir, files.txt), toPlainText(messages));

    return {
        channel_name: channel.name,
        channel_id: channel.id,
        message_count: messages.length,
        unique_users: new Set(messages.map((m) => m.user_id)).size,
        files
    };
}

module.exports = { collectMessages, writeChannelArchive };
