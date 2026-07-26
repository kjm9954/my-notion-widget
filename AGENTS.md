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

## 3-1. 모션

구현은 전부 `widget-frame.css` · `widget-frame.js`에 있다. 위젯 HTML은 클래스만 붙인다.

**토큰 — 새 값을 만들지 마라. 아래가 전부다.**

```css
:root {
  --t-color: 120ms;   /* 색 · 보더 · outline */
  --t-press:  90ms;   /* 눌림 */
  --t-open:  180ms;   /* 펼침 · 접힘 */
  --t-swap:  200ms;   /* 내용 교체(crossfade) */
  --t-close: 160ms;   /* 삭제로 자리가 닫힘 */
  --t-gauge: 400ms;   /* HP/MP 게이지 채움 — 게이지에만 */
  --t-mark:  800ms;   /* 새로 추가된 항목 색 잔상 */
  --ease: cubic-bezier(.2,.6,.2,1);   /* 이징은 이거 하나만 */
}
```

- **이동 거리 최대 4px, 스케일 최대 1.02.** 그 이상 움직이지 마라.
- 애니메이션에 쓰는 색은 `#0E5C7A` `#E2F0F6` `#CFE2EA` `#EDF2F4`뿐. 새 색 금지.
- **금지**: 바운스 · 회전(`↻` 아이콘 1회전만 예외) · 등장 stagger · 로딩 스피너 · 좌우 슬라이드 전환 · 그림자 애니메이션 · blur · 카운트업 숫자.
- `prefers-reduced-motion: reduce`에서는 `*, *::before, *::after`의 트랜지션·애니메이션을 전부 끄고 `opacity:1!important`로 끝 상태를 즉시 보여준다.

**상태별 규칙**

| 상태 | 동작 |
| --- | --- |
| 가만히 있을 때 | **유휴 호흡** — 위젯당 딱 하나의 요소만 느리게 숨 쉰다. §3-2 참조 |
| hover | 보더 색만 `#EDF2F4 → #CFE2EA`, `var(--t-color)`. 떠오르거나 커지지 않는다. `@media (hover:none)`에선 적용 안 함 |
| 선택 / 활성 | `outline:2px solid #0E5C7A; outline-offset:-2px`를 `var(--t-color)`로. 레이아웃 이동 없음 |
| 눌림(active) | `transform: scale(.98)`, `var(--t-press)` |
| 펼침 / 접힘 | height + opacity, `var(--t-open)`. 펼칠 때 스크롤 위치를 유지한다 |
| 삭제 | `opacity → 0` 후 `height → 0`, `var(--t-close)`. `widgetMotion.close(el, done)`을 쓴다 |
| 추가 | 새 항목 배경 `#E2F0F6 → transparent`, `var(--t-mark)`(`.motion-new`). **위치 이동 없이 색 잔상만** |
| 내용 교체 | crossfade `var(--t-swap)`(`.motion-swap`). 슬라이드·플립 금지 |
| 게이지(HP/MP) | 값이 바뀔 때만 `width` `var(--t-gauge)`. 로드 시 0에서 채우지 말고 현재 값에서 시작 |

## 3-2. 유휴 호흡 (전 위젯 공통)

가만히 뒀을 때 페이지가 죽은 화면처럼 보이지 않게, 모든 위젯이 **같은 호흡 하나**를 가진다. 이것이 유일하게 허용되는 상시 애니메이션이다. `widget-frame.css`가 `@keyframes idle-breath`와 `.idle`을 제공하고, `widget-frame.js`가 탭이 숨으면 멈춘다.

**철칙**
- **위젯당 정확히 1개 요소**에만 `.idle`을 붙인다. 둘 이상이면 산만해 보인다.
- **`opacity`만** 바꾼다. transform·색·크기·그림자를 건드리지 마라.
- 주기는 **8s(내용 있을 때) / 12s(빈 상태 `.idle.is-empty`)** 둘뿐. 범위는 `.55~1` 또는 `.8~1`.
- hover · 입력 포커스 · 항목이 펼쳐진 동안 · 탭 숨김 상태에선 멈춘다.
- **숫자·본문 글자·목록 항목 텍스트는 절대 호흡시키지 마라.** 읽는 것을 방해한다.
- 빈 상태일 때는 강조 요소 대신 **점선 블록 하나만** 호흡한다(둘 동시 금지).

| 위젯 | 호흡하는 것 |
| --- | --- |
| 문장 서랍 `quote-drawer` | 오늘의 문장 좌측 2px 선 |
| 생각 정리함 `thoughts` | 재발견 배너의 경과 일수 라벨 |
| 생각 정리함 `add` / `find` | 입력 안내 라벨 / 검색 결과 라벨 |
| 인생책 `life-books` | 인용 영역 좌측 2px 선 |
| 책 현황 `reading-count` | `지금까지` 라벨 (10/800) |
| 구매 예정 `wishlist` | 대표 카드의 구매 완료 버튼 보더 |
| 독서 서랍 `drawer` / 서재 `library` / 세션 `session` | 대표 라벨 하나 |
| 일기 · 오늘 `today` | 오늘 날짜 제목 (13/800) |
| 일기 · 캘린더 `calendar` | 오늘 칸의 outline |
| 기분 온도 `mood` · 업적 `achieve` · 빈 날 `empty` | 선택된 칸 또는 대표 라벨 |
| 오늘의 재료 `material` | `오늘의 재료` 라벨 (10/800) |
| 에너지 나침반 `index` | 선택된 분면의 outline |
| 스탯 `stats` · 목표 `goals` · 기록 `record` | 대표 숫자 **옆 라벨**(숫자 자체는 건드리지 않음) |
| 모든 위젯의 빈 상태 | 점선 블록 전체 (`.idle.is-empty`) |

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
- 드래그하면 **비율 유지** 확대/축소: 스케일 `k` 하나만 상태로 두고 `흰 프레임 = 기본폭×k · 기본높이×k`로 고정한다. 폭·높이를 따로 저장하면 임베드가 넓거나 납작할 때 프레임과 내용의 비율이 어긋나 **흰 여백 띠(찌그러짐)** 가 생긴다. 레이아웃을 재계산하지 마라.
- 임베드가 숨겨져 있거나 화면 밖이면 `requestAnimationFrame`이 아예 돌지 않는다. 첫 배치는 동기로 커밋하고, 이후 갱신도 rAF와 타이머 중 먼저 오는 쪽으로 반드시 반영한다.
- 범위: 기본의 **70%** ~ `window.innerWidth/innerHeight`. 임베드 밖으로 넘쳐 잘리면 안 된다.
- 드래그 중 핸들 위에 현재 크기를 9px `#A9BAC2`로 표시(`940 × 620`).
- 목록/격자가 주인 위젯은 **카드 아래 가운데 46×4 손잡이**(radius 2, 같은 색 규칙)를 추가 — 끌면 그 영역 높이만 늘어난다(비율 무관).
- 저장: `widget-size-<파일명>` → `{ scale }` 또는 `{ scale, listH }`. 로드 시 복원, 최대치를 넘으면 자동으로 낮춘다. 예전에 저장된 `{ width, height }`도 스케일로 환산해 읽는다.

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

- [ ] 새로 만든 색·radius·그림자·이징 값이 하나도 없는가
- [ ] 흰 배경 위에 얹었을 때 회색 사각형이 안 보이는가
- [ ] 임베드를 넓히면 카드가 따라 넓어지고 가운데 있는가
- [ ] 임베드가 아주 넓거나 납작해도 **흰 카드가 내용에 딱 맞는가**(빈 여백 띠 금지)
- [ ] 가만히 두면 위젯마다 **정확히 한 요소**만 느리게 숨 쉬는가
- [ ] 숫자·본문·목록 텍스트는 호흡하지 않는가 / hover·포커스·탭 숨김에서 멈추는가
- [ ] `prefers-reduced-motion`에서 모션이 전부 꺼지는가
- [ ] 어떤 요소도 hover로 떠오르거나 커지지 않는가 (보더 색만)
- [ ] 항목 삭제 시 자리가 닫히고, 추가 시 색 잔상만 남는가(튀지 않음)
- [ ] hover 전 핸들이 완전히 안 보이는가 / 끌면 비율이 유지되는가
- [ ] 빈 값일 때 라벨·빈 블록이 남지 않는가
- [ ] 막대·숫자·퍼센트를 새로 추가하지 않았는가
- [ ] 분면 색을 나침반 밖에서 쓰지 않았는가
- [ ] 다른 위젯의 localStorage 키를 건드리지 않았는가
