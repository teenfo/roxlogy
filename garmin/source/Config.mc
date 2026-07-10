using Toybox.Application as App;

// 공유 상수. anon 키는 공개(RLS 보호) — service role 금지.
module Config {
    const PROJECT_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co";
    const INGEST_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co/functions/v1/ingest-session";
    const GOAL_URL = "https://vuloxbpfhyqkvgmpmkst.supabase.co/rest/v1/goal_plans";
    const ANON_KEY =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
        "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1bG94YnBmaHlxa3ZnbXBta3N0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMTc0NzgsImV4cCI6MjA5ODc5MzQ3OH0." +
        "WhmfRIZWBS88_Rf-e_p7tMpOLKEX9kKxC67KVrLZGjs";

    // 설정에 주입된 사용자 액세스 토큰(테스트 토큰). 없으면 "".
    function token() {
        var t = App.Properties.getValue("supabaseAccessToken");
        return (t == null) ? "" : t;
    }
}
