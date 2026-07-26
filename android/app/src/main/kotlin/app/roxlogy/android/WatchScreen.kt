package app.roxlogy.android

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.roxlogy.android.sync.GoalSync
import app.roxlogy.android.ui.RoxMark
import app.roxlogy.android.ui.RoxOutlineButton
import app.roxlogy.android.ui.RoxPrimaryButton
import app.roxlogy.android.ui.theme.RoxAccent
import app.roxlogy.android.ui.theme.RoxError
import app.roxlogy.android.ui.theme.RoxMuted
import app.roxlogy.android.ui.theme.RoxSurface
import app.roxlogy.android.ui.theme.RoxTrack
import com.google.android.gms.tasks.Tasks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 워치 탭 — 백그라운드로만 돌던 워치 연동을 전면으로 노출하는 네이티브 허브.
 * ① 연결 상태 ② 목표 diff 수동 재전송 ③ 오늘의 WOD(네이티브) ④ 자동 업로드 안내 ⑤ 설치 안내.
 */
@Composable
fun WatchScreen(onOpenWeb: (String) -> Unit, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var showWod by remember { mutableStateOf(false) }
    var nodes by remember { mutableStateOf<List<String>?>(null) } // null = 조회 중
    var goalNote by remember { mutableStateOf<String?>(null) }
    var goalBusy by remember { mutableStateOf(false) }

    suspend fun loadNodes() {
        nodes = withContext(Dispatchers.IO) {
            runCatching {
                Tasks.await(
                    com.google.android.gms.wearable.Wearable.getNodeClient(context).connectedNodes,
                ).map { it.displayName }
            }.getOrDefault(emptyList())
        }
    }

    LaunchedEffect(Unit) { loadNodes() }

    if (showWod) {
        BackHandler { showWod = false }
        WodScreen(onBack = { showWod = false })
        return
    }

    BackHandler { onBack() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoxMark(size = 28.dp)
            Spacer(Modifier.width(10.dp))
            Text("워치", fontWeight = FontWeight.Black, fontSize = 18.sp, letterSpacing = 2.sp)
        }

        Spacer(Modifier.height(20.dp))

        // ① 연결 상태
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(RoxSurface, MaterialTheme.shapes.large)
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(
                    Modifier
                        .width(8.dp)
                        .height(8.dp)
                        .background(
                            when {
                                nodes == null -> RoxMuted
                                nodes!!.isEmpty() -> RoxError
                                else -> RoxTrack
                            },
                            CircleShape,
                        ),
                )
                Spacer(Modifier.width(8.dp))
                Text("연결 상태", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { scope.launch { nodes = null; loadNodes() } }) {
                    Text("새로고침", color = RoxMuted, fontSize = 12.sp)
                }
            }
            Spacer(Modifier.height(4.dp))
            Text(
                when {
                    nodes == null -> "확인 중…"
                    nodes!!.isEmpty() -> "연결된 워치가 없습니다. 워치의 블루투스 연결을 확인하세요."
                    else -> "연결됨: ${nodes!!.joinToString(", ")}"
                },
                color = RoxMuted,
                fontSize = 13.sp,
            )
        }

        Spacer(Modifier.height(14.dp))

        // ③ 오늘의 WOD (네이티브 기록 화면)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(RoxSurface, MaterialTheme.shapes.large)
                .padding(20.dp),
        ) {
            Text("오늘의 WOD", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                "활성 프로그램의 오늘 워크아웃을 체크하고 무게·횟수를 기록합니다.",
                color = RoxMuted,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(14.dp))
            RoxPrimaryButton(text = "오늘의 WOD 열기", onClick = { showWod = true })
        }

        Spacer(Modifier.height(14.dp))

        // ② 목표 diff 재전송
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(RoxSurface, MaterialTheme.shapes.large)
                .padding(20.dp),
        ) {
            Text("목표 전송", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                "웹에서 저장한 최신 목표 스플릿을 워치로 보냅니다. 시뮬 진행 중 구간별 diff가 표시됩니다. (로그인 시 자동 전송되며, 목표를 바꿨다면 여기서 다시 보내세요.)",
                color = RoxMuted,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(14.dp))
            RoxOutlineButton(
                text = if (goalBusy) "전송 중…" else "워치로 목표 다시 보내기",
                onClick = {
                    if (goalBusy) return@RoxOutlineButton
                    goalBusy = true; goalNote = null
                    scope.launch {
                        val ok = GoalSync().fetchAndPush(context)
                        goalBusy = false
                        goalNote = if (ok) "전송 완료 — 워치에서 목표가 갱신됩니다."
                        else "전송 실패 — 저장된 목표가 없거나 워치가 연결되지 않았습니다."
                    }
                },
            )
            goalNote?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = if (it.startsWith("전송 완료")) RoxTrack else RoxError, fontSize = 12.sp)
            }
        }

        Spacer(Modifier.height(14.dp))

        // ④ 자동 업로드 안내
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(RoxSurface, MaterialTheme.shapes.large)
                .padding(20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.width(8.dp).height(8.dp).background(RoxAccent, CircleShape))
                Spacer(Modifier.width(8.dp))
                Text("세션 자동 업로드", style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(4.dp))
            Text(
                "워치에서 하이록스 시뮬을 마치면 세션이 자동으로 폰을 거쳐 서버에 저장됩니다. 오프라인이어도 보류됐다가 연결되면 재전송됩니다. 저장된 세션은 [세션] 탭에서 확인하세요.",
                color = RoxMuted,
                fontSize = 13.sp,
            )
        }

        Spacer(Modifier.height(14.dp))

        // ⑤ 설치 안내
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(RoxSurface, MaterialTheme.shapes.large)
                .padding(20.dp),
        ) {
            Text("워치 앱 설치", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(4.dp))
            Text(
                "Wear OS 워치 앱(사이드로드)과 가민 Connect IQ 앱을 지원합니다.",
                color = RoxMuted,
                fontSize = 13.sp,
            )
            Spacer(Modifier.height(14.dp))
            RoxOutlineButton(text = "다운로드 페이지 열기", onClick = { onOpenWeb("/download") })
        }

        Spacer(Modifier.height(24.dp))
    }
}
