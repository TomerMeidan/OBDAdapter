import { useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { setToken } from "../api/onlycars";
import { pairedDevice, readNow, stopAutoConnect } from "../ble/autoConnect";
import { forgetLocalData, localVehicle, retryUploads, setBaseline } from "../mileage/sync";
import { useStatus } from "../status";
import { Button, Field, Note, styles, Title } from "./ui";

const CONNECTION = {
  stopped: "Sync is off",
  waiting: "Waiting for the car",
  connected: "Connected to the car",
} as const;

export default function Home({ onUnpaired }: { onUnpaired: () => void }) {
  const status = useStatus();
  const [km, setKm] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rebaseline() {
    setError(null);
    const vehicle = await localVehicle();
    if (!vehicle) {
      setError("No vehicle saved on this phone. Pair the adapter again.");
      return;
    }
    // PID 31 is captured on the next read; if the car is connected that's now.
    await setBaseline(vehicle, Number(km), null);
    setKm("");
    setEditing(false);
    readNow();
  }

  async function unpair() {
    await stopAutoConnect();
    await pairedDevice.clear();
    onUnpaired();
  }

  async function signOut() {
    await stopAutoConnect();
    await pairedDevice.clear();
    await forgetLocalData();
    await setToken(null);
  }

  const rebaselineForm = (
    <>
      <Field
        placeholder="Dashboard odometer (km)"
        keyboardType="number-pad"
        value={km}
        onChangeText={setKm}
      />
      <Button title="Save new baseline" disabled={!/^\d{1,7}$/.test(km)} onPress={rebaseline} />
    </>
  );

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Title>Mileage</Title>
      <View style={styles.card}>
        <Text style={styles.big}>
          {status.lastOdometer == null ? "—" : `${status.lastOdometer.toLocaleString()} km`}
        </Text>
        <Note>
          {status.lastReadAt
            ? `Last read ${new Date(status.lastReadAt).toLocaleString()}`
            : "No reading yet. Start the car to take the first one."}
        </Note>
        <Note>{CONNECTION[status.connection]}</Note>
        {status.connection === "connected" && status.voltage != null && (
          <Note>Car battery {status.voltage.toFixed(1)} V</Note>
        )}
        {status.pendingUploads > 0 && <Note>{status.pendingUploads} upload(s) waiting</Note>}
        {status.message && <Note error>{status.message}</Note>}
      </View>

      {status.needsRebaseline && (
        <View style={styles.banner}>
          <Note>
            The mileage can't be calculated: the car's counter was reset (codes cleared or battery
            disconnected), or OnlyCars has a higher reading. Enter the current dashboard km to resume syncing.
          </Note>
          {rebaselineForm}
        </View>
      )}
      {status.tokenRejected && (
        <View style={styles.banner}>
          <Note>
            OnlyCars no longer accepts this phone's token. Create a new one in OnlyCars (Settings, Connected
            devices). Readings taken meanwhile are kept and uploaded afterwards.
          </Note>
          <Button title="Enter a new token" onPress={() => void setToken(null)} />
        </View>
      )}
      {status.nearLimit && !status.needsRebaseline && (
        <View style={styles.banner}>
          <Note>
            The car's counter is close to its 65,535 km limit. Clear the trouble codes with Car
            Scanner, then enter the dashboard km here.
          </Note>
        </View>
      )}
      {error && <Note error>{error}</Note>}

      {status.pendingUploads > 0 && <Button quiet title="Retry uploads" onPress={() => void retryUploads()} />}
      {!status.needsRebaseline &&
        (editing ? rebaselineForm : <Button quiet title="Correct the odometer" onPress={() => setEditing(true)} />)}
      {Platform.OS === "android" && (
        <Button
          quiet
          title="Battery optimisation settings"
          onPress={() => void Linking.sendIntent("android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS")}
        />
      )}
      <Button quiet title="Pair a different adapter" onPress={unpair} />
      <Button quiet title="Disconnect from OnlyCars" onPress={signOut} />
    </ScrollView>
  );
}
