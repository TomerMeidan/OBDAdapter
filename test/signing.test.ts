import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { applyReleaseSigning } = createRequire(import.meta.url)("../plugins/withReleaseSigning.js");

// The part of the Expo template's android/app/build.gradle the plugin rewrites (SDK 58).
const template = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

test("release uses your key, debug keeps the debug key, and a release without it is stopped", () => {
  const out: string = applyReleaseSigning(template);
  assert.match(out, /signingConfigs \{\n\s+release \{\n\s+if \(findProperty\('OBD_UPLOAD_STORE_FILE'\)\)/);
  assert.match(out, /debug \{\n\s+signingConfig signingConfigs\.debug/);
  assert.match(out, /Caution![^\n]*\n[^\n]*\n\s+signingConfig\(findProperty\('OBD_UPLOAD_STORE_FILE'\) \? signingConfigs\.release : signingConfigs\.debug\)/);
  assert.match(out, /gradle\.taskGraph\.whenReady/);
  assert.match(out, /throw new GradleException/);
  assert.match(out, /OBD_ALLOW_DEBUG_SIGNING/);
});

test("running it twice changes nothing more", () => {
  const once = applyReleaseSigning(template);
  assert.equal(applyReleaseSigning(once), once);
});

test("a template it doesn't recognise stops prebuild instead of leaving the debug key", () => {
  assert.throws(() => applyReleaseSigning("android { }"), /expected signing blocks/);
});

test("an android folder made by the first version (silent debug-key fallback) is upgraded", () => {
  // What 493ef7a wrote for the release build type.
  const old = applyReleaseSigning(template).replace(
    "signingConfig(findProperty('OBD_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug)",
    `signingConfig(findProperty('OBD_UPLOAD_STORE_FILE') ? signingConfigs.release : {
                println("OBD Mileage: OBD_UPLOAD_STORE_FILE is not set, so this release build uses the shared debug key.")
                signingConfigs.debug
            }())`,
  ).replace(/\n\n\/\/ OBD Mileage: a release build must[\s\S]*$/, "");
  assert.ok(!old.includes("OBD_ALLOW_DEBUG_SIGNING") && old.includes("println"), "the fixture is the old output");

  const upgraded: string = applyReleaseSigning(old);
  assert.equal(upgraded, applyReleaseSigning(template));
});
