import { PlusIcon } from "lucide-react";
import { startNewChat } from "~/server/new-chat";

export const NewChatButton = () => {
  return (
    <form action={startNewChat}>
      <button
        type="submit"
        aria-label="New Chat"
        title="New Chat"
        className="flex size-8 items-center justify-center rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <PlusIcon className="size-5" />
      </button>
    </form>
  );
};
