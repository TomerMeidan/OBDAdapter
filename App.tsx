import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { getToken, onTokenChange } from "./src/api/onlycars";
import { pairedDevice, startAutoConnect } from "./src/ble/autoConnect";
import { retryUploads } from "./src/mileage/sync";
import Home from "./src/screens/Home";
import Setup from "./src/screens/Setup";
import SignIn from "./src/screens/SignIn";
import { setStatus } from "./src/status";
import { styles } from "./src/screens/ui";

/**
 * Starts background sync and shows why on the home screen if Android refuses it.
 * Android only allows starting the foreground service while the app is visible.
 */
function startSync() {
  startAutoConnect().catch((e) =>
    setStatus({ message: `Background sync could not start: ${e instanceof Error ? e.message : String(e)}` }),
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
      <SafeAreaView style={styles.screen}>{screen}</SafeAreaView>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
