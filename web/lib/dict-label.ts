import type { DictKey } from "./i18n/dictionaries/en";

type TFn = (key: DictKey, params?: Record<string, string | number>) => string;

/** 사전에 없는 키는 t() 가 키 문자열을 그대로 돌려준다. 자유 입력으로 들어온
 *  토큰(어드민이 손으로 넣은 muscles, 새 장비 슬러그 등)이 화면에
 *  'muscle.pec' 처럼 노출되는 것을 막고 원문으로 폴백한다. */
export function dictLabel(t: TFn, key: string, fallback: string): string {
  const v = t(key as DictKey);
  return v === key ? fallback : v;
}
