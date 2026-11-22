const { MessageType } = require('discord.js');
const { displayDate } = require('./utils');
const { kindOf } = require('./media');

const serializeAttachment = (attachment) => ({
    id: attachment.id,
    name: attachment.name,
    url: attachment.url,
    size: attachment.size,
    content_type: attachment.contentType ?? null,
    kind: kindOf(attachment.contentType, attachment.name),
    width: attachment.width ?? null,
    height: attachment.height ?? null
});

const serializeEmbed = (embed) => ({
    type: embed.data?.type ?? null,
    title: embed.title,
    description: embed.description,
    url: embed.url,
    color: embed.color,
    provider: embed.provider?.name ?? null,
    image_url: embed.image?.url ?? null,
    thumbnail_url: embed.thumbnail?.url ?? null,
    video_url: embed.video?.url ?? null
});

// One message as a plain record. Field names from the original archiver are kept,
// so existing scripts that read messages.json keep working.
function serializeMessage(message) {
    return {
        message_id: message.id,
        user_id: message.author.id,
        username: message.author.username,
        display_name: message.author.globalName ?? null,
        is_bot: message.author.bot,
        webhook_id: message.webhookId ?? null,
        timestamp: displayDate(message.createdAt),
        timestamp_iso: message.createdAt.toISOString(),
        edited_timestamp_iso: message.editedAt ? message.editedAt.toISOString() : null,
        type: MessageType[message.type] ?? String(message.type),
        system: message.system,
        pinned: message.pinned,
        content: message.content || '',
        mentions: message.mentions.users.map((user) => ({ user_id: user.id, username: user.username })),
        attachments: message.attachments.map(serializeAttachment),
        embeds: message.embeds.map(serializeEmbed),
        stickers: message.stickers.map((sticker) => ({ id: sticker.id, name: sticker.name })),
        reactions: message.reactions.cache.map((reaction) => ({
            emoji: reaction.emoji.name || reaction.emoji.toString(),
            count: reaction.count
        })),
        reference: message.reference ? {
            message_id: message.reference.messageId ?? null,
            channel_id: message.reference.channelId ?? null
        } : null,
        // Forwarded messages: Discord copies their content, attachments and embeds into the forward
        forwarded: [...(message.messageSnapshots?.values() ?? [])].map((snapshot) => ({
            content: snapshot.content || '',
            timestamp_iso: snapshot.createdTimestamp ? new Date(snapshot.createdTimestamp).toISOString() : null,
            attachments: snapshot.attachments.map(serializeAttachment),
            embeds: snapshot.embeds.map(serializeEmbed)
        })),
        // A thread started from this message has the message's ID
        thread_id: message.hasThread ? message.id : null
    };
}

module.exports = { serializeMessage };
