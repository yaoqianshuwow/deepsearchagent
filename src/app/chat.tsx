"use client";

import { useChat } from "@ai-sdk/react";
import { ArrowDown, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StickToBottom, useStickToBottom } from "use-stick-to-bottom";

import { ChatMessage } from "~/components/chat-message";
import { SignInModal } from "~/components/sign-in-modal";
import type { SearchChatMessage } from "~/types/chat";
import { ResumableChatTransport } from "~/lib/chat-transport";

interface ChatProps {
  userName: string;
  isAuthenticated: boolean;
  chatId: string;
  isNewChat: boolean;
  initialMessages: SearchChatMessage[];
}

export const ChatPage = ({
  userName,
  isAuthenticated,
  chatId,
  isNewChat,
  initialMessages,
}: ChatProps) => {
  const router = useRouter();
  const isNewChatRef = useRef(isNewChat);
  const shouldResume = useRef(
    !isNewChat && initialMessages.at(-1)?.role === "user",
  ).current;
  const disconnectedRef = useRef(false);
  const stick = useStickToBottom({ initial: "instant", resize: "smooth" });
  const [input, setInput] = useState("");
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const { messages, sendMessage, status, error, setMessages, resumeStream } =
    useChat<SearchChatMessage>({
      id: chatId,
      messages: initialMessages,
      resume: shouldResume,
      // Keep the hook's identity stable when the URL changes during generation.
      transport: new ResumableChatTransport({
        body: () => ({ chatId, isNewChat: isNewChatRef.current }),
      }),
      onData: (part) => {
        if (part.type === "data-chat-created") {
          isNewChatRef.current = false;
          router.push(`?id=${encodeURIComponent(part.data.chatId)}`, {
            scroll: false,
          });
        }
        if (part.type === "data-chat-restored") setMessages(part.data.messages);
      },
      onFinish: ({ isAbort, isDisconnect, isError }) => {
        disconnectedRef.current = isDisconnect;
        if (!isAbort && !isDisconnect && !isError) router.refresh();
      },
    });
  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    const reconnect = () => {
      if (disconnectedRef.current && document.visibilityState === "visible") {
        disconnectedRef.current = false;
        void resumeStream();
      }
    };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [resumeStream]);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const text = input.trim();
    if (!text || isLoading) return;
    if (!isAuthenticated) {
      setIsSignInOpen(true);
      return;
    }

    void sendMessage({ text });
    void stick.scrollToBottom();
    setInput("");
  };

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <StickToBottom instance={stick} className="relative min-h-0 flex-1">
          <StickToBottom.Content
            scrollClassName="overflow-y-auto scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500"
            className="mx-auto w-full max-w-[65ch] p-4"
            role="log"
            aria-label="Chat messages"
          >
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                parts={message.parts}
                role={message.role}
                userName={userName}
              />
            ))}
          </StickToBottom.Content>
          {!stick.isAtBottom && (
            <button
              type="button"
              aria-label="回到最新消息"
              onClick={() => void stick.scrollToBottom()}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-gray-600 bg-gray-800 p-2 text-gray-200 shadow-lg hover:bg-gray-700"
            >
              <ArrowDown className="size-4" />
            </button>
          )}
        </StickToBottom>

        <div className="border-t border-gray-700">
          {error && (
            <p
              role="alert"
              className="mx-auto max-w-[65ch] px-4 pt-4 text-sm text-red-400"
            >
              回复失败：{error.message}
            </p>
          )}
          <form
            onSubmit={handleFormSubmit}
            className="mx-auto max-w-[65ch] p-4"
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Say something..."
                autoFocus
                aria-label="Chat input"
                disabled={isLoading}
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2 text-gray-200 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
                aria-label={isLoading ? "Generating response" : "Send message"}
              >
                {isLoading ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <SignInModal
        isOpen={isSignInOpen}
        onClose={() => setIsSignInOpen(false)}
      />
    </>
  );
};
