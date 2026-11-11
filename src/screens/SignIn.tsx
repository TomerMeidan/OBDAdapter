import { useState } from "react";
import { ScrollView } from "react-native";
import { ApiError, listVehicles, setToken } from "../api/onlycars";
import { Button, Field, Note, styles, Title } from "./ui";

/** Connects the app to an OnlyCars account with a device token (there is no password sign-in). */
export default function SignIn() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    const token = value.trim();
    setBusy(true);
    setMessage(null);
    try {
      await listVehicles(token); // proves the token works before it is saved
      await setToken(token);
    } catch (e) {
      const status = e instanceof ApiError ? e.status : null;
      setMessage(
        status === 401 || status === 403
          ? "OnlyCars did not accept this token. Check that all of it was pasted, or create a new one."
          : `Could not reach OnlyCars (${e instanceof Error ? e.message : String(e)}). Try again in a minute.`,
      );
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>OBD Mileage</Title>
      <Note>
        Open OnlyCars on this phone, go to Settings, then Connected devices, and create a token. Copy it and paste
        it here.
      </Note>
      <Field
        placeholder="Device token (ocd_…)"
        autoCapitalize="none"
        autoCorrect={false}
        value={value}
        onChangeText={setValue}
      />
      {message && <Note error>{message}</Note>}
      <Button title={busy ? "Checking…" : "Connect"} disabled={busy || !value.trim()} onPress={submit} />
    </ScrollView>
  );
}
