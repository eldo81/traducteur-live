plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val run = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 1

android {
    namespace = "com.dioneo.clavieria"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.dioneo.clavieria"
        minSdk = 26
        targetSdk = 35
        versionCode = run
        versionName = "1.0.$run"
    }

    signingConfigs {
        create("stable") {
            // Clé de signature fixe : les nouvelles versions s'installent par-dessus l'ancienne.
            storeFile = file("keystore/clavier-ia.keystore")
            storePassword = "android"
            keyAlias = "clavieria"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("stable")
        }
        debug {
            signingConfig = signingConfigs.getByName("stable")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}
