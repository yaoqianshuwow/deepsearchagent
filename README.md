# deepsearchagent

Independent Day 1 learning project extracted from [AI Hero — DeepSearch in TypeScript](https://github.com/ai-hero-dev/ai-hero/tree/main/courses/01-deepsearch-in-typescript/00-apps/01-day-1-app).

This snapshot includes the local changes for DeepSeek chat, QQ Mail email authentication, and rejecting unauthenticated chat requests. The original course code and this adaptation retain the upstream CC BY-NC-SA 4.0 license; see [LICENSE.md](LICENSE.md).

## 每日聊天限流

普通用户默认每天 1 次，可在 `.env` 中用 `DAILY_CHAT_LIMIT=1` 调整，修改后重启开发服务。按北京时间每天 00:00 重置。

每个通过额度检查的 `/api/chat` 请求会在 `ai-app-template_chat_request` 中记录一次，包括之后生成失败的请求；一次请求中的多轮搜索不重复计数。超额请求返回 HTTP 429 和 `Retry-After`，不会调用模型或搜索。无效消息不占额度。

运行 `pnpm db:push` 更新表结构，用 `pnpm db:studio` 查看请求记录。用户表中的 `isAdmin` 默认为 `false`；将自己的用户设为 `true` 可免限额，管理员请求仍会记录。不需要重新登录即可生效。

数据库集成测试仅操作临时测试用户，并在结束后删除它们及其请求记录：

```powershell
$env:RUN_RATE_LIMIT_DB_TESTS = "1"
pnpm exec vitest run src/server/chat-rate-limit.integration.test.ts
Remove-Item Env:RUN_RATE_LIMIT_DB_TESTS
```

## Day 2：第一题——聊天存储

`src/server/db/schema.ts` 定义聊天和消息表，`src/server/chats.ts` 提供：

- `upsertChat({ userId, chatId, title, messages })`：按指定 ID 创建或更新聊天，在事务中整体替换消息；拒绝修改其他用户的聊天。
- `getChat({ userId, chatId })`：读取自己的聊天及按原顺序排列的消息；不存在或不属于自己时返回 `undefined`。
- `getChats({ userId })`：只读取自己的聊天列表，按最近更新时间排序，不加载消息。

消息使用现有 `SearchChatMessage` 类型，保存 ID、role、parts 和顺序，包含搜索工具调用及结果。调用方必须使用服务端登录会话中的 `userId`。第一题只实现存储函数；聊天 API 接入见下面第二题，刷新页面后恢复历史属于后续题目。

运行 `pnpm db:push` 同步本地表结构。真实数据库测试只创建临时测试用户，结束后级联删除其聊天和消息：

```powershell
$env:RUN_CHAT_DB_TESTS = "1"
try { pnpm exec vitest run src/server/chats.integration.test.ts }
finally { Remove-Item Env:RUN_CHAT_DB_TESTS }
pnpm check
```

## Day 2：第二题——聊天 API 接入存储

`POST /api/chat` 接收完整的 `messages` 数组。第二题最初使用可选的 `chatId`；第五题将接口更新为必传 `chatId` 和 `isNewChat`：`isNewChat=true` 按指定 ID 创建，`false` 时只能更新当前用户已有的聊天，否则返回 404。新建 ID 冲突时返回 409，不覆盖已有聊天。用户 ID 来自服务端登录会话。新聊天标题取第一条用户消息的文本（最多 100 字符），续聊保留原标题。

通过消息格式、聊天归属和每日额度检查后，先保存消息，再调用模型。正常结束时使用当前 AI SDK 的 `originalMessages` 和 `onEnd` 保存包含工具调用、工具结果及回答的完整消息。中断或生成失败时保留生成前已保存的消息；首次保存失败返回 503，不调用模型。已通过额度检查的请求仍计入当天次数，包括后续保存或生成失败的请求。

响应头 `X-Chat-Id` 返回本次聊天 ID。第二题只实现接口；前端传递 ID 见第三、五题，历史加载见第四题。

自动验收（使用模拟模型和数据库函数，不消耗模型余额或聊天额度）：

```powershell
pnpm exec vitest run src/app/api/chat/route.test.ts
pnpm typecheck
pnpm exec eslint src/app/api/chat/route.ts src/app/api/chat/route.test.ts
```

预期接口测试 18 项通过，覆盖登录、限流、消息校验、归属检查、生成前保存、保存失败、新建 ID 冲突、中断和真实 SDK 多轮搜索消息合并。

手动验收：运行 `pnpm dev` 和 `pnpm db:studio`，登录后发送一条问题。在浏览器开发者工具的 Network 中查看 `/api/chat` 响应头的 `X-Chat-Id`；用该 ID 在 `ai-app-template_chat` 和 `ai-app-template_message` 表中查找记录。生成前已有用户消息；正常回复后应同时有用户和 AI 消息，AI 的 `parts` 包含搜索结果和回答，`order` 分别是 0、1。真实请求会消耗每日聊天额度及模型/搜索余额。

## Day 2：第三题——前端创建和续聊

服务端 `page.tsx` 从异步 `searchParams` 读取 `?id=...`，传给 `ChatPage`。前端通过 `DefaultChatTransport` 在请求体传递 `chatId`。接口创建聊天后先发送临时 `data-chat-created` 事件，再继续发送模型回复。前端在 `onData` 中接收通知并导航到 `?id=新ID`，保持聊天 hook 的身份不变，让正在生成的回复继续；下一次发送复用这个 ID。通知不写入消息历史，`X-Chat-Id` 响应头继续保留。第五题把首次请求改为预先生成稳定 ID，并额外发送 `isNewChat=true`。

自动验收：运行 `pnpm exec vitest run src/app/api/chat/route.test.ts`（18 项通过）及 `pnpm typecheck`。接口测试确认新聊天通知在回复文本前发送、续聊不重复通知，通知不进入保存的消息。

手动验收：

1. 运行 `pnpm dev`，登录后在一个新标签页打开首页 `/`（不带 `id`）。
2. 打开浏览器开发者工具的 Network，发送第一条问题。当前第五题版本的请求体应有 `chatId`、`isNewChat=true`；地址应变为 `/?id=同一个ID`，正在生成的回答应继续显示，第一条问题不消失。
3. 回复完成后发送第二条问题。请求体的 `chatId` 应与地址中的 ID 相同、`isNewChat=false`，`messages` 应包含上一轮的问题、回答和当前问题；地址中的 ID 不变。
4. 用 `pnpm db:studio` 查看同一个聊天 ID，完成两轮后应有 4 条消息，顺序为 0 到 3，而不是创建第二条聊天记录。

真实请求消耗每日额度和模型/搜索余额；普通用户默认每天 1 次，验收第二次发送需要仍有额度的账号或已有管理员账号。自动测试不消耗这些额度。已移除指向不存在聊天 `id=1` 的模板示例链接。

## Day 2：第四、五题——历史聊天与新建按钮

服务端按登录用户查询真实聊天列表，并在有 `?id=...` 时加载该聊天的消息。前端以 SDK 的 `messages` 参数初始化历史；切换聊天、刷新页面可恢复原消息。列表按最近更新时间排列，当前聊天高亮。不存在或不属于当前用户的聊天显示“聊天不存在或无权访问”，可返回首页；未登录不读取私人聊天。

无 ID 的页面在服务端先生成 UUID，将它同时作为 `ChatPage` 的 `key`、SDK 聊天 ID 和接口 `chatId`。首次保存后网址使用同一 ID，组件不会重建，流式回答继续；点击 `+` 返回首页并刷新，获得新 UUID，清空旧消息、输入和错误。只点 `+` 不创建空聊天，也不会删除旧聊天。生成途中切换聊天会停止当前前端请求，生成前保存的问题仍保留；刷新后续接未完成生成属于第七题。

验收步骤：

1. 登录后确认左侧显示自己的真实聊天，点击两条不同记录，右侧消息分别对应各自聊天。
2. 刷新当前聊天，消息应按原顺序恢复，网址 ID 不变；正常完成回复后列表更新。
3. 在已有聊天中输入草稿，再点 `+`：网址回到 `/`，右侧消息、输入和错误清空。旧聊天仍在列表，点击可以恢复。
4. 在首页再次输入草稿并点 `+`，草稿同样清空。发送新问题后，网址变为新 ID，回答连续生成；续聊使用相同 ID，刷新能看到已保存消息。

检查命令：`pnpm typecheck`、`pnpm exec vitest run src/app/api/chat/route.test.ts`。数据库测试使用 `RUN_CHAT_DB_TESTS=1` 运行 `src/server/chats.integration.test.ts`，预期 7 项通过，包括新建 ID 冲突时不能覆盖自己或其他用户的聊天；只操作并清理临时测试用户数据。

## 后续待办

Do related followup questions.

Handle anonymous requests to the API, rate limit by IP.

Use a chunking system on the crawled information.

Add 'edit' button, and 'rerun from here' button.

Add evals.

Handle conversations longer than the context window by summarizing.

How do you get the LLM to ask followup questions?

## Setup

1. Copy `.env.example` to `.env`, fill in your local credentials, and install dependencies with `pnpm`. Real `.env` files are not committed.

```bash
cp .env.example .env
pnpm install
```

2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)

3. Run `./start-database.sh` to start the database.

4. Run `./start-redis.sh` to start the Redis server.

5. Run `pnpm db:push` to create the database tables, then `pnpm db:studio` to open the database browser.

### Windows PowerShell

Use Node.js 22 and start Docker Desktop before running the database scripts:

```powershell
pnpm install
& "C:\Program Files\Git\bin\bash.exe" ./start-database.sh
& "C:\Program Files\Git\bin\bash.exe" ./start-redis.sh
pnpm db:push
pnpm db:studio
pnpm dev
```

### Email login

Set `AUTH_SECRET` and the `EMAIL_SERVER_*` / `EMAIL_FROM` variables shown in `.env.example`. For QQ Mail, enable SMTP and use the SMTP authorization code as `EMAIL_SERVER_PASSWORD`, rather than your QQ password. Port 465 uses TLS.

Start the database and run `pnpm db:push` before signing in. Click **Sign in**, enter your email address, and follow the link in the email to log in. **Sign out** returns you to the home page. Requests to `/api/chat` without a valid session return HTTP 401.

The local `pnpm-workspace.yaml` keeps pnpm from reading unrelated workspace configuration in parent directories. The `.npmrc` limits dependency directory names to avoid Windows path length errors when loading Drizzle.
