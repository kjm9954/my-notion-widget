// Worker 배포 진입점(wrangler.toml 의 main).
// worker.js 바깥을 위젯 레이아웃 → 분기 목표 → 면담 기록 순서로 감싼다. 운영 Worker와 같은 순서다.
// 각 래퍼는 자기 경로만 처리하고 나머지 요청은 안쪽으로 넘긴다.
import worker from './worker.js';
import { withWidgetLayouts } from './widget-layout-api.mjs';
import { withQuarterGoals } from './quarter-goals-api.mjs';
import { withMeetingNotes } from './meeting-notes-api.mjs';

export * from './worker.js';
export default withMeetingNotes(withQuarterGoals(withWidgetLayouts(worker)));
