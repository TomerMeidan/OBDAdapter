import { PermissionsAndroid, Platform } from "react-native";

/** Asks for the Android runtime permissions needed to scan, connect and notify. */
export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const P = PermissionsAndroid.PERMISSIONS;
  const api = Number(Platform.Version);
  const wanted =
    api >= 31
      ? [P.BLUETOOTH_SCAN, P.BLUETOOTH_CONNECT, P.ACCESS_FINE_LOCATION]
      : [P.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  if (api >= 33) await PermissionsAndroid.request(P.POST_NOTIFICATIONS);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}
