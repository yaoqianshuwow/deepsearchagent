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

预期接口测试 20 项通过，覆盖登录、限流、消息校验、归属检查、生成前保存、保存失败、新建 ID 冲突、Redis 不可用、活动生成冲突、中断和真实 SDK 多轮搜索消息合并。

手动验收：运行 `pnpm dev` 和 `pnpm db:studio`，登录后发送一条问题。在浏览器开发者工具的 Network 中查看 `/api/chat` 响应头的 `X-Chat-Id`；用该 ID 在 `ai-app-template_chat` 和 `ai-app-template_message` 表中查找记录。生成前已有用户消息；正常回复后应同时有用户和 AI 消息，AI 的 `parts` 包含搜索结果和回答，`order` 分别是 0、1。真实请求会消耗每日聊天额度及模型/搜索余额。

## Day 2：第三题——前端创建和续聊

服务端 `page.tsx` 从异步 `searchParams` 读取 `?id=...`，传给 `ChatPage`。前端通过 `DefaultChatTransport` 在请求体传递 `chatId`。接口创建聊天后先发送临时 `data-chat-created` 事件，再继续发送模型回复。前端在 `onData` 中接收通知并导航到 `?id=新ID`，保持聊天 hook 的身份不变，让正在生成的回复继续；下一次发送复用这个 ID。通知不写入消息历史，`X-Chat-Id` 响应头继续保留。第五题把首次请求改为预先生成稳定 ID，并额外发送 `isNewChat=true`。

自动验收：运行 `pnpm exec vitest run src/app/api/chat/route.test.ts`（20 项通过）及 `pnpm typecheck`。接口测试确认新聊天通知在回复文本前发送、续聊不重复通知，通知不进入保存的消息。

手动验收：

1. 运行 `pnpm dev`，登录后在一个新标签页打开首页 `/`（不带 `id`）。
2. 打开浏览器开发者工具的 Network，发送第一条问题。当前第五题版本的请求体应有 `chatId`、`isNewChat=true`；地址应变为 `/?id=同一个ID`，正在生成的回答应继续显示，第一条问题不消失。
3. 回复完成后发送第二条问题。请求体的 `chatId` 应与地址中的 ID 相同、`isNewChat=false`，`messages` 应包含上一轮的问题、回答和当前问题；地址中的 ID 不变。
4. 用 `pnpm db:studio` 查看同一个聊天 ID，完成两轮后应有 4 条消息，顺序为 0 到 3，而不是创建第二条聊天记录。

真实请求消耗每日额度和模型/搜索余额；普通用户默认每天 1 次，验收第二次发送需要仍有额度的账号或已有管理员账号。自动测试不消耗这些额度。已移除指向不存在聊天 `id=1` 的模板示例链接。

## Day 2：第四、五题——历史聊天与新建按钮

服务端按登录用户查询真实聊天列表，并在有 `?id=...` 时加载该聊天的消息。前端以 SDK 的 `messages` 参数初始化历史；切换聊天、刷新页面可恢复原消息。列表按最近更新时间排列，当前聊天高亮。不存在或不属于当前用户的聊天显示“聊天不存在或无权访问”，可返回首页；未登录不读取私人聊天。

首页无 ID 时生成 UUID；点击 `+` 时通过客户端路由进入 `/?draft=新UUID`，由服务端校验并复用该草稿 ID。这个 ID 同时作为 `ChatPage` 的 `key`、SDK 聊天 ID 和接口 `chatId`。首次保存后网址改为 `?id=同一ID`，组件不会重建，流式回答继续。每次点击 `+` 都使用新的草稿 ID，清空旧消息、输入和错误，不提交表单、不整页刷新，也避免复用缓存中的旧 ID。只点 `+` 不创建空聊天，也不会删除旧聊天。接入第七题后，生成途中切换聊天只断开当前页面的连接，后台生成继续，返回聊天后可恢复。

验收步骤：

1. 登录后确认左侧显示自己的真实聊天，点击两条不同记录，右侧消息分别对应各自聊天。
2. 刷新当前聊天，消息应按原顺序恢复，网址 ID 不变；正常完成回复后列表更新。
3. 在已有聊天中输入草稿，再点 `+`：网址变为 `/?draft=新UUID`，右侧消息、输入和错误清空，浏览器不整页刷新。旧聊天仍在列表，点击可以恢复。
4. 在新草稿中再次输入内容并点 `+`，草稿 ID 更新，输入同样清空。发送新问题后，网址变为 `?id=同一UUID`，回答连续生成；续聊使用相同 ID，刷新能看到已保存消息。

检查命令：`pnpm typecheck`、`pnpm exec vitest run src/app/api/chat/route.test.ts`。数据库测试使用 `RUN_CHAT_DB_TESTS=1` 运行 `src/server/chats.integration.test.ts`，预期 8 项通过，包括新建 ID 冲突时不能覆盖自己或其他用户的聊天，以及活动流的并发限制与权限；只操作并清理临时测试用户数据。

## Day 2：第六、七题——滚动与恢复生成

消息区使用 `use-stick-to-bottom`：初次打开停在底部，生成时跟随新增内容；向上滚动查看历史后停止自动跟随，点击“回到最新消息”继续跟随。输入框固定在底部，不随长消息滚出窗口。

`ai-app-template_stream` 记录每次生成的 ID、所属聊天、创建时间和状态。`createStream` 在事务中检查聊天归属并锁住聊天，同一聊天只允许一个活动流；它与初始消息保存使用同一个事务。`getStreamsByChatId` 只返回当前用户可访问的聊天流。

`resumable-stream/ioredis` 在后台消费 SDK 的 SSE 流，浏览器刷新、关闭标签页或切到其他聊天不会取消模型生成。当前 SDK 的 `resume` 和 `GET /api/chat/[id]/stream` 在回来后重放原流，`ResumableChatTransport` 将它标记为完整重放，避免追加重复文本或工具步骤。若生成刚好在页面加载后完成，恢复接口返回已保存的完整消息，处理这个时间差。恢复接口检查登录和归属，不调用模型，也不扣聊天额度。SDK 判断为网络断开后，重新联网或标签页再次可见时也会尝试重连。

Redis 是恢复功能的必要条件；初始化连接失败返回 503，不消耗聊天额度、不调用模型。连接兼容旧版 Redis 的 `AUTH password`。部署时必须让原服务进程保持运行；这不能恢复已经被服务器重启杀掉的模型任务。每次生成最长 60 秒，超过两分钟仍未结束的活动记录可标为失败，避免进程异常后聊天永远被锁住。切换聊天后后台仍会生成，模型和搜索费用照常产生。

数据库更新：对已有项目，先通过 SQL 客户端执行 `drizzle/rename-message-primary-key.sql`，它只重命名带连字符的旧主键约束，绕过旧版 drizzle-kit 的引号问题，不修改消息数据；再运行 `pnpm db:push`。新数据库可直接运行 `pnpm db:push`。

验收步骤：

1. 发送一个需要较长回答的问题，确认长消息出现时自动滚动，输入框始终可见。
2. 生成过程中向上滚动，新内容不能把你拉回底部；点击“回到最新消息”应回到底部并继续跟随。
3. 回答尚未完成时刷新，确认浏览器发起 `GET /api/chat/当前ID/stream`，已生成部分恢复并继续输出，不重复显示。
4. 生成途中点 `+`，再点击原来的聊天，应接回同一条回答。完成后再次刷新，完整消息仍在。
5. 用 `pnpm db:studio` 检查：同一轮只有一条 `stream` 记录，完成状态是 `completed`；刷新恢复没有增加该用户的 `chat_request` 记录。

自动检查：`pnpm typecheck`；`RUN_CHAT_DB_TESTS=1` 下运行 `pnpm exec vitest run`，包含真实数据库权限、活动生成并发，以及恢复接口的未登录、跨用户访问、完成时机竞争、过期流和 Redis 故障测试。恢复本身不额外计费，手动开始新一轮聊天仍消耗正常额度。

## Day 3：第一题——接入 Langfuse

Langfuse 用来查看助手每次调用模型、搜索工具的过程，包括问题、回答、搜索参数与结果、耗时和 token 使用量。运行记录会发送到你配置的 Langfuse 服务。当前项目使用 AI SDK 7，按新版官方集成使用 `@langfuse/vercel-ai-sdk`，替代教程旧版的 `langfuse-vercel` 和 `experimental_telemetry`。

在 Langfuse 后台进入你的项目，在 Settings → API Keys 创建或复制连接配置，填入本地 `.env`（密钥不提交到 Git）：

```dotenv
LANGFUSE_PUBLIC_KEY="从后台复制 Public Key"
LANGFUSE_SECRET_KEY="从后台复制 Secret Key"
LANGFUSE_BASE_URL="从后台复制该项目所在区域的服务地址"
```

注意新版变量名是 `LANGFUSE_BASE_URL`，与旧教程中的 `LANGFUSE_BASEURL` 不同。三个值全空时聊天仍可使用，但不会上传记录；只填一部分会在启动时提示配置不完整。新增或修改配置后需要重启 `pnpm dev`。

`src/instrumentation.ts` 只在 Node.js 服务启动时注册 OpenTelemetry 和 Langfuse 集成，聊天的 `streamText` 使用 `telemetry` 开启记录。结束的 span 立即发送，适用于当前后台消费、可恢复的生成流程；Langfuse 上传失败不应打断正常聊天。当前只完成基础记录，按用户和聊天 ID 分类属于下一题。

验收步骤：

1. 配置 `.env` 并重启服务，确认日志出现 `[Langfuse] 已开启模型与工具调用记录。`。
2. 登录 [本地应用](http://localhost:3000)，新建聊天，发送“搜索 TypeScript 的官方网站，说明它是什么，并给出来源链接”。这会正常消耗一条聊天额度及模型、搜索用量。
3. 回答结束后，打开同一个 Langfuse 项目的 Tracing / Traces 列表，必要时刷新或稍等片刻。
4. 打开刚生成的记录，确认能看到 `deepsearch-agent`、模型调用、`searchWeb` 的搜索参数与返回结果、最终回答、耗时及 token 用量。费用显示取决于平台是否支持对应模型的价格。
5. 若无记录，先检查启动日志是否提示未配置，再确认密钥、服务地址属于同一个 Langfuse 项目；检查 `logs/dev.stderr.log` 的上传错误。

自动检查：`pnpm check`、`pnpm exec vitest run`。`src/instrumentation.test.ts` 使用模拟模型和本地 HTTP 接收端，验证模型 → 工具 → 模型的真实 SDK 遥测能发送到配置的地址，并覆盖未配置、配置不完整和 Edge 跳过初始化的情况；不消耗模型余额、不向真实 Langfuse 上传数据。真实 Langfuse 后台验收需要填入有效配置。

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
