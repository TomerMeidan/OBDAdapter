import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text } from "react-native";
import type { Device } from "react-native-ble-plx";
import { listVehicles } from "../api/onlycars";
import { pairedDevice } from "../ble/autoConnect";
import { Elm327 } from "../ble/elm327";
import { manager, waitForPoweredOn } from "../ble/manager";
import { requestBlePermissions } from "../ble/permissions";
import { rememberSiteOdometer, setBaseline } from "../mileage/sync";
import type { RemoteVehicle } from "../types";
import { Button, Field, Note, styles, Title } from "./ui";

type Step =
  | { name: "scan" }
  | { name: "reading"; device: Device }
  | { name: "car"; device: Device; pid31: number }
  | { name: "baseline"; device: Device; pid31: number; car: RemoteVehicle };

const carTitle = (c: RemoteVehicle) => c.nickname;
const carDetails = (c: RemoteVehicle) =>
  [[c.make, c.model, c.year].filter(Boolean).join(" "), c.plate, `${Math.round(c.currentOdometerKm).toLocaleString()} km`]
    .filter(Boolean)
    .join(" · ");

/** One-time pairing: pick the adapter, read PID 31, pick the car in OnlyCars, confirm the dashboard km. */
export default function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>({ name: "scan" });
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cars, setCars] = useState<RemoteVehicle[] | null>(null);
  const [odometer, setOdometer] = useState("");
  const [saving, setSaving] = useState(false);
  const connected = useRef<string | null>(null);

  useEffect(() => {
    if (step.name !== "scan") return;
    let cancelled = false;
    (async () => {
      if (!(await requestBlePermissions())) {
        setError("Bluetooth permissions are required to find the adapter.");
        return;
      }
      await waitForPoweredOn();
      if (cancelled) return;
      manager.startDeviceScan(null, null, (err, device) => {
        if (err) {
          setError(err.message);
          return;
        }
        if (!device?.name) return;
        setDevices((list) => (list.some((d) => d.id === device.id) ? list : [...list, device]));
      });
    })();
    return () => {
      cancelled = true;
      void manager.stopDeviceScan();
    };
  }, [step.name]);

  useEffect(
    () => () => {
      if (connected.current) void manager.cancelDeviceConnection(connected.current).catch(() => undefined);
    },
    [],
  );

  async function pick(device: Device) {
    setError(null);
    setStep({ name: "reading", device });
    try {
      const live = await manager.connectToDevice(device.id, { timeout: 15000 });
      connected.current = live.id;
      const elm = new Elm327();
      await elm.attach(live);
      const pid31 = await elm.readPid31();
      elm.detach();
      setStep({ name: "car", device, pid31 });
      void loadCars();
    } catch (e) {
      await manager.cancelDeviceConnection(device.id).catch(() => undefined);
      connected.current = null;
      setError(
        `Could not read mileage (${e instanceof Error ? e.message : String(e)}). ` +
          "Start the engine and try again.",
      );
      setStep({ name: "scan" });
    }
  }

  async function loadCars() {
    setError(null);
    setCars(null);
    try {
      setCars(await listVehicles());
    } catch (e) {
      setCars([]);
      setError(`Could not load your cars from OnlyCars (${e instanceof Error ? e.message : String(e)}).`);
    }
  }

  async function save(device: Device, pid31: number, car: RemoteVehicle) {
    setSaving(true);
    setError(null);
    try {
      // The baseline stays on this phone; OnlyCars only ever receives the calculated odometer.
      await setBaseline({ id: car.id, name: carTitle(car) }, Number(odometer), pid31);
      await rememberSiteOdometer(car.currentOdometerKm);
      await manager.cancelDeviceConnection(device.id).catch(() => undefined);
      connected.current = null;
      await pairedDevice.set(device.id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  }

  if (step.name === "baseline") {
    const valid = /^\d{1,7}$/.test(odometer);
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Title>Enter the baseline</Title>
        <Note>
          {carTitle(step.car)}: OnlyCars has {Math.round(step.car.currentOdometerKm).toLocaleString()} km. Check
          the dashboard and correct the number so it matches exactly what the car shows right now.
        </Note>
        <Field
          placeholder="Dashboard odometer (km)"
          keyboardType="number-pad"
          value={odometer}
          onChangeText={setOdometer}
        />
        {error && <Note error>{error}</Note>}
        <Button title="Save" disabled={!valid || saving} onPress={() => save(step.device, step.pid31, step.car)} />
      </ScrollView>
    );
  }

  if (step.name === "car") {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Which car is this?</Title>
        <Note>Pick the car in OnlyCars that the adapter is plugged into.</Note>
        {error && <Note error>{error}</Note>}
        {cars === null && <ActivityIndicator />}
        {cars?.length === 0 && !error && <Note>No cars yet. Add the car in OnlyCars first, then reload.</Note>}
        {cars?.map((c) => (
          <Pressable
            key={c.id}
            style={styles.row}
            onPress={() => {
              setOdometer(String(Math.round(c.currentOdometerKm)));
              setStep({ name: "baseline", device: step.device, pid31: step.pid31, car: c });
            }}
          >
            <Text style={styles.rowTitle}>{carTitle(c)}</Text>
            <Note>{carDetails(c)}</Note>
          </Pressable>
        ))}
        {cars !== null && <Button quiet title="Reload" onPress={() => void loadCars()} />}
      </ScrollView>
    );
  }

  if (step.name === "reading") {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Title>Reading mileage…</Title>
        <Note>Connecting to {step.device.name}. This can take up to 30 seconds.</Note>
        <ActivityIndicator />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Title>Pair the OBD adapter</Title>
      <Note>
        Plug the adapter in and start the engine. A Vgate adapter shows up as “Android-Vlink” or
        “IOS-Vlink”.
      </Note>
      {error && <Note error>{error}</Note>}
      {devices.length === 0 && <ActivityIndicator />}
      {devices.map((d) => (
        <Pressable key={d.id} style={styles.row} onPress={() => pick(d)}>
          <Text style={styles.rowTitle}>{d.name}</Text>
          <Note>{d.id}</Note>
        </Pressable>
      ))}
    </ScrollView>
  );
}
