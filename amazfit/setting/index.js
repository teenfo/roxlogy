// Zepp 앱 내 설정 화면 — Supabase 사용자 액세스 토큰 입력 (Garmin 버전과 동일 규약).
AppSettingsPage({
  build(props) {
    const token = props.settingsStorage.getItem("token") || "";
    return View(
      { style: { padding: "16px" } },
      [
        Text(
          { style: { fontSize: "18px", fontWeight: "bold" } },
          "Roxlogy",
        ),
        Text(
          { style: { fontSize: "13px", color: "#666", marginTop: "8px" } },
          "Supabase access token — 로그인된 웹/폰 앱에서 발급한 토큰을 붙여넣으면 워치 기록이 계정으로 업로드됩니다.",
        ),
        TextInput({
          label: "Access token",
          value: token,
          onChange: (v) => props.settingsStorage.setItem("token", v),
        }),
      ],
    );
  },
});
