package app.roxlogy.wear.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Card
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.ToggleChip
import androidx.wear.compose.material.ToggleChipDefaults
import app.roxlogy.shared.record.StoredSession
import app.roxlogy.shared.sim.GoalPlan
import app.roxlogy.shared.sim.HyroxSim
import app.roxlogy.wear.store.WearStore
import app.roxlogy.wear.sync.WearDataSender
import app.roxlogy.wear.ui.theme.MutedText
import app.roxlogy.wear.ui.theme.RaceYellow
import app.roxlogy.wear.ui.theme.SurfaceHi
import app.roxlogy.wear.ui.theme.TrackBlue
import androidx.compose.ui.platform.LocalContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private fun fmtTotal(ms: Long): String {
    val t = (ms / 1000).coerceAtLeast(0)
    val h = t / 3600
    return if (h > 0) "%d:%02d:%02d".format(h, (t % 3600) / 60, t % 60)
    else "%d:%02d".format(t / 60, t % 60)
}

/** 주 액션 버튼 — 전폭·15sp Bold (전 화면 공통 규격). */
@Composable
fun PrimaryActionChip(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Chip(
        onClick = onClick,
        modifier = modifier.fillMaxWidth(0.85f).height(40.dp),
        colors = ChipDefaults.primaryChipColors(),
        label = {
            Text(
                text, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
            )
        },
    )
}

/** T자 분할 하단 칸 — 값(16sp Bold) + 서브라벨(9sp). */
@Composable
fun MetricCell(value: String, valueColor: Color, sub: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = valueColor)
        Text(sub, fontSize = 9.sp, color = MutedText)
    }
}

/** 브랜드 워드마크 헤더 — Archivo Black 스타일(볼드·대문자·타이트 자간). */
@Composable
fun BrandHeader(sub: String? = null) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            "ROXLOGY",
            fontSize = 15.sp,
            fontWeight = FontWeight.Black,
            letterSpacing = 1.5.sp,
            color = RaceYellow,
        )
        if (sub != null) Text(sub, fontSize = 10.sp, color = MutedText)
    }
}

/** 메뉴 항목 — full-width Chip + 아이콘 글리프 + 보조 라벨. */
@Composable
private fun MenuChip(
    glyph: String,
    label: String,
    secondary: String? = null,
    primary: Boolean = false,
    onClick: () -> Unit,
) {
    Chip(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = if (primary) ChipDefaults.primaryChipColors()
        else ChipDefaults.secondaryChipColors(backgroundColor = SurfaceHi),
        icon = {
            Text(glyph, fontSize = 15.sp, color = if (primary) Color.Black else RaceYellow)
        },
        label = {
            Text(label, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        },
        secondaryLabel = secondary?.let {
            { Text(it, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        },
    )
}

// ---------------------------------------------------------------- 메뉴
@Composable
fun MenuScreen(
    hasResume: Boolean,
    hasWod: Boolean,
    onStart: (Boolean) -> Unit,
    onWod: () -> Unit,
    onErg: () -> Unit,
    onGoal: () -> Unit,
    onArchive: () -> Unit,
    onSettings: () -> Unit,
) {
    Scaffold(timeText = { TimeText() }) {
        ScalingLazyColumn(Modifier.fillMaxSize()) {
            item { BrandHeader(sub = "HYROX 트레이닝") }
            item { Spacer(Modifier.height(2.dp)) }
            if (hasResume) {
                item {
                    MenuChip("▶", "이어서 기록", "진행 중인 시뮬 있음", primary = true) {
                        onStart(true)
                    }
                }
                item { MenuChip("↻", "새 레이스 시뮬") { onStart(false) } }
            } else {
                item { MenuChip("▶", "레이스 시뮬", "8×1km + 8 스테이션", primary = true) { onStart(false) } }
            }
            item {
                MenuChip("✓", "오늘의 WOD", if (hasWod) "프로그램 워크아웃" else "폰에서 동기화 필요") { onWod() }
            }
            item { MenuChip("⚡", "에르그", "PM5 단독 기록") { onErg() } }
            item { MenuChip("◎", "목표", "목표 스플릿 확인") { onGoal() } }
            item { MenuChip("▤", "보관함", "최근 세션 · 재전송") { onArchive() } }
            item { MenuChip("⚙", "설정") { onSettings() } }
        }
    }
}

// ---------------------------------------------------------------- 보관함
@Composable
fun ArchiveScreen(sender: WearDataSender) {
    val context = LocalContext.current
    val items = remember { WearStore.sessions(context).sortedByDescending { it.createdAtMs } }
    var resentId by remember { mutableStateOf<String?>(null) }
    val dateFmt = remember { SimpleDateFormat("M/d (E) HH:mm", Locale.getDefault()) }

    Scaffold(timeText = { TimeText() }) {
        ScalingLazyColumn(Modifier.fillMaxSize()) {
            item { ListHeader { Text("보관함", color = RaceYellow, fontWeight = FontWeight.Bold) } }
            if (items.isEmpty()) {
                item {
                    Text(
                        "저장된 세션 없음",
                        fontSize = 12.sp, color = MutedText, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            items(items, key = { it.id }) { s: StoredSession ->
                Card(onClick = {
                    sender.sendRaw(s.id, s.payloadJson, s.clientUpdatedAt)
                    resentId = s.id
                }) {
                    Text(dateFmt.format(Date(s.createdAtMs)), fontSize = 12.sp)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(fmtTotal(s.totalMs), fontSize = 15.sp, fontWeight = FontWeight.Bold, color = RaceYellow)
                        Spacer(Modifier.width(6.dp))
                        Text(
                            when {
                                resentId == s.id -> "재전송함 ✓"
                                s.sent -> "전송됨"
                                else -> "대기"
                            },
                            fontSize = 10.sp,
                            color = if (resentId == s.id) TrackBlue else MutedText,
                        )
                    }
                }
            }
            item { Text("최근 20세션 · 72시간 보관 · 탭 = 재전송", fontSize = 9.sp, color = MutedText, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
        }
    }
}

// ---------------------------------------------------------------- 설정
@Composable
fun SettingsScreen(
    ble: app.roxlogy.wear.ble.Pm5BleClient,
    ensureBle: ((() -> Unit) -> Unit),
) {
    val context = LocalContext.current
    var haptic by remember { mutableStateOf(WearStore.hapticEnabled(context)) }
    var screenOn by remember { mutableStateOf(WearStore.screenOnEnabled(context)) }
    var ambient by remember { mutableStateOf(WearStore.ambientEnabled(context)) }
    // PM5 연결 테스트 — 화면을 나가면 연결 해제
    var pm5State by remember { mutableStateOf("idle") } // idle | scanning | ok
    var pm5Live by remember { mutableStateOf("") }
    androidx.compose.runtime.DisposableEffect(Unit) { onDispose { ble.stop() } }

    @Composable
    fun toggle(label: String, sub: String, checked: Boolean, onChange: (Boolean) -> Unit) {
        ToggleChip(
            checked = checked,
            onCheckedChange = onChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text(label, fontSize = 13.sp) },
            secondaryLabel = { Text(sub, fontSize = 9.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            toggleControl = {
                androidx.wear.compose.material.Icon(
                    imageVector = ToggleChipDefaults.switchIcon(checked),
                    contentDescription = null,
                )
            },
        )
    }

    Scaffold(timeText = { TimeText() }) {
        ScalingLazyColumn(Modifier.fillMaxSize()) {
            item { ListHeader { Text("설정", color = RaceYellow, fontWeight = FontWeight.Bold) } }
            item {
                toggle("햅틱 피드백", "랩·완료 시 진동", haptic) {
                    haptic = it; WearStore.setHaptic(context, it)
                }
            }
            item {
                toggle("화면 항상 켜기", "시뮬 중 화면 유지 (배터리↓)", screenOn) {
                    screenOn = it; WearStore.setScreenOn(context, it)
                }
            }
            item {
                toggle("앰비언트 모드", "꺼짐 시 저전력 간소 화면", ambient) {
                    ambient = it; WearStore.setAmbient(context, it)
                }
            }
            item { ListHeader { Text("PM5", fontSize = 11.sp, color = MutedText) } }
            item {
                Chip(
                    onClick = {
                        ensureBle {
                            pm5State = "scanning"
                            ble.start(object : app.roxlogy.wear.ble.Pm5BleClient.Listener {
                                override fun onConnected() { pm5State = "ok"; pm5Live = "" }
                                override fun onDisconnected() { pm5State = "idle"; pm5Live = "" }
                                override fun onSamples(samples: List<app.roxlogy.shared.ingest.ErgSample>) {
                                    samples.lastOrNull()?.let {
                                        pm5Live = "${it.watts ?: 0}W · ${it.spm ?: 0}spm"
                                    }
                                }
                                override fun onFailed(reason: String) {
                                    pm5State = "fail"; pm5Live = reason
                                }
                            })
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ChipDefaults.secondaryChipColors(backgroundColor = SurfaceHi),
                    label = {
                        Text(
                            when (pm5State) {
                                "ok" -> "PM5 연결됨 ✓ " + pm5Live.ifEmpty { "데이터 대기 중" }
                                "scanning" -> "PM5 검색 중…"
                                "fail" -> "PM5 연결 실패 — 다시 탭"
                                else -> "PM5 연결 테스트"
                            },
                            fontSize = 12.sp,
                        )
                    },
                    secondaryLabel = {
                        Text(
                            if (pm5State == "fail") pm5Live else "PM5 Menu → Connect 화면에서 탭",
                            fontSize = 9.sp, maxLines = 4,
                        )
                    },
                )
            }
            item { Text("v0.4.1", fontSize = 9.sp, color = MutedText, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth()) }
        }
    }
}

// ---------------------------------------------------------------- 목표
@Composable
fun GoalScreen(goal: GoalPlan?, stationLabel: Map<String, String>) {
    Scaffold(timeText = { TimeText() }) {
        ScalingLazyColumn(Modifier.fillMaxSize()) {
            item { ListHeader { Text("목표 스플릿", color = RaceYellow, fontWeight = FontWeight.Bold) } }
            if (goal == null) {
                item {
                    Text(
                        "저장된 목표 없음\n폰 앱 [워치] 탭에서\n목표를 보내세요",
                        fontSize = 11.sp, color = MutedText, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            } else {
                item { MetricRow("총시간", fmtTotal(goal.targetTotalMs), big = true) }
                item { MetricRow("1km 랩", fmtTotal(goal.runTotalMs / HyroxSim.ROUNDS)) }
                item { MetricRow("록스존 1회", fmtTotal(goal.roxzoneTotalMs / (HyroxSim.ROUNDS * 2))) }
                item { ListHeader { Text("스테이션", fontSize = 11.sp, color = MutedText) } }
                items(goal.stationTargets.entries.toList()) { (key, ms) ->
                    MetricRow(stationLabel[key] ?: key, fmtTotal(ms))
                }
            }
        }
    }
}

/** 지표 행 카드 — 라벨 + 큰 숫자 (Roxfit 요약 스타일). */
@Composable
fun MetricRow(label: String, value: String, big: Boolean = false, valueColor: Color = RaceYellow) {
    Card(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, fontSize = 11.sp, color = MutedText, modifier = Modifier.weight(1f))
            Text(
                value,
                fontSize = if (big) 18.sp else 14.sp,
                fontWeight = FontWeight.Bold,
                color = valueColor,
            )
        }
    }
}
