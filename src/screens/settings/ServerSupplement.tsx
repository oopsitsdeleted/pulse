import { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { connectedServer, connectServer, disconnectServer, ServerSupplementError } from "@/health/serverSupplement";
import { appStore, rescore, useApp, useDataVersion } from "@/state/app";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { HINT, ROW_LABEL, TextField } from "./controls";

export function ServerSupplement() {
  const { t } = useTranslation("settings");
  const version = useDataVersion();
  const syncing = useApp((s) => s.status === "syncing");
  const timeZone = useApp((s) => s.profile?.timeZone);
  const warning = useApp((s) => s.warnings.find((w) => w.startsWith("pulse_server:"))?.split(":")[1]);
  const [connected, setConnected] = useState<string | null>(null);
  const [last, setLast] = useState<number | null>(null);
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([connectedServer(), appStore().readServerVitals()]).then(([origin, cache]) => {
      if (active) { setConnected(origin); setLast(cache?.syncedAt ?? null); }
    }).catch(() => { if (active) setIssue("network"); });
    return () => { active = false; };
  }, [version]);

  async function connect() {
    if (!timeZone) return;
    setBusy(true);
    setIssue(undefined);
    setPassword("");
    try {
      await connectServer(appStore(), address, username, password, timeZone);
      setConnected(await connectedServer());
      setAddress("");
      setUsername("");
      await rescore();
    } catch (error) {
      setIssue(error instanceof ServerSupplementError ? error.code : "network");
    } finally { setBusy(false); }
  }

  async function disconnect() {
    setBusy(true);
    setIssue(undefined);
    try {
      await disconnectServer(appStore());
      setConnected(null);
      setLast(null);
      await rescore();
    } catch { setIssue("network"); }
    finally { setBusy(false); }
  }

  const error = issue ?? (connected ? warning : undefined);
  return (
    <View className="mt-4 gap-2 border-t border-border pt-4">
      <Text className={ROW_LABEL}>{t("serverSupplement.title")}</Text>
      <Text className={HINT}>{t("serverSupplement.description")}</Text>
      {connected ? (
        <>
          <Text selectable className={HINT}>{connected}</Text>
          {last != null && <Text className={HINT}>{t("serverSupplement.lastSync", { date: new Date(last).toLocaleString() })}</Text>}
          <Button variant="secondary" disabled={busy || syncing} onPress={() => void disconnect()}>{t("serverSupplement.disconnect")}</Button>
        </>
      ) : (
        <>
          <TextField accessibilityLabel={t("serverSupplement.address")} placeholder={t("serverSupplement.address")} value={address} onChangeText={setAddress} autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={300} editable={!busy} />
          <TextField accessibilityLabel={t("serverSupplement.username")} placeholder={t("serverSupplement.username")} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} autoComplete="username" maxLength={30} editable={!busy} />
          <TextField accessibilityLabel={t("serverSupplement.password")} placeholder={t("serverSupplement.password")} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="current-password" maxLength={128} editable={!busy} />
          <Button disabled={busy || syncing || !timeZone || !address.trim() || !username.trim() || !password} onPress={() => void connect()}>
            {busy ? t("serverSupplement.connecting") : t("serverSupplement.connect")}
          </Button>
        </>
      )}
      {error && <Text accessibilityRole="alert" className="text-recovery-red-text">{t(`serverSupplement.error.${error}`, { defaultValue: t("serverSupplement.error.network") })}</Text>}
    </View>
  );
}
