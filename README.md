# 성장 MAP (snja_map)

성장 MAP 수업 사이트입니다. 6학년 사회 「2. 시장경제와 국가 간 거래」의 국가 간 무역 6차시(무역이 뭐예요? → 나라마다 가진 게 달라요 → 바꾸면 더 좋아요 → 좋은 점, 걱정되는 점 → 우리나라 무역 그래프 읽기 → 스마트폰을 만들어라!)를 담았습니다. 공공미술교육연구회(humanskill_art) 사이트와 같은 틀로 만들었습니다.

- 선생님 자료실: https://biossam.github.io/snja_map/
- 학생용 화면: https://biossam.github.io/snja_map/?view=student

## 자료 추가

모든 내용은 `data/course.json`에서 관리합니다.

- 영상: YouTube에 올리고 차시의 `videos`에 `{"youtubeId": "영상ID", "title": "제목"}` 형태로 기록
- 활동지: `files/차시번호/worksheet.hwpx`에 넣고 `teacher.worksheet`에 경로 기록
- 수업 자료 그림: `assets/img/figures/`에 넣고 차시의 `figures`에 기록 (`level`: 기본·보충·심화)
- 성장 MAP 전략·준비 메모: 차시의 `strategy`, `prep` (선생님 화면에만 보임)
- 수업 PPT와 지도안은 사이트에 올리지 않았습니다.
- 배지: `assets/img/badges/차시번호.png`에 넣고 차시의 `badge`에 경로 기록

## 구조

```
index.html              화면 틀
assets/css/style.css    디자인
assets/js/app.js        동작 (차시 목록, 차시 화면, 수업 모드, QR)
data/site.json          사이트 이름
data/course.json        ★ 차시·영상·자료 링크
```

빌드 과정이 없는 정적 사이트이며 GitHub Pages로 무료 운영합니다. 내 컴퓨터에서 볼 때는 폴더에서 `python -m http.server 8000` 후 http://localhost:8000 에 접속하세요.
