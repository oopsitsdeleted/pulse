import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@/data/memory";

vi.mock("./connect", () => ({ permissionState: vi.fn(), readAll: vi.fn() }));
const { permissionState, readAll } = await import("./connect");
const { runDataCheck } = await import("./dataCheck");
const options = { timeZone: "UTC", now: new Date("2026-11-19T12:00:00Z") };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(permissionState).mockResolvedValue({
    granted: ["OxygenSaturation", "RespiratoryRate"], missing: [], history: true, background: true,
  });
  vi.mocked(readAll).mockResolvedValue([]);
});

describe("data check read diagnostics", () => {
  it("distinguishes empty reads, denied permissions and native failures without exposing messages", async () => {
    vi.mocked(readAll).mockImplementation(async (type) => {
      if (type === "RespiratoryRate") throw { code: "ERROR_SECURITY", message: "private health record" };
      return [];
    });
    const { text } = await runDataCheck(new MemoryStore(), options);
    expect(text).toContain("OxygenSaturation: allowed; read succeeded; 0 raw records");
    expect(text).toContain("RespiratoryRate: read failed (ERROR_SECURITY)");
    expect(text).toContain("RestingHeartRate: not allowed (permission API)");
    expect(text).not.toContain("private health record");
    expect(text).toContain("2026-11-19T12:00:00.000Z (UTC)");
  });

  it("reports raw and invalid counts and unreadable ranges instead of silently hiding them", async () => {
    vi.mocked(readAll).mockImplementation(async (type, range, opts) => {
      if (type !== "OxygenSaturation") return [];
      opts?.onSkipped?.(range);
      return [
        { time: "2026-11-19T08:00:00Z", percentage: 97 },
        { time: "invalid", percentage: 96 },
        { time: "2026-11-19T09:00:00Z", percentage: null },
      ] as never;
    });
    const { text } = await runDataCheck(new MemoryStore(), options);
    expect(text).toContain("OxygenSaturation: allowed; read succeeded; 3 raw records; 2 invalid time/value; 1 unreadable ranges skipped");
    expect(text).toContain("SpO2: Pulse — %");
    expect(text).toContain("97 % (1 rec;");
  });
});
