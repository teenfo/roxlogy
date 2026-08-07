package app.roxlogy.android

import android.content.Context
import android.content.SharedPreferences
import java.io.PrintWriter
import java.io.StringWriter

/**
 * 사이드로드 앱용 최소 크래시 리포터.
 *
 * 스토어 배포가 아니라 크래시가 나도 로그를 볼 방법이 없다(adb 없이는 "튕김"만 보인다).
 * 그래서 처리되지 않은 예외를 평문으로 저장해 두고, 다음 실행 때 화면에 보여준다.
 * 개인정보가 담기지 않도록 스택트레이스만 남기며, 사용자가 지울 수 있다.
 */
object CrashLog {

    private const val PREFS = "rox_crash"
    private const val KEY_TRACE = "trace"
    private const val MAX_CHARS = 4000

    private fun prefs(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** 앱 시작 시 1회. 기존 핸들러를 감싸(체인) 저장만 추가한다. */
    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching {
                val sw = StringWriter()
                error.printStackTrace(PrintWriter(sw))
                val text = sw.toString().take(MAX_CHARS)
                prefs(app).edit().putString(KEY_TRACE, text).commit() // 죽기 전이라 commit
            }
            previous?.uncaughtException(thread, error)
        }
    }

    /** 마지막 크래시 스택트레이스 (없으면 null). */
    fun last(context: Context): String? = prefs(context).getString(KEY_TRACE, null)

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_TRACE).apply()
    }
}
