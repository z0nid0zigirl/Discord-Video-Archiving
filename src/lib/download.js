const fs = require('fs');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { sleep } = require('./utils');

class NotMediaError extends Error {}

function retryDelay(response, attempt, baseMs) {
    const header = Number(response?.headers.get('retry-after'));
    if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 60_000);
    return Math.min(baseMs * 2 ** attempt, 30_000);
}

// Streams a file to disk while hashing it, so large videos never sit in memory.
// Tries each URL in turn and retries rate limits, server errors and dropped connections.
// `accept(contentType)` can reject a response before anything is written.
async function downloadToFile(urls, destination, { accept = null, retries = 3, retryDelayMs = 1000, signal } = {}) {
    let lastError = new Error('No URL to download');

    for (const url of [...new Set(urls.filter(Boolean))]) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (signal?.aborted) throw signal.reason ?? new Error('Aborted');
            let response;
            try {
                response = await fetch(url, { signal });

                if (response.status === 429 || response.status >= 500) {
                    lastError = new Error(`HTTP ${response.status}`);
                    await response.body?.cancel();
                    if (attempt < retries) await sleep(retryDelay(response, attempt, retryDelayMs));
                    continue;
                }
                if (!response.ok) {
                    lastError = new Error(`HTTP ${response.status}`);
                    await response.body?.cancel();
                    break; // try the next URL
                }

                const contentType = response.headers.get('content-type');
                if (accept && !accept(contentType)) {
                    await response.body?.cancel();
                    throw new NotMediaError(`not a media file (${contentType || 'unknown type'})`);
                }

                const hash = crypto.createHash('sha256');
                let bytes = 0;
                const meter = new Transform({
                    transform(chunk, _encoding, callback) {
                        hash.update(chunk);
                        bytes += chunk.length;
                        callback(null, chunk);
                    }
                });
                await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(destination));
                return { hash: hash.digest('hex'), bytes, contentType };
            } catch (error) {
                fs.rmSync(destination, { force: true });
                if (error instanceof NotMediaError || signal?.aborted) throw error;
                lastError = error;
                if (attempt < retries) await sleep(retryDelay(null, attempt, retryDelayMs));
            }
        }
    }
    throw lastError;
}

// Runs `fn` over `items` with at most `limit` running at once.
// Returns results in input order as { value } or { error }.
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const index = next++;
            try {
                results[index] = { value: await fn(items[index], index) };
            } catch (error) {
                results[index] = { error };
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

module.exports = { downloadToFile, mapLimit, NotMediaError };
