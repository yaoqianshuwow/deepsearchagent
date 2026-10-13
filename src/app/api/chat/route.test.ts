import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  convert: vi.fn(),
  stream: vi.fn(),
  response: vi.fn(),
}));

vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("~/model", () => ({ model: "test-model" }));
vi.mock("ai", () => ({
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
    expect(mocks.stream).toHaveBeenCalledWith({
      model: "test-model",
      messages: modelMessages,
    });
  });
});
