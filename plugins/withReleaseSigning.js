// Signs release builds with your own key instead of the React Native template's shared debug key, whose
// password is public. The key and its passwords stay out of the repository: set these four properties in
// %USERPROFILE%\.gradle\gradle.properties (see README, "Signing key"). Without them the build falls back
// to the debug key and says so.
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

const RELEASE_SIGNING = `signingConfig(findProperty('OBD_UPLOAD_STORE_FILE') ? signingConfigs.release : {
                println("OBD Mileage: OBD_UPLOAD_STORE_FILE is not set, so this release build uses the shared debug key.")
                signingConfigs.debug
            }())`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes("OBD_UPLOAD_STORE_FILE")) return cfg;

    const configs = gradle.replace(/signingConfigs \{/, (m) => m + RELEASE_CONFIG);
    // The template's release build type points at the debug key, right after its "Caution!" comment.
    const signed = configs.replace(
      /(release \{\s*(?:\/\/[^\n]*\n\s*)*)signingConfig signingConfigs\.debug/,
      (_m, head) => head + RELEASE_SIGNING,
    );
    if (configs === gradle || signed === configs) {
      throw new Error("withReleaseSigning: android/app/build.gradle no longer has the expected signing blocks.");
    }
    cfg.modResults.contents = signed;
    return cfg;
  });
};
