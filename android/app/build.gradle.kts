plugins {
    id("com.android.application")
}

android {
    namespace = "app.lifegame.companion"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.lifegame.companion"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // No third-party libraries on purpose: the app only needs the Android platform and Kotlin.
    testImplementation("junit:junit:4.13.2")
}
