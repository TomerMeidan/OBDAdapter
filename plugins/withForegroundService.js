// Declares the background-actions service as a "connectedDevice" foreground
// service, which Android 14+ requires before the service may start.
const { withAndroidManifest, AndroidConfig } = require("expo/config-plugins");

const SERVICE = "com.asterinet.react.bgactions.RNBackgroundActionsTask";

module.exports = function withForegroundService(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service ?? []).filter((s) => s.$["android:name"] !== SERVICE);
    app.service.push({
      $: {
        "android:name": SERVICE,
        "android:foregroundServiceType": "connectedDevice",
        "android:exported": "false",
      },
    });
    return cfg;
  });
};
