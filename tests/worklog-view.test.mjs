import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeWorklogState } from "../worker.js";

test("업무 보기 상태는 시간 기본값과 메모 값만 허용", () => {
  assert.equal(normalizeWorklogState({}).workView, "time");
  assert.equal(normalizeWorklogState({ workView:"memo" }).workView, "memo");
  assert.equal(normalizeWorklogState({ workView:"other" }).workView, "time");
});

test("업무일지는 시간·메모 전환과 두 열 구성을 모두 포함", async () => {
  const html = await readFile(new URL("../Worklog/worklog.html", import.meta.url), "utf8");
  assert.match(html, /data-work-view="time"/);
  assert.match(html, /data-work-view="memo"/);
  assert.match(html, /column-head work view-memo/);
  assert.match(html, /메모 \$\{memoCount\}건/);
});

test("업무 관리용 위젯은 전체 크기 조절 프레임을 사용", async () => {
  const html = await readFile(new URL("../Worklog/schedule.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /data-widget-resize="list-only"/);
  assert.match(html, /data-widget-scale-handle/);
  assert.match(html, /data-widget-size-label/);
});
