package app.roxlogy.android

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.roxlogy.android.sync.TokenStore
import app.roxlogy.android.sync.WodClient
import kotlinx.coroutines.launch

/**
 * 오늘의 WOD — 운동별 완료 체크 + 수행 무게/횟수 기록. 웹 워크아웃 상세와 동일 동작.
 * PM5 raw는 폰이 직결(권장 구조), 이 화면은 프로그램 WOD 수행 기록용.
 */
@Composable
fun WodScreen(onBack: () -> Unit) {
    val scope = rememberCoroutineScope()
    val client = remember { WodClient() }
    var loading by remember { mutableStateOf(true) }
    var wod by remember { mutableStateOf<WodClient.Wod?>(null) }
    var items by remember { mutableStateOf<List<WodClient.WodItem>>(emptyList()) }
    var message by remember { mutableStateOf<String?>(null) }

    suspend fun reload() {
        loading = true
        val token = TokenStore.accessToken()
        if (token == null) {
            message = "로그인이 필요합니다."
            loading = false
            return
        }
        val w = client.loadToday(token)
        wod = w
        items = w?.items ?: emptyList()
        if (w == null) message = "오늘 예정된 워크아웃이 없습니다."
        loading = false
    }

    LaunchedEffect(Unit) { reload() }

    fun replace(item: WodClient.WodItem) {
        items = items.map { if (it.itemId == item.itemId) item else it }
    }

    val doneCount = items.count { it.done }
    val total = items.size

    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← 뒤로") }
        }
        Text("오늘의 WOD", style = MaterialTheme.typography.headlineSmall)
        wod?.let {
            Text(
                "Day ${it.dayNumber} · ${it.title}",
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        if (loading) {
            Text("불러오는 중…", modifier = Modifier.padding(top = 16.dp))
            return@Column
        }

        if (total > 0) {
            LinearProgressIndicator(
                progress = { doneCount.toFloat() / total },
                modifier = Modifier.fillMaxWidth().padding(top = 16.dp),
            )
            Text(
                "$doneCount/$total 완료",
                style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(top = 6.dp),
            )
            if (doneCount == total) {
                Text(
                    "✓ WOD 완료됨",
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }

        message?.let {
            Text(it, modifier = Modifier.padding(top = 16.dp))
        }

        items.forEach { item ->
            WodItemRow(
                item = item,
                onToggle = { done ->
                    replace(item.copy(done = done))
                    scope.launch {
                        val token = TokenStore.accessToken() ?: return@launch
                        val ok = client.setComplete(item.itemId, done, token)
                        if (!ok) {
                            replace(item) // 되돌리기
                            message = "저장 실패 — 다시 시도하세요."
                        }
                    }
                },
                onSave = { weight, reps, note ->
                    scope.launch {
                        val token = TokenStore.accessToken() ?: return@launch
                        val ok = client.saveLog(item.itemId, weight, reps, note, token)
                        if (ok) {
                            replace(
                                item.copy(done = true, weightKg = weight, reps = reps, note = note),
                            )
                            message = null
                        } else {
                            message = "저장 실패 — 다시 시도하세요."
                        }
                    }
                },
            )
        }

        if (total > 0) {
            Button(
                onClick = {
                    val markAll = doneCount != total
                    scope.launch {
                        val token = TokenStore.accessToken() ?: return@launch
                        var allOk = true
                        for (it in items) {
                            if (it.done != markAll) {
                                val ok = client.setComplete(it.itemId, markAll, token)
                                if (!ok) allOk = false
                            }
                        }
                        if (allOk) items = items.map { it.copy(done = markAll) }
                        else message = "일부 저장 실패 — 다시 시도하세요."
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(top = 20.dp),
            ) {
                Text(if (doneCount == total) "WOD 완료 취소" else "WOD 완료 처리")
            }
        }
    }
}

@Composable
private fun WodItemRow(
    item: WodClient.WodItem,
    onToggle: (Boolean) -> Unit,
    onSave: (Double?, Int?, String?) -> Unit,
) {
    var weight by remember(item.itemId) {
        mutableStateOf(item.weightKg?.let { formatNum(it) } ?: "")
    }
    var reps by remember(item.itemId) {
        mutableStateOf(item.reps?.toString() ?: "")
    }
    var note by remember(item.itemId) { mutableStateOf(item.note ?: "") }

    Column(modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = item.done, onCheckedChange = onToggle)
            Column(modifier = Modifier.padding(start = 4.dp)) {
                Text(item.name, style = MaterialTheme.typography.bodyLarge)
                item.targetNote?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            OutlinedTextField(
                value = weight,
                onValueChange = { weight = it },
                label = { Text("무게(kg)") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.width(120.dp),
            )
            OutlinedTextField(
                value = reps,
                onValueChange = { reps = it },
                label = { Text("횟수") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.width(100.dp),
            )
        }
        OutlinedTextField(
            value = note,
            onValueChange = { note = it },
            label = { Text("메모") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
        TextButton(
            onClick = {
                onSave(
                    weight.trim().toDoubleOrNull(),
                    reps.trim().toIntOrNull(),
                    note.trim().ifEmpty { null },
                )
            },
        ) {
            Text("기록 저장")
        }
    }
}

private fun formatNum(v: Double): String =
    if (v == v.toLong().toDouble()) v.toLong().toString() else v.toString()
