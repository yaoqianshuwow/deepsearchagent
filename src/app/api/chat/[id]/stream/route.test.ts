import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  streams: vi.fn(),
  chat: vi.fn(),
  context: vi.fn(),
  resume: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/server/chats", () => ({ getChat: mocks.chat }));
vi.mock("~/server/streams", () => ({
  getStreamsByChatId: mocks.streams,
  finishStream: mocks.finish,
}));
vi.mock("~/server/stream-context", () => ({ getStreamContext: mocks.context }));
import { GET } from "./route";

const get = () =>
  GET(new Request("http://localhost/api/chat/chat-1/stream"), {
    params: Promise.resolve({ id: "chat-1" }),
  });

describe("resuming a chat stream", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    mocks.context.mockResolvedValue({ resumeExistingStream: mocks.resume });
    mocks.streams.mockResolvedValue([
      { id: "stream-1", status: "active", createdAt: new Date() },
    ]);
  });

  it("rejects anonymous access without looking up private data", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect(mocks.streams).not.toHaveBeenCalled();
  });

  it("checks ownership before connecting to Redis", async () => {
    mocks.streams.mockResolvedValue(undefined);
    expect((await get()).status).toBe(404);
    expect(mocks.streams).toHaveBeenCalledWith({
      userId: "user-1",
      chatId: "chat-1",
    });
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("returns no content for a chat without streams", async () => {
    mocks.streams.mockResolvedValue([]);
    expect((await get()).status).toBe(204);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("replays the existing SSE stream without starting another generation", async () => {
    mocks.resume.mockResolvedValue(
      new ReadableStream<string>({
        start(controller) {
          controller.enqueue(
            'data: {"type":"text-delta","id":"text-1","delta":"恢复"}\n\n',
          );
          controller.close();
        },
      }),
    );
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
    expect(await response.text()).toContain("恢复");
    expect(mocks.resume).toHaveBeenCalledWith("stream-1");
  });

  it("restores saved messages when generation finished just after the page loaded", async () => {
    mocks.resume.mockResolvedValue(null);
    const messages = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "问题" }] },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "完整回答" }],
      },
    ];
    mocks.chat.mockResolvedValue({ messages });
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(
      JSON.stringify({
        type: "data-chat-restored",
        data: { messages },
        transient: true,
      }),
    );
  });

  it("does not contact Redis for a completed stream", async () => {
    mocks.streams.mockResolvedValue([
      { id: "stream-1", status: "completed", createdAt: new Date() },
    ]);
    mocks.chat.mockResolvedValue({
      messages: [
        { id: "a", role: "assistant", parts: [{ type: "text", text: "完成" }] },
      ],
    });
    expect((await get()).status).toBe(200);
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("expires orphaned generations so a server restart cannot block a chat forever", async () => {
    mocks.streams.mockResolvedValue([
      {
        id: "stream-1",
        status: "active",
        createdAt: new Date(Date.now() - 121000),
      },
    ]);
    mocks.chat.mockResolvedValue({ messages: [{ role: "user" }] });
    expect((await get()).status).toBe(204);
    expect(mocks.finish).toHaveBeenCalledWith("stream-1", "failed");
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("returns 503 when resume storage is unavailable", async () => {
    mocks.context.mockRejectedValue(new Error("Redis unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect((await get()).status).toBe(503);
    } finally {
      log.mockRestore();
    }
  });
});
