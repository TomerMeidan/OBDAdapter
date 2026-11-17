import { StatusBar } from "expo-status-bar";
import { Component, type ReactNode, useEffect, useState } from "react";
import { AppState, ScrollView, Text } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { getToken, onTokenChange } from "./src/api/onlycars";
import { pairedDevice, startAutoConnect } from "./src/ble/autoConnect";
import { retryUploads } from "./src/mileage/sync";
import Home from "./src/screens/Home";
import Setup from "./src/screens/Setup";
import SignIn from "./src/screens/SignIn";
import { clearCrash, type Crash, describe, readCrash, recordCrash } from "./src/crash";
import { setStatus } from "./src/status";
import { Button, Note, styles, Title } from "./src/screens/ui";

/**
 * Starts background sync and shows why on the home screen if Android refuses it.
 * Android only allows starting the foreground service while the app is visible.
 */
function startSync() {
  startAutoConnect().catch((e) =>
    setStatus({ message: `Background sync could not start: ${e instanceof Error ? e.message : String(e)}` }),
  );
}

/** Shows a screen error instead of closing the app, and keeps it for the next launch. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: describe(error, "Screen error") };
  }
  componentDidCatch(error: unknown) {
    void recordCrash(describe(error, "Screen error"));
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Something went wrong</Title>
        <Note>Take a screenshot of this and send it to the developer.</Note>
        <Text selectable style={styles.note}>{this.state.error}</Text>
        <Button title="Try again" onPress={() => this.setState({ error: null })} />
      </ScrollView>
    );
  }
}

/** The last crash, shown once on the next launch so it can be screenshotted. */
function LastCrash() {
  const [crash, setCrash] = useState<Crash | null>(null);
  useEffect(() => {
    void readCrash().then(setCrash);
  }, []);
  if (!crash) return null;
  return (
    <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={[styles.content, styles.banner]}>
      <Note error>The app closed unexpectedly ({new Date(crash.at).toLocaleString()}). Take a screenshot of this and send it to the developer.</Note>
      <Text selectable style={styles.note}>{crash.text}</Text>
      <Button quiet title="Dismiss" onPress={() => void clearCrash().then(() => setCrash(null))} />
    </ScrollView>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [paired, setPaired] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void getToken().then(setToken);
    const unsubscribe = onTokenChange(setToken);
    // Opening the app (also after a reboot or an update) starts sync; "change" only fires when it comes back to the front.
    void pairedDevice.get().then((id) => {
      setPaired(Boolean(id));
      if (id) startSync();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      startSync();
      void retryUploads().catch(() => undefined);
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    if (!token) void pairedDevice.get().then((id) => setPaired(Boolean(id)));
    // A new token after a rejected one: send what was waiting.
    else void retryUploads().catch(() => undefined);
  }, [token]);

  let screen;
  if (token === undefined || paired === undefined) {
    screen = null;
  } else if (!token) {
    screen = <SignIn />;
  } else if (!paired) {
    screen = (
      <Setup
        onDone={() => {
          setPaired(true);
          startSync();
        }}
      />
    );
  } else {
    screen = <Home onUnpaired={() => setPaired(false)} />;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <LastCrash />
        <ErrorBoundary>{screen}</ErrorBoundary>
      </SafeAreaView>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
