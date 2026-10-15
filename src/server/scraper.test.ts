import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type * as Undici from "undici";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  lookup: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));
vi.mock("undici", async (importOriginal) => ({
  ...(await importOriginal<typeof Undici>()),
  fetch: mocks.fetch,
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("./redis/client", () => ({
  createRedisClient: () => ({ get: mocks.get, set: mocks.set }),
}));

import { bulkCrawlWebsites, crawlWebsite, MAX_MARKDOWN_CHARS } from "./scraper";
import {
  MAX_HTML_BYTES,
  resolvePublicHost,
  validatePublicUrl,
} from "./public-web";

const page = (html = "<article><h1>正文标题</h1><p>原文细节</p></article>") =>
  new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
const robotsMissing = () => new Response(null, { status: 404 });
const url = "https://example.com/article";
const cache = new Map<string, string>();

beforeEach(() => {
  vi.resetAllMocks();
  cache.clear();
  mocks.get.mockImplementation(async (key: string) => cache.get(key) ?? null);
  mocks.set.mockImplementation(async (key: string, value: string) => {
    cache.set(key, value);
    return "OK";
  });
  mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.fetch.mockImplementation(async (value: URL) =>
    value.pathname === "/robots.txt" ? robotsMissing() : page(),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("public webpage access", () => {
  it.each([
    "http://localhost/",
    "http://foo.localhost/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fc00::1]/",
    "http://example.com:3000/",
    "https://user:password@example.com/",
    "file:///etc/passwd",
    "ftp://example.com/file",
  ])(
    "blocks unsafe URL %s before a cache lookup or request",
    async (unsafe) => {
      const result = await crawlWebsite(unsafe);
      expect(result.success).toBe(false);
      expect(mocks.get).not.toHaveBeenCalled();
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects DNS results containing any internal address, including mixed public/private answers", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(resolvePublicHost("example.com")).rejects.toThrow(
      "内网或保留地址",
    );
  });

  it("allows public addresses and removes fragments from the cache identity", async () => {
    await expect(resolvePublicHost("example.com")).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
    ]);
    expect(validatePublicUrl(`${url}#section`).href).toBe(url);
  });

  it("rejects a redirect to an internal address without fetching its target", async () => {
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : new Response(null, {
            status: 302,
            headers: { Location: "http://127.0.0.1/private" },
          }),
    );
    expect(await crawlWebsite(url)).toEqual({
      success: false,
      error: expect.stringContaining("内网地址") as unknown,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("webpage extraction and cache", () => {
  it("checks robots first, extracts the article as Markdown, removes page chrome and resolves relative links", async () => {
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : page(
            '<nav>导航广告</nav><article><header>广告</header><h1>正文标题</h1><p>原文细节 <a href="/source">来源</a></p><script>恶意脚本</script><pre><code>const x = 1;</code></pre></article><footer>页脚</footer>',
          ),
    );
    const result = await crawlWebsite(url);
    expect(result).toEqual({
      success: true,
      truncated: false,
      data: expect.stringContaining("# 正文标题") as unknown,
    });
    if (!result.success) throw new Error("Expected extracted Markdown");
    expect(result.data).toContain("[来源](https://example.com/source)");
    expect(result.data).toContain("```\nconst x = 1;");
    expect(result.data).not.toMatch(/广告|恶意脚本|页脚/);
    expect((mocks.fetch.mock.calls[0]![0] as URL).pathname).toBe("/robots.txt");
    expect(mocks.fetch.mock.calls[0]![1]).toMatchObject({
      redirect: "manual",
      headers: { "User-Agent": "DeepSearchAgent/1.0" },
    });
  });

  it("falls back past an empty article to main content", async () => {
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : page("<article></article><main><p>主区域正文</p></main>"),
    );
    expect(await crawlWebsite(url)).toMatchObject({
      success: true,
      data: "主区域正文",
    });
  });

  it("obeys robots restrictions and never requests a disallowed page", async () => {
    mocks.fetch.mockResolvedValue(
      new Response("User-agent: DeepSearchAgent\nDisallow: /article"),
    );
    expect(await crawlWebsite(url)).toEqual({
      success: false,
      error: expect.stringContaining("robots.txt") as unknown,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("checks robots at a redirected page's destination too", async () => {
    mocks.fetch.mockImplementation(async (value: URL) => {
      if (value.hostname === "blocked.example")
        return new Response("User-agent: *\nDisallow: /");
      return value.pathname === "/robots.txt"
        ? robotsMissing()
        : new Response(null, {
            status: 302,
            headers: { Location: "https://blocked.example/article" },
          });
    });
    expect(await crawlWebsite(url)).toMatchObject({ success: false });
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("caches successful results for six hours using only the normalized URL", async () => {
    const first = await crawlWebsite(
      `${url}#first`,
      new AbortController().signal,
    );
    expect(
      await crawlWebsite(`${url}#second`, new AbortController().signal),
    ).toEqual(first);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "EX",
      21600,
    );
    expect([...cache.keys()]).toEqual([`crawlWebsite:v1:["${url}"]`]);
  });

  it("returns permanent HTTP errors without retrying or caching them", async () => {
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : new Response(null, { status: 403 }),
    );
    expect(await crawlWebsite(url)).toEqual({
      success: false,
      error: "网页请求失败（HTTP 403）",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.set).not.toHaveBeenCalled();
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt" ? robotsMissing() : page(),
    );
    expect(await crawlWebsite(url)).toMatchObject({ success: true });
  });

  it("retries transient failures with backoff then returns the successful page", async () => {
    let attempts = 0;
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : ++attempts < 3
          ? new Response(null, { status: 503 })
          : page(),
    );
    expect(await crawlWebsite(url)).toMatchObject({ success: true });
    expect(attempts).toBe(3);
  });

  it("bounds retries for rate limiting and does not cache the failure", async () => {
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : new Response(null, { status: 429 }),
    );
    expect(await crawlWebsite(url)).toMatchObject({
      success: false,
      error: expect.stringContaining("429") as unknown,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(6);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("does not return cached content for an already cancelled request", async () => {
    await crawlWebsite(url);
    mocks.get.mockClear();
    expect(await crawlWebsite(url, AbortSignal.abort())).toMatchObject({
      success: false,
    });
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it.each(["application/pdf", "image/png"])(
    "rejects unsupported content type %s",
    async (type) => {
      mocks.fetch.mockImplementation(async (value: URL) =>
        value.pathname === "/robots.txt"
          ? robotsMissing()
          : new Response("file", { headers: { "Content-Type": type } }),
      );
      expect(await crawlWebsite(url)).toMatchObject({
        success: false,
        error: expect.stringContaining("不是 HTML") as unknown,
      });
    },
  );

  it("limits response bytes even when content-length is absent", async () => {
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : page("x".repeat(MAX_HTML_BYTES + 1)),
    );
    expect(await crawlWebsite(url)).toMatchObject({
      success: false,
      error: expect.stringContaining("大小限制") as unknown,
    });
  });

  it("marks truncated Markdown and reports empty content", async () => {
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : page(`<article>${"a".repeat(MAX_MARKDOWN_CHARS + 100)}</article>`),
    );
    const result = await crawlWebsite(url);
    expect(result).toMatchObject({ success: true, truncated: true });
    if (result.success) expect(result.data).toHaveLength(MAX_MARKDOWN_CHARS);
    mocks.fetch.mockImplementation(async (value: URL) =>
      value.pathname === "/robots.txt"
        ? robotsMissing()
        : page("<script>app()</script>"),
    );
    expect(await crawlWebsite("https://example.com/empty")).toMatchObject({
      success: false,
      error: expect.stringContaining("未提取到") as unknown,
    });
  });

  it("keeps per-page successes and errors in a mixed batch and deduplicates URLs", async () => {
    const result = await bulkCrawlWebsites([
      url,
      "http://localhost/private",
      url,
    ]);
    expect(result.success).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ url, result: { success: true } });
    expect(result.results[1]).toMatchObject({ result: { success: false } });
    await expect(bulkCrawlWebsites([])).rejects.toThrow("1 到 3");
    await expect(bulkCrawlWebsites([url, url, url, url])).rejects.toThrow(
      "1 到 3",
    );
  });
});
