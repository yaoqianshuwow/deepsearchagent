import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "~/server/auth/index.ts";
import { getChat, getChats } from "~/server/chats";
import { NewChatButton } from "~/components/new-chat-button";
import type { SearchChatMessage } from "~/types/chat";
import { ChatPage } from "./chat.tsx";
import { AuthButton } from "../components/auth-button.tsx";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string | string[] }>;
}) {
  const { id } = await searchParams;
  const chatIdFromUrl =
    typeof id === "string" && id.length > 0 ? id : undefined;
  const chatId = chatIdFromUrl ?? crypto.randomUUID();
  const session = await auth();
  const userName = session?.user?.name ?? session?.user?.email ?? "Guest";
  const isAuthenticated = !!session?.user;
  const userId = session?.user?.id;
  const [chats, chat] = userId
    ? await Promise.all([
        getChats({ userId }),
        chatIdFromUrl
          ? getChat({ userId, chatId: chatIdFromUrl })
          : Promise.resolve(undefined),
      ])
    : [[], undefined];
  if (userId && chatIdFromUrl && !chat) notFound();
  const initialMessages: SearchChatMessage[] =
    chat?.messages.map(({ id, role, parts }) => ({ id, role, parts })) ?? [];

  return (
    <div className="flex h-screen bg-gray-950">
      {/* Sidebar */}
      <div className="flex w-64 flex-col border-r border-gray-700 bg-gray-900">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-400">Your Chats</h2>
            {isAuthenticated && <NewChatButton />}
          </div>
        </div>
        <div className="-mt-1 flex-1 space-y-2 overflow-y-auto px-4 pt-1 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600">
          {chats.map((chat) => (
            <Link
              key={chat.id}
              href={`/?id=${encodeURIComponent(chat.id)}`}
              aria-current={chat.id === chatIdFromUrl ? "page" : undefined}
              className={`block rounded-lg p-3 text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                chat.id === chatIdFromUrl
                  ? "bg-gray-700"
                  : "bg-gray-800 hover:bg-gray-700"
              }`}
            >
              {chat.title}
            </Link>
          ))}
          {chats.length === 0 && (
            <p className="text-sm text-gray-500">
              {isAuthenticated
                ? "No chats yet. Start a new conversation!"
                : "Sign in to start chatting"}
            </p>
          )}
        </div>
        <div className="p-4">
          <AuthButton
            isAuthenticated={isAuthenticated}
            userImage={session?.user?.image}
          />
        </div>
      </div>

      <ChatPage
        key={chatId}
        userName={userName}
        isAuthenticated={isAuthenticated}
        chatId={chatId}
        isNewChat={!chatIdFromUrl}
        initialMessages={initialMessages}
      />
    </div>
  );
}
