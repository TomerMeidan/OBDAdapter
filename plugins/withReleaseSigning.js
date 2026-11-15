// Signs release builds with your own key instead of the React Native template's shared debug key, whose
// password is public: an APK signed with that key could install over the app as an "update" and read its
// data, the device token included. The key and its passwords stay out of the repository: set the four
// OBD_UPLOAD_* properties in %USERPROFILE%\.gradle\gradle.properties (see README, "Signing key").
// Without them a release build stops with an error, unless OBD_ALLOW_DEBUG_SIGNING=true is set on purpose.
const { withAppBuildGradle } = require("expo/config-plugins");

const RELEASE_CONFIG = `
        release {
            if (findProperty('OBD_UPLOAD_STORE_FILE')) {
                storeFile file(findProperty('OBD_UPLOAD_STORE_FILE'))
                storePassword findProperty('OBD_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('OBD_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('OBD_UPLOAD_KEY_PASSWORD')
            }
        }`;

const RELEASE_SIGNING = "signingConfig(findProperty('OBD_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug)";

// Checked when the task graph is known, so debug builds (expo run:android) never need the key.
const GUARD = `

// OBD Mileage: a release build must be signed with your own key (plugins/withReleaseSigning.js).
gradle.taskGraph.whenReady { graph ->
    def release = graph.allTasks.any { it.project == project && it.name.toLowerCase().contains('release') }
    if (release && !findProperty('OBD_UPLOAD_STORE_FILE') && findProperty('OBD_ALLOW_DEBUG_SIGNING') != 'true') {
        throw new GradleException("OBD Mileage: OBD_UPLOAD_STORE_FILE is not set, so this release build would be signed with the public debug key. " +
            "Set the OBD_UPLOAD_* properties (README, Signing key), or OBD_ALLOW_DEBUG_SIGNING=true to build with the debug key anyway.")
    }
}
`;

/** Rewrites the template's app/build.gradle. Exported for the test. */
function applyReleaseSigning(gradle) {
  if (gradle.includes("OBD_UPLOAD_STORE_FILE")) return gradle;
  const configs = gradle.replace(/signingConfigs \{/, (m) => m + RELEASE_CONFIG);
  // The template's release build type points at the debug key, right after its "Caution!" comment.
  const signed = configs.replace(
    /(release \{\s*(?:\/\/[^\n]*\n\s*)*)signingConfig signingConfigs\.debug/,
    (_m, head) => head + RELEASE_SIGNING,
  );
  if (configs === gradle || signed === configs) {
    throw new Error("withReleaseSigning: android/app/build.gradle no longer has the expected signing blocks.");
  }
  return signed + GUARD;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.applyReleaseSigning = applyReleaseSigning;
