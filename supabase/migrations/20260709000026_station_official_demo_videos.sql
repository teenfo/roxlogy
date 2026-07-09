-- 8개 HYROX 스테이션에 특정 시연 영상(유튜브) 지정 → 상세 화면에서 임베드 재생.
-- 나머지 종목은 검색 딥링크(025)를 유지한다. 영상은 기술 설명 위주로 선별.
update exercises set media_url='https://www.youtube.com/watch?v=fv-fKFjyH8U' where station_type='station_1'; -- SkiErg
update exercises set media_url='https://www.youtube.com/watch?v=9lXw0D3dxRQ' where station_type='station_2'; -- Sled Push
update exercises set media_url='https://www.youtube.com/watch?v=WgRM2e5U6H0' where station_type='station_3'; -- Sled Pull
update exercises set media_url='https://www.youtube.com/watch?v=3eXUefIatHk' where station_type='station_4'; -- Burpee Broad Jump
update exercises set media_url='https://www.youtube.com/watch?v=gb2Z3ARYxOc' where station_type='station_5'; -- Rowing
update exercises set media_url='https://www.youtube.com/watch?v=Rv8h4WoE1LA' where station_type='station_6'; -- Farmers Carry
update exercises set media_url='https://www.youtube.com/watch?v=29lLj4p6Slo' where station_type='station_7'; -- Sandbag Lunges
update exercises set media_url='https://www.youtube.com/watch?v=2Dgn-8AJeQM' where station_type='station_8'; -- Wall Balls
