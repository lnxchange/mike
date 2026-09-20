import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    cacheForInjectedFetch,
    fetchOfficialBytes,
    writeOfficialCache,
} from "../officialFileCache";

const dirs: string[] = [];

afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("official file cache", () => {
    it("returns a cached official file inside the TTL", async () => {
        const dir = await mkdtemp(join(tmpdir(), "mike-official-cache-"));
        dirs.push(dir);
        const url = "https://www.aer.gov.au/system/files/example.pdf";
        await writeOfficialCache(url, Buffer.from("cached-bytes"), { dir });
        let fetches = 0;
        const result = await fetchOfficialBytes(
            async () => {
                fetches += 1;
                return new Response("fresh", { status: 200 });
            },
            url,
            {},
            { dir },
        );
        expect(result.fromCache).toBe(true);
        expect(result.bytes.toString()).toBe("cached-bytes");
        expect(fetches).toBe(0);
    });

    it("does not cache when a test injects fetch unless a cache is set", () => {
        expect(cacheForInjectedFetch(async () => new Response("ok"))).toEqual({
            disabled: true,
        });
        expect(cacheForInjectedFetch(undefined).disabled).toBeUndefined();
    });
});
