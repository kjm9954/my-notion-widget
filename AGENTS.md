# AGENTS.md — 노션 위젯 디자인 시스템

이 저장소의 모든 HTML 위젯은 아래 규칙을 따른다. **새 색·새 폰트·새 아이콘·새 radius·새 컴포넌트를 만들지 마라.** 명시되지 않은 것만 규칙에서 유추한다.

## 0. 제품 개요

노션에 임베드하는 독립 HTML 위젯 묶음. 빌드 도구·프레임워크 없이 **바닐라 JS**, 외부 의존성은 Pretendard CDN 하나. 각 파일은 단독으로 열어도 동작해야 하고, 데이터는 localStorage로 공유한다.

```
compass.html    에너지 나침반 (우선순위 4분면)
today.html      일기 · 오늘        calendar.html  일기 · 캘린더
material.html   오늘의 재료        empty.html     빈 날 채우기
achieve.html    업적 보관함        mood.html      기분 온도
thoughts.html   생각 정리함        goals.html     목표 계층
stats.html      스탯               record.html    성장 기록
```

## 1. 컬러 토큰

```css
--action: #0E5C7A;        /* 유일한 액션 색 — 버튼·게이지 채움·선택 outline */
--action-soft: #E2F0F6;   /* 포인트 연배경 */

--text: #12303C;  --title: #33505C;
--secondary: #6B8794;  #55707C;  #3E5A66;
--muted: #93A5AD;  --faint: #A2B4BC;  --done: #A9BAC2;  --inactive: #C6D6DD;

/* 보더 */  #DCE7ED  #E1EAEE  #E6EDF0  #F1F5F7  #EDF2F4  #F7F9FA
/* 면 */    #FFFFFF  #FAFCFD  #F5F9FB(알약 배경)
/* 점선 */  1px dashed #C6D6DD      /* 인용 좌측선 */ 2px solid #CFE2EA
/* 파괴적 */ 보더 #E4D5D5 · 글자 #A56B6B · 확인 버튼 배경 #A56B6B
```

**모드 색 (일기 위젯 전용)**
```
퀘스트 --q  oklch(0.62 0.09 245)   tint oklch(0.975 0.017 245)
사진   --p  oklch(0.62 0.09 195)   tint oklch(0.975 0.017 195)
```

**분면 색 (에너지 나침반 전용)** — `oklch(0.62 0.09 215 / 195 / 245 / 168)`.
이 색은 "에너지 분류"라는 뜻을 이미 갖고 있다. **나침반과 오늘의 재료(분면 배지) 외에는 절대 쓰지 마라.**

**철칙**
- **화면당 색이 채워진 블록은 하나**. 나머지는 무채색.
- 빨강 계열·경고색은 파괴적 동작(삭제 확인)에만. 낮은 값·공백·안 쓴 날에 쓰지 마라.
- 카테고리·태그마다 색을 부여하지 마라(선택된 것만 포인트 채움).

## 2. 타이포

Pretendard Variable, fallback `-apple-system, "Helvetica Neue", sans-serif`.
```
https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css
```
```
34/800  Lv 등 대표 숫자        15/800  마법사 질문
13/800  날짜 제목              12/800  카드 제목(#33505C) · 세그먼트
12/600  본문 (line-height 1.4~1.7)     11/700  보조·버튼
11/600  목록 항목              10/800  라벨·카운트 (letter-spacing .06em)
10/700  알약                   9/700   캡션·날짜
```
굵기는 **600 · 700 · 800**만 사용한다.

## 3. 형태 · 간격

```
radius   카드 18 / 내부 카드 14 / 블록·영역 12 / 항목·입력·칸 9 / 작은 버튼 8 / 알약 999
그림자   카드  0 1px 2px rgba(18,48,60,.04), 0 6px 18px rgba(18,48,60,.06)
         항목  0 1px 2px rgba(18,48,60,.05)
간격     카드 padding 13~22 · 블록 gap 10~16 · 목록 gap 4~7 · 항목 padding 6~9
```

**아이콘 세트 없음.** 텍스트 기호(`＋ − ✕ ✓ ↻ ‹ › ⌕`)와 도형만 쓴다. SVG를 그리지 말고, 이모지·일러스트·채운 아이콘도 쓰지 마라.

**모션**

```css
/* 지속시간 */
--t-color: 120ms;   /* 색 · 보더 · outline */
--t-press:  90ms;   /* 눌림 */
--t-open:  180ms;   /* 펼침 · 접힘 */
--t-swap:  200ms;   /* 내용 교체(crossfade) */
--t-close: 160ms;   /* 삭제로 자리가 닫힘 */
--t-gauge: 400ms;   /* HP/MP 게이지 채움 — 게이지에만 */
--t-mark:  800ms;   /* 새로 추가된 항목 색 잔상 */
--ease: cubic-bezier(.2,.6,.2,1);
```

- 이동 거리 최대 4px, 스케일 최대 1.02.
- 애니메이션 색은 `#0E5C7A`, `#E2F0F6`, `#CFE2EA`, `#EDF2F4`만 쓴다.
- 바운스, 로딩 스피너, stagger, 좌우 슬라이드, 그림자 애니메이션, blur는 금지한다. 회전은 오늘의 문장 `↻` 1회전만 허용한다.
- 정지 상태의 유휴 애니메이션은 오늘의 문장/재발견 좌측 2px 선의 8초 opacity 호흡만 허용한다.
- hover는 보더 색만 바꾸고, 선택은 2px action outline, active는 `scale(.98)`로 처리한다.
- 펼침/접힘은 height+opacity `var(--t-open)`, 삭제는 opacity 뒤 height 닫힘 `var(--t-close)`, 추가는 배경 잔상 `var(--t-mark)`을 쓴다.
- 모든 위젯은 `widget-frame.css`의 `prefers-reduced-motion: reduce` 규칙을 적용해 모션을 완전히 끈다.

## 4. 레이아웃 (전 파일 공통)

1. **배경 투명** — `html, body { background: transparent; }`. 페이지 배경색을 위젯 안에 그리지 마라. 노션 배경이 그대로 비쳐야 한다.
2. **유동 폭 + 가운데 정렬** — `width: 100%; max-width: <파일별 값>; margin: 0 auto;`. 고정 px 폭 금지(임베드를 넓히면 카드도 넓어져야 한다).
3. **회색은 카드 안쪽에만** — 카드 안 "영역"에 `background:#FAFCFD; border:1px solid #F1F5F7; border-radius:12px`. 목록·게이지·격자·스크롤 영역이 대상.
4. **캘린더 칸** — `aspect-ratio: 1/1`, **월요일 시작**, 6주차 불필요 시 렌더 안 함. 이전/다음 달 `opacity:.3`, 미래 `opacity:.35`, 오늘 `outline:2px solid #0E5C7A; outline-offset:-2px`.
5. **내부 스크롤은 목록 영역만.** 고정 영역(헤더·검색·칩·배너)은 스크롤되지 않는다. 카드 높이는 고정해 항목이 늘어도 레이아웃이 밀리지 않게 한다.
6. **모달·토스트·툴팁·탭·토글을 신설하지 마라.** 화면 전환은 카드 안에서 내용을 교체하는 방식.

## 5. 크기 조절 핸들 (전 파일 공통)

```
위치  카드 우하단 안쪽 right:6px; bottom:6px · 14×14
모양  border-right:2px solid; border-bottom:2px solid; border-radius:0 0 3px 0
색    평소 opacity:0 → 카드 hover 시 opacity:1 + #C6D6DD → 드래그 중 #0E5C7A
      transition: opacity .12s, border-color .12s · cursor: nwse-resize
      @media (hover: none) { display: none }
```
- 드래그하면 **비율 유지** 확대/축소: `transform: scale(k); transform-origin: top center` (k = 현재 폭 / 기본 폭). 래퍼 높이 = `기본높이 × k`. 레이아웃을 재계산하지 마라.
- 범위: 기본의 **70%** ~ `window.innerWidth/innerHeight`. 임베드 밖으로 넘쳐 잘리면 안 된다.
- 드래그 중 핸들 위에 현재 크기를 9px `#A9BAC2`로 표시(`940 × 620`).
- 목록/격자가 주인 위젯은 **카드 아래 가운데 46×4 손잡이**(radius 2, 같은 색 규칙)를 추가 — 끌면 그 영역 높이만 늘어난다(비율 무관).
- 저장: `widget-size-<파일명>` → `{ scale }` 또는 `{ scale, listH }`. 로드 시 복원, 최대치를 넘으면 자동으로 낮춘다.

## 6. 데이터

```
game-log-diary-4b-v2   일기        { entries: { "YYYY-MM-DD": Entry } }
diary-mood-words-v1    감정 단어    { words: string[] }
energy-compass-3a-v1   우선순위
thought-box-v1         생각 정리함  { items:[{id,one,detail,cat,created,opened}], cats, catOpened }
growth-goals-v1        목표        { goals:[{id,scope,t,done,parent}] }
growth-stats-v1        스탯        { start, urls }
reading-notes-v1       독서 노트    { byDate: { "YYYY-MM-DD": n } }
```
- 날짜 키는 로컬 시간 `YYYY-MM-DD`. 사진은 **긴 변 720px · JPEG 0.8 dataURL**로 저장(원본 금지).
- 쓰기 직전에 저장소를 다시 읽어 병합한다(다른 위젯의 쓰기를 덮지 않도록).
- 실시간 반영이 필요하면 `BroadcastChannel` + `storage` 이벤트 + `visibilitychange`/`focus` 세 가지를 모두 건다.
- 읽기/쓰기는 전부 try-catch. **위 키 외의 localStorage를 읽거나 지우지 마라.**
- 위젯은 서로 없어도 단독으로 동작해야 한다.

## 7. 톤

- **재촉하지 않는다.** 남은 일수·달성률 압박·연속 끊김 경고를 쓰지 마라. 숫자는 누적으로.
- 안 한 날·빈 값은 **경고가 아니라 아무 표시 없음**. 미래는 흐리게(못 한 날로 보이면 안 된다).
- 감정·상태를 **좋음/나쁨으로 줄 세우지 마라**(차가움↔따뜻함 같은 중립 축).
- **빈 상태를 반드시 설계한다** — 점선 블록(`#FAFCFD` + 1px dashed `#C6D6DD`, radius 12) + 제목 12/800 `#33505C` + 설명 10~11/600 `#93A5AD`.
- 값이 없으면 **라벨째 렌더하지 마라.** 빈 자리를 남겨 덜컹거리게 하지 않는다.
- 입력 UI를 상시 노출하지 마라. 눌렀을 때만 펼친다.

## 8. 시각화 금지 규칙

- **막대 게이지는 `today.html`의 HP 하나뿐.** 다른 위젯에 진행 막대를 추가하지 마라(진행 상황은 텍스트로).
- 값을 **높이·길이로 표현하지 마라.** 농도(무채색 5단) 또는 칸 개수로 한다.
- 축·눈금·숫자·퍼센트·평균·그래프를 넣지 마라.
- 칸으로 만든 선택 트랙은 **gap 4 이상**을 유지해 막대로 보이지 않게 한다.

## 9. 반응형

```
≥1000   기본 사양
640–999 구조 동일, 폭만 축소 (좌측 컬럼은 340까지)
<640    모두 위아래로 쌓임, 카드 폭 100%
```
캘린더는 좁아져도 **7열 월 그리드를 유지**하고 칸만 작아진다. 탭 대상 최소 40px(아이콘 버튼 44px).

## 10. 작업 전 체크리스트

- [ ] 새로 만든 색·radius·그림자 값이 하나도 없는가
- [ ] 흰 배경 위에 얹었을 때 회색 사각형이 안 보이는가
- [ ] 임베드를 넓히면 카드가 따라 넓어지고 가운데 있는가
- [ ] hover 전 핸들이 완전히 안 보이는가 / 끌면 비율이 유지되는가
- [ ] 빈 값일 때 라벨·빈 블록이 남지 않는가
- [ ] 막대·숫자·퍼센트를 새로 추가하지 않았는가
- [ ] 분면 색을 나침반 밖에서 쓰지 않았는가
- [ ] 다른 위젯의 localStorage 키를 건드리지 않았는가

