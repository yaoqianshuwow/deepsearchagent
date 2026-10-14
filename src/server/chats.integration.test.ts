import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import type postgres from "postgres";

import type * as Database from "~/server/db";
import type * as Schema from "~/server/db/schema";
import type * as Chats from "./chats";
import type { SearchChatMessage } from "~/types/chat";

// Only creates temporary users/chats; cascading deletes remove all test messages.
describe.skipIf(process.env.RUN_CHAT_DB_TESTS !== "1")(
  "chat persistence with real PostgreSQL",
  () => {
    let db: typeof Database.db;
    let schema: typeof Schema;
    let api: typeof Chats;
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    const original: SearchChatMessage[] = [
      { id: "z-first", role: "user", parts: [{ type: "text", text: "问题" }] },
      {
        id: "a-second",
        role: "assistant",
        parts: [
          {
            type: "tool-searchWeb",
            toolCallId: "search-1",
            state: "output-available",
            input: { query: "问题" },
            output: [
              { title: "来源", link: "https://example.com", snippet: "摘要" },
            ],
          },
          { type: "text", text: "回答" },
        ],
      },
    ];

    beforeAll(async () => {
      ({ db } = await import("~/server/db"));
      schema = await import("~/server/db/schema");
      api = await import("./chats");
      await db.insert(schema.users).values(
        [userId, otherUserId].map((id) => ({
          id,
          email: `chat-test-${id}@example.invalid`,
        })),
      );
    });

    afterAll(async () => {
      if (db) {
        await db
          .delete(schema.users)
          .where(inArray(schema.users.id, [userId, otherUserId]));
      }
      await (globalThis as unknown as { conn?: postgres.Sql }).conn?.end();
    });

    it("creates a chat with its supplied id and preserves message order and tool parts", async () => {
      await api.upsertChat({
        userId,
        chatId,
        title: "第一次聊天",
        messages: original,
      });
      const chat = await api.getChat({ userId, chatId });
      expect(chat).toMatchObject({ id: chatId, userId, title: "第一次聊天" });
      expect(
        chat?.messages.map(({ id, role, parts }) => ({ id, role, parts })),
      ).toEqual(original);
      expect(chat?.messages.map((message) => message.order)).toEqual([0, 1]);
    });

    it("only lists the owner's chats without loading their messages", async () => {
      const list = await api.getChats({ userId });
      expect(list).toHaveLength(1);
      expect(list[0]).not.toHaveProperty("messages");
      expect(await api.getChats({ userId: otherUserId })).toEqual([]);
      expect(
        await api.getChat({ userId: otherUserId, chatId }),
      ).toBeUndefined();
      expect(
        await api.getChat({ userId, chatId: crypto.randomUUID() }),
      ).toBeUndefined();
    });

    it("rejects another user's write and preserves the existing chat", async () => {
      await expect(
        api.upsertChat({
          userId: otherUserId,
          chatId,
          title: "覆盖",
          messages: [],
        }),
      ).rejects.toThrow("无权修改此聊天");
      expect((await api.getChat({ userId, chatId }))?.messages).toHaveLength(2);
      expect((await api.getChat({ userId, chatId }))?.title).toBe("第一次聊天");
    });

    it("rolls back the deletion and title change if replacement insertion fails", async () => {
      await expect(
        api.upsertChat({
          userId,
          chatId,
          title: "不应保存",
          messages: [original[0]!, original[0]!],
        }),
      ).rejects.toThrow();
      const chat = await api.getChat({ userId, chatId });
      expect(chat?.title).toBe("第一次聊天");
      expect(
        chat?.messages.map(({ id, role, parts }) => ({ id, role, parts })),
      ).toEqual(original);
    });

    it("replaces all messages, updates the title, and supports empty chats", async () => {
      await api.upsertChat({
        userId,
        chatId,
        title: "更新",
        messages: [original[1]!],
      });
      const chat = await api.getChat({ userId, chatId });
      expect(chat?.title).toBe("更新");
      expect(chat?.messages).toHaveLength(1);
      expect(chat?.messages[0]).toMatchObject({ id: "a-second", order: 0 });
      await api.upsertChat({ userId, chatId, title: "空聊天", messages: [] });
      expect((await api.getChat({ userId, chatId }))?.messages).toEqual([]);
    });

    it("keeps concurrent first writes as complete snapshots without duplicates", async () => {
      const concurrentChatId = crypto.randomUUID();
      await Promise.all(
        original.map((message) =>
          api.upsertChat({
            userId,
            chatId: concurrentChatId,
            title: message.id,
            messages: [message],
          }),
        ),
      );
      const chat = await api.getChat({ userId, chatId: concurrentChatId });
      expect(chat?.messages).toHaveLength(1);
      expect(chat?.messages[0]?.id).toBe(chat?.title);
      expect(chat?.messages[0]?.order).toBe(0);
    });
  },
);
