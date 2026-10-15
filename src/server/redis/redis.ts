import { createRedisClient } from "./client";

export const redis = createRedisClient();

const CACHE_EXPIRY_SECONDS = 60 * 60 * 6; // 6 hours
const CACHE_KEY_SEPARATOR = ":";

export const cacheWithRedis = <TArgs extends unknown[], TResult>(
  keyPrefix: string,
  fn: (...args: TArgs) => Promise<TResult>,
  options?: {
    keyArgs?: (...args: TArgs) => unknown;
    shouldCache?: (result: TResult) => boolean;
  },
) => {
  return async (...args: TArgs): Promise<TResult> => {
    const key = `${keyPrefix}${CACHE_KEY_SEPARATOR}${JSON.stringify(options?.keyArgs ? options.keyArgs(...args) : args)}`;
    const cachedResult = await redis.get(key);
    if (cachedResult) {
      console.log(`Cache hit for ${key}`);
      return JSON.parse(cachedResult) as TResult;
    }

    const result = await fn(...args);
    if (!options?.shouldCache || options.shouldCache(result)) {
      await redis.set(key, JSON.stringify(result), "EX", CACHE_EXPIRY_SECONDS);
    }
    return result;
  };
};
