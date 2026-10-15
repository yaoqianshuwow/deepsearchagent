import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import type { ResumableStreamContext } from "resumable-stream/ioredis";
import { createRedisClient } from "~/server/redis/client";

const globalForStreams = globalThis as unknown as {
  streamContext?: Promise<ResumableStreamContext>;
};

export function getStreamContext() {
  if (globalForStreams.streamContext) return globalForStreams.streamContext;
  const publisher = createRedisClient();
  const subscriber = createRedisClient();
  const pending: Promise<ResumableStreamContext> = (async () => {
    try {
      await Promise.all([publisher.connect(), subscriber.connect()]);
      return createResumableStreamContext({
        keyPrefix: "deepsearchagent",
        publisher,
        subscriber,
        waitUntil: after,
      });
    } catch (error) {
      publisher.disconnect();
      subscriber.disconnect();
      throw error;
    }
  })();
  globalForStreams.streamContext = pending;
  const reset = () => {
    if (globalForStreams.streamContext !== pending) return;
    globalForStreams.streamContext = undefined;
    publisher.disconnect();
    subscriber.disconnect();
  };
  publisher.once("end", reset);
  subscriber.once("end", reset);
  void pending.catch(reset);
  return pending;
}
