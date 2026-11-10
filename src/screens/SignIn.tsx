import { useState } from "react";
import { ScrollView } from "react-native";
import { supabase } from "../api/supabase";
import { Button, Field, Note, styles, Title } from "./ui";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(mode: "in" | "up") {
    setBusy(true);
    setMessage(null);
    const credentials = { email: email.trim(), password };
    const { data, error } =
      mode === "in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);
    setBusy(false);
    if (error) setMessage(error.message);
    else if (!data.session) setMessage("Check your email to confirm the account, then sign in.");
  }

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>OBD Mileage</Title>
      <Note>Sign in with the same account as the maintenance website.</Note>
      <Field
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Field placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {message && <Note error>{message}</Note>}
      <Button title="Sign in" disabled={busy || !email || !password} onPress={() => submit("in")} />
      <Button quiet title="Create account" disabled={busy || !email || !password} onPress={() => submit("up")} />
    </ScrollView>
  );
}
