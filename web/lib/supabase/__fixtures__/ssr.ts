/**
 * `@supabase/ssr` 대체 모듈 (개발/캡쳐 전용).
 *
 * `next.config.ts` 가 `ROX_FIXTURES=1` 일 때만 이 파일로 alias 한다.
 * 진짜 모듈과 같은 이름을 내보내므로 `lib/supabase/server.ts`·`client.ts`·
 * `proxy.ts` 를 한 줄도 고치지 않아도 된다.
 */
import { makeClient } from "./mock";

type Options = Parameters<typeof makeClient>[0];

export function createServerClient(_url: string, _key: string, options?: Options) {
  return makeClient(options);
}

export function createBrowserClient(_url: string, _key: string, options?: Options) {
  return makeClient(options);
}
