import { registerRootComponent } from "expo";

import App from "./App";
import { startAutoConnect } from "./src/ble/autoConnect";
import { installCrashRecorder } from "./src/crash";

installCrashRecorder();

// Started here rather than in a component so it also runs when iOS relaunches
// the app in the background after the adapter appears.
void startAutoConnect().catch(() => undefined);

registerRootComponent(App);
