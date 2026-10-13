import { env } from "./src/env.js";
import Redis from "ioredis";

const redis = new Redis(env.REDIS_URL);

async function testRedis() {
  try {
    const pong = await redis.ping();
    console.log("Redis ping response:", pong);
    console.log("Redis connection successful!");
  } catch (error) {
    console.error("Redis connection failed:", error);
  } finally {
    await redis.quit();
  }
}

testRedis();
