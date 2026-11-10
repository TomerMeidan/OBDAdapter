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
import { styles } from "./src/screens/ui";

export default function App() {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [paired, setPaired] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    void getToken().then(setToken);
    const unsubscribe = onTokenChange(setToken);
    void pairedDevice.get().then((id) => setPaired(Boolean(id)));
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // Android only allows starting the foreground service while the app is visible.
      void startAutoConnect().catch(() => undefined);
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
