import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const store = await readFile(new URL("../store.js", import.meta.url), "utf8");
const worker = await readFile(new URL("../worker.js", import.meta.url), "utf8");
const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
const stats = await readFile(new URL("../growth-page/stats.html", import.meta.url), "utf8");
const record = await readFile(new URL("../growth-page/record.html", import.meta.url), "utf8");

test("스탯과 기록의 실제 데이터는 localStorage가 아니라 Store API에서 읽는다", () => {
  assert.doesNotMatch(stats, /localStorage|reading-notes-v1|growth-stats-v1/);
  assert.doesNotMatch(record, /localStorage|growth-stats-v1/);
  assert.match(stats, /Store\.loadReadingNotesState\(\)/);
  assert.match(stats, /Store\.loadStatsSettings\(\)/);
  assert.match(record, /Store\.loadReadingNotesState\(\)/);
  assert.match(record, /Store\.loadStatsSettings\(\)/);
  assert.match(record, /Store\.loadWorklogState\(\)/);
});

test("HP는 서울 날짜 최근 7일의 기록 비율이며 최솟값만 20이다", () => {
  assert.match(store, /timeZone:\s*"Asia\/Seoul"/);
  assert.match(store, /Math\.max\(20, Math\.round\(\(count \/ 7\) \* 100\)\)/);
  assert.doesNotMatch(store, /20 \+ Math\.round\(\(count \/ 7\) \* 80\)/);
});

test("인스턴스 키는 존재 확인 뒤 모든 개인 데이터 저장 키와 행 범위에 적용된다", () => {
  assert.match(worker, /loadRawSetting\(env, instanceMetaKey\(rawInstanceId\), null\)/);
  assert.match(worker, /unknown widget instance/);
  assert.match(worker, /`instance:\$\{env\.__instanceId\}:\$\{date\}`/);
  assert.match(worker, /`instance:\$\{env\.__instanceId\}:\$\{key\}`/);
  assert.match(worker, /WHERE instance_id = \?/);
  assert.match(schema, /PRIMARY KEY \(instance_id, task_id\)/);
  assert.match(schema, /UNIQUE \(instance_id, schedule_id, occurrence_key\)/);
  assert.match(worker, /mood: Number\.isFinite\(numericMood\) \? numericMood : row\.mood/);
});

test("생각·목표 삭제와 전체 저장은 에너지 나침반 연결 메타도 정리한다", () => {
  assert.match(worker, /function removeIndexItems\(index, ids\)/);
  assert.match(worker, /removeIndexItems\(index, \[`thought:\$\{sourceId\}`\]\)/);
  assert.match(worker, /removeIndexItems\(index, \[\.\.\.removing\]\.map\(goalId => `goal:\$\{goalId\}`\)\)/);
  assert.match(worker, /if \(meta\.p && removed\.has\(meta\.p\)\) meta\.p = null/);
});

test("저장 계층은 네트워크 실패를 위젯 안에 표시하고 재시도를 유지한다", () => {
  assert.match(store, /function showStoreError\(error\)/);
  assert.match(store, /서버 연결 실패 · 다시 시도 중/);
  assert.match(store, /window\.addEventListener\("online", run\)/);
  assert.match(store, /setInterval\(run/);
});
