import { z } from "zod";
import type { DayRange, Store } from "./store";
import { emptyMetrics, type DailyValue, type Metrics } from "./types";

const day = z.iso.date();
const vital = z.object({
  day, spo2Pct: z.number().positive().max(100).nullable(), respBpm: z.number().positive().max(100).nullable(),
  rhrBpm: z.number().positive().max(300).nullable(), hrvMs: z.number().nonnegative().nullable(),
  hrvDeepMs: z.number().nonnegative().nullable(), vo2maxDaily: z.number().positive().nullable(), vo2maxRun: z.number().positive().nullable(),
});
const activityKeys = ["active_calories", "azm", "active_minutes", "light_minutes", "sedentary_minutes", "avg_hr"] as const;

export const serverSnapshotSchema = z.object({
  version: z.literal(1), timeZone: z.string(), from: day, to: day,
  vitals: z.array(vital).max(180),
  activity: z.array(z.object({ day, key: z.enum(activityKeys), value: z.number().nonnegative() })).max(180 * activityKeys.length),
}).refine((s) =>
  s.from <= s.to && [...s.vitals, ...s.activity].every((r) => r.day >= s.from && r.day <= s.to) &&
  new Set(s.vitals.map((r) => r.day)).size === s.vitals.length &&
  new Set(s.activity.map((r) => `${r.day}:${r.key}`)).size === s.activity.length);

export type ServerSnapshot = z.infer<typeof serverSnapshotSchema>;
export type ServerVitalsCache = { snapshot: ServerSnapshot; syncedAt: number };

/** Local direct measurements win; a server value fills a gap before any downstream estimates are made. */
export function mergeServerVitals(local: Metrics[], snapshot: ServerSnapshot | null, timeZone?: string): Metrics[] {
  if (!snapshot || (timeZone && snapshot.timeZone !== timeZone) || !snapshot.vitals.length) return local;
  const rows = new Map(local.map((r) => [r.day, r]));
  for (const { day, ...values } of snapshot.vitals) {
    const row = { ...(rows.get(day) ?? emptyMetrics(day)) };
    let changed = false;
    for (const key of Object.keys(values) as (keyof typeof values)[]) {
      if (row[key] === null && values[key] !== null) {
        row[key] = values[key];
        changed = true;
      }
    }
    if (changed) rows.set(day, row);
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Prefer Google's reported activity totals over locally derived approximations; never add both. */
export async function dailyValuesWithServer(store: Store, range: DayRange, timeZone: string): Promise<DailyValue[]> {
  const [local, cache] = await Promise.all([store.dailyValues(range), store.readServerVitals()]);
  if (cache?.snapshot.timeZone !== timeZone) return local;
  const rows = new Map(local.map((r) => [`${r.day}:${r.key}`, r]));
  for (const r of cache.snapshot.activity) {
    if (r.day >= range.from && r.day <= range.to) rows.set(`${r.day}:${r.key}`, r);
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day) || a.key.localeCompare(b.key));
}
