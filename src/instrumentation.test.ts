import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isStepCount, simulateReadableStream, streamText, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { propagateAttributes } from "@langfuse/tracing";

const config = vi.hoisted(() => ({
  LANGFUSE_PUBLIC_KEY: undefined as string | undefined,
  LANGFUSE_SECRET_KEY: undefined as string | undefined,
  LANGFUSE_BASE_URL: undefined as string | undefined,
  NODE_ENV: "test",
}));
vi.mock("./env.js", () => ({ env: config }));

import { register } from "./instrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
  config.LANGFUSE_PUBLIC_KEY = undefined;
  config.LANGFUSE_SECRET_KEY = undefined;
  config.LANGFUSE_BASE_URL = undefined;
});

describe("Langfuse instrumentation", () => {
  it("allows starting without Langfuse credentials", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await expect(register()).resolves.toBeUndefined();
  });

  it("rejects partial configuration with a useful error", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    config.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    await expect(register()).rejects.toThrow("Langfuse 配置不完整");
  });

  it("does not initialize Node instrumentation in Edge", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    config.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    await expect(register()).resolves.toBeUndefined();
  });

  it("exports a streamed model/tool/model sequence to the configured OTLP endpoint", async () => {
    const received: { path: string; auth?: string; body: string }[] = [];
    const collector = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const payload = Buffer.concat(chunks);
        received.push({
          path: request.url!,
          auth: request.headers.authorization,
          body: (request.headers["content-encoding"] === "gzip"
            ? gunzipSync(payload)
            : payload
          ).toString(),
        });
        response.writeHead(200, { "Content-Type": "application/x-protobuf" });
        response.end();
      });
    });
    await new Promise<void>((resolve) =>
      collector.listen(0, "127.0.0.1", resolve),
    );
    const address = collector.address();
    if (!address || typeof address === "string") throw new Error("No port");

    try {
      vi.stubEnv("NEXT_RUNTIME", "nodejs");
      config.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
      config.LANGFUSE_SECRET_KEY = "sk-lf-test";
      config.LANGFUSE_BASE_URL = `http://127.0.0.1:${address.port}`;
      await register();

      const usage = {
        inputTokens: { total: 2, noCache: 2, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      };
      const model = new MockLanguageModelV4({
        doStream: [
          {
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start", warnings: [] },
                {
                  type: "tool-call",
                  toolCallId: "search-1",
                  toolName: "searchWeb",
                  input: '{"query":"trace-test-query"}',
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
            stream: simulateReadableStream({
              chunks: [
                { type: "stream-start", warnings: [] },
                { type: "text-start", id: "text-1" },
                {
                  type: "text-delta",
                  id: "text-1",
                  delta: "trace-test-answer",
                },
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
      const result = propagateAttributes(
        {
          userId: "trace-test-user",
          sessionId: "trace-test-chat",
          traceName: "chat",
        },
        () =>
          streamText({
            model,
            prompt: "trace-test-question",
            telemetry: { isEnabled: true, functionId: "deepsearch-agent" },
            stopWhen: isStepCount(3),
            tools: {
              searchWeb: tool({
                inputSchema: z.object({ query: z.string() }),
                execute: async () => [
                  { title: "trace-test-source", link: "https://example.com" },
                ],
              }),
            },
          }),
      );
      // Start another user's generation before consuming either stream. Both
      // streams continue after propagateAttributes has returned to its caller.
      const otherResult = propagateAttributes(
        {
          userId: "another-test-user",
          sessionId: "another-test-chat",
          traceName: "chat",
        },
        () =>
          streamText({
            model: new MockLanguageModelV4({
              doStream: {
                stream: simulateReadableStream({
                  chunks: [
                    { type: "stream-start", warnings: [] },
                    { type: "text-start", id: "other-text" },
                    {
                      type: "text-delta",
                      id: "other-text",
                      delta: "another-test-answer",
                    },
                    { type: "text-end", id: "other-text" },
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
            }),
            prompt: "another-test-question",
            telemetry: { isEnabled: true, functionId: "deepsearch-agent" },
          }),
      );
      await Promise.all([result.consumeStream(), otherResult.consumeStream()]);
      expect(await result.text).toBe("trace-test-answer");
      await vi.waitFor(
        () => {
          const body = received.map((item) => item.body).join("");
          expect(body).toContain("trace-test-question");
          expect(body).toContain("trace-test-query");
          expect(body).toContain("trace-test-source");
          expect(body).toContain("trace-test-answer");
          expect(body).toContain("deepsearch-agent");
          expect(body).toContain("trace-test-user");
          expect(body).toContain("trace-test-chat");
          expect(body).toContain("langfuse.environment");
          expect(body).toContain("test");
          expect(body).toContain("another-test-answer");
          const firstUser = received.filter((item) =>
            item.body.includes("trace-test-user"),
          );
          const secondUser = received.filter((item) =>
            item.body.includes("another-test-user"),
          );
          expect(firstUser.length).toBeGreaterThan(2);
          expect(secondUser.length).toBeGreaterThan(0);
          for (const item of firstUser) {
            expect(item.body).toContain("trace-test-chat");
            expect(item.body).not.toContain("another-test-chat");
            expect(item.body).toContain("langfuse.trace.name");
          }
          for (const item of secondUser) {
            expect(item.body).toContain("another-test-chat");
            expect(item.body).not.toContain("trace-test-chat");
          }
        },
        { timeout: 5000 },
      );
      expect(
        received.every((item) => item.path === "/api/public/otel/v1/traces"),
      ).toBe(true);
      expect(
        received.every(
          (item) =>
            item.auth ===
            `Basic ${Buffer.from("pk-lf-test:sk-lf-test").toString("base64")}`,
        ),
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) =>
        collector.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 15000);
});
