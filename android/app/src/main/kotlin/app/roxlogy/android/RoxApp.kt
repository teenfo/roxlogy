package app.roxlogy.android

import android.app.Application
import android.content.Context

/**
 * 크래시 리포터를 **가능한 가장 이른 시점**에 설치하기 위한 Application.
 *
 * 안드로이드 시작 순서는 attachBaseContext → ContentProvider.onCreate(Firebase 자동 초기화가
 * 여기서 돈다) → Application.onCreate → Activity.onCreate 다. 핸들러를 Activity 에서 걸면
 * 그보다 앞서 죽는 크래시(예: Firebase 초기화 실패)를 놓친다. 그래서 attachBaseContext 에서 건다.
 */
class RoxApp : Application() {

    override fun attachBaseContext(base: Context) {
        super.attachBaseContext(base)
        runCatching { CrashLog.install(base) }
    }
}
