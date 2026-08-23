import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const androidRoot = join(projectRoot, 'android')

const fail = message => {
  console.error(`\nAndroid APK build stopped: ${message}`)
  process.exit(1)
}

const run = (command, args, cwd = projectRoot, environment = process.env) => {
  const windows = process.platform === 'win32'
  const executable = windows ? process.env.ComSpec ?? 'cmd.exe' : command
  const executableArgs = windows ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args
  const result = spawnSync(executable, executableArgs, {
    cwd,
    env: environment,
    stdio: 'inherit',
  })
  if (result.error) fail(result.error.message)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const portableRoot = join(projectRoot, '.android-tools')
const portableJdks = existsSync(portableRoot)
  ? readdirSync(portableRoot).filter(name => name.startsWith('jdk-21')).map(name => join(portableRoot, name))
  : []
const javaCandidates = [process.env.JAVA_HOME, ...portableJdks].filter(Boolean)
const javaHome = javaCandidates.find(candidate => {
  const executable = join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (!existsSync(executable)) return false
  const version = spawnSync(executable, ['-version'], { encoding: 'utf8' })
  const major = Number(`${version.stdout}${version.stderr}`.match(/version "(\d+)/)?.[1])
  return major >= 17 && major <= 23
})

if (!javaHome) fail('JDK 17 or 21 was not found. Set JAVA_HOME to a compatible JDK, then retry.')

const sdkRoot = process.env.ANDROID_SDK_ROOT
  ?? process.env.ANDROID_HOME
  ?? (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined)
if (!sdkRoot || !existsSync(sdkRoot)) fail('Android SDK was not found. Open Android Studio SDK Manager and install Android SDK Platform 35.')

const escapedSdkPath = sdkRoot.replace(/\\/g, '\\\\').replace(':', '\\:')
writeFileSync(join(androidRoot, 'local.properties'), `sdk.dir=${escapedSdkPath}\n`)

run('npm', ['run', 'build'])
run('npm', ['run', 'android:sync'])
const redundantAndroidOcrAssets = join(androidRoot, 'app', 'src', 'main', 'assets', 'public', 'ocr')
if (existsSync(redundantAndroidOcrAssets)) rmSync(redundantAndroidOcrAssets, { recursive: true, force: true })
run(join(androidRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), ['clean', 'assembleDebug'], androidRoot, { ...process.env, JAVA_HOME: javaHome })

const source = join(androidRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
if (!existsSync(source)) fail('Gradle completed but the debug APK was not found.')
const artifactDirectory = join(projectRoot, 'artifacts')
mkdirSync(artifactDirectory, { recursive: true })
const destination = join(artifactDirectory, 'LOCAL-debug.apk')
copyFileSync(source, destination)
console.log(`\nLOCAL debug APK ready:\n${destination}`)
