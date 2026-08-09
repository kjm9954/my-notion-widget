import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeWorklogState, rollWorklogState } from "../worker.js";

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

test("일상 모드의 토요일 미완료 항목은 일요일 오전 6시 이후 이월된다", () => {
  const beforeCutoff = new Date("2026-08-08T20:00:00.000Z"); // 서울 일요일 05:00
  const afterCutoff = new Date("2026-08-08T21:00:00.000Z"); // 서울 일요일 06:00
  const source = {
    tasks:[
      { id:"life-open", mode:"life", date:"2026-08-08", proj:"미분류", title:"미완료", status:"wait", done:false },
      { id:"life-done", mode:"life", date:"2026-08-08", proj:"미분류", title:"완료", status:"done", done:true },
    ],
  };
  assert.equal(rollWorklogState(source,beforeCutoff).state.tasks[0].date,"2026-08-08");
  const rolled = rollWorklogState(source,afterCutoff);
  assert.equal(rolled.moved,1);
  assert.equal(rolled.state.tasks[0].date,"2026-08-09");
  assert.equal(rolled.state.tasks[0].rolledFrom,"2026-08-08");
  assert.equal(rolled.state.tasks[1].date,"2026-08-08");
});

test("업무 모드는 주말에 금요일 날짜를 유지한다", () => {
  const sundayMorning = new Date("2026-08-08T23:00:00.000Z"); // 서울 일요일 08:00
  const rolled = rollWorklogState({
    tasks:[{ id:"work-open", mode:"work", date:"2026-08-06", proj:"미분류", title:"업무", status:"wait", done:false }],
  },sundayMorning);
  assert.equal(rolled.state.tasks[0].date,"2026-08-07");
});

test("오늘 이전의 미완료 항목만 이월하고 미래에 미리 쓴 항목은 건드리지 않는다", () => {
  const mondayCutoff = new Date("2026-08-09T21:00:00.000Z"); // 서울 월요일 06:00
  const rolled = rollWorklogState({
    tasks:[
      { id:"work-open", mode:"work", date:"2026-08-07", proj:"미분류", title:"금요일 미완료", status:"wait", done:false },
      { id:"work-future", mode:"work", date:"2026-08-11", proj:"미분류", title:"화요일 미리 작성", status:"wait", done:false },
      { id:"life-open", mode:"life", date:"2026-08-09", proj:"미분류", title:"일요일 미완료", status:"wait", done:false },
      { id:"life-future", mode:"life", date:"2026-08-11", proj:"미분류", title:"화요일 일상 미리 작성", status:"wait", done:false },
    ],
  },mondayCutoff);

  assert.equal(rolled.moved,2);
  assert.equal(rolled.state.tasks.find(task => task.id === "work-open").date,"2026-08-10");
  assert.equal(rolled.state.tasks.find(task => task.id === "life-open").date,"2026-08-10");
  assert.equal(rolled.state.tasks.find(task => task.id === "work-future").date,"2026-08-11");
  assert.equal(rolled.state.tasks.find(task => task.id === "life-future").date,"2026-08-11");
  assert.equal(rolled.state.tasks.find(task => task.id === "work-future").rolledFrom,null);
  assert.equal(rolled.state.tasks.find(task => task.id === "life-future").rolledFrom,null);
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
