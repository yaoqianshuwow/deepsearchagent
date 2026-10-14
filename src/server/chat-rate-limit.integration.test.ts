import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { count, eq, inArray } from "drizzle-orm";
import type postgres from "postgres";
import type * as Database from "~/server/db";
import type * as Schema from "~/server/db/schema";
import type * as RateLimit from "./chat-rate-limit";

// Opt in: this creates temporary users in the configured local database and removes them.
describe.skipIf(process.env.RUN_RATE_LIMIT_DB_TESTS !== "1")(
  "daily quota with real PostgreSQL",
  () => {
    let db: typeof Database.db;
    let schema: typeof Schema;
    let rateLimit: typeof RateLimit;
    const ids = Array.from({ length: 4 }, () => crypto.randomUUID());

    beforeAll(async () => {
      process.env.DAILY_CHAT_LIMIT = "1";
      ({ db } = await import("~/server/db"));
      schema = await import("~/server/db/schema");
      rateLimit = await import("./chat-rate-limit");
      await db.insert(schema.users).values(
        ids.map((id, i) => ({
          id,
          email: `quota-test-${id}@example.invalid`,
          isAdmin: i === 2,
        })),
      );
    });

    afterAll(async () => {
      if (db)
        await db.delete(schema.users).where(inArray(schema.users.id, ids));
      const connection = (globalThis as unknown as { conn?: postgres.Sql })
        .conn;
      await connection?.end();
    });

    it("allows exactly one of simultaneous requests, and records only the accepted request", async () => {
      const decisions = await Promise.all(
        Array.from({ length: 8 }, () => rateLimit.consumeChatQuota(ids[0]!)),
      );
      expect(decisions.filter((d) => d.status === "allowed")).toHaveLength(1);
      expect(decisions.filter((d) => d.status === "limited")).toHaveLength(7);
      const [usage] = await db
        .select({ total: count() })
        .from(schema.chatRequests)
        .where(eq(schema.chatRequests.userId, ids[0]!));
      expect(usage!.total).toBe(1);
    });

    it("keeps user quotas separate", async () => {
      expect((await rateLimit.consumeChatQuota(ids[1]!)).status).toBe(
        "allowed",
      );
    });

    it("allows admins beyond the limit and still records their requests", async () => {
      const decisions = await Promise.all(
        Array.from({ length: 3 }, () => rateLimit.consumeChatQuota(ids[2]!)),
      );
      expect(decisions.every((d) => d.status === "allowed")).toBe(true);
      const [usage] = await db
        .select({ total: count() })
        .from(schema.chatRequests)
        .where(eq(schema.chatRequests.userId, ids[2]!));
      expect(usage!.total).toBe(3);
    });

    it("does not charge today's quota for yesterday's request", async () => {
      const { start } = rateLimit.getChatDayWindow(new Date());
      await db
        .insert(schema.chatRequests)
        .values({ userId: ids[3]!, createdAt: new Date(start.getTime() - 1) });
      expect((await rateLimit.consumeChatQuota(ids[3]!)).status).toBe(
        "allowed",
      );
      const result = await rateLimit.consumeChatQuota(ids[3]!);
      expect(result.status).toBe("limited");
      if (result.status === "limited") {
        expect(result.retryAfter).toBeGreaterThan(0);
        expect(result.resetAt.getTime()).toBe(start.getTime() + 86400000);
      }
    });

    it("rejects a missing user", async () => {
      expect(
        (await rateLimit.consumeChatQuota(crypto.randomUUID())).status,
      ).toBe("unauthorized");
    });
  },
);
