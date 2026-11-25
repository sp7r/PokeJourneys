import com.google.firebase.crashlytics.buildtools.gradle.CrashlyticsExtension
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile
import java.util.Properties
import java.net.URI
import java.nio.file.FileSystems
import java.nio.file.Files

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("app.cash.paparazzi")
}

// The companion's screens and what they need, compiled by shared-ui/ (the root build's sharedUiSources): their paths
// under src/main/kotlin, left out of this module's compile and lint.
@Suppress("UNCHECKED_CAST")
val sharedUiFiles: Set<String> = fileTree("src/main/kotlin") {
    include(rootProject.extra["sharedUiSources"] as List<String>)
    exclude(rootProject.extra["sharedUiAppOnly"] as List<String>)
    exclude(rootProject.extra["sharedCoreSources"] as List<String>)
}.map { it.relativeTo(file("src/main/kotlin")).invariantSeparatorsPath }
    // Kotlin only: shared-ui compiles no Java, so a .java under those folders (co-op's X25519 copy) stays the app's.
    .filter { it.endsWith(".kt") }.toSet()

@Suppress("UNCHECKED_CAST")
val sharedCoreFiles: Set<String> = fileTree("src/main/kotlin") {
    include(rootProject.extra["sharedCoreSources"] as List<String>)
}.map { it.relativeTo(file("src/main/kotlin")).invariantSeparatorsPath }.toSet()

// Crash reports (Firebase Crashlytics, opt-in - CrashReports.kt): only with the project's
// app/google-services.json, which stays out of this public repo (gitignored; the release
// workflow writes it from a secret). Without it the app builds the same, reports off.
val crashlytics = file("google-services.json").isFile
if (crashlytics) {
    apply(plugin = "com.google.gms.google-services")
    apply(plugin = "com.google.firebase.crashlytics")
    // The dev build's package id (com.pokedaisy.app.dev) has no client in google-services.json, which fails its task.
    tasks.configureEach { if (name == "processDevGoogleServices") enabled = false }
}

// Release signing comes from an untracked keystore.properties (storeFile, storePassword,
// keyAlias, keyPassword) - the key itself lives outside this public repo. Without it,
// release builds come out unsigned. Every GitHub release must be signed with the same
// key, or the in-app updater's APK won't install over the previous one.
val keystoreProps = rootProject.file("keystore.properties").takeIf { it.isFile }?.let { f ->
    Properties().apply { f.inputStream().use(::load) }
}

// A password left out of keystore.properties comes from the macOS Keychain instead, so it needn't sit
// in a plain file: `security add-generic-password -a pokedaisy -s pokedaisy-<storePassword|keyPassword> -w`.
fun signingSecret(name: String): String? =
    keystoreProps?.getProperty(name)?.takeIf { it.isNotBlank() } ?: runCatching {
        val p = ProcessBuilder("security", "find-generic-password", "-a", "pokedaisy", "-s", "pokedaisy-$name", "-w")
            .redirectErrorStream(false).start()
        p.inputStream.bufferedReader().readText().trim().takeIf { p.waitFor() == 0 && it.isNotEmpty() }
    }.getOrNull()

// Values a build takes from outside this public repo: the untracked local.properties, else the
// environment (the release workflow's secrets), escaped for a BuildConfig string; empty without either.
// - ScreenScraper's developer credentials (ScreenScraperClient: every API call carries the app's own
//   as well as the player's account): screenscraper.devId / screenscraper.devPassword, or
//   SCREENSCRAPER_DEV_ID / SCREENSCRAPER_DEV_PASSWORD. Without them a build still sends the player's
//   account alone, and the sign-in says what the server answered.
// - The co-op relay: coop.relayUrl, or COOP_RELAY_URL. Without it co-op is LAN and BY IP only.
val localProps = rootProject.file("local.properties").takeIf { it.isFile }?.let { f ->
    Properties().apply { f.inputStream().use(::load) }
}
fun buildSecret(prop: String, env: String): String =
    (localProps?.getProperty(prop) ?: System.getenv(env)).orEmpty()
        .replace("\\", "\\\\").replace("\"", "\\\"")

// Features merged but off until asked for (FeatureFlags.kt): `-Ppokedaisy.<name>=true` on the command line, or the same
// key in local.properties. A marker file on the device turns them on for an APK already installed.
fun featureFlag(name: String): Boolean =
    (findProperty("pokedaisy.$name") ?: localProps?.getProperty("pokedaisy.$name"))?.toString()?.trim()?.toBoolean() == true

// The ABIs every native library is built for: arm64 always, x86_64 too for the emulator
// (`-Ppokedaisy.x86_64=true`), 32-bit ARM for a device running a 32-bit Android (`-Ppokedaisy.armv7=true`).
val nativeAbis = listOf("arm64-v8a") +
    (if (featureFlag("x86_64")) listOf("x86_64") else emptyList()) +
    (if (featureFlag("armv7")) listOf("armeabi-v7a") else emptyList())

android {
    namespace = "com.pokedaisy.app"
    compileSdk = 34
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "com.pokejourneys.app"
        minSdk = 26
        targetSdk = 34
        // Bump both for every GitHub release: the updater compares versionName
        // against the release tag (v<versionName>), Android needs versionCode to grow.
        versionCode = 24
        versionName = "1.7.1"
        // Whether this build can send crash reports at all (CrashReports.available).
        buildConfigField("boolean", "CRASHLYTICS", crashlytics.toString())
        buildConfigField("String", "SCREENSCRAPER_DEV_ID", "\"${buildSecret("screenscraper.devId", "SCREENSCRAPER_DEV_ID")}\"")
        buildConfigField("String", "SCREENSCRAPER_DEV_PASSWORD", "\"${buildSecret("screenscraper.devPassword", "SCREENSCRAPER_DEV_PASSWORD")}\"")
        // The co-op relay this build starts on (empty = no relay: LAN and BY IP only); Settings can override it.
        buildConfigField("String", "COOP_RELAY_URL", "\"${buildSecret("coop.relayUrl", "COOP_RELAY_URL")}\"")
        // ScreenScraper (game media, its setup step and the update's popup): off until the app has its developer login
        // (FeatureFlags.screenScraper).
        buildConfigField("boolean", "FEATURE_SCREENSCRAPER", featureFlag("screenScraper").toString())
        // CO-OP (the connection to a paired partner): off until the feature ships (FeatureFlags.coop).
        buildConfigField("boolean", "FEATURE_COOP", featureFlag("coop").toString())
        // 3DS games (Azahar, the n3ds module): only built in with the flag (settings.gradle.kts), off until they ship
        // (FeatureFlags.n3ds).
        buildConfigField("boolean", "FEATURE_N3DS", featureFlag("n3ds").toString())
        // Blocked games (BlockedGames) play with everything, tagged BLOCKED: debug builds always, else only with this.
        buildConfigField("boolean", "FEATURE_ALLOW_BLOCKED", featureFlag("allowBlocked").toString())
        // ...and `allowBlocked=false` keeps them blocked in a debug build too (to see it as a release does).
        buildConfigField("boolean", "FEATURE_KEEP_BLOCKED",
            ((findProperty("pokedaisy.allowBlocked") ?: localProps?.getProperty("pokedaisy.allowBlocked"))?.toString()?.trim() == "false").toString())

        ndk {
            // Thor is arm64; armeabi-v7a (a 32-bit Android) only with the armv7 flag above.
            abiFilters += nativeAbis
        }
        externalNativeBuild {
            cmake {
                // mGBA core is C-only, but keep a real STL around in case a
                // transitive piece needs it; it's cheap.
                arguments += "-DANDROID_STL=c++_shared"
                cFlags += "-O2"
                // melonDS (the DS core) is C++: unoptimised, a DS game runs far below full speed even in debug builds.
                cppFlags += "-O2"
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    androidResources {
        // Stored, so the fonts are mapped straight from the APK instead of
        // inflated into memory each time one loads (PixelTypeface.kt).
        noCompress += "ttf"
    }

    signingConfigs {
        if (keystoreProps != null) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = signingSecret("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = signingSecret("keyPassword")
            }
        }
    }

    buildTypes {
        // The release build's code (not debuggable, so ART compiles it and installs the libraries' baseline profiles)
        // under the debug key, so it installs over a debug build: for timing a device (`assembleBenchmark`).
        create("benchmark") {
            initWith(getByName("debug"))
            isDebuggable = false
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
        }
        // A debug build that installs beside the release app (`make install-dev`): its own package id, so its own
        // data under Android/data/<id>/, named "PokeDaisy Dev" with an orange icon (src/dev/res). No crash reports:
        // google-services.json has no client for its id.
        create("dev") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".dev"
            buildConfigField("boolean", "CRASHLYTICS", "false")
            matchingFallbacks += listOf("debug")
        }
        release {
            isMinifyEnabled = false
            if (keystoreProps != null) signingConfig = signingConfigs.getByName("release")
            // libpokedaisy's symbols, so native crashes (mGBA, the JNI bridge) read as
            // functions, not addresses: `make release` runs uploadCrashlyticsSymbolFileRelease.
            if (crashlytics) (this as ExtensionAware).extensions.configure<CrashlyticsExtension> {
                nativeSymbolUploadEnabled = true
                mappingFileUploadEnabled = false
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // The dev build is a debug build: the debug overlay (exported PokeDaisyActivity, local co-op relay) plus its own name / icon.
    sourceSets["dev"].manifest.srcFile("src/debug/AndroidManifest.xml")
    sourceSets["dev"].res.srcDirs("src/debug/res", "src/dev/res")
    sourceSets["main"].java.srcDirs("src/main/kotlin")
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/licenses"))
    sourceSets["test"].java.srcDirs("src/test/kotlin", "../server/coop-relay/src/main/kotlin")

    // The shared modules' files are compiled there; lint reads them there too.
    sourceSets["main"].java.filter.exclude(sharedCoreFiles)
    sourceSets["main"].java.filter.exclude(sharedUiFiles)

    testOptions {
        unitTests.isIncludeAndroidResources = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

// companion/data and companion/i18n are compiled by shared/ (Android + iOS), so the app leaves them out of its own
// compile, and their tests too but those that also use the app's classes (the root build's appOnlyTests).
@Suppress("UNCHECKED_CAST")
val appOnlyTests = rootProject.extra["appOnlyTests"] as List<String>
@Suppress("UNCHECKED_CAST")
val sharedTestHelpers = rootProject.extra["sharedTestHelpers"] as List<String>
val sharedDirs = listOf("com/pokedaisy/app/companion/data/", "com/pokedaisy/app/companion/i18n/")
tasks.withType<KotlinCompile>().configureEach {
    val tests = name.contains("UnitTest")
    exclude { e ->
        !e.isDirectory && sharedDirs.any { e.path.startsWith(it) } && !(tests && e.file.nameWithoutExtension in appOnlyTests + sharedTestHelpers)
    }
    // The companion's screens are compiled by shared-ui/; their tests stay here (Paparazzi).
    if (!tests) exclude { e -> !e.isDirectory && (e.path in sharedUiFiles || e.path in sharedCoreFiles) }
}

// Settings > LICENSES: NOTICE, then the license text of everything the APK carries, as one asset
// (licenses.txt; a line "=== <name>" starts each part).
val licensesAsset by tasks.registering {
    val parts = listOf(
        "PokeJourneys and PokeDaisy (NOTICE)" to "NOTICE",
        "GNU General Public License v3 (PokeJourneys, PokeDaisy)" to "LICENSE",
        "mGBA - Mozilla Public License 2.0" to "third_party/mgba/LICENSE",
        "blip_buf (in mGBA) - GNU LGPL 2.1" to "third_party/mgba/src/third-party/blip_buf/license.txt",
        "inih (in mGBA) - BSD" to "third_party/mgba/src/third-party/inih/LICENSE.txt",
        "rcheevos - MIT" to "third_party/rcheevos/LICENSE",
        "PKHeX.Core (save bridge) - GNU GPL 3.0 or later" to "LICENSE",
        ".NET runtime (save bridge) - MIT" to "third_party/licenses/dotnet-runtime-MIT.txt",
        "melonDS - GNU GPL 3.0" to "third_party/melonds/LICENSE",
        "FatFs (in melonDS)" to "third_party/melonds/src/fatfs/LICENSE.txt",
        "Teakra (in melonDS) - MIT" to "third_party/melonds/src/teakra/LICENSE",
        "xxHash (in melonDS) - BSD 2-Clause" to "third_party/licenses/xxHash-BSD-2-Clause.txt",
        "tiny-AES-c (in melonDS and DSperate) - The Unlicense" to "third_party/melonds/src/tiny-AES-c/unlicense.txt",
        "blip_buf (in melonDS) - GNU LGPL 2.1" to "third_party/melonds/src/blip-buf/license.txt",
        "Dolphin's ARM64 emitter (in melonDS) - GNU GPL 2.0 or later" to "third_party/melonds/src/dolphin/license_dolphin.txt",
        "DSperate - GNU GPL 3.0 or later" to "third_party/dsperate/LICENSE",
        "FreeBIOS (in DSperate) - BSD 2-Clause" to "third_party/dsperate/src/core/bios/LICENSE.freebios",
        "miniz (in DSperate) - MIT" to "third_party/dsperate/src/core/cart/miniz/LICENSE",
        "Noto Sans DSi font table (in DSperate) - SIL Open Font License 1.1" to "third_party/dsperate/src/core/io/dsi_font/LICENSE-NotoSans-OFL-1.1.txt",
        "WenQuanYi Micro Hei DSi font table (in DSperate) - GNU GPL 3.0 or later with font exception" to "third_party/dsperate/src/core/io/dsi_font/LICENSE-WenQuanYi-MicroHei.txt",
        "BananaDS - GNU GPL 3.0 or later" to "third_party/bananads/bananads/LICENSE",
        "melonDS (in BananaDS) - GNU GPL 3.0" to "third_party/melonds-bananads/LICENSE",
        "LCD and Scanlines shaders - MIT" to "third_party/licenses/mGBA-shaders-MIT.txt",
        "xBR, xBRZ and ScaleFX shaders (libretro glsl-shaders) - MIT, xBRZ also GNU GPL 3.0" to "third_party/licenses/libretro-shaders.txt",
        "PixelMplus - M+ FONT LICENSE" to "app/src/main/assets/fonts/LICENSE-PixelMplus.txt",
        "Galmuri - SIL Open Font License 1.1" to "app/src/main/assets/fonts/LICENSE-Galmuri.txt",
        "Atkinson Hyperlegible - SIL Open Font License 1.1" to "app/src/main/assets/fonts/LICENSE-AtkinsonHyperlegible.txt",
        "PokeAPI data - BSD 3-Clause" to "third_party/licenses/PokeAPI-BSD-3-Clause.txt",
        "apicula (DS model converter) - BSD Zero Clause" to "third_party/licenses/apicula-0BSD.txt",
        "QuickJS (quickjs-ng) - MIT" to "third_party/licenses/quickjs-MIT.txt",
        "SSEQ Player (hub music) - WTFPL" to "third_party/licenses/SSEQPlayer-WTFPL.txt",
        "QOA (hub music) - MIT" to "third_party/licenses/qoa-MIT.txt",
        "Godot Engine (Victory Island) - MIT" to "third_party/licenses/Godot-MIT.txt",
        "Godot Engine's bundled libraries" to "third_party/licenses/Godot-COPYRIGHT.txt",
        "AndroidX, Jetpack Compose / Compose Multiplatform, Kotlin, Ktor, kotlinx.atomicfu, kotlinx-datetime, Apache Commons Compress / IO / Codec / Lang, Firebase Crashlytics, ZXing, OkHttp, Okio - Apache License 2.0" to "third_party/licenses/Apache-2.0.txt",
        "Apache Commons - NOTICE" to "third_party/licenses/Apache-Commons-NOTICE.txt",
        "XZ for Java - BSD Zero Clause" to "third_party/licenses/XZ-Java-0BSD.txt",
        "Bouncy Castle (co-op) - MIT" to "third_party/licenses/BouncyCastle-MIT.txt",
        "Generation 8 Pack follower sprites (hub followers) - credits" to "third_party/licenses/Gen8-Pack-credits.txt",
    ).map { (name, path) -> name to rootProject.file(path) }
    inputs.files(parts.map { it.second })
    val out = layout.buildDirectory.file("generated/licenses/licenses.txt")
    outputs.file(out)
    doLast {
        out.get().asFile.apply { parentFile.mkdirs() }.writeText(
            parts.joinToString("\n\n") { (name, f) -> "=== $name\n\n" + f.readText().trim() } +
                "\n\n=== Pixel Operator - CC0 1.0\n\nJayvee Enaguas dedicated the font to the public domain (CC0 1.0).\n",
        )
    }
}
tasks.named("preBuild") { dependsOn(licensesAsset) }

// The offline Battle Dome runs the browser-compatible Showdown simulator in Android's existing WebView.
val domeAssetsDir = layout.buildDirectory.dir("generated/domeAssets")
val domeDependencies by tasks.registering(Exec::class) {
    inputs.files(rootProject.file("tools/battle/package.json"), rootProject.file("tools/battle/package-lock.json"))
    outputs.file(rootProject.file("tools/battle/node_modules/.package-lock.json"))
    val install = listOf("npm", "ci", "--ignore-scripts", "--prefix", rootProject.file("tools/battle").path)
    commandLine(if (org.gradle.internal.os.OperatingSystem.current().isWindows) listOf("cmd", "/c") + install else install)
}
val domeAssets by tasks.registering(Exec::class) {
    dependsOn(domeDependencies)
    inputs.files(rootProject.fileTree("tools/battle") { exclude("node_modules/**") })
    inputs.file(rootProject.file("third_party/licenses/pkmn-MIT.txt"))
    outputs.dir(domeAssetsDir)
    commandLine("node", rootProject.file("tools/battle/build.mjs").path, domeAssetsDir.get().asFile.path)
}
android.sourceSets["main"].assets.srcDir(domeAssetsDir)
tasks.named("preBuild") { dependsOn(domeAssets) }
licensesAsset.configure {
    dependsOn(domeAssets)
    val notices = domeAssetsDir.map { it.file("dome/licenses.txt") }
    inputs.file(notices)
    doLast {
        layout.buildDirectory.file("generated/licenses/licenses.txt").get().asFile
            .appendText("\n\n=== Battle Dome simulator dependencies - MIT\n\n" + notices.get().asFile.readText())
    }
}

// PokeJourneys: the save bridge (src/Journeys.Cli on PKHeX.Core), compiled ahead of time for Android arm64 and
// shipped as lib/arm64-v8a/libjourneys.so, an executable the app runs from its native library folder
// (journeys/JourneysBridge.kt). Building it needs the .NET 10 SDK; the NDK supplies the linker.
val journeysPublishDir = layout.buildDirectory.dir("journeys/publish")
val journeysBridge by tasks.registering(Exec::class) {
    val os = org.gradle.internal.os.OperatingSystem.current()
    val host = when { os.isWindows -> "windows-x86_64"; os.isMacOsX -> "darwin-x86_64"; else -> "linux-x86_64" }
    val llvm = android.ndkDirectory.resolve("toolchains/llvm/prebuilt/$host")
    val exe = if (os.isWindows) ".exe" else ""
    inputs.dir(rootProject.file("src"))
    outputs.dir(journeysPublishDir)
    environment("PATH", llvm.resolve("bin").path + File.pathSeparator + System.getenv("PATH"))
    commandLine(
        "dotnet", "publish", rootProject.file("src/Journeys.Cli").path,
        "-c", "Release", "-r", "linux-bionic-arm64", "-o", journeysPublishDir.get().asFile.path,
        "-p:PublishAot=true", "-p:PublishAotUsingRuntimePack=true", "-p:DisableUnsupportedError=true",
        "-p:CppCompilerAndLinker=aarch64-linux-android26-clang" + (if (os.isWindows) ".cmd" else ""),
        "-p:SysRoot=" + llvm.resolve("sysroot").path,
        "-p:ObjCopyName=llvm-objcopy$exe",
    )
}
val journeysJniLibs = layout.buildDirectory.dir("generated/journeysJni")
val journeysJniLib by tasks.registering(Copy::class) {
    dependsOn(journeysBridge)
    from(journeysPublishDir) { include("journeys"); rename { "libjourneys.so" } }
    into(journeysJniLibs.map { it.dir("arm64-v8a") })
}
android.sourceSets["main"].jniLibs.srcDir(journeysJniLibs)

// PokeJourneys: apicula (https://github.com/scurest/apicula, 0BSD), which converts the DS models in the player's own
// ROMs on first run. Cloned at a fixed commit, built without its model viewer (tools/apicula/no-viewer.patch) and
// shipped as lib/arm64-v8a/libapicula.so, run as a program like libjourneys.so. Needs Rust (rustup target add
// aarch64-linux-android); cargo from pokejourneys.cargo in local.properties, CARGO, or ~/.cargo/bin. Skipped without it.
val apiculaCommit = "3d4e91e14045392a49c89e86dab8cb936225588c"
val apiculaSrc = layout.buildDirectory.dir("apicula/src")
val cargo = (localProps?.getProperty("pokejourneys.cargo") ?: System.getenv("CARGO"))?.takeIf { it.isNotBlank() }
    ?: File(System.getProperty("user.home"), ".cargo/bin/cargo" + if (org.gradle.internal.os.OperatingSystem.current().isWindows) ".exe" else "")
        .takeIf { it.isFile }?.path
val apiculaBuild by tasks.registering {
    onlyIf { cargo != null }
    val patch = rootProject.file("tools/apicula/no-viewer.patch")
    inputs.file(patch)
    outputs.file(apiculaSrc.map { it.file("target/aarch64-linux-android/release/apicula") })
    doLast {
        val os = org.gradle.internal.os.OperatingSystem.current()
        val host = when { os.isWindows -> "windows-x86_64"; os.isMacOsX -> "darwin-x86_64"; else -> "linux-x86_64" }
        val bin = android.ndkDirectory.resolve("toolchains/llvm/prebuilt/$host/bin")
        val clang = bin.resolve("aarch64-linux-android26-clang" + if (os.isWindows) ".cmd" else "").path
        val src = apiculaSrc.get().asFile
        fun run(dir: File, vararg command: String, env: Map<String, String> = emptyMap()) {
            // Output is read here rather than inherited: inheriting the daemon's handles leaves cargo hanging on Windows.
            val process = ProcessBuilder(*command).directory(dir).redirectErrorStream(true)
                .also { it.environment().putAll(env) }.start()
            process.outputStream.close()
            process.inputStream.bufferedReader().forEachLine { logger.lifecycle(it) }
            check(process.waitFor() == 0) { command.joinToString(" ") + " failed" }
        }
        if (!src.resolve(".git").isDirectory) {
            src.deleteRecursively(); src.parentFile.mkdirs()
            run(src.parentFile, "git", "clone", "-q", "https://github.com/scurest/apicula", src.path)
        }
        run(src, "git", "checkout", "-q", "-f", apiculaCommit)
        run(src, "git", "apply", patch.path)
        run(src, cargo!!, "build", "--release", "--locked", "--no-default-features", "--target", "aarch64-linux-android",
            env = mapOf("CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER" to clang, "CC_aarch64_linux_android" to clang,
                "AR_aarch64_linux_android" to bin.resolve("llvm-ar" + if (os.isWindows) ".exe" else "").path))
    }
}
val apiculaJniLib by tasks.registering(Copy::class) {
    dependsOn(apiculaBuild)
    from(apiculaSrc.map { it.dir("target/aarch64-linux-android/release") }) { include("apicula"); rename { "libapicula.so" } }
    into(journeysJniLibs.map { it.dir("arm64-v8a") })
}
tasks.named("preBuild") { dependsOn(apiculaJniLib) }

// PokeJourneys: QuickJS (quickjs-ng, https://github.com/quickjs-ng/quickjs, MIT), whose qjs program runs the hub's
// build scripts (tools/hub, as assets under hub-build/) on the phone to make the hub data from the player's ROMs.
// Built at a pinned release with the SDK's CMake and the NDK, packed as lib/arm64-v8a/libqjs.so.
val qjsTag = "v0.10.1"
val qjsSrc = layout.buildDirectory.dir("quickjs/src")
val qjsBuild by tasks.registering {
    outputs.file(qjsSrc.map { it.file("build-android/qjs") })
    doLast {
        val src = qjsSrc.get().asFile
        val sdk = android.sdkDirectory
        val cmake = sdk.resolve("cmake").listFiles()?.filter { it.resolve("bin").isDirectory }?.maxByOrNull { it.name }?.resolve("bin")
            ?: error("CMake is missing from the Android SDK")
        val exe = if (org.gradle.internal.os.OperatingSystem.current().isWindows) ".exe" else ""
        fun run(dir: File, vararg command: String) {
            val process = ProcessBuilder(*command).directory(dir).redirectErrorStream(true).start()
            process.outputStream.close()
            process.inputStream.bufferedReader().forEachLine { logger.lifecycle(it) }
            check(process.waitFor() == 0) { command.joinToString(" ") + " failed" }
        }
        if (!src.resolve(".git").isDirectory) {
            src.deleteRecursively(); src.parentFile.mkdirs()
            run(src.parentFile, "git", "clone", "-q", "--depth", "1", "--branch", qjsTag, "https://github.com/quickjs-ng/quickjs", src.path)
        }
        run(src, cmake.resolve("cmake$exe").path, "-S", ".", "-B", "build-android", "-G", "Ninja",
            "-DCMAKE_MAKE_PROGRAM=" + cmake.resolve("ninja$exe").path,
            "-DCMAKE_TOOLCHAIN_FILE=" + android.ndkDirectory.resolve("build/cmake/android.toolchain.cmake").path,
            "-DANDROID_ABI=arm64-v8a", "-DANDROID_PLATFORM=android-26", "-DCMAKE_BUILD_TYPE=Release")
        run(src, cmake.resolve("cmake$exe").path, "--build", "build-android", "--target", "qjs_exe")
        val strip = android.ndkDirectory.resolve("toolchains/llvm/prebuilt").listFiles()!!.first().resolve("bin/llvm-strip$exe")
        run(src, strip.path, "build-android/qjs")
    }
}
val qjsJniLib by tasks.registering(Copy::class) {
    dependsOn(qjsBuild)
    from(qjsSrc.map { it.dir("build-android") }) { include("qjs"); rename { "libqjs.so" } }
    into(journeysJniLibs.map { it.dir("arm64-v8a") })
}
tasks.named("preBuild") { dependsOn(qjsJniLib) }
// The hub build scripts and the owner's design data they read (no game data), as assets under hub-build/.
val hubBuildAssetsDir = layout.buildDirectory.dir("generated/hubBuildAssets")
val hubBuildAssets by tasks.registering(Sync::class) {
    from(rootProject.file("tools/hub")) {
        include("qjs/*.mjs", "qjs/*.js", "victory/*.js", "victory/*.json", "dsms/glb-to-obj.js", "build/**")
        into("hub-build/tools/hub")
    }
    from(rootProject.file("hub/victory/data/layout.json")) { into("hub-build/hub/victory/data") }
    into(hubBuildAssetsDir)
}
android.sourceSets["main"].assets.srcDir(hubBuildAssetsDir)
tasks.named("preBuild") { dependsOn(hubBuildAssets) }
// Native libraries are extracted to the device, so libjourneys.so can be run as a program.
android.packaging.jniLibs.useLegacyPackaging = true
tasks.named("preBuild") { dependsOn(journeysJniLib) }

// PokeJourneys: Victory Island (hub/victory), exported by Godot 4.7.2 as plain project files at the root of the APK's
// assets, which is where the Godot library looks for res://, with the creator art (assets/creator) as res://creator.
// Needs the Godot editor: pokejourneys.godot=<path to Godot_v4.7.2-stable_win64_console.exe> in local.properties, or
// GODOT. Without it the APK has no hub and the app opens on the library (journeys/HubActivity.kt).
val godotEditor = (localProps?.getProperty("pokejourneys.godot") ?: System.getenv("GODOT"))?.takeIf { it.isNotBlank() }
val hubPackFile = layout.buildDirectory.file("hub/victory.zip")
val hubAssetsDir = layout.buildDirectory.dir("generated/hubAssets")
val hubPack by tasks.registering(Exec::class) {
    onlyIf { godotEditor != null }
    inputs.dir(rootProject.file("hub/victory")).withPropertyName("project")
    outputs.file(hubPackFile)
    doFirst { hubPackFile.get().asFile.parentFile.mkdirs() }
    commandLine(
        godotEditor ?: "godot", "--headless", "--path", rootProject.file("hub/victory").path,
        "--export-pack", "Android", hubPackFile.get().asFile.path,
    )
}
val hubAssets by tasks.registering(Sync::class) {
    dependsOn(hubPack)
    onlyIf { godotEditor != null }
    from(provider { hubPackFile.get().asFile.takeIf { it.isFile }?.let { zipTree(it) } ?: files() })
    from(rootProject.file("assets/creator")) { into("creator") }
    into(hubAssetsDir)
}
android.sourceSets["main"].assets.srcDir(hubAssetsDir)
// The hub's .godot folder: the default pattern skips every name starting with a dot.
android.androidResources.ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:<dir>_*:!CVS:!thumbs.db:!picasa.ini:!*~"
tasks.named("preBuild") { dependsOn(hubAssets) }
// Discord sign-in (journeys/DiscordSignIn.kt): the Discord application's client id, discord.clientId in
// local.properties or DISCORD_CLIENT_ID. Without one the hub has no sign-in screen. The redirect's scheme is
// discord-<client id>, as Discord asks of mobile apps.
val discordClientId = buildSecret("discord.clientId", "DISCORD_CLIENT_ID").filter { it.isDigit() }
android.defaultConfig.buildConfigField("String", "DISCORD_CLIENT_ID", "\"$discordClientId\"")
android.defaultConfig.buildConfigField("String", "OFFICIAL_SERVER_URL", "\"${buildSecret("journeys.officialServer", "JOURNEYS_OFFICIAL_SERVER")}\"")
android.defaultConfig.manifestPlaceholders["discordScheme"] = "discord-" + discordClientId.ifEmpty { "0" }
// Bouncy Castle and that Kotlin standard library both carry this OSGi manifest; the app needs neither.
android.packaging.resources.excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF"

tasks.withType<Test> {
    // readNativeTelemetry's bag-read throttle (NativeReader.kt) caches its
    // last result in file-level (process-global) state - harmless in the
    // real app (one NativeConfig per process) but it leaks between different
    // games' tests if they share a JVM. One fresh JVM per test class keeps
    // each game's decode test isolated without touching production code.
    forkEvery = 1
    // Tests that read real ROMs skip without them (Assume). Point them at a folder of
    // the player's own dumps with POKEDAISY_ROM_DIR (the release workflow's runner does).
    System.getenv("POKEDAISY_ROM_DIR")?.takeIf { it.isNotBlank() }?.let { systemProperty("romDir", it) }
    // `make test-quick` (-Pquick): the everyday run. The Paparazzi renders assert nothing and were 86% of the
    // full run's time; BestEffortTest scans 26 whole ROMs. The forks run side by side (still one class each).
    if (project.hasProperty("quick")) {
        filter {
            excludeTestsMatching("*ScreenshotTest")
            excludeTestsMatching("*BestEffortTest")
        }
        maxParallelForks = (Runtime.getRuntime().availableProcessors() / 2).coerceAtLeast(1)
    }
}

// Test-only: copies the JDK's com.sun.net.httpserver classes (from the running JDK's jrt image) into a jar, since android.jar hides them.
val jdkHttpServerStub by tasks.registering {
    val out = layout.buildDirectory.dir("jdk-httpserver")
    outputs.dir(out)
    inputs.property("jdk", System.getProperty("java.version"))
    doLast {
        val root = out.get().asFile
        root.deleteRecursively()
        val jrt = FileSystems.getFileSystem(URI.create("jrt:/"))
        val src = jrt.getPath("/modules/jdk.httpserver/com/sun/net/httpserver")
        Files.walk(src).use { paths ->
            paths.filter { Files.isRegularFile(it) }.forEach {
                val dest = root.toPath().resolve("com/sun/net/httpserver").resolve(src.relativize(it).toString())
                Files.createDirectories(dest.parent)
                Files.copy(it, dest)
            }
        }
    }
}
val jdkHttpServerJar by tasks.registering(Zip::class) {
    dependsOn(jdkHttpServerStub)
    from(layout.buildDirectory.dir("jdk-httpserver"))
    archiveFileName.set("jdk-httpserver.jar")
    destinationDirectory.set(layout.buildDirectory)
}

dependencies {
    // The companion's data and language code (shared/build.gradle.kts).
    implementation(project(":shared"))
    // The companion's screens (shared-ui/build.gradle.kts).
    implementation(project(":shared-ui"))
    // 3DS games' native library (libpk_n3ds.so), only with the n3ds flag: see settings.gradle.kts.
    if (featureFlag("n3ds")) implementation(project(":n3ds"))
    implementation("androidx.core:core-ktx:1.13.1")
    // FOLD LAYOUT: a foldable's hinge and posture (WindowInfoTracker's FoldingFeature), for a plain Activity.
    implementation("androidx.window:window:1.3.0")
    implementation("androidx.window:window-java:1.3.0")
    implementation("androidx.activity:activity-compose:1.9.1")
    // Firebase (play-services-basement) brings androidx.fragment 1.1.0, too old for registerForActivityResult
    // (lintVitalRelease's InvalidFragmentVersionForActivityResult): ask for one that matches activity 1.9.
    implementation("androidx.fragment:fragment:1.8.2")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")
    implementation("androidx.savedstate:savedstate-ktx:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    // Bottom-screen companion UI (ported from tools/android-companion).
    // 2025.03.01 = Compose 1.7.8, the last before 1.8 (which needs compileSdk 35).
    val composeBom = platform("androidx.compose:compose-bom:2025.03.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.runtime:runtime")

    // ROMs in .7z archives (RomArchive; .zip is java.util.zip). xz is 7z's LZMA / LZMA2.
    implementation("org.apache.commons:commons-compress:1.28.0")
    implementation("org.tukaani:xz:1.12")


    // Crash reports, opt-in (CrashReports.kt). -ndk catches native crashes too (mGBA, JNI),
    // which is where most of this app's crashes have been.
    implementation(platform("com.google.firebase:firebase-bom:33.16.0"))
    implementation("com.google.firebase:firebase-crashlytics")
    implementation("com.google.firebase:firebase-crashlytics-ndk")

    // Decode-logic regression tests (app/src/test) - see scripts/capture_fixture.sh
    // for how the fixtures they read (app/src/test/resources/fixtures/) get made.
    testImplementation("junit:junit:4.13.2")
    // CoopQrTest reads the invite codes back (the app draws them with its own encoder, CoopQr).
    testImplementation("com.google.zxing:core:3.5.3")
    // The real org.json (android.jar's is a stub in unit tests): ScreenScraperTest and DocsSearchTest parse JSON.
    testImplementation("org.json:json:20260814")
    // The co-op relay server (its sources are on the test path) for CoopRelayIntegrationTest.
    testImplementation("org.java-websocket:Java-WebSocket:1.6.0")
    testImplementation("org.slf4j:slf4j-nop:2.0.20")
    // The relay uses the JDK's HttpServer, which android.jar hides at compile time (the JDK has it at run time).
    testImplementation(files(jdkHttpServerJar))
    // Co-op transport crypto: X25519 (rfc7748) for keys and the Noise IK handshake is Bouncy Castle's own code, copied
    // into companion/coop/x25519/ (MIT); the whole library stays a test dependency, which X25519Test checks the copy against.
    testImplementation("org.bouncycastle:bcprov-jdk18on:1.87")
    // The relay WebSocket (Apache 2.0, with Okio).
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // Byte buffers, files and hashes in the data code shared with the iPad app (okio is Kotlin Multiplatform).
    implementation("com.squareup.okio:okio:3.18.2")
    // Locks in the data code shared with the iPad app (atomicfu is Kotlin Multiplatform; the coroutines are above).
    implementation("org.jetbrains.kotlinx:atomicfu:0.23.1")
    // The local date and time in the data code shared with the iPad app (Kotlin Multiplatform).
    implementation("org.jetbrains.kotlinx:kotlinx-datetime:0.7.1")
    // JSON in the code shared with the iPad app (the manual's API; Kotlin Multiplatform, no compiler plugin: the element API).
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")

    // PokeJourneys: the Godot engine for Victory Island (journeys/HubActivity.kt), MIT.
    implementation("org.godotengine:godot:4.7.2.stable")
}

