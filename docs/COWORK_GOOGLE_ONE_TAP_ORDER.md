# 작업 지시서 — 구글 원탭 로그인 활성화 (Cowork 용)

> 대상: Roxlogy(roxlogy.com) 운영 콘솔 설정 담당자
> 소요: 10분 내외. 코드 변경 없음. **콘솔 설정 2건 + 재배포 1건**이 전부다.
> 배경 문서: `docs/GOOGLE_ONE_TAP.md`

## 0. 이 작업이 뭔가

앱 코드에는 구글 원탭(브라우저가 띄우는 "○○(으)로 계속하기" 카드) 로그인이 이미
들어가 있다. **환경변수 `NEXT_PUBLIC_GOOGLE_CLIENT_ID` 가 없으면 컴포넌트가 스스로
꺼진다.** 그래서 지금은 아무것도 뜨지 않는다. 이 지시서는 그 변수를 채워 켜는 작업이다.

완료 기준(Definition of Done):
1. 구글 클라우드 콘솔의 기존 웹 클라이언트에 `https://roxlogy.com` 이 **승인된
   JavaScript 원본**으로 등록되어 있다.
2. Vercel 의 Production·Preview 환경에 `NEXT_PUBLIC_GOOGLE_CLIENT_ID` 가 있다.
3. 재배포 후, **구글 계정으로 브라우저에 로그인되어 있고 Roxlogy 에는 로그아웃된
   상태**로 https://roxlogy.com/crew 같은 공개 페이지에 들어가면 우측 상단에
   구글 카드가 뜬다.

---

## 1. 절대 하지 말 것 (중요)

- ❌ **새 OAuth 클라이언트를 만들지 말 것.** 반드시 Supabase Auth 에 이미 등록된
  그 클라이언트를 재사용해야 한다. 클라이언트가 다르면 Supabase 가 ID 토큰을
  거부해서 원탭이 눌러도 로그인이 안 된다.
- ❌ **승인된 리디렉션 URI 를 수정·삭제하지 말 것.** 원탭은 리디렉트를 쓰지 않는다.
  거기를 건드리면 지금 잘 되고 있는 기존 구글 로그인 버튼이 깨진다.
- ❌ **클라이언트 시크릿(Client secret)은 복사하지도, 전달하지도 말 것.**
  이 작업에 시크릿은 **필요 없다.** 필요한 값은 클라이언트 **ID** 하나뿐이다.
  (시크릿은 이미 Supabase 대시보드에만 저장되어 있어야 한다.)
- ❌ 구글 계정 비밀번호·2단계 인증 코드를 채팅이나 문서에 적지 말 것.

---

## 2. 작업 A — 구글 클라우드 콘솔

**필요 권한:** roxlogy 용 구글 클라우드 프로젝트의 편집 권한이 있는 계정
(= Supabase 구글 로그인을 처음 설정한 그 계정).

1. https://console.cloud.google.com/apis/credentials 접속.
2. 화면 상단에서 **프로젝트가 맞는지 확인.** 계정에 프로젝트가 여러 개면 아래
   3번의 리디렉션 URI 로 찾는 게 확실하다.
3. **OAuth 2.0 클라이언트 ID** 목록에서 유형이 **"웹 애플리케이션"** 인 항목들을
   하나씩 열어, **승인된 리디렉션 URI** 에 아래 값이 들어 있는 클라이언트를 찾는다.
   이게 우리가 쓸 클라이언트다.

   ```
   https://vuloxbpfhyqkvgmpmkst.supabase.co/auth/v1/callback
   ```

   > 이 URI 가 있는 클라이언트가 **정답**이다. 없으면 그 클라이언트는 우리 것이
   > 아니니 닫고 다음 걸 본다. 끝까지 없으면 4번으로 넘어가지 말고
   > **작업을 중단하고 보고할 것** (프로젝트를 잘못 찾은 것이다).

4. 그 클라이언트 편집 화면에서 **승인된 JavaScript 원본(Authorized JavaScript
   origins)** 섹션의 **+ URI 추가** 를 눌러 아래를 추가한다.

   ```
   https://roxlogy.com
   ```

   - **끝에 슬래시(`/`)를 붙이지 말 것.** `https://roxlogy.com/` 는 거부된다.
   - **경로를 붙이지 말 것.** `https://roxlogy.com/login` 같은 건 안 된다.
   - `www.roxlogy.com` 으로도 접속하게 할 거라면 `https://www.roxlogy.com` 을
     **별도 항목으로 하나 더** 추가한다 (서브도메인은 자동 포함이 아니다).
   - Vercel 프리뷰 도메인에서도 테스트할 거라면 해당 프리뷰 URL을 추가한다.
     (선택 사항 — 안 해도 프로덕션은 동작한다.)

5. **저장(Save)**. 반영에 몇 분 걸릴 수 있다.

6. 같은 화면 상단(또는 목록의 클라이언트 상세)에서 **클라이언트 ID** 를 복사한다.
   형태는 이렇다:

   ```
   1234567890-abcdefghijklmnop.apps.googleusercontent.com
   ```

   이 값은 원래 브라우저에 공개되는 식별자라 비밀이 아니다. 작업 B 에서 쓴다.
   **바로 아래 있는 "클라이언트 보안 비밀번호(Client secret)" 는 복사하지 않는다.**

---

## 3. 작업 B — Vercel 환경변수

**필요 권한:** Vercel 팀 `flexmania-1761s-projects` 의 roxlogy 프로젝트 설정 권한.

1. https://vercel.com/flexmania-1761s-projects/roxlogy/settings/environment-variables
2. **Add Another / Add New** 로 새 변수를 추가한다.

   | 항목 | 값 |
   |---|---|
   | Key | `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
   | Value | 작업 A 6번에서 복사한 클라이언트 ID |
   | Environments | **Production** 과 **Preview** 둘 다 체크 (Development 는 선택) |

   - 키 이름의 `NEXT_PUBLIC_` 접두사를 반드시 그대로 쓸 것. 오타 나면 조용히
     안 켜진다(에러가 안 난다).
   - 값 앞뒤 공백·따옴표가 들어가지 않게 주의.

3. **Save.**

4. **재배포한다.** ← 이 단계를 빠뜨리면 아무 일도 일어나지 않는다.
   `NEXT_PUBLIC_` 변수는 **빌드 시점에 번들에 구워지기 때문에** 변수만 저장하고
   재배포를 안 하면 기존 배포는 계속 예전 값(없음)으로 돈다.

   - Deployments 탭 → 최신 Production 배포의 **⋯ 메뉴 → Redeploy**
   - "Use existing Build Cache" 는 **체크 해제**하는 편이 확실하다.

---

## 4. 검증

배포가 **Ready** 가 된 뒤에 확인한다.

1. 크롬 **일반 창**(시크릿 창 아님)에서 구글 계정에 로그인되어 있는지 확인한다.
   원탭은 브라우저에 구글 계정이 로그인돼 있어야만 뜬다.
2. Roxlogy 에서는 **로그아웃** 상태로 만든다.
3. https://roxlogy.com/login 또는 공개 크루 페이지에 접속한다.
4. 우측 상단에 "○○(으)로 계속하기" 카드가 뜨면 성공. 눌러서 실제로 로그인까지
   되는지 확인한다.

**증빙으로 남길 것:** 카드가 뜬 화면 스크린샷 1장, 로그인 완료 후 화면 1장.

---

## 5. 문제 해결

브라우저 **개발자 도구 → Console** 을 열어놓고 보면 원인이 바로 나온다.

| 증상 / 콘솔 메시지 | 원인 · 조치 |
|---|---|
| `The given origin is not allowed for the given client ID` | 작업 A 4번의 JavaScript 원본이 안 들어갔거나 슬래시·경로가 붙었다. 정확히 `https://roxlogy.com` 인지 확인. 저장 후 몇 분 기다린다. |
| `The given client ID is not found` | 값이 잘못 복사됐다. `.apps.googleusercontent.com` 로 끝나는지 확인. |
| 아무 카드도 안 뜨고 콘솔도 조용함 | ① 환경변수 저장 후 **재배포를 안 했다** ② 이미 Roxlogy 에 로그인돼 있다(로그인 사용자에겐 일부러 안 띄운다) ③ 브라우저에 구글 계정이 로그인돼 있지 않다 |
| 며칠 잘 되다가 나한테만 안 뜸 | 정상. 사용자가 카드를 여러 번 닫으면 구글이 쿨다운을 건다. 다른 브라우저·계정으로 확인. |
| 사파리·파이어폭스에서 안 뜸 | 정상. FedCM 지원이 제한적이다. 기존 구글 로그인 **버튼**은 모든 브라우저에서 그대로 동작한다. |
| 카드는 뜨는데 누르면 로그인 실패 | 작업 A 3번에서 **다른 클라이언트**를 골랐을 가능성이 높다. 리디렉션 URI 에 `https://vuloxbpfhyqkvgmpmkst.supabase.co/auth/v1/callback` 이 있는 클라이언트가 맞는지 다시 확인. |

---

## 6. 롤백

문제가 생기면 **Vercel 환경변수 `NEXT_PUBLIC_GOOGLE_CLIENT_ID` 를 삭제하고
재배포**하면 된다. 원탭 컴포넌트가 스스로 꺼지고 기존 로그인 화면 그대로 돌아간다.
구글 콘솔에 추가한 JavaScript 원본은 남겨둬도 무해하다.

---

## 7. 보고 항목

작업 후 아래를 회신한다.

- [ ] 사용한 OAuth 클라이언트의 **이름**(ID 전체는 필요 없음)과, 리디렉션 URI 로
      본인 확인이 됐는지 여부
- [ ] `https://roxlogy.com` JavaScript 원본 추가 완료 (www 도 추가했는지)
- [ ] Vercel 변수 추가 환경 (Production / Preview)
- [ ] 재배포 실행 시각 및 배포 상태(Ready)
- [ ] 검증 스크린샷 2장
- [ ] 막힌 지점이 있으면 콘솔 에러 메시지 원문
