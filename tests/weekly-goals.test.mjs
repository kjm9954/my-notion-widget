import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
