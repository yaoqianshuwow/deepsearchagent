import Redis from "ioredis";
import { env } from "~/env";

export function createRedisClient() {
  const url = new URL(env.REDIS_URL);
  // Redis before 6 only supports AUTH password, not AUTH default password.
  if (url.username === "default") url.username = "";
  const client = new Redis(url.toString(), {
    lazyConnect: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    retryStrategy: (attempt) =>
      attempt <= 3 ? Math.min(attempt * 200, 1000) : null,
  });
  client.on("error", (error: Error) =>
    console.error("Redis connection failed:", error.message),
  );
  return client;
}
