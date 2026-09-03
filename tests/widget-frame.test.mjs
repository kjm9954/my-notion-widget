import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../widget-frame.js", import.meta.url), "utf8");
const css = await readFile(new URL("../widget-frame.css", import.meta.url), "utf8");

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

test("저장 폭과 기기 유형으로 축소·아이폰 배치·일반 재배치를 구분한다", () => {
  assert.match(source, /function isMobileTabletDevice\(\)/);
  assert.match(source, /matchMedia\?\.\('\(any-pointer: coarse\)'\)\.matches === true/);
  assert.match(source, /if \(!isMobileTabletDevice\(\)\) return 'desktop'/);
  assert.match(source, /if \(width >= 640 \|\| savedWidth <= width \* 2\) return 'scale'/);
  assert.match(source, /host\?\.hasAttribute\('data-widget-mobile'\) \? 'mobile' : 'reflow'/);
  assert.match(source, /const viewportLimit = isMobileTabletDevice\(\) \? byWidth : Number\.POSITIVE_INFINITY/);
  assert.match(source, /const reflowWidth = viewportWidth\(\);\s*renderedScale = 1;/);
  assert.match(source, /--widget-content-width', `\$\{reflowWidth\}px`/);
  assert.match(source, /card\.style\.removeProperty\('height'\)/);
  assert.match(css, /body\.widget-page\.is-widget-reflow,\s*body\.widget-page\.is-widget-mobile[\s\S]*?overflow-y: auto !important/);
  assert.match(css, /body\.is-widget-mobile \[data-widget-card\][\s\S]*?transform: none !important/);
  assert.match(source, /function saveSize\(\) \{\s*if \(isMobileTabletDevice\(\)\) return;/);
});

test("URL 크기 지정은 저장 크기보다 우선하고 기기 재배치 강제·해제를 제공한다", () => {
  assert.match(source, /contentW:positiveQuery\('w'\)/);
  assert.match(source, /frameH:positiveQuery\('h'\)/);
  assert.match(source, /scale:positiveQuery\('s'\)/);
  assert.match(source, /listH:positiveQuery\('list'\)/);
  assert.match(source, /if \(override === 'on'\) return true/);
  assert.match(source, /if \(override === 'off'\) return false/);
});

test("폭 기반 반응형 CSS는 모바일·태블릿 포인터에서만 적용한다", async () => {
  assert.doesNotMatch(css, /@media\s*\(max-width:/);
  assert.match(css, /@media \(any-pointer: coarse\) and \(max-width: 639px\)/);
});

test("팝오버는 카드 안으로 보정되고 모바일에서는 하단 시트가 된다", () => {
  assert.match(source, /function clampToCard\(element\)/);
  assert.match(source, /window\.widgetFrame = Object\.assign\([\s\S]*clampToCard/);
  assert.match(css, /body\.is-widget-mobile \.cell-popover[\s\S]*?bottom: 8px !important/);
});
