const path = require('path');

// Folder names, in the order they're reported
const KINDS = ['photos', 'videos', 'audio', 'files'];

// Used when Discord doesn't report a file type
const EXTENSIONS = {
    photos: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tif', '.tiff', '.heic', '.heif', '.avif', '.svg', '.jfif'],
    videos: ['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.3gp', '.ogv'],
    audio: ['.mp3', '.wav', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.flac', '.wma', '.aif', '.aiff']
};
const EXTENSION_KIND = new Map(
    Object.entries(EXTENSIONS).flatMap(([kind, exts]) => exts.map((ext) => [ext, kind]))
);

// For files that arrive without an extension (common for embedded media)
const MIME_EXTENSIONS = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/mp4': '.m4a'
};

const KIND_LABELS = { photos: ['photo', 'photos'], videos: ['video', 'videos'], audio: ['audio file', 'audio files'], files: ['file', 'files'] };

// "1 photo", "3 videos", "1,204 messages"
function countLabel(count, kind) {
    const [one, many] = KIND_LABELS[kind] ?? [kind.replace(/s$/, ''), kind];
    return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

function mimeType(contentType) {
    return String(contentType || '').split(';')[0].trim().toLowerCase();
}

// photos / videos / audio / files, from the file type Discord reports, falling back to the extension
function kindOf(contentType, fileName) {
    const type = mimeType(contentType);
    if (type.startsWith('image/')) return 'photos';
    if (type.startsWith('video/')) return 'videos';
    if (type.startsWith('audio/')) return 'audio';
    return EXTENSION_KIND.get(path.extname(fileName || '').toLowerCase()) ?? 'files';
}

function isMediaType(contentType) {
    return /^(image|video|audio)\//.test(mimeType(contentType));
}

function nameFromUrl(url) {
    try {
        const base = path.posix.basename(new URL(url).pathname);
        return decodeURIComponent(base) || 'file';
    } catch {
        return 'file';
    }
}

function withExtension(fileName, contentType) {
    if (path.extname(fileName)) return fileName;
    return fileName + (MIME_EXTENSIONS[mimeType(contentType)] ?? '');
}

// Media inside an embed worth keeping: GIFs (Tenor, Giphy), image links, direct video links
// and images in bot or social embeds. Link previews of web pages (article thumbnails,
// YouTube) are skipped; they're pictures of the link, not something someone posted.
// Only Discord's own cached copy (the proxy URL) is used, so the archiver never contacts
// the sites embeds point to.
function embedMedia(embed) {
    const type = embed.data?.type;
    const found = [];
    const add = (field, media) => {
        if (media?.proxyURL) found.push({ field, url: media.url ?? null, proxyURL: media.proxyURL });
    };

    if (type === 'gifv') {
        if (embed.video?.proxyURL) add('video', embed.video);
        else add('thumbnail', embed.thumbnail);
    } else if (type === 'image') {
        add('thumbnail', embed.thumbnail);
        add('image', embed.image);
    } else if (type === 'video') {
        // Only direct video files get a proxy URL; YouTube and similar players don't
        add('video', embed.video);
    } else if (type === 'rich') {
        add('image', embed.image);
    }
    return found;
}

// Jobs for one message's attachments and embeds; `prefix` keeps forwarded content's keys apart
function collectJobs(message, prefix, { allFiles, embeds, extensions }) {
    const jobs = [];
    const allowed = (name, kind) => {
        if (extensions) return extensions.has(path.extname(name || '').toLowerCase());
        return allFiles || kind !== 'files';
    };

    for (const attachment of message.attachments.values()) {
        const kind = kindOf(attachment.contentType, attachment.name);
        if (!allowed(attachment.name, kind)) continue;
        jobs.push({
            key: `${prefix}a:${attachment.id}`,
            source: 'attachment',
            name: attachment.name,
            kind,
            urls: [attachment.url, attachment.proxyURL]
        });
    }

    if (embeds) {
        message.embeds.forEach((embed, index) => {
            for (const media of embedMedia(embed)) {
                const name = nameFromUrl(media.url || media.proxyURL);
                const kind = media.field === 'video' ? 'videos' : 'photos';
                if (extensions && path.extname(name) && !allowed(name, kind)) continue;
                jobs.push({
                    key: `${prefix}e:${index}:${media.field}`,
                    source: 'embed',
                    name,
                    kind,
                    url: media.url,
                    urls: [media.proxyURL]
                });
            }
        });
    }
    return jobs;
}

// Everything in one message that should be downloaded, including forwarded messages,
// each with a stable key so a resumed run never downloads the same file twice
function mediaJobs(message, { allFiles = false, embeds = true, extensions = null } = {}) {
    const options = { allFiles, embeds, extensions };
    const jobs = collectJobs(message, '', options);
    [...(message.messageSnapshots?.values() ?? [])].forEach((snapshot, index) => {
        jobs.push(...collectJobs(snapshot, `f:${index}:`, options));
    });
    return jobs;
}

module.exports = { KINDS, EXTENSIONS, countLabel, kindOf, isMediaType, nameFromUrl, withExtension, embedMedia, mediaJobs };
