import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "~/server/db";
import { chats, streams } from "~/server/db/schema";
import { ChatStreamActiveError } from "~/server/chat-errors";

type ChatTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createStream(
  opts: { userId: string; chatId: string; streamId?: string },
  transaction?: ChatTransaction,
) {
  const reserve = async (tx: ChatTransaction) => {
    const [chat] = await tx
      .select()
      .from(chats)
      .where(eq(chats.id, opts.chatId))
      .for("update");
    if (!chat || chat.userId !== opts.userId)
      throw new Error("聊天不存在或无权访问");
    await tx
      .update(streams)
      .set({ status: "failed" })
      .where(
        and(
          eq(streams.chatId, opts.chatId),
          eq(streams.status, "active"),
          lt(streams.createdAt, new Date(Date.now() - 120_000)),
        ),
      );
    const active = await tx.query.streams.findFirst({
      where: and(eq(streams.chatId, opts.chatId), eq(streams.status, "active")),
    });
    if (active) throw new ChatStreamActiveError();
    const streamId = opts.streamId ?? crypto.randomUUID();
    await tx.insert(streams).values({ id: streamId, chatId: opts.chatId });
    return streamId;
  };
  return transaction ? reserve(transaction) : db.transaction(reserve);
}

export async function getStreamsByChatId(opts: {
  userId: string;
  chatId: string;
}) {
  const chat = await db.query.chats.findFirst({
    where: and(eq(chats.id, opts.chatId), eq(chats.userId, opts.userId)),
    with: { streams: { orderBy: [asc(streams.createdAt), asc(streams.id)] } },
  });
  return chat?.streams;
}

export async function finishStream(
  streamId: string,
  status: "completed" | "failed",
) {
  await db.update(streams).set({ status }).where(eq(streams.id, streamId));
}
