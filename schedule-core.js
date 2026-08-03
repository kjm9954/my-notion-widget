export const SEOUL_TIME_ZONE = "Asia/Seoul";
export const NOTION_API_VERSION = "2026-03-11";
export const LEAD_MINUTES = Object.freeze([30, 60, 120, 180]);
export const WEEKDAY_LABELS = Object.freeze(["월", "화", "수", "목", "금", "토", "일"]);
export const TITLE_TOKENS = Object.freeze(["date", "name", "project"]);
export const TITLE_SEPARATORS = Object.freeze([" ", " / ", " · ", " - ", "[", "]", "(", ")"]);
export const DEFAULT_TITLE_TEMPLATE = Object.freeze([
  Object.freeze({ type: "literal", value: "[" }),
  Object.freeze({ type: "token", value: "date" }),
  Object.freeze({ type: "literal", value: " / " }),
  Object.freeze({ type: "token", value: "name" }),
  Object.freeze({ type: "literal", value: "]" }),
  Object.freeze({ type: "literal", value: " " }),
  Object.freeze({ type: "token", value: "project" }),
]);

const DAY_MS = 86_400_000;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

function two(value) {
  return String(value).padStart(2, "0");
}

export function cleanScheduleText(value, maximum = 120) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximum);
}

export function isDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(stamp);
  return date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3]);
}

export function normalizeScheduleTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${two(hour)}:${two(minute)}`;
}

export function addDateKeyDays(dateKey, days) {
  if (!isDateKey(dateKey)) throw new Error("invalid date key");
  const [year, month, day] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return `${next.getUTCFullYear()}-${two(next.getUTCMonth() + 1)}-${two(next.getUTCDate())}`;
}

export function weekdayOfDateKey(dateKey) {
  if (!isDateKey(dateKey)) return null;
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function seoulDateKey(value = Date.now()) {
  const shifted = new Date(Number(value instanceof Date ? value.getTime() : value) + SEOUL_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${two(shifted.getUTCMonth() + 1)}-${two(shifted.getUTCDate())}`;
}

export function seoulDateTimeToMs(dateKey, time) {
  if (!isDateKey(dateKey)) throw new Error("invalid date key");
  const clock = normalizeScheduleTime(time);
  if (!clock) throw new Error("invalid schedule time");
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

export function seoulDateTimeIso(dateKey, time) {
  const clock = normalizeScheduleTime(time);
  if (!isDateKey(dateKey) || !clock) throw new Error("invalid Seoul date time");
  return `${dateKey}T${clock}:00+09:00`;
}

export function formatDateToken(dateKey) {
  if (!isDateKey(dateKey)) return "";
  const [, month, day] = dateKey.split("-").map(Number);
  return `${two(month)}${two(day)}`;
}

export function formatScheduleDate(dateKey) {
  if (!isDateKey(dateKey)) return "";
  const [, month, day] = dateKey.split("-").map(Number);
  return `${month}월 ${day}일 ${WEEKDAY_LABELS[weekdayOfDateKey(dateKey) - 1]}요일`;
}

export function normalizeTitleTemplate(value) {
  const source = Array.isArray(value) ? value : DEFAULT_TITLE_TEMPLATE;
  const parts = [];
  source.slice(0, 20).forEach(part => {
    if (!part || typeof part !== "object") return;
    if (part.type === "token" && TITLE_TOKENS.includes(part.value)) {
      parts.push({ type: "token", value: part.value });
      return;
    }
    if (part.type === "literal") {
      const literal = String(part.value ?? "").slice(0, 12);
      if (TITLE_SEPARATORS.includes(literal)) parts.push({ type: "literal", value: literal });
    }
  });
  if (!parts.some(part => part.type === "token")) {
    return DEFAULT_TITLE_TEMPLATE.map(part => ({ ...part }));
  }
  return parts;
}

export function formatScheduleTitle(template, context) {
  const data = {
    date: formatDateToken(context?.date),
    name: cleanScheduleText(context?.name, 120),
    project: cleanScheduleText(context?.project, 120),
  };
  return normalizeTitleTemplate(template)
    .map(part => part.type === "token" ? data[part.value] : part.value)
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 200);
}

export function normalizeScheduleInput(raw, options = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const kind = source.kind === "weekly" ? "weekly" : "once";
  const name = cleanScheduleText(source.name, 120);
  const project = cleanScheduleText(source.project, 80);
  const scheduleTime = normalizeScheduleTime(source.scheduleTime ?? source.schedule_time);
  const leadMinutes = Number(source.leadMinutes ?? source.lead_minutes);
  const date = kind === "once" ? String(source.date || "") : null;
  const weekday = kind === "weekly" ? Number(source.weekday) : null;
  const errors = [];
  if (source.kind !== undefined && !["once", "weekly"].includes(source.kind)) errors.push("올바른 예약 유형을 선택해주세요.");
  if (!name) errors.push("예약 이름을 입력해주세요.");
  if (!scheduleTime) errors.push("올바른 시간을 선택해주세요.");
  if (!project) errors.push("프로젝트를 입력해주세요.");
  if (!LEAD_MINUTES.includes(leadMinutes)) errors.push("생성 시점을 선택해주세요.");
  if (kind === "once" && !isDateKey(date)) errors.push("올바른 날짜를 선택해주세요.");
  if (kind === "weekly" && (!Number.isInteger(weekday) || weekday < 1 || weekday > 7)) errors.push("반복 요일을 선택해주세요.");
  const rawTemplate = source.titleTemplate ?? source.title_template;
  if (rawTemplate !== undefined) {
    if (!Array.isArray(rawTemplate) || rawTemplate.length < 1 || rawTemplate.length > 20) {
      errors.push("제목 형식을 확인해주세요.");
    } else {
      const validParts = rawTemplate.every(part => part && typeof part === "object" && (
        (part.type === "token" && TITLE_TOKENS.includes(part.value))
        || (part.type === "literal" && TITLE_SEPARATORS.includes(String(part.value ?? "")))
      ));
      if (!validParts || !rawTemplate.some(part => part?.type === "token" && TITLE_TOKENS.includes(part.value))) {
        errors.push("제목 형식에 올바른 항목을 하나 이상 넣어주세요.");
      }
    }
  }
  const normalized = {
    id: cleanScheduleText(source.id, 120),
    kind,
    name,
    project,
    date,
    weekday,
    scheduleTime,
    leadMinutes,
    titleTemplate: normalizeTitleTemplate(source.titleTemplate ?? source.title_template),
    status: source.status === "completed" ? "completed" : "active",
    skippedOccurrenceKey: source.skippedOccurrenceKey ?? source.skipped_occurrence_key ?? null,
    lastOccurrenceKey: source.lastOccurrenceKey ?? source.last_occurrence_key ?? null,
    createdAt: String(source.createdAt ?? source.created_at ?? options.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(source.updatedAt ?? source.updated_at ?? options.updatedAt ?? new Date(0).toISOString()),
  };
  return { value: normalized, errors };
}

export function occurrenceForDate(scheduleValue, dateKey) {
  const { value: schedule, errors } = normalizeScheduleInput(scheduleValue);
  if (errors.length || !isDateKey(dateKey) || schedule.status !== "active") return null;
  if (schedule.kind === "once" && schedule.date !== dateKey) return null;
  if (schedule.kind === "weekly" && schedule.weekday !== weekdayOfDateKey(dateKey)) return null;
  const scheduledAtMs = seoulDateTimeToMs(dateKey, schedule.scheduleTime);
  const createAtMs = scheduledAtMs - schedule.leadMinutes * 60_000;
  return {
    key: `${schedule.kind}:${dateKey}`,
    date: dateKey,
    scheduledAtMs,
    createAtMs,
    scheduledAt: new Date(scheduledAtMs).toISOString(),
    scheduledAtSeoul: seoulDateTimeIso(dateKey, schedule.scheduleTime),
    createAt: new Date(createAtMs).toISOString(),
    title: formatScheduleTitle(schedule.titleTemplate, { date: dateKey, name: schedule.name, project: schedule.project }),
  };
}

function createdAtMs(schedule) {
  const parsed = Date.parse(schedule.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function upcomingOccurrences(scheduleValue, nowValue = Date.now(), count = 2, options = {}) {
  const { value: schedule, errors } = normalizeScheduleInput(scheduleValue);
  if (errors.length || schedule.status !== "active") return [];
  const nowMs = Number(nowValue instanceof Date ? nowValue.getTime() : nowValue);
  const today = seoulDateKey(nowMs);
  const candidates = [];
  const activation = createdAtMs(schedule);
  const skipped = options.ignoreSkipped ? null : schedule.skippedOccurrenceKey;
  const last = options.ignoreLast ? null : schedule.lastOccurrenceKey;

  if (schedule.kind === "once") {
    const occurrence = occurrenceForDate(schedule, schedule.date);
    if (!occurrence || occurrence.key === last || occurrence.key === skipped) return [];
    if (occurrence.scheduledAtMs < activation) return [];
    if (occurrence.scheduledAtMs < nowMs) return [];
    return [occurrence];
  }

  for (let offset = 0; offset <= 35 && candidates.length < count; offset += 1) {
    const dateKey = addDateKeyDays(today, offset);
    const occurrence = occurrenceForDate(schedule, dateKey);
    if (!occurrence || occurrence.key === last || occurrence.key === skipped) continue;
    if (occurrence.scheduledAtMs < activation) continue;
    if (occurrence.scheduledAtMs < nowMs) continue;
    candidates.push(occurrence);
  }
  return candidates.slice(0, count);
}

export function currentSkippableOccurrence(scheduleValue, nowValue = Date.now()) {
  const { value: schedule, errors } = normalizeScheduleInput(scheduleValue);
  if (errors.length || schedule.status !== "active") return null;
  if (schedule.skippedOccurrenceKey) {
    const dateKey = schedule.skippedOccurrenceKey.split(":").at(-1);
    const skipped = occurrenceForDate(schedule, dateKey);
    if (skipped && skipped.scheduledAtMs >= Number(nowValue instanceof Date ? nowValue.getTime() : nowValue)) return skipped;
  }
  return upcomingOccurrences(schedule, nowValue, 1, { ignoreSkipped: true })[0] || null;
}

export function expiredSkipAction(scheduleValue, nowValue = Date.now()) {
  const { value: schedule, errors } = normalizeScheduleInput(scheduleValue);
  if (errors.length || !schedule.skippedOccurrenceKey) return null;
  const dateKey = String(schedule.skippedOccurrenceKey).split(":").at(-1);
  const occurrence = occurrenceForDate(schedule, dateKey);
  const nowMs = Number(nowValue instanceof Date ? nowValue.getTime() : nowValue);
  if (!occurrence || occurrence.scheduledAtMs > nowMs) return null;
  return schedule.kind === "once" ? "complete" : "clear";
}

export function dueOccurrence(scheduleValue, nowValue = Date.now()) {
  const nowMs = Number(nowValue instanceof Date ? nowValue.getTime() : nowValue);
  const { value: schedule, errors } = normalizeScheduleInput(scheduleValue);
  if (errors.length || schedule.status !== "active") return null;
  const activation = createdAtMs(schedule);
  const today = seoulDateKey(nowMs);
  const dateKeys = schedule.kind === "once" ? [schedule.date] : [addDateKeyDays(today, -1), today];
  const due = dateKeys.map(dateKey => occurrenceForDate(schedule, dateKey)).filter(occurrence => (
    occurrence
    && occurrence.key !== schedule.lastOccurrenceKey
    && occurrence.key !== schedule.skippedOccurrenceKey
    && occurrence.scheduledAtMs >= activation
    && (schedule.kind === "once" || occurrence.scheduledAtMs >= nowMs - DAY_MS)
    && occurrence.createAtMs <= nowMs
  ));
  due.sort((a, b) => a.createAtMs - b.createAtMs);
  return due[0] || null;
}

export function scheduleSortKey(scheduleValue, nowValue = Date.now()) {
  const next = upcomingOccurrences(scheduleValue, nowValue, 1)[0];
  return next?.createAtMs ?? Number.POSITIVE_INFINITY;
}
