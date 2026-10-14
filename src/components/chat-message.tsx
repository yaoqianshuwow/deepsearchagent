import ReactMarkdown, { type Components } from "react-markdown";
import { LoaderCircle, Search } from "lucide-react";
import type { MessagePart } from "~/types/chat";

interface ChatMessageProps {
  parts: MessagePart[];
  role: string;
  userName: string;
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

const SearchToolCall = ({
  part,
}: {
  part: Extract<MessagePart, { type: "tool-searchWeb" }>;
}) => {
  const pending =
    part.state === "input-streaming" || part.state === "input-available";
  const status =
    part.state === "input-streaming"
      ? "正在准备搜索…"
      : part.state === "input-available"
        ? "正在搜索网络…"
        : part.state === "output-available"
          ? `搜索完成，找到 ${part.output.length} 条结果`
          : part.state === "output-error"
            ? "搜索失败，请重试"
            : part.state === "output-denied"
              ? "搜索已取消"
              : "搜索等待确认";

  return (
    <div className="my-3 rounded-lg border border-gray-600 bg-gray-900 p-3 text-sm">
      <div className="flex items-center gap-2" role="status">
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Search className="size-4" aria-hidden="true" />
        )}
        <span>{status}</span>
      </div>
      {part.input?.query && (
        <p className="mt-2 break-words text-gray-400">
          搜索词：{part.input.query}
        </p>
      )}
      {part.state === "output-available" && part.output.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-blue-400">
            查看搜索结果
          </summary>
          <ul className="mt-3 space-y-3">
            {part.output.map((result, index) => (
              <li key={`${result.link}-${index}`}>
                <a
                  className="break-words text-blue-400 underline"
                  href={
                    /^https?:\/\//i.test(result.link) ? result.link : undefined
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {result.title}
                </a>
                <p className="mt-1 break-words text-gray-400">
                  {result.snippet}
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

export const ChatMessage = ({ parts, role, userName }: ChatMessageProps) => {
  const isAI = role === "assistant";

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        {parts.map((part, index) => {
          if (part.type === "text") {
            return (
              <div key={index} className="prose prose-invert max-w-none">
                <Markdown>{part.text}</Markdown>
              </div>
            );
          }
          if (part.type === "tool-searchWeb") {
            return <SearchToolCall key={part.toolCallId} part={part} />;
          }
          return null;
        })}
      </div>
    </div>
  );
};
