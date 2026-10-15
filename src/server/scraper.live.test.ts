import { afterAll, expect, it } from "vitest";
import { crawlWebsite } from "./scraper";
import { redis } from "./redis/redis";

const enabled = process.env.RUN_SCRAPER_LIVE_TESTS === "1";
afterAll(async () => {
  if (enabled) await redis.quit();
});

it.skipIf(!enabled)(
  "fetches a public webpage and reuses its real Redis cache",
  async () => {
    const url = "https://example.com/";
    const result = await crawlWebsite(url);
    expect(result).toMatchObject({ success: true });
    if (!result.success) throw new Error(result.error);
  expect(result.data.length).toBeGreaterThan(0);
    expect(await redis.get(`crawlWebsite:v1:${JSON.stringify([url])}`)).toBe(
      JSON.stringify(result),
    );
    expect(await crawlWebsite(url)).toEqual(result);
  },
  30000,
);
