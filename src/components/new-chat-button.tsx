"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";

export const NewChatButton = () => {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() =>
        router.push(`/?draft=${crypto.randomUUID()}`, { scroll: false })
      }
      aria-label="New Chat"
      title="New Chat"
      className="flex size-8 items-center justify-center rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
      <PlusIcon className="size-5" />
    </button>
  );
};
