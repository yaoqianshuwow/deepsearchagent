import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";

export class CrawlError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

const isPublicAddress = (address: string) =>
  ipaddr.isValid(address) && ipaddr.process(address).range() === "unicast";

export function validatePublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CrawlError("网页地址无效");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !["80", "443"].includes(url.port)) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    (isIP(host) && !isPublicAddress(host))
  )
    throw new CrawlError(
      "只允许抓取公开的 HTTP/HTTPS 网页，不能访问本机或内网地址",
    );
  url.hash = "";
  return url;
}

export async function resolvePublicHost(hostname: string) {
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  ) {
    throw new CrawlError("网页域名解析到了本机、内网或保留地址，已拒绝访问");
  }
  return addresses;
}

// Validate DNS at connection time and connect to that exact address. A hostname
// cannot pass a public-IP check and then resolve to an internal IP for the fetch.
const dispatcher = new Agent({
  connect: {
    autoSelectFamily: false,
    lookup: (hostname, options, callback) => {
      void resolvePublicHost(hostname).then(
        (addresses) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0]!.address, addresses[0]!.family);
        },
        (error: Error) => callback(error, "", 4),
      );
    },
  },
});

export const CRAWLER_USER_AGENT = "DeepSearchAgent";
export const MAX_HTML_BYTES = 2 * 1024 * 1024;

export async function requestPublicPage(
  url: URL,
  signal: AbortSignal,
  maxBytes = MAX_HTML_BYTES,
) {
  validatePublicUrl(url.href);
  try {
    const response = await fetch(url, {
      dispatcher,
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      headers: {
        "User-Agent": `${CRAWLER_USER_AGENT}/1.0`,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
      },
    });
    const headers = response.headers;
    if ((response.status >= 300 && response.status < 400) || !response.ok) {
      await response.body?.cancel();
      return { status: response.status, headers, body: Buffer.alloc(0) };
    }
    if (Number(headers.get("content-length")) > maxBytes) {
      await response.body?.cancel();
      throw new CrawlError("网页内容超过大小限制");
    }
    const chunks: Uint8Array[] = [];
    const reader = (
      response.body as ReadableStream<Uint8Array> | null
    )?.getReader();
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw new CrawlError("网页内容超过大小限制");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    }
    return { status: response.status, headers, body: Buffer.concat(chunks) };
  } catch (error) {
    if (error instanceof TypeError && error.cause instanceof CrawlError)
      throw error.cause;
    throw error;
  }
}
