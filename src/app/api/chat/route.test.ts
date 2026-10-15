import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as AISDK from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { SearchChatMessage } from "~/types/chat";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  convert: vi.fn(),
  stream: vi.fn(),
  response: vi.fn(),
  search: vi.fn(),
  quota: vi.fn(),
  getChat: vi.fn(),
  upsertChat: vi.fn(),
  getContext: vi.fn(),
  finishStream: vi.fn(),
  traceAttributes: vi.fn(),
}));

vi.mock("@langfuse/tracing", () => ({
  propagateAttributes: <T>(attributes: unknown, run: () => T): T => {
    mocks.traceAttributes(attributes);
    return run();
  },
}));

vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/model", () => ({ model: "test-model" }));
vi.mock("~/serper", () => ({ searchSerper: mocks.search }));
vi.mock("~/server/chat-rate-limit", () => ({ consumeChatQuota: mocks.quota }));
vi.mock("~/server/chats", () => ({
  ChatAlreadyExistsError: class extends Error {},
  ChatStreamActiveError: class extends Error {},
  getChat: mocks.getChat,
  upsertChat: mocks.upsertChat,
}));
vi.mock("~/server/stream-context", () => ({
  getStreamContext: mocks.getContext,
}));
vi.mock("~/server/streams", () => ({ finishStream: mocks.finishStream }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof AISDK>()),
  APICallError: { isInstance: () => false },
  LoadAPIKeyError: { isInstance: () => false },
  RetryError: { isInstance: () => false },
  convertToModelMessages: mocks.convert,
  streamText: mocks.stream,
}));

import { POST } from "./route";
import { ChatAlreadyExistsError, ChatStreamActiveError } from "~/server/chats";

const newChatId = "11111111-1111-4111-8111-111111111111";

const mockStreamContext = () =>
  mocks.getContext.mockResolvedValue({
    createNewResumableStream: vi.fn(
      async (_id: string, makeStream: () => ReadableStream<string>) =>
        makeStream(),
    ),
  });

const emptyModelStream = () =>
  new ReadableStream<AISDK.UIMessageChunk>({
    start(controller) {
      controller.close();
    },
  });

describe("chat authentication", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockStreamContext();
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
    expect(mocks.traceAttributes).not.toHaveBeenCalled();
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
    mocks.response.mockReturnValue(emptyModelStream());
    mocks.stream.mockReturnValue({ toUIMessageStream: mocks.response });

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages, chatId: newChatId, isNewChat: true }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"type":"data-chat-created"');
    expect(mocks.convert).toHaveBeenCalledWith(messages);
    expect(mocks.quota).toHaveBeenCalledWith("test-user");
    expect(mocks.traceAttributes).toHaveBeenCalledExactlyOnceWith({
      userId: "test-user",
      sessionId: newChatId,
      traceName: "chat",
    });
    expect(mocks.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "test-model",
        messages: modelMessages,
        telemetry: { isEnabled: true, functionId: "deepsearch-agent" },
      }),
    );
  });

  it("executes Serper search with cancellation and returns only source summaries", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "test-user" } });
    mocks.convert.mockResolvedValue([]);
    mocks.response.mockReturnValue(emptyModelStream());
    mocks.stream.mockReturnValue({ toUIMessageStream: mocks.response });
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
        chatId: newChatId,
        isNewChat: true,
        messages: [
          { id: "1", role: "user", parts: [{ type: "text", text: "Search" }] },
        ],
      }),
    });
    await POST(request);
    const options = mocks.stream.mock.calls[0]![0] as Parameters<
      typeof AISDK.streamText
    >[0];
    expect(options.abortSignal).not.toBe(request.signal);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
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
          chatId: newChatId,
          isNewChat: true,
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
            chatId: newChatId,
            isNewChat: true,
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

describe("chat persistence", () => {
  const messages: SearchChatMessage[] = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "第一个问题" }],
    },
  ];
  const request = (body: Record<string, unknown> = { messages }) =>
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({ chatId: newChatId, isNewChat: true, ...body }),
    });
  const responseOptions = () =>
    mocks.response.mock
      .calls[0]![0] as AISDK.UIMessageStreamOptions<SearchChatMessage>;

  beforeEach(() => {
    vi.resetAllMocks();
    mockStreamContext();
    mocks.auth.mockResolvedValue({ user: { id: "test-user" } });
    mocks.quota.mockResolvedValue({ status: "allowed" });
    mocks.convert.mockResolvedValue([]);
    mocks.upsertChat.mockResolvedValue({});
    mocks.response.mockImplementation(emptyModelStream);
    mocks.stream.mockReturnValue({ toUIMessageStream: mocks.response });
  });

  it("saves before generation, uses the session's user, and preserves the supplied new chat id", async () => {
    const response = await POST(request({ messages, userId: "forged-user" }));
    const chatId = response.headers.get("X-Chat-Id");
    expect(chatId).toBe(newChatId);
    expect(mocks.upsertChat).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user",
        chatId,
        title: "第一个问题",
        messages,
        createOnly: true,
      }),
    );
    expect(mocks.upsertChat.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.stream.mock.invocationCallOrder[0]!,
    );
    expect(mocks.traceAttributes).toHaveBeenCalledExactlyOnceWith({
      userId: "test-user",
      sessionId: chatId,
      traceName: "chat",
    });
    expect(responseOptions().originalMessages).toEqual(messages);
    expect(await response.text()).toContain(
      JSON.stringify({
        type: "data-chat-created",
        data: { chatId },
        transient: true,
      }),
    );
  });

  it("reuses an owned chat id and preserves its title", async () => {
    mocks.getChat.mockResolvedValue({
      id: "existing-chat",
      title: "原来的标题",
    });
    const response = await POST(
      request({ messages, chatId: "existing-chat", isNewChat: false }),
    );
    expect(mocks.getChat).toHaveBeenCalledWith({
      userId: "test-user",
      chatId: "existing-chat",
    });
    expect(response.headers.get("X-Chat-Id")).toBe("existing-chat");
    expect(mocks.traceAttributes).toHaveBeenCalledExactlyOnceWith({
      userId: "test-user",
      sessionId: "existing-chat",
      traceName: "chat",
    });
    expect(mocks.upsertChat).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "test-user",
        chatId: "existing-chat",
        title: "原来的标题",
        messages,
        createOnly: false,
      }),
    );
    expect(await response.text()).not.toContain("data-chat-created");
  });

  it("rejects a missing or inaccessible chat before consuming quota or saving", async () => {
    mocks.getChat.mockResolvedValue(undefined);
    expect(
      (
        await POST(
          request({ messages, chatId: "other-user-chat", isNewChat: false }),
        )
      ).status,
    ).toBe(404);
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(mocks.upsertChat).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.traceAttributes).not.toHaveBeenCalled();
  });

  it("rejects invalid chat ids, invalid message parts and duplicate message ids without consuming quota", async () => {
    for (const body of [
      { messages, chatId: "" },
      { messages, chatId: 123 },
      { messages, chatId: "a".repeat(256) },
      { messages, chatId: undefined },
      { messages, isNewChat: undefined },
      { messages, isNewChat: "true" },
      {
        messages: [
          { id: "1", role: "user", parts: [{ type: "text", text: 123 }] },
        ],
      },
      { messages: [messages[0], messages[0]] },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(mocks.upsertChat).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("does not save when the quota is exhausted", async () => {
    mocks.quota.mockResolvedValue({
      status: "limited",
      limit: 1,
      retryAfter: 60,
    });
    expect((await POST(request())).status).toBe(429);
    expect(mocks.upsertChat).not.toHaveBeenCalled();
  });

  it("does not start generation if the initial save fails", async () => {
    mocks.upsertChat.mockRejectedValue(new Error("Database unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await POST(request())).status).toBe(503);
      expect(mocks.stream).not.toHaveBeenCalled();
      expect(mocks.traceAttributes).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("does not consume quota or call the model if Redis cannot be initialized", async () => {
    mocks.getContext.mockRejectedValue(new Error("Redis unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await POST(request())).status).toBe(503);
      expect(mocks.quota).not.toHaveBeenCalled();
      expect(mocks.stream).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("does not overwrite a chat that already has an active generation", async () => {
    mocks.upsertChat.mockRejectedValue(new ChatStreamActiveError());
    expect((await POST(request())).status).toBe(409);
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("rejects a new-chat id collision without starting the model", async () => {
    mocks.upsertChat.mockRejectedValue(new ChatAlreadyExistsError());
    expect((await POST(request())).status).toBe(409);
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.traceAttributes).not.toHaveBeenCalled();
  });

  it.each(["aborted", "failed", "cancelled"])(
    "keeps the initial messages when the stream is %s",
    async (status) => {
      await POST(request());
      const responseMessage: SearchChatMessage = {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "未完成" }],
      };
      await responseOptions().onEnd!({
        messages: [...messages, responseMessage],
        responseMessage,
        isContinuation: false,
        isAborted: status === "aborted",
        ...(status === "cancelled" ? { isCancelled: true as const } : {}),
        outcome: {
          status:
            status === "cancelled"
              ? "unknown"
              : (status as "aborted" | "failed"),
        },
      });
      expect(mocks.upsertChat).toHaveBeenCalledTimes(1);
      expect(mocks.finishStream).toHaveBeenCalledWith(
        expect.any(String),
        "failed",
      );
    },
  );

  it("uses the real SDK stream to save merged text and tool results with stable message ids", async () => {
    const sdk = await vi.importActual<typeof AISDK>("ai");
    mocks.convert.mockImplementation(sdk.convertToModelMessages);
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const testModel = new MockLanguageModelV4({
      doStream: [
        {
          stream: sdk.simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              {
                type: "tool-call",
                toolCallId: "search-1",
                toolName: "searchWeb",
                input: JSON.stringify({ query: "问题" }),
              },
              {
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage,
              },
            ],
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
        },
        {
          stream: sdk.simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "text-1" },
              { type: "text-delta", id: "text-1", delta: "搜索后的回答" },
              { type: "text-end", id: "text-1" },
              {
                type: "finish",
                finishReason: { unified: "stop", raw: "stop" },
                usage,
              },
            ],
            initialDelayInMs: 0,
            chunkDelayInMs: 0,
          }),
        },
      ],
    });
    mocks.search.mockResolvedValue({
      organic: [
        { title: "来源", link: "https://example.com", snippet: "摘要" },
      ],
    });
    mocks.stream.mockImplementation(
      (options: Parameters<typeof AISDK.streamText>[0]) =>
        sdk.streamText({ ...options, model: testModel }),
    );
    const response = await POST(request());
    const wire = await response.text();
    expect(mocks.upsertChat).toHaveBeenCalledTimes(2);
    expect(mocks.finishStream).toHaveBeenCalledWith(
      expect.any(String),
      "completed",
    );
    const finalSave = mocks.upsertChat.mock.calls[1]![0] as {
      chatId: string;
      messages: SearchChatMessage[];
    };
    expect(finalSave.chatId).toBe(response.headers.get("X-Chat-Id"));
    expect(finalSave.messages).toHaveLength(2);
    expect(finalSave.messages[0]).toEqual(messages[0]);
    const assistant = finalSave.messages[1]!;
    expect(assistant.role).toBe("assistant");
    expect(assistant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(wire).toContain(assistant.id);
    expect(wire.indexOf('"type":"data-chat-created"')).toBeLessThan(
      wire.indexOf('"type":"text-delta"'),
    );
    expect(
      assistant.parts.some((part) => part.type === "data-chat-created"),
    ).toBe(false);
    expect(assistant.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text", text: "搜索后的回答" }),
        expect.objectContaining({
          type: "tool-searchWeb",
          toolCallId: "search-1",
          state: "output-available",
          input: { query: "问题" },
          output: [
            { title: "来源", link: "https://example.com", snippet: "摘要" },
          ],
        }),
      ]),
    );
    expect(
      await sdk.validateUIMessages({
        messages: finalSave.messages,
        tools: (
          mocks.stream.mock.calls[0]![0] as Parameters<
            typeof AISDK.streamText
          >[0]
        ).tools,
      }),
    ).toHaveLength(2);
  });
});
