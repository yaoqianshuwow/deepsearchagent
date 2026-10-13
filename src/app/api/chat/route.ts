import {
  APICallError,
  LoadAPIKeyError,
  RetryError,
  convertToModelMessages,
  streamText,
  type UIMessage,
} from "ai";

import { model } from "~/model";
import { auth } from "~/server/auth";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "请先登录后再聊天" }, { status: 401 });
  }

  const { messages } = (await request.json()) as {
    messages: UIMessage[];
  };

  const result = streamText({
    model,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse({
    onError: (error) => {
      console.error(error);
      const cause = RetryError.isInstance(error) ? error.lastError : error;
      if (LoadAPIKeyError.isInstance(cause)) {
        return "服务器未配置 DeepSeek API 密钥，请配置后重启服务。";
      }
      if (APICallError.isInstance(cause)) {
        if (!cause.statusCode) {
          return "服务器无法连接 DeepSeek，请检查网络或代理设置。";
        }
        if (cause.statusCode === 401) {
          return "DeepSeek API 密钥无效，请检查服务器配置。";
        }
        if (cause.statusCode === 402) {
          return "DeepSeek 账户余额不足，请检查账户余额。";
        }
        if (cause.statusCode === 429) {
          return "DeepSeek 请求过于频繁，请稍后重试。";
        }
        return `DeepSeek 调用失败（HTTP ${cause.statusCode}），请稍后重试。`;
      }
      return "生成回复失败，请稍后重试并检查服务器日志。";
    },
  });
}
