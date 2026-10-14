import type { UIDataTypes, UIMessage } from "ai";
import type { searchSerper } from "~/serper";

type SearchResult = Awaited<ReturnType<typeof searchSerper>>["organic"][number];

export type SearchChatMessage = UIMessage<
  unknown,
  UIDataTypes,
  {
    searchWeb: {
      input: { query: string };
      output: Pick<SearchResult, "title" | "link" | "snippet">[];
    };
  }
>;

export type MessagePart = SearchChatMessage["parts"][number];
