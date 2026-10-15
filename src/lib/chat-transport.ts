import { DefaultChatTransport } from "ai";
import type { SearchChatMessage } from "~/types/chat";

export class ResumableChatTransport extends DefaultChatTransport<SearchChatMessage> {
  readonly resumeStreamIsReplay = true;
}
