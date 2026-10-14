import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({ env: { DAILY_CHAT_LIMIT: 1 } }));
vi.mock("~/server/db", () => ({ db: {} }));

import { getChatDayWindow } from "./chat-rate-limit";

describe("Shanghai quota calendar day", () => {
  it("changes at midnight in Shanghai, independent of the host timezone", () => {
    const before = getChatDayWindow(new Date("2026-10-14T15:59:59.999Z"));
    const after = getChatDayWindow(new Date("2026-10-14T16:00:00.000Z"));
    expect(before.start.toISOString()).toBe("2026-10-13T16:00:00.000Z");
    expect(before.end.toISOString()).toBe("2026-10-14T16:00:00.000Z");
    expect(after.start.toISOString()).toBe(before.end.toISOString());
    expect(after.end.toISOString()).toBe("2026-10-15T16:00:00.000Z");
  });
});
