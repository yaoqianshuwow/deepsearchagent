# React、Next.js 与 AI SDK 问答

这份笔记整理了聊天应用接入过程中关于 React、Next.js、`useChat` 和 `/api/chat` 的问题。说明以当前项目的 AI SDK 7 用法为准，并尽量用 C++ 概念作类比。

## 1. `"use client"` 有什么作用？这是官方用法吗？

是的。`"use client"` 是 React 支持的指令，也是 Next.js 官方用来声明客户端组件入口的方式。它要放在文件最顶部、所有 `import` 之前。

客户端组件可以使用 `useState` 等状态 Hook、处理点击和输入事件，也可以使用浏览器 API。当前聊天组件使用 `useState` 和 `useChat`，所以文件需要声明 `"use client"`。

不必每个客户端组件文件都加这行。从这个入口导入的组件和依赖也会进入客户端模块范围。它也不表示首屏一定只在浏览器渲染：Next.js 可以先生成 HTML，再由浏览器接管交互，这个过程叫 hydration。

## 2. `react` 和 `@ai-sdk/react` 分别做什么？

- `react` 是界面库。当前代码从中使用 `useState`，保存输入框的文字。
- `@ai-sdk/react` 是 AI SDK 的 React 集成。当前代码从中使用 `useChat`，管理聊天消息、发送请求和接收流式回复。

```tsx
import { useChat } from "@ai-sdk/react";
import { useState } from "react";

const [input, setInput] = useState("");
const { messages, sendMessage, status } = useChat();
```

可以粗略理解为：`useState` 管理普通界面数据，`useChat` 管理 AI 对话数据。

## 3. `useChat` 怎么用？

`useChat()` 是一个 React Hook，必须在客户端组件函数的顶层调用。它返回聊天状态和操作函数：

```tsx
const { messages, sendMessage, status, error } = useChat();
```

- `messages`：当前对话消息数组。
- `sendMessage`：发送一条新消息并请求模型回复。
- `status`：当前状态，例如 `submitted`（请求已提交）、`streaming`（正在接收回复）、`ready`（空闲）。
- `error`：请求失败时的错误。

当前 AI SDK 版本使用 `sendMessage` 和 `status`。课程中出现的 `input`、`handleInputChange`、`handleSubmit`、`isLoading` 是旧版 `useChat` API；在当前项目里，输入值由 React `useState` 管理，加载状态根据 `status` 判断：

```tsx
const [input, setInput] = useState("");
const { messages, sendMessage, status } = useChat();
const isLoading = status === "submitted" || status === "streaming";
```

## 4. `sendMessage` 的作用和用法是什么？

它把用户的新消息加入对话，并触发到聊天 API 的请求。当前项目这样调用：

```tsx
void sendMessage({ text: "你好" });
```

`{ text: "你好" }` 是消息对象。`sendMessage` 返回一个 `Promise`，代表发送过程；`void` 表示这里发起请求但不等待它结束，聊天状态由 `useChat` 管理。

常见表单处理方式：

```tsx
function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
  event.preventDefault();

  const text = input.trim();
  if (!text || isLoading) return;

  setInput("");
  void sendMessage({ text });
}
```

`event.preventDefault()` 阻止浏览器提交表单时刷新页面；`trim()` 去掉首尾空格；空消息或生成中时直接返回。

## 5. `/api/chat` 的 URL 是怎么来的？

Next.js App Router 根据 `app` 目录中的文件夹自动生成路径：

```text
src/app/api/chat/route.ts  →  /api/chat
```

`route.ts` 是 Next.js 约定的请求处理入口。它导出 `POST` 函数后，就能处理发往 `/api/chat` 的 POST 请求。

前端调用 `useChat()` 时没有写 URL，是因为 AI SDK 默认将请求发往 `/api/chat`。也可以显式指定：

```tsx
const chat = useChat({ api: "/api/chat" });
```

所以这段连接由两部分组成：Next.js 把 URL 路由到 `route.ts`，AI SDK 把 `sendMessage` 请求发到这个 URL。

## 6. `/api/chat` 的后端代码做了什么？

接口文件：`src/app/api/chat/route.ts`。

```tsx
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { model } from "~/model";

export const maxDuration = 60;

export async function POST(request: Request) {
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
      return "Oops, an error occurred!";
    },
  });
}
```

模块和函数的作用：

- `ai`：AI SDK 核心包。提供消息转换、流式生成和消息类型。
- `~/model`：项目自己的模型配置，路径别名 `~/` 指向 `src/`。
- `request.json()`：读取前端 POST 请求中的 JSON 消息。
- `convertToModelMessages(...)`：把 UI 使用的消息格式转换为模型需要的格式。
- `streamText(...)`：调用配置好的模型，逐段生成文字。
- `toUIMessageStreamResponse()`：把模型输出包装成 `useChat` 能接收的流式响应。
- `onError`：错误详情写入服务端日志，并向前端返回通用提示。
- `maxDuration = 60`：Next.js 路由配置，允许该请求最多执行 60 秒。

注意：`as { messages: UIMessage[] }` 是 TypeScript 的类型断言，只帮助编译器理解数据形状，不会在运行时验证 JSON。

## 7. React 会把 URL 和控件自动绑定吗？

React 本身不负责把 URL 映射到页面或接口。当前项目中：

- **Next.js** 根据文件目录决定 URL 对应的页面或接口。
- **AI SDK 的 `useChat`** 在调用 `sendMessage` 时向 `/api/chat` 发送请求。
- **React** 根据状态变化更新输入框、消息列表和加载图标。

从 C++ 角度粗略类比：React 负责界面和状态，Next.js 负责请求路由，AI SDK 负责聊天请求及流式状态。

## 8. 怎么判断一个项目用了什么框架？

先看根目录 `package.json`：

- `dependencies` 列出项目依赖。
- `scripts` 列出常用启动和构建命令。

当前项目包含 `next` 依赖，并用 `next dev --turbo` 启动，因此是 Next.js 项目。它同时依赖 `react` 和 `react-dom`，因为 Next.js 是基于 React 的框架。

目录也能帮助确认：`src/app/page.tsx` 是 App Router 页面入口；`src/app/api/chat/route.ts` 是 API 路由入口。单独看到 `react` 依赖还不足以判断项目是不是 Next.js，因为 React 也可以搭配其他框架或构建工具使用。

## 完整请求流程

```text
用户输入文字
  → React useState 更新输入框
  → 表单调用 useChat 返回的 sendMessage
  → AI SDK POST /api/chat
  → Next.js 路由到 src/app/api/chat/route.ts
  → AI SDK 调用 DeepSeek 模型并流式生成
  → useChat 更新 messages/status
  → React 重新绘制聊天界面
```
