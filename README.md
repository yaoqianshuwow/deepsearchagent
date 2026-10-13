# deepsearchagent

Independent Day 1 learning project extracted from [AI Hero — DeepSearch in TypeScript](https://github.com/ai-hero-dev/ai-hero/tree/main/courses/01-deepsearch-in-typescript/00-apps/01-day-1-app).

This snapshot includes the local changes for DeepSeek chat, QQ Mail email authentication, and rejecting unauthenticated chat requests. The original course code and this adaptation retain the upstream CC BY-NC-SA 4.0 license; see [LICENSE.md](LICENSE.md).

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
