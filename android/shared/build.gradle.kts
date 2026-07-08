plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.datetime)
    testImplementation(kotlin("test-junit"))
}

// 순수 Kotlin/JVM 모듈 — Android SDK 없이 로컬·CI에서 유닛테스트 가능.
// iOS 확장 시 KMP로 승격 (CLAUDE.md).
