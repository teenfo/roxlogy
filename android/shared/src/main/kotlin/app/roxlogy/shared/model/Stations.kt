package app.roxlogy.shared.model

/**
 * HYROX 스테이션 고정 정의 — exercise_id는 웹 시드(web/lib/hyrox.ts)의 UUID와 일치해야
 * 워치가 만든 세그먼트가 서버에서 동일 운동으로 매핑된다. (상표 "HYROX"는 코드/설명 내
 * 호환성 표기만 허용 — 앱/패키지명에는 사용 금지.)
 */
enum class MachineType(val wire: String) {
    SKI("ski"),
    ROW("row"),
}

data class Station(
    val key: String,
    val exerciseId: String,
    val machine: MachineType?,
)

object Stations {
    const val RUN_EXERCISE_ID = "e0000000-0000-0000-0000-000000000009"

    val ALL: List<Station> = listOf(
        Station("ski",       "e0000000-0000-0000-0000-000000000001", MachineType.SKI),
        Station("sledpush",  "e0000000-0000-0000-0000-000000000002", null),
        Station("sledpull",  "e0000000-0000-0000-0000-000000000003", null),
        Station("burpee",    "e0000000-0000-0000-0000-000000000004", null),
        Station("row",       "e0000000-0000-0000-0000-000000000005", MachineType.ROW),
        Station("farmers",   "e0000000-0000-0000-0000-000000000006", null),
        Station("lunges",    "e0000000-0000-0000-0000-000000000007", null),
        Station("wallballs", "e0000000-0000-0000-0000-000000000008", null),
    )

    fun byKey(key: String): Station? = ALL.firstOrNull { it.key == key }
}
