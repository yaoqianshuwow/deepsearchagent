import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  UI_MESSAGE_STREAM_HEADERS,
} from "ai";
import { auth } from "~/server/auth";
import { getChat } from "~/server/chats";
import { getStreamContext } from "~/server/stream-context";
import { finishStream, getStreamsByChatId } from "~/server/streams";
import type { SearchChatMessage } from "~/types/chat";

export const maxDuration = 60;

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return new Response("请先登录后再聊天", { status: 401 });
  const { id: chatId } = await params;
  if (!chatId || chatId.length > 255)
    return new Response("聊天 ID 无效", { status: 400 });
  const userId = session.user.id;
  try {
    const streams = await getStreamsByChatId({ userId, chatId });
    if (!streams) return new Response("聊天不存在或无权访问", { status: 404 });
    const latest = streams.at(-1);
    if (!latest) return new Response(null, { status: 204 });
    const expired = latest.createdAt.getTime() < Date.now() - 120_000;
    if (latest.status === "active" && expired)
      await finishStream(latest.id, "failed");
    if (latest.status === "active" && !expired) {
      const context = await getStreamContext();
      const resumed = await context.resumeExistingStream(latest.id);
      if (resumed)
        return new Response(resumed.pipeThrough(new TextEncoderStream()), {
          headers: UI_MESSAGE_STREAM_HEADERS,
        });
    }
    // Generation may finish between the server-rendered page and this request.
    const chat = await getChat({ userId, chatId });
    if (chat?.messages.at(-1)?.role !== "assistant")
      return new Response(null, { status: 204 });
    const restored = chat.messages.map(({ id, role, parts }) => ({
      id,
      role,
      parts,
    }));
    return createUIMessageStreamResponse({
      stream: createUIMessageStream<SearchChatMessage>({
        execute: ({ writer }) =>
          writer.write({
            type: "data-chat-restored",
            data: { messages: restored },
            transient: true,
          }),
      }),
    });
  } catch (error) {
    console.error("Stream resume failed", error);
    return new Response("暂时无法恢复回复，请稍后重试", { status: 503 });
  }
}
