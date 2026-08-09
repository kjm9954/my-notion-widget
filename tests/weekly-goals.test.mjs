import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeWeeklyGoalsState } from "../worker.js";

const html = await readFile(new URL("../Worklog/weekly-goals.html", import.meta.url), "utf8");

test("이번 주 목표는 불러온 데이터를 서버에 다시 덮어쓰지 않는다", () => {
  assert.doesNotMatch(html,/state\s*=\s*loaded;\s*save\(\)/);
  assert.match(html,/syncFromServer\(\);\s*Store\.watch\(syncFromServer,1500\)/);
});

test("이번 주 목표는 초기 조회 실패를 자동 재시도한다", () => {
  assert.match(html,/function scheduleRetry\(\)/);
  assert.match(html,/자동으로 다시 불러옵니다/);
  assert.match(html,/requestRevision !== localRevision/);
});

test("지난주 미완 목표 이어가기 화면과 주당 1회 가드를 포함한다", () => {
  assert.match(html,/class="carry-overlay"/);
  assert.match(html,/새 주가 시작됐어요/);
  assert.match(html,/done !== true/);
  assert.match(html,/picked: true/);
  assert.match(html,/carryPrompt !== null/);
  assert.match(html,/state\.carryHandledWeek = handledWeek/);
  assert.match(html,/done: false, text: it\.text/);
  assert.match(html,/가져오지 않고 시작/);
});

test("서버는 이어가기 처리 주 키를 보존한다", () => {
  const state = normalizeWeeklyGoalsState({
    week:"2026-8-3",
    carryHandledWeek:"2026-8-10",
    seq:1,
    items:[{ id:1, m:"work", done:false, text:"이어갈 목표" }],
  });
  assert.equal(state.carryHandledWeek,"2026-8-10");
  assert.equal(state.items.length,1);
  assert.equal(state.items[0].done,false);
});
