import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const worker = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const store = await readFile(new URL("../store.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0004_worklog_rows.sql", import.meta.url), "utf8");
const desktopClient = await readFile(new URL("../../TodayPriority/WorklogApiClient.cs", import.meta.url), "utf8");

test("업무 데이터는 인스턴스별 행과 삭제 표식으로 저장", () => {
  assert.match(migration,/CREATE TABLE IF NOT EXISTS worklog_tasks/);
  assert.match(migration,/PRIMARY KEY \(instance_id, task_id\)/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS worklog_tombstones/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS worklog_sync/);
});

test("Worker는 항목 패치 API와 안전한 구버전 병합을 제공", () => {
  assert.match(worker,/path === "\/api\/worklog\/patch"/);
  assert.match(worker,/async function patchWorklogState/);
  assert.match(worker,/async function mergeLegacyWorklogState/);
  assert.match(worker,/ON CONFLICT\(instance_id, task_id\) DO NOTHING/);
  assert.match(worker,/worklog_tombstones/);
});

test("웹 저장소와 데스크톱 앱은 전체 state 저장 대신 patch를 사용", () => {
  assert.match(store,/async function patchWorklogState\(patch\)/);
  assert.match(store,/async function apiGetFresh\(path, instanceId = WIDGET_INSTANCE_ID\)/);
  assert.match(desktopClient,/BuildUrl\("\/api\/worklog\/patch"\)/);
  assert.doesNotMatch(desktopClient,/BuildUrl\("\/api\/worklog\/state"\), content/);
});
