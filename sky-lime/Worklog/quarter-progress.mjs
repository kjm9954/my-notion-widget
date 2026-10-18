// 위젯 1. 분기 진행도: ‹ 분기 › · 업무/일상 전환 · 큰 % · 막대(경과율 띠) · D-n. 읽기 전용.
// 분기·업무/일상을 바꾸면 분기 목표·습관 점검 위젯도 함께 바뀐다(다른 iframe이어도).
import { getMode, onModeChange, paintModeToggle, bindModeToggle, staleText, failureText } from './sky-lime-common.mjs?v=20261015-sky-lime';
import { getQuarter, setQuarter, onQuarterChange, onDayChange, watchQuarterGoals, createQuarterController } from './goal-check-common.mjs?v=20261018-goal-check';
import { quarterLabel, shiftQuarter, canShiftQuarter, quarterProgress, lagWidth, quarterDday } from './goal-check-model.mjs?v=20261018-goal-check';

const app = document.getElementById('app');
const quarterEl = document.getElementById('quarter');
const toggleEl = document.getElementById('modeToggle');
const noticeEl = document.getElementById('notice');
const percentEl = document.getElementById('percent');
const fillEl = document.getElementById('fill');
const lagEl = document.getElementById('lag');
const ddayEl = document.getElementById('dday');
const messageEl = document.getElementById('message');
const arrows = [...app.querySelectorAll('[data-shift]')];
const controller = createQuarterController(render);

function render() {
  const mode = getMode();
  const quarter = getQuarter();
  paintModeToggle(toggleEl, mode);
  quarterEl.textContent = quarterLabel(quarter);
  arrows.forEach(button => { button.disabled = !canShiftQuarter(quarter, Number(button.dataset.shift)); });
  const state = controller.view();
  const error = controller.error;
  if (state) {
    const progress = quarterProgress(state);
    percentEl.textContent = `${progress}%`;
    fillEl.style.width = `${progress}%`;
    lagEl.style.width = `${lagWidth(quarter, progress)}%`;
    ddayEl.textContent = quarterDday(quarter);
  }
  messageEl.textContent = !state && controller.loaded ? failureText(error) : '';
  noticeEl.textContent = state && error ? staleText(error) : '';
  app.dataset.status = !controller.loaded ? 'loading' : !state ? 'error' : error ? 'stale' : 'ready';
  app.dataset.mode = mode;
  app.dataset.quarter = quarter;
}

app.addEventListener('click', event => {
  const arrow = event.target.closest('[data-shift]');
  if (arrow && !arrow.disabled) setQuarter(shiftQuarter(getQuarter(), Number(arrow.dataset.shift)));
});
bindModeToggle(app);
// 바꾼 범위로 바로 넘어가 그린다(이미 본 범위면 그 값, 처음이면 불러오는 중).
onModeChange(() => controller.load());
onQuarterChange(() => controller.load());
onDayChange(render);
render();
controller.load();
watchQuarterGoals(() => controller.load());
