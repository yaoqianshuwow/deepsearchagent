import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AISDK from "ai";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  convert: vi.fn(),
  stream: vi.fn(),
  response: vi.fn(),
  search: vi.fn(),
  quota: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/model", () => ({ model: "test-model" }));
vi.mock("~/serper", () => ({ searchSerper: mocks.search }));
vi.mock("~/server/chat-rate-limit", () => ({ consumeChatQuota: mocks.quota }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof AISDK>()),
  APICallError: { isInstance: () => false },
  LoadAPIKeyError: { isInstance: () => false },
  RetryError: { isInstance: () => false },
  convertToModelMessages: mocks.convert,
  streamText: mocks.stream,
}));

import { POST } from "./route";

describe("chat authentication", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.quota.mockResolvedValue({ status: "allowed" });
  });

  it("rejects anonymous requests before parsing the body or calling the model", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: "invalid JSON",
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "请先登录后再聊天" });
    expect(mocks.convert).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.quota).not.toHaveBeenCalled();
  });

  it("rejects a session without a user", async () => {
    mocks.auth.mockResolvedValue({ expires: "2099-01-01" });
    const response = await POST(
      new Request("http://localhost/api/chat", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("streams a response for an authenticated user", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "test-user" } });
    const messages = [
      { id: "1", role: "user", parts: [{ type: "text", text: "Hi" }] },
    ];
    const modelMessages = [{ role: "user", content: "Hi" }];
    mocks.convert.mockResolvedValue(modelMessages);
    mocks.response.mockReturnValue(new Response("stream", { status: 200 }));
    mocks.stream.mockReturnValue({ toUIMessageStreamResponse: mocks.response });

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("stream");
    expect(mocks.convert).toHaveBeenCalledWith(messages);
    expect(mocks.quota).toHaveBeenCalledWith("test-user");
    expect(mocks.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        messages: modelMessages,
      }),
    );
  });

  it("executes Serper search with cancellation and returns only source summaries", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "test-user" } });
    mocks.convert.mockResolvedValue([]);
    mocks.response.mockReturnValue(new Response("stream"));
    mocks.stream.mockReturnValue({ toUIMessageStreamResponse: mocks.response });
    mocks.search.mockResolvedValue({
      organic: [
        {
          title: "Example",
          link: "https://example.com",
          snippet: "Search summary",
          position: 1,
        },
      ],
      credits: 1,
    });
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { id: "1", role: "user", parts: [{ type: "text", text: "Search" }] },
        ],
      }),
    });
    await POST(request);
    const options = mocks.stream.mock.calls[0]![0] as Parameters<
      typeof AISDK.streamText
    >[0];
    expect(options.abortSignal).toBe(request.signal);
    const search = options.tools!.searchWeb! as AISDK.Tool<
      { query: string },
      { title: string; link: string; snippet: string }[]
    >;
    const results = await search.execute!(
      { query: "test query" },
      {
        toolCallId: "search-1",
        messages: [],
        abortSignal: request.signal,
        context: undefined,
      },
    );
    expect(mocks.search).toHaveBeenCalledWith(
      { q: "test query", num: 10 },
      request.signal,
    );
    expect(results).toEqual([
      {
        title: "Example",
        link: "https://example.com",
        snippet: "Search summary",
      },
    ]);
  });

  it("returns 429 without calling the model when the daily quota is exhausted", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "test-user" } });
    mocks.convert.mockResolvedValue([]);
    mocks.quota.mockResolvedValue({
      status: "limited",
      limit: 1,
      retryAfter: 60,
    });
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [
            { id: "1", role: "user", parts: [{ type: "text", text: "Hi" }] },
          ],
        }),
      }),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await response.text()).toContain("今日聊天额度已用完");
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("does not consume quota for malformed or empty requests", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "test-user" } });
    for (const body of ["invalid JSON", JSON.stringify({ messages: [] })]) {
      const response = await POST(
        new Request("http://localhost/api/chat", { method: "POST", body }),
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("does not call the model when the quota database is unavailable", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "test-user" } });
    mocks.convert.mockResolvedValue([]);
    mocks.quota.mockRejectedValue(new Error("Database unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await POST(
        new Request("http://localhost/api/chat", {
          method: "POST",
          body: JSON.stringify({
            messages: [
              { id: "1", role: "user", parts: [{ type: "text", text: "Hi" }] },
            ],
          }),
        }),
      );
      expect(response.status).toBe(503);
      expect(mocks.stream).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
