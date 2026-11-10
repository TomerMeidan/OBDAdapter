import AsyncStorage from "@react-native-async-storage/async-storage";

async function read<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export function item<T>(key: string) {
  return {
    get: () => read<T>(key),
    set: (value: T) => AsyncStorage.setItem(key, JSON.stringify(value)),
    clear: () => AsyncStorage.removeItem(key),
  };
}
