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

## TODO

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
