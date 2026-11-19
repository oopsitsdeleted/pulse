import { and, asc, eq, gt, gte, inArray, lte } from "drizzle-orm";
import { getAuth } from "./auth";
import { decryptKey, encryptKey } from "./coach/crypto";
import { getConfig } from "./config";
import { getDb } from "./db";
import { dailyMetrics, dailyValues, session } from "./db/schema";
import { getProfile } from "./profile";

const TOKEN_PREFIX = "pulse_mobile_v1.";
const EXTRAS = ["active_calories", "azm", "active_minutes", "light_minutes", "sedentary_minutes", "avg_hr"] as const;

export const mobileJson = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

/** The original Better Auth session token never leaves the server in plaintext. */
function deviceKey() {
  const cfg = getConfig();
  return cfg.dataSource === "google" && cfg.authSecret ? `pulse:mobile:v1:${cfg.authSecret}` : null;
}

export async function mobileSignIn(req: Request) {
  const key = deviceKey();
  if (!key) return mobileJson({ error: "mobile_disabled" }, 404);
  if (!req.headers.get("content-type")?.startsWith("application/json")) return mobileJson({ error: "bad_request" }, 400);
  const input: unknown = await req.json().catch(() => null);
  if (!input || typeof input !== "object" || !("username" in input) || !("password" in input) ||
      typeof input.username !== "string" || !input.username.trim() || input.username.length > 30 ||
      typeof input.password !== "string" || !input.password || input.password.length > 128) {
    return mobileJson({ error: "bad_request" }, 400);
  }

  // Use the existing sign-in handler (including its database rate limit and password verification).
  // Don't forward incoming cookies, Authorization, or Origin, and don't pass its session cookie back.
  const endpoint = new URL("/api/auth/sign-in/username", getConfig().appUrl ?? req.url);
  const headers = new Headers({ "content-type": "application/json", origin: endpoint.origin });
  for (const name of ["cf-connecting-ip", "x-forwarded-for"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const result = await getAuth().handler(new Request(endpoint, {
    method: "POST", headers, body: JSON.stringify({ username: input.username.trim(), password: input.password, rememberMe: true }),
  }));
  if (!result.ok) {
    if (result.status >= 500) return mobileJson({ error: "server_error" }, 503);
    return result.status === 429 ? mobileJson({ error: "rate_limited" }, 429) : mobileJson({ error: "invalid_credentials" }, 401);
  }
  const body: { token?: unknown } = await result.json();
  if (typeof body.token !== "string" || !body.token) return mobileJson({ error: "session_unavailable" }, 503);
  return mobileJson({ token: TOKEN_PREFIX + encryptKey(body.token, key).toString("base64url") });
}

async function deviceSession(req: Request) {
  const key = deviceKey();
  const bearer = req.headers.get("authorization");
  if (!key || !bearer?.startsWith(`Bearer ${TOKEN_PREFIX}`) || bearer.length > 1024) return null;
  const encoded = bearer.slice(`Bearer ${TOKEN_PREFIX}`.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const token = decryptKey(Buffer.from(encoded, "base64url"), key);
  if (!token) return null;
  const [row] = await getDb().select({ id: session.id, userId: session.userId }).from(session)
    .where(and(eq(session.token, token), gt(session.expiresAt, new Date()))).limit(1);
  return row ?? null;
}

export async function mobileDisconnect(req: Request) {
  const device = await deviceSession(req);
  if (!device) return mobileJson({ error: "not_connected" }, 401);
  await getDb().delete(session).where(and(eq(session.id, device.id), eq(session.userId, device.userId)));
  return mobileJson({ ok: true });
}

function parseDay(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(date) && new Date(date).toISOString().slice(0, 10) === value ? date : null;
}

export async function mobileMeasurements(req: Request) {
  const device = await deviceSession(req);
  if (!device) return mobileJson({ error: "not_connected" }, 401);
  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const lo = parseDay(from);
  const hi = parseDay(to);
  if (!from || !to || lo === null || hi === null || hi < lo || hi - lo >= 180 * 86_400_000)
    return mobileJson({ error: "bad_date_range" }, 400);
  const db = getDb();
  const userId = device.userId;
  const [profile, vitals, activity] = await Promise.all([
    getProfile(db, userId),
    db.select({
      day: dailyMetrics.day, spo2Pct: dailyMetrics.spo2Pct, respBpm: dailyMetrics.respBpm,
      rhrBpm: dailyMetrics.rhrBpm, hrvMs: dailyMetrics.hrvMs, hrvDeepMs: dailyMetrics.hrvDeepMs,
      vo2maxDaily: dailyMetrics.vo2maxDaily, vo2maxRun: dailyMetrics.vo2maxRun,
    }).from(dailyMetrics).where(and(eq(dailyMetrics.userId, userId), eq(dailyMetrics.source, "google"), gte(dailyMetrics.day, from), lte(dailyMetrics.day, to))).orderBy(asc(dailyMetrics.day)),
    db.select({ day: dailyValues.day, key: dailyValues.key, value: dailyValues.value }).from(dailyValues)
      .where(and(eq(dailyValues.userId, userId), gte(dailyValues.day, from), lte(dailyValues.day, to), inArray(dailyValues.key, EXTRAS)))
      .orderBy(asc(dailyValues.day), asc(dailyValues.key)),
  ]);
  if (!profile) return mobileJson({ error: "profile_required" }, 409);
  return mobileJson({ version: 1, timeZone: profile.timeZone, from, to, vitals, activity });
}
