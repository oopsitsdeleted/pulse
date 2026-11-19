import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "./auth";
import { parseConfig, type Config } from "./config";
import type { Db } from "./db";
import { dailyMetrics, dailyValues } from "./db/schema";
import { mobileDisconnect, mobileMeasurements, mobileSignIn } from "./mobile";
import { saveProfile } from "./profile";
import { freshDb, PROFILE, TZ, USER } from "./testing";

const mock = vi.hoisted(() => ({ cfg: undefined as unknown }));
vi.mock("./config", async (actual) => ({ ...(await actual<object>()), getConfig: () => mock.cfg as Config }));
const origin = "https://pulse.example.test";
const account = { name: "Mobile tester", email: "mobile@example.com", username: "mobile.test", password: "test-password-only" };
const day = "2026-11-19";
let db: Db;
let userId: number;

beforeEach(async () => {
  mock.cfg = parseConfig({
    DATA_SOURCE: "google", GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret",
    SIGNUP: "open", APP_URL: origin, BETTER_AUTH_SECRET: "a-long-test-only-server-secret-at-least-32",
  });
  db = await freshDb();
  const { user } = await getAuth().api.signUpEmail({ body: account });
  userId = Number(user.id);
  await saveProfile(db, userId, { ...PROFILE, timeZone: TZ });
});

const signIn = (password = account.password) => mobileSignIn(new Request(`${origin}/api/mobile/v1/session`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: account.username, password }),
}));
const measurements = (token?: string, from = day) => mobileMeasurements(new Request(`${origin}/api/mobile/v1/measurements?from=${from}&to=${day}`, {
  headers: token ? { authorization: `Bearer ${token}` } : {},
}));

describe("mobile supplement", () => {
  it("authenticates with the existing account, limits measurements to its owner, and revokes on disconnect", async () => {
    await db.insert(dailyMetrics).values([
      { userId, day, source: "google", spo2Pct: 97, respBpm: 16.4 },
      { userId: USER, day, source: "google", spo2Pct: 91, respBpm: 28 },
    ]);
    await db.insert(dailyValues).values([
      { userId, day, key: "azm", value: 21 },
      { userId, day, key: "water", value: 8 },
      { userId: USER, day, key: "azm", value: 78 },
    ]);
    expect((await measurements()).status).toBe(401);
    expect((await signIn("wrong-password")).status).toBe(401);
    const signedIn = await signIn();
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("set-cookie")).toBeNull();
    const { token } = await signedIn.json();
    expect(token).toMatch(/^pulse_mobile_v1\./);
    expect((await measurements(`${token}modified`)).status).toBe(401);
    expect((await measurements(token, "2026-02-31")).status).toBe(400);
    expect((await measurements(token, "2026-01-01")).status).toBe(400);
    const response = await measurements(token);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      version: 1, timeZone: TZ, from: day, to: day,
      vitals: [{ day, spo2Pct: 97, respBpm: expect.closeTo(16.4) }],
      activity: [{ day, key: "azm", value: 21 }],
    });
    expect((await mobileDisconnect(new Request(`${origin}/api/mobile/v1/session`, {
      method: "DELETE", headers: { authorization: `Bearer ${token}` },
    }))).status).toBe(200);
    expect((await measurements(token)).status).toBe(401);
  });
});
