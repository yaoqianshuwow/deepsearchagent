import { and, count, eq, gte, lt } from "drizzle-orm";

import { env } from "~/env";
import { db } from "~/server/db";
import { chatRequests, users } from "~/server/db/schema";

const DAY_MS = 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function getChatDayWindow(now: Date) {
  const start =
    Math.floor((now.getTime() + SHANGHAI_OFFSET_MS) / DAY_MS) * DAY_MS -
    SHANGHAI_OFFSET_MS;
  return { start: new Date(start), end: new Date(start + DAY_MS) };
}

type QuotaResult =
  | { status: "allowed" }
  | { status: "unauthorized" }
  | { status: "limited"; limit: number; resetAt: Date; retryAfter: number };

export async function consumeChatQuota(userId: string): Promise<QuotaResult> {
  return db.transaction(async (tx): Promise<QuotaResult> => {
    // Serialize quota checks for the same user, across processes as well as tabs.
    const [user] = await tx
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) return { status: "unauthorized" };

    const now = new Date();
    const { start, end } = getChatDayWindow(now);
    if (!user.isAdmin) {
      const [usage] = await tx
        .select({ total: count() })
        .from(chatRequests)
        .where(
          and(
            eq(chatRequests.userId, userId),
            gte(chatRequests.createdAt, start),
            lt(chatRequests.createdAt, end),
          ),
        );
      if (usage!.total >= env.DAILY_CHAT_LIMIT) {
        return {
          status: "limited",
          limit: env.DAILY_CHAT_LIMIT,
          resetAt: end,
          retryAfter: Math.max(
            1,
            Math.ceil((end.getTime() - now.getTime()) / 1000),
          ),
        };
      }
    }

    // Count accepted requests before spending on AI/search. Failed generations also count.
    await tx.insert(chatRequests).values({ userId, createdAt: now });
    return { status: "allowed" };
  });
}
