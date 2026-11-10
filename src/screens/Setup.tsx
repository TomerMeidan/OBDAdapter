import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text } from "react-native";
import type { Device } from "react-native-ble-plx";
import { createVehicle, fetchVehicle, patchVehicle } from "../api/supabase";
import { pairedDevice } from "../ble/autoConnect";
import { Elm327 } from "../ble/elm327";
import { manager, waitForPoweredOn } from "../ble/manager";
import { requestBlePermissions } from "../ble/permissions";
import { rememberVehicle, setBaseline } from "../mileage/sync";
import { Button, Field, Note, styles, Title } from "./ui";

type Step =
  | { name: "scan" }
  | { name: "reading"; device: Device }
  | { name: "baseline"; device: Device; pid31: number };

/** One-time pairing: pick the adapter, read PID 31, enter the dashboard km. */
export default function Setup({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>({ name: "scan" });
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Honda Accord 2009");
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
      setStep({ name: "baseline", device, pid31 });
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

  async function save(device: Device, pid31: number) {
    setSaving(true);
    setError(null);
    try {
      const km = Number(odometer);
      const existing = await fetchVehicle();
      if (existing) {
        await patchVehicle(existing.id, { name, adapter_device_id: device.id });
        await setBaseline({ ...existing, name, adapter_device_id: device.id }, km, pid31);
      } else {
        const created = await createVehicle({
          name,
          adapter_device_id: device.id,
          baseline_odometer_km: km,
          baseline_pid31_km: pid31,
        });
        await rememberVehicle(created);
      }
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
    const valid = /^\d{1,7}$/.test(odometer) && name.trim().length > 0;
    return (
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Title>Enter the baseline</Title>
        <Note>
          The adapter reports {step.pid31.toLocaleString()} km since codes were cleared. Type the
          odometer exactly as the dashboard shows it right now.
        </Note>
        <Field placeholder="Car name" value={name} onChangeText={setName} />
        <Field
          placeholder="Dashboard odometer (km)"
          keyboardType="number-pad"
          value={odometer}
          onChangeText={setOdometer}
        />
        {error && <Note error>{error}</Note>}
        <Button title="Save" disabled={!valid || saving} onPress={() => save(step.device, step.pid31)} />
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
