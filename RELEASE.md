# LOCAL Android release procedure

## Versioning

Android `versionName` and `androidVersionCode` are read from `package.json`. Increase both for every published build; `androidVersionCode` must be greater than every previously published APK.

## One-time signing key creation

Create the keystore outside the repository and keep two secure backups. Never commit the keystore or passwords.

```powershell
keytool -genkeypair -v -keystore C:\secure\LOCAL-release.jks -alias local-release -keyalg RSA -keysize 4096 -validity 10000
```

Set signing values only in the build shell or a private CI secret store:

```powershell
$env:LOCAL_RELEASE_STORE_FILE='C:\secure\LOCAL-release.jks'
$env:LOCAL_RELEASE_STORE_PASSWORD='<secret>'
$env:LOCAL_RELEASE_KEY_ALIAS='local-release'
$env:LOCAL_RELEASE_KEY_PASSWORD='<secret>'
```

`LOCAL_APPLICATION_ID` is intentionally unset for real releases. It exists only for isolated signed upgrade tests that must not replace a developer-signed installation.

Before tagging a release, compare `androidVersionCode` with the current public APK using `aapt dump badging`. Keeping the code in source control prevents repository or environment variables from silently producing a downgrade.

## Release gate

```powershell
npm ci
npm audit --omit=dev
npm test -- --run
npm run build
npm run android:sync
cd android
.\gradlew.bat clean lintRelease testReleaseUnitTest bundleRelease assembleRelease
```

Verify the output with `apksigner verify --verbose --print-certs`, preserve the certificate fingerprint, install the signed APK over the previous version without clearing data, and test scan, OCR, search, private unlock, export, backup and restore.

Outputs are generated under `android/app/build/outputs/`. Git ignores APK, AAB and keystore files.
