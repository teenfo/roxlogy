-- 모든 운동에 시연 영상 링크(media_url) — 유튜브 영상 검색 딥링크.
-- 특정 영상 ID를 박아 넣으면 삭제·지역차단으로 썩으므로, 정제된 종목명으로
-- 데믹 영상을 검색하는 결정적 링크를 넣는다(전 종목 커버·데드링크 없음).
-- 상세 화면은 media_url이 유튜브면 <img> 대신 "시연 영상" 링크로 렌더한다.

-- 1) 일반: name_en 정제(괄호·특수문자 제거) → "<종목> form" 영상 검색
update exercises set media_url =
  'https://www.youtube.com/results?search_query=' ||
  regexp_replace(
    trim(regexp_replace(regexp_replace(name_en, '\(.*?\)', '', 'g'), '[^a-zA-Z0-9 ]', ' ', 'g')),
    ' +', '+', 'g'
  ) || '+form';

-- 2) HYROX 스테이션: 거리·강도 변형 제거한 깔끔한 HYROX 데믹 검색
update exercises set media_url='https://www.youtube.com/results?search_query=HYROX+ski+erg+technique' where station_type='station_1';
update exercises set media_url='https://www.youtube.com/results?search_query=HYROX+sled+push+technique' where station_type='station_2';
update exercises set media_url='https://www.youtube.com/results?search_query=HYROX+sled+pull+technique' where station_type='station_3';
update exercises set media_url='https://www.youtube.com/results?search_query=HYROX+burpee+broad+jump+technique' where station_type='station_4';
update exercises set media_url='https://www.youtube.com/results?search_query=HYROX+rowing+technique+concept2' where station_type='station_5';
update exercises set media_url='https://www.youtube.com/results?search_query=HYROX+farmers+carry+technique' where station_type='station_6';
update exercises set media_url='https://www.youtube.com/results?search_query=HYROX+sandbag+lunges+technique' where station_type='station_7';
update exercises set media_url='https://www.youtube.com/results?search_query=HYROX+wall+balls+technique' where station_type='station_8';

-- 3) 러닝: "<종목> running training"
update exercises set media_url =
  'https://www.youtube.com/results?search_query=' ||
  regexp_replace(
    trim(regexp_replace(regexp_replace(name_en, '\(.*?\)', '', 'g'), '[^a-zA-Z0-9 ]', ' ', 'g')),
    ' +', '+', 'g'
  ) || '+running+training'
  where category='running';
