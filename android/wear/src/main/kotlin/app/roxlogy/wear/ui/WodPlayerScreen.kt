package app.roxlogy.wear.ui

import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import app.roxlogy.wear.store.WearStore
import app.roxlogy.wear.sync.WearDataSender
import app.roxlogy.wear.sync.WearWod
import app.roxlogy.wear.ui.theme.Good
import app.roxlogy.wear.ui.theme.MutedText
import app.roxlogy.wear.ui.theme.RaceYellow
import app.roxlogy.wear.ui.theme.SurfaceHi
import kotlinx.coroutines.delay

private fun fmtSec(ms: Long): String {
    val t = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(t / 60, t % 60)
}

/**
 * 오늘의 WOD 플레이어 — 폰이 푸시한 워크아웃을 순서대로 수행.
 * 현재 항목 타이머 + [완료] = 체크·소요시간 확정·역동기화(⌚ note) 후 다음 항목.
 */
@Composable
fun WodPlayerScreen(sender: WearDataSender) {
    val context = LocalContext.current
    var wod by remember { mutableStateOf<WearWod.Wod?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var doneIds by remember { mutableStateOf(setOf<String>()) }
    var itemStartMs by remember { mutableStateOf(System.currentTimeMillis()) }
    var nowMs by remember { mutableStateOf(System.currentTimeMillis()) }
    val vibrator = remember { context.getSystemService(Vibrator::class.java) }

    LaunchedEffect(Unit) {
        val w = WearWod.load(context)
        wod = w
        doneIds = w?.items?.filter { it.done }?.map { it.id }?.toSet() ?: emptySet()
        loaded = true
        itemStartMs = System.currentTimeMillis()
        while (true) {
            nowMs = System.currentTimeMillis()
            delay(500)
        }
    }

    fun buzz(ms: Long) {
        if (!WearStore.hapticEnabled(context)) return
        vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    val w = wod
    val current = w?.items?.firstOrNull { it.id !in doneIds }
    val allDone = w != null && current == null

    Scaffold(timeText = { TimeText() }) {
        ScalingLazyColumn(Modifier.fillMaxSize()) {
            item {
                ListHeader {
                    Text(
                        w?.title ?: "오늘의 WOD",
                        color = RaceYellow, fontWeight = FontWeight.Bold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            when {
                !loaded -> item { Text("불러오는 중…", fontSize = 11.sp, color = MutedText) }
                w == null -> item {
                    Text(
                        "오늘의 WOD 없음\n폰 앱 [워치] 탭에서\n동기화하거나 프로그램을\n등록하세요",
                        fontSize = 11.sp, color = MutedText, textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                allDone -> {
                    item {
                        Text(
                            "오늘의 WOD 완료 ✓",
                            fontSize = 14.sp, color = Good, fontWeight = FontWeight.Bold,
                            textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    items(w.items) { it -> WodRow(it.name, done = true, active = false, sub = it.note) }
                }
                else -> {
                    // 현재 항목 — 크게 + 타이머 + 완료
                    item {
                        Card(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
                            Text("지금", fontSize = 9.sp, color = MutedText)
                            Text(
                                current!!.name, fontSize = 15.sp, fontWeight = FontWeight.Bold,
                                maxLines = 2, overflow = TextOverflow.Ellipsis,
                            )
                            current.note?.let { Text(it, fontSize = 10.sp, color = MutedText, maxLines = 2) }
                            Text(
                                fmtSec(nowMs - itemStartMs),
                                fontSize = 20.sp, fontWeight = FontWeight.Bold, color = RaceYellow,
                            )
                        }
                    }
                    item {
                        Chip(
                            onClick = {
                                val elapsed = System.currentTimeMillis() - itemStartMs
                                sender.sendWodDone(current!!.id, elapsed)
                                doneIds = doneIds + current.id
                                itemStartMs = System.currentTimeMillis()
                                buzz(60)
                                if (w.items.all { it.id in doneIds }) buzz(200)
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ChipDefaults.primaryChipColors(),
                            label = {
                                Text("완료", fontSize = 14.sp, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
                            },
                        )
                    }
                    item { ListHeader { Text("전체 목록", fontSize = 10.sp, color = MutedText) } }
                    items(w.items) { it ->
                        WodRow(it.name, done = it.id in doneIds, active = it.id == current!!.id, sub = it.note)
                    }
                }
            }
        }
    }
}

@Composable
private fun WodRow(name: String, done: Boolean, active: Boolean, sub: String?) {
    Card(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (done) "✓" else if (active) "▶" else "○",
                fontSize = 12.sp,
                color = if (done) Good else if (active) RaceYellow else MutedText,
            )
            Spacer(Modifier.width(6.dp))
            Column {
                Text(
                    name, fontSize = 12.sp,
                    color = if (done) MutedText else androidx.compose.ui.graphics.Color.White,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                if (!done && sub != null) {
                    Text(sub, fontSize = 9.sp, color = MutedText, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}
