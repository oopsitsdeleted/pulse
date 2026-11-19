import { fetch } from "expo/fetch";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { z } from "zod";
import { serverSnapshotSchema } from "@/data/serverVitals";
import type { Store } from "@/data/store";
import { addDays, localDay } from "@/lib/time";

const KEY = "pulse.server-supplement.v1";
const route = "/api/mobile/v1";
const token = z.string().regex(/^pulse_mobile_v1\.[A-Za-z0-9_-]{1,900}$/);
const grantSchema = z.object({ origin: z.string(), token });
type Grant = z.infer<typeof grantSchema>;
export type ServerIssue = "address" | "credentials" | "rate" | "incompatible" | "expired" | "profile" | "timezone" | "network";
export class ServerSupplementError extends Error {
  constructor(readonly code: ServerIssue) { super(code); }
}

export function serverOrigin(input: string): string {
  const text = input.trim();
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    if (url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) return url.origin;
  } catch { /* A malformed address is handled below. */ }
  throw new ServerSupplementError("address");
}

async function readGrant(): Promise<Grant | null> {
  const raw = await getItemAsync(KEY);
  if (!raw) return null;
  const parsed = grantSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || serverOrigin(parsed.data.origin) !== parsed.data.origin) return null;
  return parsed.data;
}

export async function connectedServer() { return (await readGrant())?.origin ?? null; }

async function request(origin: string, path: string, init: Parameters<typeof fetch>[1], login = false): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${origin}${route}${path}`, {
      ...init, redirect: "error", credentials: "omit", signal: controller.signal,
    });
    if (res.status === 401) throw new ServerSupplementError(login ? "credentials" : "expired");
    if (res.status === 429) throw new ServerSupplementError("rate");
    if (res.status === 409) throw new ServerSupplementError("profile");
    if (res.status >= 500) throw new ServerSupplementError("network");
    if (!res.ok) throw new ServerSupplementError("incompatible");
    const type = res.headers.get("content-type");
    if (!type?.startsWith("application/json")) throw new ServerSupplementError("incompatible");
    return await res.json().catch(() => { throw new ServerSupplementError("incompatible"); });
  } catch (error) {
    throw error instanceof ServerSupplementError ? error : new ServerSupplementError("network");
  } finally { clearTimeout(timer); }
}

function zoneName(zone: string) { return Intl.DateTimeFormat("en", { timeZone: zone }).resolvedOptions().timeZone; }

async function download(grant: Grant, timeZone: string) {
  const to = localDay(Date.now() / 1000, timeZone);
  const from = addDays(to, -179);
  const body = await request(grant.origin, `/measurements?from=${from}&to=${to}`, {
    headers: { authorization: `Bearer ${grant.token}`, accept: "application/json" },
  });
  const parsed = serverSnapshotSchema.safeParse(body);
  if (!parsed.success || parsed.data.from !== from || parsed.data.to !== to) throw new ServerSupplementError("incompatible");
  try {
    if (zoneName(parsed.data.timeZone) !== zoneName(timeZone)) throw new ServerSupplementError("timezone");
  } catch { throw new ServerSupplementError("timezone"); }
  return { snapshot: { ...parsed.data, timeZone }, syncedAt: Date.now() };
}

async function revoke(grant: Grant) {
  await request(grant.origin, "/session", { method: "DELETE", headers: { authorization: `Bearer ${grant.token}` } });
}

export async function connectServer(store: Store, address: string, username: string, password: string, timeZone: string) {
  const origin = serverOrigin(address);
  const previous = await readGrant();
  const result = await request(origin, "/session", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: username.trim(), password }),
  }, true);
  const parsed = z.object({ token }).safeParse(result);
  if (!parsed.success) throw new ServerSupplementError("incompatible");
  const grant = { origin, token: parsed.data.token };
  try {
    const snapshot = await download(grant, timeZone);
    await setItemAsync(KEY, JSON.stringify(grant));
    try { await store.setServerVitals(snapshot); }
    catch (error) {
      if (previous) await setItemAsync(KEY, JSON.stringify(previous));
      else await deleteItemAsync(KEY);
      throw error;
    }
  } catch (error) {
    await revoke(grant).catch(() => {});
    throw error;
  }
  if (previous) void revoke(previous).catch(() => {});
}

/** Runs in the app sync only. Failed reads leave the last successful snapshot intact. */
export async function syncServer(store: Store, timeZone: string) {
  const grant = await readGrant();
  if (!grant) return;
  const next = await download(grant, timeZone);
  if ((await readGrant())?.token === grant.token) await store.setServerVitals(next);
  return true;
}

export async function disconnectServer(store: Store | null) {
  const grant = await readGrant();
  await deleteItemAsync(KEY);
  if (store) await store.setServerVitals(null);
  if (grant) void revoke(grant).catch(() => {});
}
