import { loadBuffer } from "cheerio";
import { setTimeout } from "node:timers/promises";
import robotsParser from "robots-parser";
import TurndownService from "turndown";
import { cacheWithRedis } from "~/server/redis/redis";
import {
  CRAWLER_USER_AGENT,
  CrawlError,
  requestPublicPage,
  validatePublicUrl,
} from "./public-web";

export type CrawlResponse =
  | { success: true; data: string; truncated: boolean }
  | { success: false; error: string };
export type BulkCrawlResponse = {
  success: boolean;
  results: { url: string; result: CrawlResponse }[];
};

export const MAX_CRAWL_URLS = 3;
export const MAX_MARKDOWN_CHARS = 20000;
const MAX_ATTEMPTS = 3;
const MAX_REDIRECTS = 5;
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
});

function extractMarkdown(html: Buffer, url: URL, contentType: string) {
  const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  const $ = loadBuffer(html, {
    baseURI: url.href,
    encoding: {
      transportLayerEncodingLabel: charset,
      defaultEncoding: "utf-8",
    },
  });
  $(
    "script, style, nav, header, footer, iframe, noscript, form, svg, [hidden], [aria-hidden='true']",
  ).remove();
  $("a[href], img[src]").each((_, element) => {
    const node = $(element);
    const attribute = element.tagName === "a" ? "href" : "src";
    const target = node.attr(attribute);
    try {
      const resolved = new URL(target ?? "", url);
      if (["http:", "https:"].includes(resolved.protocol))
        node.attr(attribute, resolved.href);
      else node.removeAttr(attribute);
    } catch {
      node.removeAttr(attribute);
    }
  });
  for (const selector of [
    "article",
    "[role='main']",
    ".post-content",
    ".article-content",
    "main",
    ".content",
    "body",
  ]) {
    const candidate = $(selector).first();
    const markdown = turndown.turndown(candidate.html() ?? "").trim();
    if (markdown)
      return {
        data: markdown.slice(0, MAX_MARKDOWN_CHARS),
        truncated: markdown.length > MAX_MARKDOWN_CHARS,
      };
  }
  throw new CrawlError("未提取到网页正文，页面可能需要登录或运行 JavaScript");
}

function httpError(status: number) {
  return new CrawlError(
    `网页请求失败（HTTP ${status}）`,
    status === 429 || status >= 500,
  );
}

async function checkRobots(url: URL, signal: AbortSignal) {
  let robotsUrl = new URL("/robots.txt", url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await requestPublicPage(robotsUrl, signal, 512 * 1024);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      robotsUrl = validatePublicUrl(new URL(location, robotsUrl).href);
      continue;
    }
    if (response.status === 404 || response.status === 410) return;
    if (response.status !== 200) throw httpError(response.status);
    const robots = robotsParser(
      new URL("/robots.txt", url).href,
      response.body.toString("utf8"),
    );
    if (robots.isAllowed(url.href, CRAWLER_USER_AGENT) === false) {
      throw new CrawlError("网站 robots.txt 不允许抓取该页面");
    }
    return;
  }
  throw new CrawlError("robots.txt 重定向次数过多");
}

async function fetchMarkdown(url: URL, signal: AbortSignal) {
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    signal.throwIfAborted();
    await checkRobots(url, signal);
    const response = await requestPublicPage(url, signal);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = validatePublicUrl(new URL(location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300)
      throw httpError(response.status);
    const type = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (type !== "text/html" && type !== "application/xhtml+xml") {
      throw new CrawlError(
        "该链接不是 HTML 网页，暂不支持 PDF、图片或其他文件",
      );
    }
    return {
      success: true as const,
      ...extractMarkdown(
        response.body,
        url,
        response.headers.get("content-type") ?? "",
      ),
    };
  }
  throw new CrawlError("网页重定向次数过多");
}

const cachedCrawl = cacheWithRedis(
  "crawlWebsite:v1",
  async (url: string, signal: AbortSignal): Promise<CrawlResponse> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await fetchMarkdown(validatePublicUrl(url), signal);
      } catch (error) {
        if (signal.aborted)
          return { success: false, error: "网页抓取已取消或超时" };
        if (
          (error instanceof CrawlError && !error.retryable) ||
          attempt === MAX_ATTEMPTS - 1
        ) {
          return {
            success: false,
            error:
              error instanceof CrawlError
                ? error.message
                : "网络连接失败或请求超时，请稍后重试",
          };
        }
        await setTimeout(500 * 2 ** attempt, undefined, { signal });
      }
    }
    return { success: false, error: "网页抓取失败" };
  },
  { keyArgs: (url) => [url], shouldCache: (result) => result.success },
);

export async function crawlWebsite(
  url: string,
  abortSignal?: AbortSignal,
): Promise<CrawlResponse> {
  try {
    const normalized = validatePublicUrl(url).href;
    const signal = AbortSignal.any([
      AbortSignal.timeout(20000),
      ...(abortSignal ? [abortSignal] : []),
    ]);
    signal.throwIfAborted();
    return await cachedCrawl(normalized, signal);
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof CrawlError
          ? error.message
          : "网页抓取已取消、超时或缓存暂不可用",
    };
  }
}

export async function bulkCrawlWebsites(
  urls: string[],
  abortSignal?: AbortSignal,
): Promise<BulkCrawlResponse> {
  if (!urls.length || urls.length > MAX_CRAWL_URLS)
    throw new Error(`每次只能抓取 1 到 ${MAX_CRAWL_URLS} 个网页`);
  const results = await Promise.all(
    [...new Set(urls)].map(async (url) => ({
      url,
      result: await crawlWebsite(url, abortSignal),
    })),
  );
  return { success: results.every(({ result }) => result.success), results };
}
