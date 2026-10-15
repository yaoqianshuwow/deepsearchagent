import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ChatMessage } from "./chat-message";
import type { MessagePart } from "~/types/chat";

const render = (part: MessagePart) =>
  renderToStaticMarkup(
    createElement(ChatMessage, {
      parts: [part],
      role: "assistant",
      userName: "用户",
    }),
  );

it("shows webpage progress while URLs are still streaming", () => {
  const html = render({
    type: "tool-scrapePages",
    toolCallId: "scrape-1",
    state: "input-streaming",
    input: { urls: ["https://example.com"] },
  });
  expect(html).toContain("正在读取网页正文");
  expect(html).toContain("https://example.com");
});

it("shows per-page failures, truncation and escaped source content", () => {
  const html = render({
    type: "tool-scrapePages",
    toolCallId: "scrape-1",
    state: "output-available",
    input: { urls: ["https://example.com", "https://blocked.example"] },
    output: {
      success: false,
      results: [
        {
          url: "https://example.com",
          result: {
            success: true,
            data: "<script>alert(1)</script>",
            truncated: true,
          },
        },
        {
          url: "https://blocked.example",
          result: { success: false, error: "robots.txt 不允许抓取" },
        },
      ],
    },
  });
  expect(html).toContain("1/2 个成功");
  expect(html).toContain("内容已截断");
  expect(html).toContain("robots.txt 不允许抓取");
  expect(html).not.toContain("<script>");
});
