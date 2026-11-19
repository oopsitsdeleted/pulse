// Data check, device part: reads the last `days` days of every checked type from Health Connect (all apps) and compares them with Pulse's stored rows. See dataCheckSummary.ts.
import type { Store } from "@/data/store";
import { addDays, localDay, localMidnight } from "@/lib/time";
import { permissionState, readAll, type Range, type ReadType } from "./connect";
import { CHECK_METRICS, formatReport, invalidRecordCount, summarize, type DayCheck, type RawRecord, type ReadDiagnostic } from "./dataCheckSummary";

export async function runDataCheck(store: Store, opts: { timeZone: string; days?: number; now?: Date }): Promise<{ days: DayCheck[]; text: string }> {
  const tz = opts.timeZone;
  const now = opts.now ?? new Date();
  const today = localDay(Math.floor(now.getTime() / 1000), tz);
  const n = opts.days ?? 10;
  const days = Array.from({ length: n }, (_, i) => addDays(today, -i));
  const range = { start: new Date(localMidnight(days[n - 1], tz) * 1000), end: now };
  const perms = await permissionState();
  const granted = new Set<string>(perms.granted);
  const raw: Partial<Record<ReadType, RawRecord[]>> = {};
  const diagnostics: ReadDiagnostic[] = [];
  const read = async (type: ReadType, readRange: Range): Promise<RawRecord[]> => {
    const diagnostic: ReadDiagnostic = { type, status: "not_allowed", records: 0, invalidRecords: 0, skippedRanges: 0 };
    diagnostics.push(diagnostic);
    if (!granted.has(type)) return [];
    try {
      const records = await readAll(type, readRange, { onSkipped: () => diagnostic.skippedRanges++ }) as unknown as RawRecord[];
      diagnostic.status = "ok";
      diagnostic.records = records.length;
      diagnostic.invalidRecords = invalidRecordCount(type, records);
      return records;
    } catch (error) {
      diagnostic.status = "error";
      // Do not copy native error messages: they can contain health-record bodies.
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
      diagnostic.errorCode = typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : "read_failed";
      return [];
    }
  };
  for (const cm of CHECK_METRICS) {
    if (raw[cm.type]) continue;
    raw[cm.type] = await read(cm.type, range);
  }
  const sleepRaw = await read("SleepSession", { start: new Date(range.start.getTime() - 86_400_000), end: now });
  const [metrics, sessions, values] = await Promise.all([store.allMetrics(), store.allSessions(), store.dailyValues({ from: days[n - 1], to: today })]);
  const checked = summarize(raw, sleepRaw, metrics, sessions, days, tz, values);
  return { days: checked, text: formatReport(checked, diagnostics, { ...range, timeZone: tz }) };
}
