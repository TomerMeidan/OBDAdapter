import type { Session } from "@supabase/supabase-js";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { isConfigured, supabase } from "./src/api/supabase";
import { pairedDevice, startAutoConnect } from "./src/ble/autoConnect";
import { retryUploads } from "./src/mileage/sync";
import Home from "./src/screens/Home";
import Setup from "./src/screens/Setup";
import SignIn from "./src/screens/SignIn";
import { Note, styles, Title } from "./src/screens/ui";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [paired, setPaired] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    void pairedDevice.get().then((id) => setPaired(Boolean(id)));
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // Android only allows starting the foreground service while the app is visible.
      void startAutoConnect().catch(() => undefined);
      void retryUploads().catch(() => undefined);
    });
    return () => {
      data.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    if (!session) void pairedDevice.get().then((id) => setPaired(Boolean(id)));
  }, [session]);

  let screen;
  if (!isConfigured) {
    screen = (
      <SafeAreaView style={styles.content}>
        <Title>Supabase is not configured</Title>
        <Note>Copy .env.example to .env, fill in your project URL and anon key, then rebuild.</Note>
      </SafeAreaView>
    );
  } else if (session === undefined || paired === undefined) {
    screen = null;
  } else if (!session) {
    screen = <SignIn />;
  } else if (!paired) {
    screen = (
      <Setup
        onDone={() => {
          setPaired(true);
          void startAutoConnect().catch(() => undefined);
        }}
      />
    );
  } else {
    screen = <Home onUnpaired={() => setPaired(false)} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>{screen}</SafeAreaView>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
