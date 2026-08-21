import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeReadingNotesState, normalizeStatsSettings } from "../worker.js";

const stats = await readFile(new URL("../growth-page/stats.html", import.meta.url), "utf8");
const session = await readFile(new URL("../reading-notes/session.html", import.meta.url), "utf8");
const frame = await readFile(new URL("../widget-frame.js", import.meta.url), "utf8");
const store = await readFile(new URL("../store.js", import.meta.url), "utf8");

test("스탯 유휴 모션은 HP·MP 텍스트가 아니라 게이지를 순회한다", () => {
  assert.match(frame, /'stats\.html': \{ selector:'\.meter-track', max:2, continuous:true \}/);
  assert.doesNotMatch(frame, /'stats\.html': \{ selector:'\.meter-label'/);
  assert.match(frame, /config\.continuous \? -delay : delay/);
});

test("상태 이상 더보기는 모바일 버튼 높이에 늘어나지 않고 원형을 유지한다", () => {
  assert.match(stats, /button\.status-more\s*\{[\s\S]*?width:22px;[\s\S]*?height:22px;[\s\S]*?min-height:22px !important;/);
  assert.match(stats, /class="status-pill status-more"/);
});

test("스탯 게이지 값은 오버슛 없이 400ms 단방향으로 바뀐다", () => {
  assert.match(stats, /transition:width var\(--t-gauge\) var\(--ease\)/);
  assert.match(stats, /if \(fills\[0\]\) fills\[0\]\.style\.width = `\$\{current\.hp\}%`/);
  assert.match(stats, /if \(fills\[1\]\) fills\[1\]\.style\.width = `\$\{current\.mp\}%`/);
  assert.doesNotMatch(stats, /gaugeOvershoot/);
  assert.doesNotMatch(frame, /gaugeOvershoot/);
});

test("독서 기록이 전혀 없을 때도 시작 7일 후 상태이상을 표시한다", () => {
  assert.match(stats, /readingGap === null && current\.days >= 7/);
  assert.match(stats, /독서 노트 기록 없음/);
  assert.match(stats, /Store\.loadReadingNotesState\(\)/);
});

test("스탯 설정과 독서 기록은 서버 저장소 API를 사용한다", () => {
  assert.match(stats, /Store\.saveStatsSettings\(snapshot\)/);
  assert.match(store, /async function loadStatsSettings\(\)/);
  assert.match(store, /async function saveReadingNotesState\(state\)/);
  assert.match(session, /Store\.createReadingQuotes\(selectedBookId, draft, \{/);
  assert.match(session, /result\?\.readingNotes \|\| await Store\.loadReadingNotesState\(\)/);
});

test("서버는 스탯 설정과 독서 날짜 기록을 정규화한다", () => {
  const settings = normalizeStatsSettings({
    start:"2026-01-02",
    urls:[" https://example.com/diary ", "https://example.com/reading"],
  });
  assert.equal(settings.start, "2026-01-02");
  assert.deepEqual(settings.urls, ["https://example.com/diary", "https://example.com/reading", ""]);

  const reading = normalizeReadingNotesState({
    byDate:{ "2026-08-17":3.8, invalid:9, "2026-08-18":0 },
  });
  assert.deepEqual(reading, { byDate:{ "2026-08-17":3 } });
});
