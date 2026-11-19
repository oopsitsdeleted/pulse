import { describe, expect, it } from "vitest";
import { metricsWithLoggedBody } from "./body";
import { MemoryStore } from "./memory";
import { dailyValuesWithServer, serverSnapshotSchema } from "./serverVitals";
import { emptyMetrics } from "./types";

const day = "2026-11-19";
const timeZone = "Asia/Singapore";
const range = { from: day, to: day };
const snapshot = {
  version: 1 as const, timeZone, ...range,
  vitals: [{ day, spo2Pct: 97.1, respBpm: 16.4, rhrBpm: 63, hrvMs: 79.8, hrvDeepMs: null, vo2maxDaily: null, vo2maxRun: null }],
  activity: [{ day, key: "active_calories" as const, value: 450 }],
};

describe("server supplement", () => {
  it("fills gaps without modifying Health Connect rows or combining overlapping totals", async () => {
    const store = new MemoryStore();
    await store.upsertMetrics([{ ...emptyMetrics(day), hrvMs: 80 }]);
    await store.upsertDailyValues([{ day, key: "active_calories", value: 120 }]);
    await store.setServerVitals({ snapshot, syncedAt: 1 });
    expect(await metricsWithLoggedBody(store, timeZone)).toMatchObject([{ spo2Pct: 97.1, respBpm: 16.4, rhrBpm: 63, hrvMs: 80 }]);
    expect(await store.allMetrics()).toMatchObject([{ spo2Pct: null, rhrBpm: null }]);
    expect(await dailyValuesWithServer(store, range, timeZone)).toEqual(snapshot.activity);
    expect(await dailyValuesWithServer(store, range, "UTC")).toMatchObject([{ value: 120 }]);
    await store.clearImported(range, 0, 1);
    expect(await metricsWithLoggedBody(store, timeZone)).toMatchObject([{ spo2Pct: 97.1 }]);
    await store.setServerVitals(null);
    expect(await metricsWithLoggedBody(store, timeZone)).toEqual([]);
  });

  it("validates dates, numeric ranges and duplicate rows before replacing a cache", () => {
    expect(serverSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(serverSnapshotSchema.safeParse({ ...snapshot, vitals: [{ ...snapshot.vitals[0], spo2Pct: 101 }] }).success).toBe(false);
    expect(serverSnapshotSchema.safeParse({ ...snapshot, vitals: [{ ...snapshot.vitals[0], day: "2026-11-20" }] }).success).toBe(false);
    expect(serverSnapshotSchema.safeParse({ ...snapshot, activity: [...snapshot.activity, ...snapshot.activity] }).success).toBe(false);
  });
});
