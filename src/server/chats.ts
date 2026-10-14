import { and, asc, desc, eq } from "drizzle-orm";

import { db } from "~/server/db";
import { chats, messages } from "~/server/db/schema";
import type { SearchChatMessage } from "~/types/chat";

export const upsertChat = async (opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: SearchChatMessage[];
}) => {
  return db.transaction(async (tx) => {
    await tx
      .insert(chats)
      .values({ id: opts.chatId, userId: opts.userId, title: opts.title })
      .onConflictDoNothing({ target: chats.id });

    // Serialize replacements for this chat, including simultaneous first writes.
    const [chat] = await tx
      .select()
      .from(chats)
      .where(eq(chats.id, opts.chatId))
      .for("update");
    if (!chat || chat.userId !== opts.userId) {
      throw new Error("无权修改此聊天");
    }

    const [savedChat] = await tx
      .update(chats)
      .set({ title: opts.title, updatedAt: new Date() })
      .where(eq(chats.id, opts.chatId))
      .returning();
    await tx.delete(messages).where(eq(messages.chatId, opts.chatId));
    if (opts.messages.length > 0) {
      await tx.insert(messages).values(
        opts.messages.map((message, order) => ({
          id: message.id,
          chatId: opts.chatId,
          role: message.role,
          parts: message.parts,
          order,
        })),
      );
    }
    return savedChat!;
  });
};

export const getChat = async (opts: { userId: string; chatId: string }) => {
  return db.query.chats.findFirst({
    where: and(eq(chats.id, opts.chatId), eq(chats.userId, opts.userId)),
    with: { messages: { orderBy: [asc(messages.order)] } },
  });
};

export const getChats = async (opts: { userId: string }) => {
  return db.query.chats.findMany({
    where: eq(chats.userId, opts.userId),
    orderBy: [desc(chats.updatedAt), asc(chats.id)],
  });
};
