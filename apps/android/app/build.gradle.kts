plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "xyz.ogturtle.turtle"
    compileSdk = 35

    defaultConfig {
        applicationId = "xyz.ogturtle.turtle"
        minSdk = 26
        targetSdk = 35
        // O GitHub Actions passa -PversionCode=<número da execução> (cada APK mais novo que o anterior).
        versionCode = (project.findProperty("versionCode") ?: "1").toString().toInt()
        versionName = (project.findProperty("versionName") ?: "0.1.0").toString()
        // Servidor do Turtle. Para apontar para outro: -PserverUrl=https://exemplo.com
        buildConfigField("String", "SERVER_URL", "\"${project.findProperty("serverUrl") ?: "https://turtlechat.tech"}\"")
    }

    // Assinatura: o Android só atualiza um app por cima de outro com a MESMA chave. O CI lê a chave dos
    // segredos do GitHub (ver README.md); sem eles o APK sai com a chave de debug (instala, mas não atualiza
    // por cima de outro APK assinado com chave diferente).
    val keystore = System.getenv("ANDROID_KEYSTORE_FILE")
    if (!keystore.isNullOrEmpty()) {
        signingConfigs {
            create("turtle") {
                storeFile = file(keystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (!keystore.isNullOrEmpty()) signingConfigs.getByName("turtle") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("io.coil-kt:coil-compose:2.7.0")
    implementation("io.livekit:livekit-android:2.30.0")

    testImplementation("junit:junit:4.13.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
