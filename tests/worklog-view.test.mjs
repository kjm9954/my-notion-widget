import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeWorklogState } from "../worker.js";

test("업무 보기 상태는 시간 기본값과 메모 값만 허용", () => {
  assert.equal(normalizeWorklogState({}).workView, "time");
  assert.equal(normalizeWorklogState({ workView:"memo" }).workView, "memo");
  assert.equal(normalizeWorklogState({ workView:"other" }).workView, "time");
});

test("업무일지의 일일 이월 날짜는 서버 저장 과정에서 유지된다", () => {
  const normalized = normalizeWorklogState({
    lastRollDay:"2026-08-09",
    bannerDismissedDay:"2026-08-08",
  });
  assert.equal(normalized.lastRollDay,"2026-08-09");
  assert.equal(normalized.bannerDismissedDay,"2026-08-08");
  assert.equal(normalizeWorklogState({ lastRollDay:"2026-99-99" }).lastRollDay,"");
});

test("업무일지는 시간·메모 전환과 두 열 구성을 모두 포함", async () => {
  const html = await readFile(new URL("../Worklog/worklog.html", import.meta.url), "utf8");
  assert.match(html, /data-work-view="time"/);
  assert.match(html, /data-work-view="memo"/);
  assert.match(html, /column-head work view-memo/);
  assert.match(html, /메모 \$\{memoCount\}건/);
  assert.match(html, /Store\.saveWorklogView\(view\)/);
  assert.match(html, /function renderWorkView\(\)/);
  assert.match(html, /requestRevision !== localRevision/);
  assert.match(html, /requestId !== syncRequestId/);
  assert.match(html, /function rollDayIfNeeded\(\)/);
  assert.match(html, /task\.date >= targetDay/);
  assert.match(html, /function applyExternalCompletionState\(loaded\)/);
  assert.match(html, /allowWhileEditing:true/);
  assert.match(html, /class="due-cell"/);
  assert.match(html, /class="meta-rule"/);
  assert.match(html, /class="meta-label">메모/);
  assert.match(html, /-webkit-line-clamp:2/);
  assert.match(html, /\.task-row\.work\.view-memo \{ grid-template-columns:minmax\(0,1fr\) 44px 40px; \}/);
});

test("마감 현황은 업무일지의 표시 설정 변경을 화면 변경으로 오인하지 않음", async () => {
  const html = await readFile(new URL("../Worklog/deadline-horizon.html", import.meta.url), "utf8");
  assert.match(html, /JSON\.stringify\(projects\) !== JSON\.stringify\(previousProjects\)/);
  assert.doesNotMatch(html, /JSON\.stringify\(worklogData\) !== JSON\.stringify\(worklogState\)/);
});

test("업무 관리용 위젯은 전체 크기 조절 프레임을 사용", async () => {
  const html = await readFile(new URL("../Worklog/schedule.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-widget-resize="list-only"/);
  assert.match(html, /data-widget-scale-handle/);
  assert.match(html, /data-widget-size-label/);
});
