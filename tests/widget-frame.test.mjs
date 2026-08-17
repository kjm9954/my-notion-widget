import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../widget-frame.js", import.meta.url), "utf8");

test("저장 크기는 임시로 작은 임베드 뷰포트에 맞춰 덮어쓰지 않는다", () => {
  assert.match(source, /const next = fromUser\s*\? clampAxisSize\(value, MINIMUM_CONTENT_WIDTH, maximumContentWidth\(scale\)\)\s*:\s*Math\.max\(MINIMUM_CONTENT_WIDTH, number\(value, designWidth\)\)/);
  assert.match(source, /const next = fromUser\s*\? clampAxisSize\(value, MINIMUM_FRAME_HEIGHT, maximumFrameHeight\(scale\)\)\s*:\s*Math\.max\(MINIMUM_FRAME_HEIGHT, number\(value, naturalHeight\)\)/);
  assert.match(source, /if \(widthLocked\) return contentWidth;\s*return designWidth;/);
});

test("노션 임베드가 늦게 펼쳐져도 프레임을 다시 맞춘다", () => {
  assert.match(source, /window\.addEventListener\('pageshow', settleFrame\)/);
  assert.match(source, /window\.visualViewport\?\.addEventListener\('resize', settleFrame\)/);
  assert.match(source, /new ResizeObserver\(settleFrame\)\.observe\(document\.documentElement\)/);
  assert.match(source, /\[60, 250, 1000\]\.forEach\(delay => setTimeout\(commitFrame, delay\)\)/);
});

test("업무일지는 체크 외곽선을 덧그리지 않고 빈 목록만 유휴 모션을 사용한다", () => {
  assert.match(source, /'worklog\.html': \{ empty:'\.list-shell\.is-empty' \}/);
  assert.doesNotMatch(source, /'worklog\.html': \{[^\n]*done-check/);
  assert.doesNotMatch(source, /\[data-empty-add\]/);
});
