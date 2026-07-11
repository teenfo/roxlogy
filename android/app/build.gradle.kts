plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.compose.compiler)
}

android {
    namespace = "app.roxlogy.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.roxlogy.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"

        // Google 로그인용 웹 클라이언트 ID. **공개 식별자**(APK에 포함·추출 가능)라
        // 커밋해도 안전하다 — 비밀은 아니다. Supabase Google 프로바이더에 등록된 것과 동일.
        // env(ROXLOGY_GOOGLE_WEB_CLIENT_ID)/gradle property로 오버라이드 가능.
        // (참고: 클라이언트 secret(GOCSPX-…)은 서버(Supabase)에만, 절대 커밋 금지.)
        // 빈 문자열(시크릿 미설정 시 CI가 넘기는 값)은 "미설정"으로 취급해 기본값으로 폴백.
        val googleWebClientId =
            System.getenv("ROXLOGY_GOOGLE_WEB_CLIENT_ID")?.takeIf { it.isNotBlank() }
                ?: (project.findProperty("roxlogyGoogleWebClientId") as String?)?.takeIf { it.isNotBlank() }
                ?: "265762211451-6f2krau47k8rnhdstf772c3fpqtkk17c.apps.googleusercontent.com"
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")

        // 임베드할 웹앱(roxlogy.com) URL. env/gradle property로 오버라이드(스테이징 등).
        val webAppUrl =
            System.getenv("ROXLOGY_WEB_APP_URL")?.takeIf { it.isNotBlank() }
                ?: (project.findProperty("roxlogyWebAppUrl") as String?)?.takeIf { it.isNotBlank() }
                ?: "https://roxlogy.com"
        buildConfigField("String", "WEB_APP_URL", "\"$webAppUrl\"")
    }

    signingConfigs {
        // N6b: 릴리스 keystore가 env로 주어지면 사용, 없으면 debug 폴백(사이드로드 설치 가능).
        create("release") {
            val ksFile = System.getenv("ROXLOGY_KEYSTORE_FILE")
            if (ksFile != null && file(ksFile).exists()) {
                storeFile = file(ksFile)
                storePassword = System.getenv("ROXLOGY_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ROXLOGY_KEY_ALIAS")
                keyPassword = System.getenv("ROXLOGY_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release").takeIf { it.storeFile != null }
                ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":shared"))
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.play.services.wearable)
    implementation(libs.okhttp)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services)
    implementation(libs.google.id)
    implementation(libs.androidx.security.crypto)
}
