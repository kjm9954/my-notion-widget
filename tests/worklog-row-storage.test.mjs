import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const worker = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const store = await readFile(new URL("../store.js", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0004_worklog_rows.sql", import.meta.url), "utf8");

// 데스크톱 앱(TodayPriority)은 이 저장소 밖에 있다. 저장소 옆 폴더에 있거나
// TODAY_PRIORITY_DIR 로 위치를 알려 줬을 때만 함께 검사하고, 없으면 그 검사만 건너뛴다.
const desktopDir = process.env.TODAY_PRIORITY_DIR
  ? pathToFileURL(resolve(process.env.TODAY_PRIORITY_DIR) + "/")
  : new URL("../../TodayPriority/", import.meta.url);
const readOptional = url => readFile(url, "utf8").catch(() => null);
const desktopClient = await readOptional(new URL("WorklogApiClient.cs", desktopDir));
const desktopWindow = await readOptional(new URL("MainWindow.xaml.cs", desktopDir));
const desktopSkip = desktopClient && desktopWindow ? false : "데스크톱 앱 소스가 없음(TODAY_PRIORITY_DIR 로 지정 가능)";

test("업무 데이터는 인스턴스별 행과 삭제 표식으로 저장", () => {
  assert.match(migration,/CREATE TABLE IF NOT EXISTS worklog_tasks/);
  assert.match(migration,/PRIMARY KEY \(instance_id, task_id\)/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS worklog_tombstones/);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS worklog_sync/);
});

test("Worker는 항목 패치 API와 안전한 구버전 병합을 제공", () => {
  assert.match(worker,/path === "\/api\/worklog\/revision"/);
  assert.match(worker,/async function loadWorklogRevision/);
  assert.match(worker,/async function worklogReadFallback/);
  assert.match(worker,/worklog-snapshot:\$\{instanceId/);
  assert.match(worker,/exceeded D1's free tier daily row read limit/);
  assert.match(worker,/path === "\/api\/worklog\/patch"/);
  assert.match(worker,/async function patchWorklogState/);
  assert.match(worker,/async function mergeLegacyWorklogState/);
  assert.match(worker,/ON CONFLICT\(instance_id, task_id\) DO NOTHING/);
  assert.match(worker,/worklog_tombstones/);
});

test("웹 저장소는 전체 state 저장 대신 patch를 사용", () => {
  assert.match(store,/async function patchWorklogState\(patch\)/);
  assert.match(store,/refreshWorklogStateIfChanged/);
  assert.match(store,/"\/api\/worklog\/revision"/);
});

test("데스크톱 앱도 전체 state 저장 대신 patch를 사용", { skip: desktopSkip }, () => {
  assert.match(desktopClient,/LoadIfChangedAsync/);
  assert.match(desktopClient,/BuildUrl\("\/api\/worklog\/revision"\)/);
  assert.match(desktopWindow,/Interval = TimeSpan\.FromSeconds\(30\)/);
  assert.match(desktopClient,/BuildUrl\("\/api\/worklog\/patch"\)/);
  assert.doesNotMatch(desktopClient,/BuildUrl\("\/api\/worklog\/state"\), content/);
});
