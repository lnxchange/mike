import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const OFFICIAL_FILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export type OfficialFileCache = {
    dir?: string;
    ttlMs?: number;
    disabled?: boolean;
};

export type OfficialFetch = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;

function cachePath(url: string, dir: string): string {
    return join(dir, createHash("sha256").update(url).digest("hex"));
}

export async function readOfficialCache(
    url: string,
    cache: OfficialFileCache = {},
): Promise<Buffer | null> {
    if (cache.disabled) return null;
    const dir = cache.dir ?? join(tmpdir(), "mike-official-cache");
    try {
        const path = cachePath(url, dir);
        const info = await stat(path);
        const ttl = cache.ttlMs ?? OFFICIAL_FILE_CACHE_TTL_MS;
        if (Date.now() - info.mtimeMs > ttl) return null;
        return await readFile(path);
    } catch {
        return null;
    }
}

export async function writeOfficialCache(
    url: string,
    bytes: Buffer,
    cache: OfficialFileCache = {},
): Promise<void> {
    if (cache.disabled) return;
    const dir = cache.dir ?? join(tmpdir(), "mike-official-cache");
    await mkdir(dir, { recursive: true });
    await writeFile(cachePath(url, dir), bytes);
}

export async function fetchOfficialBytes(
    fetchImpl: OfficialFetch,
    url: string,
    init: RequestInit = {},
    cache: OfficialFileCache = {},
): Promise<{ bytes: Buffer; status: number; fromCache: boolean }> {
    const cached = await readOfficialCache(url, cache);
    if (cached) {
        return { bytes: cached, status: 200, fromCache: true };
    }
    const response = await fetchImpl(url, init);
    if (!response.ok) {
        return {
            bytes: Buffer.alloc(0),
            status: response.status,
            fromCache: false,
        };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeOfficialCache(url, bytes, cache);
    return { bytes, status: response.status, fromCache: false };
}

export function cacheForInjectedFetch(
    fetchImpl: OfficialFetch | undefined,
    cache?: OfficialFileCache,
): OfficialFileCache {
    if (cache) return cache;
    return fetchImpl ? { disabled: true } : {};
}
