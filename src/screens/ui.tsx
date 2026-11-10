import { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, TextInputProps } from "react-native";

export function Button(props: { title: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[styles.button, props.quiet && styles.quiet, props.disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, props.quiet && styles.quietText]}>{props.title}</Text>
    </Pressable>
  );
}

export function Field(props: TextInputProps) {
  return <TextInput placeholderTextColor="#8a94a3" {...props} style={styles.field} />;
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Note({ children, error }: { children: ReactNode; error?: boolean }) {
  return <Text style={[styles.note, error && styles.error]}>{children}</Text>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#111827" },
  note: { fontSize: 15, lineHeight: 21, color: "#4b5563" },
  error: { color: "#b91c1c" },
  field: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: "#111827",
  },
  button: { backgroundColor: "#1d4ed8", borderRadius: 10, paddingVertical: 14, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  quiet: { backgroundColor: "transparent", borderWidth: 1, borderColor: "#cbd5e1" },
  quietText: { color: "#1d4ed8" },
  disabled: { opacity: 0.5 },
  card: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 12, padding: 16, gap: 6 },
  banner: { backgroundColor: "#fef3c7", borderRadius: 12, padding: 16, gap: 10 },
  big: { fontSize: 40, fontWeight: "700", color: "#111827" },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  rowTitle: { fontSize: 16, color: "#111827" },
});
