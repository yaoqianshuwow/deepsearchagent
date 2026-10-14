"use client";

import { useChat } from "@ai-sdk/react";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";

import { ChatMessage } from "~/components/chat-message";
import { SignInModal } from "~/components/sign-in-modal";
import type { SearchChatMessage } from "~/types/chat";

interface ChatProps {
  userName: string;
  isAuthenticated: boolean;
}

export const ChatPage = ({ userName, isAuthenticated }: ChatProps) => {
  const [input, setInput] = useState("");
  const [isSignInOpen, setIsSignInOpen] = useState(false);
  const { messages, sendMessage, status, error } = useChat<SearchChatMessage>();
  const isLoading = status === "submitted" || status === "streaming";

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const text = input.trim();
    if (!text || isLoading) return;
    if (!isAuthenticated) {
      setIsSignInOpen(true);
      return;
    }

    void sendMessage({ text });
    setInput("");
  };

  return (
    <>
      <div className="flex flex-1 flex-col">
        <div
          className="mx-auto w-full max-w-[65ch] flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500"
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
        </div>

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
