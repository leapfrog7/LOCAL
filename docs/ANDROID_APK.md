# Building the LOCAL Android APK

## Test APK

From the repository root, run:

```bash
npm run android:apk
```

The command builds the web application, syncs it into Capacitor, compiles the Android project, and copies the result to:

```text
artifacts/LOCAL-debug.apk
```

The debug APK is signed with Android's local debug certificate and is suitable for installation and physical-device testing. Android 6.0 (API 23) or newer is required.

## Android Studio

Open the `android` directory as the Android Studio project. Select the `app` configuration and a connected device, then use **Run** for iterative testing. If Android Studio asks for a Gradle JDK, choose JDK 21 rather than its Java 25 runtime for this project generation.

## Release APK

Do not distribute the debug APK as a production release. In Android Studio, use **Build → Generate Signed App Bundle or APK**, choose **APK**, and create or select a private release keystore. Store that keystore and its passwords outside the repository and back them up securely; losing the key prevents publishing future updates under the same app identity.

Before the first release, update `versionCode` and `versionName` in `android/app/build.gradle`, review the final application ID (`in.local.vault`), replace the placeholder launcher artwork if necessary, and test camera, OCR, export, storage, biometric locking, and upgrades on a physical device.
