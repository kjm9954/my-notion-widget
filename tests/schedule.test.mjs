import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  currentSkippableOccurrence,
  dueOccurrence,
  expiredSkipAction,
  formatScheduleTitle,
  normalizeScheduleInput,
  occurrenceForDate,
  upcomingOccurrences,
} from "../schedule-core.js";
import { notionScheduleConfig } from "../worker.js";

const defaultTemplate = [
  { type:"literal", value:"[" },
  { type:"token", value:"date" },
  { type:"literal", value:" / " },
  { type:"token", value:"name" },
  { type:"literal", value:"]" },
  { type:"literal", value:" " },
  { type:"token", value:"project" },
];

function once(overrides = {}) {
  return {
    id:"one", kind:"once", name:"개발 리뷰", date:"2026-08-03", weekday:null,
    scheduleTime:"17:00", project:"팝콘", leadMinutes:60, titleTemplate:defaultTemplate,
    status:"active", skippedOccurrenceKey:null, lastOccurrenceKey:null,
    createdAt:"2026-08-01T00:00:00.000Z", updatedAt:"2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function weekly(overrides = {}) {
  return {
    ...once(), id:"weekly", kind:"weekly", date:null, weekday:1, scheduleTime:"16:00", leadMinutes:120,
    ...overrides,
  };
}

test("서울 기준 단발 예약과 사전 생성 시각", () => {
  const occurrence = occurrenceForDate(once(), "2026-08-03");
  assert.equal(occurrence.scheduledAt, "2026-08-03T08:00:00.000Z");
  assert.equal(occurrence.createAt, "2026-08-03T07:00:00.000Z");
  assert.equal(occurrence.scheduledAtSeoul, "2026-08-03T17:00:00+09:00");
  assert.equal(dueOccurrence(once(), Date.parse("2026-08-05T08:00:00.000Z")).key, "once:2026-08-03");
});

test("매주 특정 요일의 다음 occurrence", () => {
  const next = upcomingOccurrences(weekly(), Date.parse("2026-08-04T00:00:00.000Z"), 1)[0];
  assert.equal(next.date, "2026-08-10");
  assert.equal(next.createAt, "2026-08-10T05:00:00.000Z");
});

test("사전 생성 allowlist 밖의 값을 거부", () => {
  assert.deepEqual([30, 60, 120, 180].map(leadMinutes => normalizeScheduleInput(once({ leadMinutes })).errors), [[], [], [], []]);
  assert.match(normalizeScheduleInput(once({ leadMinutes:90 })).errors.join(" "), /생성 시점/);
});

test("반복 업무 한 회차 건너뛰기와 다음 주 자동 재개", () => {
  const skipped = weekly({ skippedOccurrenceKey:"weekly:2026-08-03" });
  const now = Date.parse("2026-08-03T00:00:00.000Z");
  assert.equal(currentSkippableOccurrence(skipped, now).date, "2026-08-03");
  assert.equal(upcomingOccurrences(skipped, now, 1)[0].date, "2026-08-10");
  assert.equal(dueOccurrence(skipped, Date.parse("2026-08-03T05:30:00.000Z")), null);
});

test("단발 예약 건너뛰기는 생성 대상에서 제외", () => {
  const skipped = once({ skippedOccurrenceKey:"once:2026-08-03" });
  assert.equal(upcomingOccurrences(skipped, Date.parse("2026-08-03T00:00:00.000Z"), 1).length, 0);
  assert.ok(occurrenceForDate(skipped, "2026-08-03").scheduledAtMs <= Date.parse("2026-08-03T08:00:00.000Z"));
  assert.equal(expiredSkipAction(skipped, Date.parse("2026-08-03T08:00:00.000Z")), "complete");
  assert.equal(expiredSkipAction(weekly({ skippedOccurrenceKey:"weekly:2026-08-03" }), Date.parse("2026-08-03T07:00:00.000Z")), "clear");
});

test("제목 formatter는 구조화 토큰과 허용 구분자만 사용", () => {
  const expected = "[0803 / 개발 리뷰] 팝콘";
  assert.equal(formatScheduleTitle(defaultTemplate, { date:"2026-08-03", name:"개발 리뷰", project:"팝콘" }), expected);
  const invalid = normalizeScheduleInput(once({ titleTemplate:[{ type:"literal", value:"<b>" }] }));
  assert.match(invalid.errors.join(" "), /제목 형식/);
});

test("Notion 설정 누락은 명확한 configuration error", () => {
  assert.throws(() => notionScheduleConfig({}), /Notion 연결 설정이 필요합니다/);
  const config = notionScheduleConfig({
    NOTION_TOKEN:"secret", NOTION_DATABASE_ID:"data-source",
    NOTION_TITLE_PROPERTY:"이름", NOTION_DATE_PROPERTY:"일정",
    NOTION_PROJECT_PROPERTY:"프로젝트", NOTION_OCCURRENCE_PROPERTY:"위젯 회차 키",
  });
  assert.equal(config.projectType, "select");
});

test("D1 중복 방지와 instance 범위 계약", async () => {
  const migration = await readFile(new URL("../migrations/0003_schedule.sql", import.meta.url), "utf8");
  const worker = await readFile(new URL("../worker.js", import.meta.url), "utf8");
  assert.match(migration, /UNIQUE \(instance_id, schedule_id, occurrence_key\)/);
  assert.match(worker, /INSERT OR IGNORE INTO schedule_runs/);
  assert.match(worker, /findNotionPageByMarker/);
  assert.match(worker, /SET last_occurrence_key = skipped_occurrence_key, skipped_occurrence_key = NULL/);
  assert.match(worker, /WHERE id = \? AND instance_id = \?/);
  assert.match(worker, /if \(!env\.__instanceId\)/);
});
