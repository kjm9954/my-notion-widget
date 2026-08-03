import {
  NOTION_API_VERSION,
  currentSkippableOccurrence,
  dueOccurrence,
  expiredSkipAction,
  normalizeScheduleInput,
  seoulDateTimeToMs,
  upcomingOccurrences,
} from "./schedule-core.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

    try {
      if (path === "/api/instance/create" && request.method === "POST") {
        const instanceId = `w_${crypto.randomUUID().replaceAll("-", "")}`;
        const meta = { id: instanceId, createdAt: new Date().toISOString() };
        await saveRawSetting(env, instanceMetaKey(instanceId), meta);
        return json({ ok: true, data: meta }, 201);
      }

      const rawInstanceId = url.searchParams.get("w") || "";
      if (rawInstanceId && !isValidInstanceId(rawInstanceId)) {
        return json({ ok: false, error: "invalid widget instance" }, 400);
      }
      if (rawInstanceId) {
        const meta = await loadRawSetting(env, instanceMetaKey(rawInstanceId), null);
        if (!meta) return json({ ok: false, error: "unknown widget instance" }, 404);
        env = instanceEnv(env, rawInstanceId);
      }

      if (path === "/api/instance" && request.method === "GET") {
        return json({ ok: true, data: rawInstanceId ? { id: rawInstanceId } : { id: null, legacy: true } });
      }

      // ───────── 일기 ─────────
      if (path === "/api/diary/save" && request.method === "POST") {
        const d = await request.json();
        if (!validDateKey(d?.date)) return json({ ok: false, error: "invalid date" }, 400);
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO diary (date, mode, mood, achievements, images, quest, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET
             mode=excluded.mode, mood=excluded.mood, achievements=excluded.achievements,
             images=excluded.images, quest=excluded.quest, updatedAt=excluded.updatedAt`
        ).bind(diaryStorageDate(env, d.date), d.mode || null, d.mood || null,
               JSON.stringify(d.achievements || []), JSON.stringify(d.images || []),
               JSON.stringify(d.quest || null), d.createdAt || now, now).run();
        return json({ ok: true });
      }

      if (path === "/api/diary/get") {
        const date = url.searchParams.get("date");
        if (!validDateKey(date)) return json({ ok: false, error: "invalid date" }, 400);
        const row = await env.DB.prepare(`SELECT * FROM diary WHERE date = ?`).bind(diaryStorageDate(env, date)).first();
        return json({ ok: true, data: row ? parseDiary(row, env) : null });
      }

      if (path === "/api/diary/range") {
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");
        if (!validDiaryRangeKey(start) || !validDiaryRangeKey(end) || start > end) {
          return json({ ok: false, error: "invalid date range" }, 400);
        }
        const { results } = await env.DB.prepare(
          `SELECT * FROM diary WHERE date >= ? AND date <= ? ORDER BY date ASC`
        ).bind(diaryStorageDate(env, start), diaryStorageDate(env, end)).all();
        return json({ ok: true, data: (results || []).map(row => parseDiary(row, env)) });
      }

      if (path === "/api/diary/dates") {
        const { results } = env.__instanceId
          ? await env.DB.prepare(`SELECT date FROM diary WHERE date >= ? AND date <= ? ORDER BY date ASC`)
              .bind(diaryStorageDate(env, "0000-01-01"), diaryStorageDate(env, "9999-12-31")).all()
          : await env.DB.prepare(`SELECT date FROM diary WHERE length(date) = 10 ORDER BY date ASC`).all();
        return json({ ok: true, data: (results || []).map(row => diaryPublicDate(env, row.date)) });
      }

      if (path === "/api/diary/delete" && request.method === "POST") {
        const { date } = await request.json();
        if (!validDateKey(date)) return json({ ok: false, error: "invalid date" }, 400);
        await env.DB.prepare(`DELETE FROM diary WHERE date = ?`).bind(diaryStorageDate(env, date)).run();
        return json({ ok: true });
      }

      // ───────── 감정 단어 ─────────
      if (path === "/api/settings/mood-words" && request.method === "GET") {
        return json({ ok: true, data: normalizeMoodWords(await loadSetting(env, "moodWords", [])) });
      }

      if (path === "/api/settings/mood-words" && request.method === "POST") {
        const body = await request.json();
        if (!Array.isArray(body?.words)) return json({ ok: false, error: "words must be an array" }, 400);
        const words = normalizeMoodWords(body?.words);
        await saveSetting(env, "moodWords", words);
        return json({ ok: true, data: words });
      }

      // ───────── 생각 ─────────
      if (path === "/api/thoughts/state" && request.method === "GET") {
        return json({ ok: true, data: await loadThoughtState(env) });
      }

      if (path === "/api/thoughts/state" && request.method === "POST") {
        const state = normalizeThoughtState(await request.json());
        await saveSetting(env, "thoughtBox", state);
        return json({ ok: true, data: state });
      }

      if (path === "/api/thoughts/add" && request.method === "POST") {
        const t = await request.json();
        const state = await loadThoughtState(env);
        const now = Date.now();
        const item = {
          id: crypto.randomUUID(),
          one: cleanText(t.one ?? t.content, 240),
          detail: cleanText(t.detail, 4000, false),
          cat: cleanCategory(t.cat ?? t.category, state.cats),
          created: Number(t.created) || now,
          opened: Number(t.opened) || now,
        };
        if (!item.one) return json({ ok: false, error: "content is required" }, 400);
        state.items.unshift(item);
        await saveSetting(env, "thoughtBox", state);
        return json({ ok: true, id: item.id, data: item });
      }

      if (path === "/api/thoughts/list") {
        const category = url.searchParams.get("category");
        const keyword = url.searchParams.get("keyword");
        const state = await loadThoughtState(env);
        const needle = String(keyword || "").trim().toLocaleLowerCase("ko");
        const items = state.items
          .filter(item => !category || item.cat === category)
          .filter(item => !needle || `${item.one}\n${item.detail}`.toLocaleLowerCase("ko").includes(needle))
          .sort((a, b) => b.created - a.created)
          .map(item => ({ ...item, content: item.one, category: item.cat, createdAt: new Date(item.created).toISOString(), updatedAt: new Date(item.opened).toISOString() }));
        return json({ ok: true, data: items });
      }

      if (path === "/api/thoughts/update" && request.method === "POST") {
        const t = await request.json();
        const state = await loadThoughtState(env);
        const item = state.items.find(entry => entry.id === String(t.id || ""));
        if (!item) return json({ ok: false, error: "not found" }, 404);
        const nextOne = t.one ?? t.content;
        if (nextOne !== undefined) {
          const clean = cleanText(nextOne, 240);
          if (!clean) return json({ ok: false, error: "content is required" }, 400);
          item.one = clean;
        }
        if (t.detail !== undefined) item.detail = cleanText(t.detail, 4000, false);
        const nextCat = t.cat ?? t.category;
        if (nextCat !== undefined) item.cat = cleanCategory(nextCat, state.cats);
        if (Number(t.opened) > 0) item.opened = Number(t.opened);
        await saveSetting(env, "thoughtBox", state);
        return json({ ok: true, data: item });
      }

      if (path === "/api/thoughts/delete" && request.method === "POST") {
        const { id } = await request.json();
        const state = await loadThoughtState(env);
        state.items = state.items.filter(item => item.id !== String(id || ""));
        await saveSetting(env, "thoughtBox", state);
        return json({ ok: true });
      }

      // ───────── 목표 ─────────
      if (path === "/api/goals/state" && request.method === "GET") {
        return json({ ok: true, data: await loadGoalState(env) });
      }

      if (path === "/api/goals/state" && request.method === "POST") {
        const state = normalizeGoalState(await request.json());
        const index = await loadIndexSettings(env);
        const activeGoalIds = new Set(state.goals.map(goal => `goal:${goal.id}`));
        Object.keys(index.items).forEach(id => {
          if (id.startsWith("goal:") && !activeGoalIds.has(id)) delete index.items[id];
        });
        state.goals.forEach(goal => {
          const id = `goal:${goal.id}`;
          if (!index.items[id]) index.items[id] = { scope: index.scope, q: null, st: goal.done ? "done" : "todo", p: null };
        });
        await Promise.all([saveSetting(env, "goalBox", state), saveSetting(env, "indexSettings", index)]);
        return json({ ok: true, data: state });
      }

      if (path === "/api/goals/add" && request.method === "POST") {
        const g = await request.json();
        const state = await loadGoalState(env);
        const title = cleanText(g.title ?? g.t, 240);
        if (!title) return json({ ok: false, error: "title is required" }, 400);
        const goal = {
          id: crypto.randomUUID(),
          scope: normalizeGoalScope(g.scope),
          t: title,
          done: false,
          parent: g.parentId ?? g.parent ?? null,
          createdAt: Number(g.createdAt) || Date.now(),
          completedAt: null,
        };
        state.goals.push(goal);
        const index = await loadIndexSettings(env);
        index.items[`goal:${goal.id}`] = { scope: index.scope, q: null, st: "todo", p: null };
        await Promise.all([saveSetting(env, "goalBox", state), saveSetting(env, "indexSettings", index)]);
        return json({ ok: true, id: goal.id, data: goal });
      }

      if (path === "/api/goals/list") {
        const scope = url.searchParams.get("scope");
        const state = await loadGoalState(env);
        const goals = state.goals
          .filter(goal => !scope || goal.scope === scope)
          .sort((a, b) => a.createdAt - b.createdAt)
          .map(goal => ({ ...goal, title: goal.t, parentId: goal.parent }));
        return json({ ok: true, data: goals });
      }

      if (path === "/api/goals/update" && request.method === "POST") {
        const g = await request.json();
        const state = await loadGoalState(env);
        const goal = state.goals.find(item => item.id === String(g.id || ""));
        if (!goal) return json({ ok: false, error: "not found" }, 404);
        const nextTitle = g.title ?? g.t;
        if (nextTitle !== undefined) {
          const clean = cleanText(nextTitle, 240);
          if (!clean) return json({ ok: false, error: "title is required" }, 400);
          goal.t = clean;
        }
        if (g.scope !== undefined) goal.scope = normalizeGoalScope(g.scope);
        if (g.parentId !== undefined || g.parent !== undefined) goal.parent = g.parentId ?? g.parent ?? null;
        if (g.done !== undefined) setGoalDone(goal, Boolean(g.done));
        await saveSetting(env, "goalBox", state);
        return json({ ok: true, data: goal });
      }

      if (path === "/api/goals/toggle" && request.method === "POST") {
        const { id } = await request.json();
        const state = await loadGoalState(env);
        const goal = state.goals.find(item => item.id === String(id || ""));
        if (!goal) return json({ ok: false, error: "not found" }, 404);
        setGoalDone(goal, !goal.done);
        await saveSetting(env, "goalBox", state);
        return json({ ok: true, done: goal.done, data: goal });
      }

      if (path === "/api/goals/delete" && request.method === "POST") {
        const { id, cascade } = await request.json();
        const state = await loadGoalState(env);
        const targetId = String(id || "");
        const removing = new Set([targetId]);
        if (cascade) {
          let changed = true;
          while (changed) {
            changed = false;
            state.goals.forEach(goal => {
              if (goal.parent && removing.has(goal.parent) && !removing.has(goal.id)) { removing.add(goal.id); changed = true; }
            });
          }
        } else {
          state.goals.forEach(goal => { if (goal.parent === targetId) goal.parent = null; });
        }
        state.goals = state.goals.filter(goal => !removing.has(goal.id));
        await saveSetting(env, "goalBox", state);
        return json({ ok: true });
      }

      // ───────── 에너지 나침반: 생각·목표 원본의 파생 뷰 ─────────
      if (path === "/api/index/state" && request.method === "GET") {
        return json({ ok: true, data: await buildIndexState(env) });
      }

      if (path === "/api/index/scope" && request.method === "POST") {
        const body = await request.json();
        const index = await loadIndexSettings(env);
        index.scope = body.scope === "month" ? "month" : "week";
        await saveSetting(env, "indexSettings", index);
        return json({ ok: true, data: index.scope });
      }

      if (path === "/api/index/add" && request.method === "POST") {
        const body = await request.json();
        const goals = await loadGoalState(env);
        const title = cleanText(body.title, 240);
        if (!title) return json({ ok: false, error: "title is required" }, 400);
        const goal = { id: crypto.randomUUID(), scope: "month", t: title, done: false, parent: null, createdAt: Date.now(), completedAt: null };
        goals.goals.push(goal);
        const index = await loadIndexSettings(env);
        const id = `goal:${goal.id}`;
        index.items[id] = { scope: body.scope === "month" ? "month" : "week", q: null, st: "todo", p: body.parent || null };
        await Promise.all([saveSetting(env, "goalBox", goals), saveSetting(env, "indexSettings", index)]);
        return json({ ok: true, id, data: (await buildIndexState(env)).items.find(item => item.id === id) });
      }

      if (path === "/api/index/update" && request.method === "POST") {
        const body = await request.json();
        const source = parseIndexId(body.id);
        if (!source) return json({ ok: false, error: "invalid id" }, 400);
        const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
        const thoughts = await loadThoughtState(env);
        const goals = await loadGoalState(env);
        const index = await loadIndexSettings(env);
        const itemMeta = index.items[body.id] || {};
        if (source.type === "thought") {
          const thought = thoughts.items.find(item => item.id === source.id);
          if (!thought) return json({ ok: false, error: "not found" }, 404);
          if (patch.t !== undefined) {
            const clean = cleanText(patch.t, 240);
            if (!clean) return json({ ok: false, error: "title is required" }, 400);
            thought.one = clean;
          }
        } else {
          const goal = goals.goals.find(item => item.id === source.id);
          if (!goal) return json({ ok: false, error: "not found" }, 404);
          if (patch.t !== undefined) {
            const clean = cleanText(patch.t, 240);
            if (!clean) return json({ ok: false, error: "title is required" }, 400);
            goal.t = clean;
          }
          if (patch.st !== undefined) setGoalDone(goal, patch.st === "done");
        }
        if (patch.scope !== undefined) itemMeta.scope = patch.scope === "month" ? "month" : "week";
        if (patch.q !== undefined) itemMeta.q = ["S", "D", "M", "O"].includes(patch.q) ? patch.q : null;
        if (patch.st !== undefined) itemMeta.st = ["todo", "doing", "done"].includes(patch.st) ? patch.st : "todo";
        if (patch.p !== undefined) itemMeta.p = patch.p || null;
        index.items[body.id] = itemMeta;
        await Promise.all([
          saveSetting(env, "thoughtBox", thoughts),
          saveSetting(env, "goalBox", goals),
          saveSetting(env, "indexSettings", index),
        ]);
        return json({ ok: true });
      }

      if (path === "/api/index/delete" && request.method === "POST") {
        const { id } = await request.json();
        const source = parseIndexId(id);
        if (!source) return json({ ok: false, error: "invalid id" }, 400);
        const thoughts = await loadThoughtState(env);
        const goals = await loadGoalState(env);
        const index = await loadIndexSettings(env);
        if (source.type === "thought") thoughts.items = thoughts.items.filter(item => item.id !== source.id);
        else {
          goals.goals.forEach(goal => { if (goal.parent === source.id) goal.parent = null; });
          goals.goals = goals.goals.filter(goal => goal.id !== source.id);
        }
        delete index.items[id];
        Object.values(index.items).forEach(meta => { if (meta.p === id) meta.p = null; });
        await Promise.all([
          saveSetting(env, "thoughtBox", thoughts),
          saveSetting(env, "goalBox", goals),
          saveSetting(env, "indexSettings", index),
        ]);
        return json({ ok: true });
      }

      // ───────── 업무 관리 예약 ─────────
      if (path.startsWith("/api/schedules/")) {
        if (!env.__instanceId) return json({ ok: false, error: "위젯 고유 주소의 w 값이 필요합니다." }, 400);

        if (path === "/api/schedules/list" && request.method === "GET") {
          const now = Date.now();
          await settleExpiredScheduleSkips(env, now);
          const { results } = await env.DB.prepare(
            `SELECT s.*,
              (SELECT r.status FROM schedule_runs r
               WHERE r.instance_id = s.instance_id AND r.schedule_id = s.id
               ORDER BY r.updated_at DESC LIMIT 1) AS run_status,
              (SELECT r.error FROM schedule_runs r
               WHERE r.instance_id = s.instance_id AND r.schedule_id = s.id
               ORDER BY r.updated_at DESC LIMIT 1) AS run_error
             FROM schedule_items s
             WHERE s.instance_id = ? AND s.status = 'active'`
          ).bind(env.__instanceId).all();
          const schedules = (results || []).map(row => scheduleListItem(row, now));
          schedules.sort((a, b) => (a.nextOccurrence?.createAt || "9999").localeCompare(b.nextOccurrence?.createAt || "9999") || a.createdAt.localeCompare(b.createdAt));
          return json({ ok: true, data: schedules, serverNow: new Date(now).toISOString() });
        }

        if (path === "/api/schedules/create" && request.method === "POST") {
          const now = new Date();
          const body = await request.json();
          const checked = normalizeScheduleInput({ ...body, createdAt: now.toISOString(), updatedAt: now.toISOString(), status: "active" });
          if (checked.errors.length) return json({ ok: false, error: checked.errors[0] }, 400);
          const schedule = checked.value;
          if (schedule.kind === "once" && seoulDateTimeToMs(schedule.date, schedule.scheduleTime) <= now.getTime()) {
            return json({ ok: false, error: "일회 예약은 현재보다 뒤의 시간을 선택해주세요." }, 400);
          }
          const id = crypto.randomUUID();
          await env.DB.prepare(
            `INSERT INTO schedule_items
              (id, instance_id, kind, name, date_key, weekday, schedule_time, project, lead_minutes,
               title_template, status, skipped_occurrence_key, last_occurrence_key, last_created_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, NULL, ?, ?)`
          ).bind(id, env.__instanceId, schedule.kind, schedule.name, schedule.date, schedule.weekday,
            schedule.scheduleTime, schedule.project, schedule.leadMinutes, JSON.stringify(schedule.titleTemplate),
            schedule.createdAt, schedule.updatedAt).run();
          const row = await loadScheduleRow(env, id);
          return json({ ok: true, data: scheduleListItem(row, now.getTime()) }, 201);
        }

        if (path === "/api/schedules/update" && request.method === "POST") {
          const body = await request.json();
          const current = await loadScheduleRow(env, body?.id);
          if (!current) return json({ ok: false, error: "예약을 찾을 수 없습니다." }, 404);
          const currentSchedule = scheduleRowToModel(current);
          const now = new Date().toISOString();
          const checked = normalizeScheduleInput({
            ...currentSchedule,
            ...body,
            id: current.id,
            createdAt: current.created_at,
            updatedAt: now,
            status: "active",
          });
          if (checked.errors.length) return json({ ok: false, error: checked.errors[0] }, 400);
          const schedule = checked.value;
          if (schedule.kind === "once" && current.last_occurrence_key !== `once:${schedule.date}`
              && seoulDateTimeToMs(schedule.date, schedule.scheduleTime) <= Date.now()) {
            return json({ ok: false, error: "일회 예약은 현재보다 뒤의 시간을 선택해주세요." }, 400);
          }
          await env.DB.prepare(
            `UPDATE schedule_items SET kind = ?, name = ?, date_key = ?, weekday = ?, schedule_time = ?,
               project = ?, lead_minutes = ?, title_template = ?, skipped_occurrence_key = NULL, updated_at = ?
             WHERE id = ? AND instance_id = ?`
          ).bind(schedule.kind, schedule.name, schedule.date, schedule.weekday, schedule.scheduleTime,
            schedule.project, schedule.leadMinutes, JSON.stringify(schedule.titleTemplate), now,
            current.id, env.__instanceId).run();
          const row = await loadScheduleRow(env, current.id);
          return json({ ok: true, data: scheduleListItem(row, Date.now()) });
        }

        if (path === "/api/schedules/skip" && request.method === "POST") {
          const body = await request.json();
          const row = await loadScheduleRow(env, body?.id);
          if (!row) return json({ ok: false, error: "예약을 찾을 수 없습니다." }, 404);
          const schedule = scheduleRowToModel(row);
          const undo = body?.skip === false;
          let occurrenceKey = null;
          if (!undo) {
            const occurrence = currentSkippableOccurrence({ ...schedule, skippedOccurrenceKey: null }, Date.now());
            if (!occurrence) return json({ ok: false, error: "건너뛸 다음 회차가 없습니다." }, 400);
            occurrenceKey = occurrence.key;
          }
          await env.DB.prepare(
            `UPDATE schedule_items SET skipped_occurrence_key = ?, updated_at = ? WHERE id = ? AND instance_id = ?`
          ).bind(occurrenceKey, new Date().toISOString(), row.id, env.__instanceId).run();
          const updated = await loadScheduleRow(env, row.id);
          return json({ ok: true, data: scheduleListItem(updated, Date.now()) });
        }

        if (path === "/api/schedules/delete" && request.method === "POST") {
          const body = await request.json();
          const id = cleanText(body?.id, 120);
          if (!id) return json({ ok: false, error: "예약을 선택해주세요." }, 400);
          const result = await env.DB.prepare(
            `DELETE FROM schedule_items WHERE id = ? AND instance_id = ?`
          ).bind(id, env.__instanceId).run();
          if (!Number(result?.meta?.changes)) return json({ ok: false, error: "예약을 찾을 수 없습니다." }, 404);
          return json({ ok: true });
        }

        return json({ ok: false, error: "schedule endpoint not found" }, 404);
      }

      // ───────── 업무일지 ─────────
      if (path === "/api/worklog/state" && request.method === "GET") {
        return json({ ok: true, data: await loadWorklogState(env) });
      }

      if (path === "/api/worklog/state" && request.method === "POST") {
        const state = normalizeWorklogState(await request.json());
        await saveSetting(env, "worklog", state);
        return json({ ok: true, data: state });
      }

      if (path === "/api/worklog/column-split" && request.method === "POST") {
        const body = await request.json();
        const mode = body?.mode === "life" ? "life" : "work";
        const state = await loadWorklogState(env);
        const value = Number(body?.value);
        const minimum = mode === "life" ? 0.25 : 0.2;
        const maximum = mode === "life" ? 0.75 : 0.82;
        state.columnSplit[mode] = Number.isFinite(value)
          ? Math.min(maximum, Math.max(minimum, value))
          : state.columnSplit[mode];
        await saveSetting(env, "worklog", state);
        return json({ ok: true, data: state });
      }

      // ───────── 중요 업무 ─────────
      if (path === "/api/important-calendar/state" && request.method === "GET") {
        return json({ ok: true, data: await loadImportantCalendarState(env) });
      }

      if (path === "/api/important-calendar/state" && request.method === "POST") {
        const state = normalizeImportantCalendarState(await request.json());
        await saveSetting(env, "importantCalendar", state);
        return json({ ok: true, data: state });
      }

      // ───────── 이번 주 목표 ─────────
      if (path === "/api/weekly-goals/state" && request.method === "GET") {
        return json({ ok: true, data: await loadWeeklyGoalsState(env) });
      }

      if (path === "/api/weekly-goals/state" && request.method === "POST") {
        const state = normalizeWeeklyGoalsState(await request.json());
        await saveSetting(env, "weeklyGoals", state);
        return json({ ok: true, data: state });
      }

      // ───────── 메모장 ─────────
      if (path === "/api/notes/state" && request.method === "GET") {
        return json({ ok: true, data: await loadNotesState(env) });
      }

      if (path === "/api/notes/state" && request.method === "POST") {
        const state = normalizeNotesState(await request.json());
        await saveSetting(env, "notes", state);
        return json({ ok: true, data: state });
      }

      // 기본 화면
      return new Response(
        `<html><body style="font-family:sans-serif;padding:40px;text-align:center">
          <h2>notion-widget API 서버 작동 중 ✅</h2>
        </body></html>`,
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    const now = Number(controller?.scheduledTime) || Date.now();
    ctx.waitUntil(runDueSchedules(env, now));
  },
};

function scheduleRowToModel(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    date: row.date_key,
    weekday: row.weekday,
    scheduleTime: row.schedule_time,
    project: row.project,
    leadMinutes: row.lead_minutes,
    titleTemplate: safeParse(row.title_template, []),
    status: row.status,
    skippedOccurrenceKey: row.skipped_occurrence_key,
    lastOccurrenceKey: row.last_occurrence_key,
    lastCreatedAt: row.last_created_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function scheduleListItem(row, now) {
  const schedule = scheduleRowToModel(row);
  const skipped = currentSkippableOccurrence(schedule, now);
  const next = upcomingOccurrences(schedule, now, 1)[0] || null;
  return {
    ...schedule,
    skippedOccurrence: skipped && skipped.key === schedule.skippedOccurrenceKey ? skipped : null,
    nextOccurrence: next,
    runStatus: row.run_status || null,
    runError: row.run_error || null,
  };
}

async function loadScheduleRow(env, id) {
  const scheduleId = cleanText(id, 120);
  if (!scheduleId || !env.__instanceId) return null;
  return env.DB.prepare(
    `SELECT * FROM schedule_items WHERE id = ? AND instance_id = ?`
  ).bind(scheduleId, env.__instanceId).first();
}

async function settleExpiredScheduleSkips(env, now) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM schedule_items
     WHERE instance_id = ? AND status = 'active' AND skipped_occurrence_key IS NOT NULL`
  ).bind(env.__instanceId).all();
  const statements = [];
  for (const row of results || []) {
    const schedule = scheduleRowToModel(row);
    const action = expiredSkipAction(schedule, now);
    if (!action) continue;
    if (action === "complete") {
      statements.push(env.DB.prepare(
        `UPDATE schedule_items SET status = 'completed', updated_at = ? WHERE id = ? AND instance_id = ?`
      ).bind(new Date(now).toISOString(), schedule.id, env.__instanceId));
    } else {
      statements.push(env.DB.prepare(
        `UPDATE schedule_items
         SET last_occurrence_key = skipped_occurrence_key, skipped_occurrence_key = NULL, updated_at = ?
         WHERE id = ? AND instance_id = ?`
      ).bind(new Date(now).toISOString(), schedule.id, env.__instanceId));
    }
  }
  if (statements.length) await env.DB.batch(statements);
}

async function runDueSchedules(env, now) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM schedule_items WHERE status = 'active' ORDER BY created_at ASC`
  ).all();
  const byInstance = new Map();
  for (const row of results || []) {
    if (!byInstance.has(row.instance_id)) byInstance.set(row.instance_id, []);
    byInstance.get(row.instance_id).push(row);
  }
  for (const [instanceId, rows] of byInstance) {
    const scoped = instanceEnv(env, instanceId);
    await settleExpiredScheduleSkips(scoped, now);
    for (const row of rows) {
      const occurrence = dueOccurrence(scheduleRowToModel(row), now);
      if (!occurrence) continue;
      await processScheduleOccurrence(env, row, occurrence, now);
    }
  }
}

async function processScheduleOccurrence(env, row, occurrence, now) {
  const runId = crypto.randomUUID();
  const nowIso = new Date(now).toISOString();
  const leaseUntil = new Date(now + 5 * 60_000).toISOString();
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO schedule_runs
      (id, instance_id, schedule_id, occurrence_key, scheduled_at, status, attempt_count,
       lease_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'claimed', 1, ?, ?, ?)`
  ).bind(runId, row.instance_id, row.id, occurrence.key, occurrence.scheduledAt,
    leaseUntil, nowIso, nowIso).run();

  let claimed = Number(inserted?.meta?.changes) > 0;
  let run = claimed
    ? { id: runId, status: "claimed", lease_until: leaseUntil }
    : await env.DB.prepare(
      `SELECT * FROM schedule_runs WHERE instance_id = ? AND schedule_id = ? AND occurrence_key = ?`
    ).bind(row.instance_id, row.id, occurrence.key).first();
  if (!run || run.status === "succeeded") return;

  if (!claimed) {
    const lease = Date.parse(run.lease_until || "");
    if (run.status === "claimed" && Number.isFinite(lease) && lease > now) return;
    const acquired = await env.DB.prepare(
      `UPDATE schedule_runs
       SET status = 'claimed', attempt_count = attempt_count + 1, lease_until = ?, updated_at = ?
       WHERE id = ? AND status != 'succeeded' AND (lease_until IS NULL OR lease_until <= ? OR status IN ('failed', 'uncertain'))`
    ).bind(leaseUntil, nowIso, run.id, nowIso).run();
    claimed = Number(acquired?.meta?.changes) > 0;
    if (!claimed) return;
  }

  const schedule = scheduleRowToModel(row);
  const marker = `${row.instance_id}:${row.id}:${occurrence.key}`;
  let pageId = null;
  try {
    const config = notionScheduleConfig(env);
    pageId = await findNotionPageByMarker(config, marker);
    if (!pageId) pageId = await createNotionSchedulePage(config, schedule, occurrence, marker);
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE schedule_runs
         SET status = 'succeeded', notion_page_id = ?, error = NULL, lease_until = NULL, updated_at = ?
         WHERE id = ?`
      ).bind(pageId, new Date().toISOString(), run.id),
      env.DB.prepare(
        `UPDATE schedule_items
         SET last_occurrence_key = ?, last_created_at = ?, skipped_occurrence_key = NULL,
             status = CASE WHEN kind = 'once' THEN 'completed' ELSE status END, updated_at = ?
         WHERE id = ? AND instance_id = ?`
      ).bind(occurrence.key, new Date().toISOString(), new Date().toISOString(), row.id, row.instance_id),
    ]);
  } catch (error) {
    const uncertain = error?.uncertain === true;
    await env.DB.prepare(
      `UPDATE schedule_runs SET status = ?, error = ?, lease_until = NULL, updated_at = ? WHERE id = ?`
    ).bind(uncertain ? "uncertain" : "failed", safeScheduleError(error), new Date().toISOString(), run.id).run();
  }
}

export function notionScheduleConfig(env) {
  const values = {
    token: String(env.NOTION_TOKEN || "").trim(),
    dataSourceId: String(env.NOTION_DATABASE_ID || "").trim(),
    titleProperty: String(env.NOTION_TITLE_PROPERTY || "").trim(),
    dateProperty: String(env.NOTION_DATE_PROPERTY || "").trim(),
    projectProperty: String(env.NOTION_PROJECT_PROPERTY || "").trim(),
    occurrenceProperty: String(env.NOTION_OCCURRENCE_PROPERTY || "").trim(),
    projectType: String(env.NOTION_PROJECT_PROPERTY_TYPE || "select").trim(),
  };
  const missing = Object.entries(values)
    .filter(([key, value]) => key !== "projectType" && !value)
    .map(([key]) => key);
  if (missing.length) throw new Error(`Notion 연결 설정이 필요합니다: ${missing.join(", ")}`);
  if (!['select', 'rich_text'].includes(values.projectType)) {
    throw new Error("NOTION_PROJECT_PROPERTY_TYPE은 select 또는 rich_text여야 합니다.");
  }
  return values;
}

function notionHeaders(config) {
  return {
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_API_VERSION,
  };
}

async function notionRequest(url, init) {
  let response;
  try {
    response = await fetch(url, init);
  } catch (_) {
    const error = new Error("Notion 네트워크 응답을 확인하지 못했습니다.");
    error.uncertain = true;
    throw error;
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Notion API ${response.status}: ${cleanText(payload?.message, 280) || "요청 실패"}`);
    error.uncertain = response.status >= 500;
    throw error;
  }
  return payload;
}

async function findNotionPageByMarker(config, marker) {
  const payload = await notionRequest(
    `https://api.notion.com/v1/data_sources/${encodeURIComponent(config.dataSourceId)}/query`,
    {
      method: "POST",
      headers: notionHeaders(config),
      body: JSON.stringify({
        page_size: 1,
        filter: {
          property: config.occurrenceProperty,
          rich_text: { equals: marker },
        },
      }),
    }
  );
  return payload?.results?.[0]?.id || null;
}

async function createNotionSchedulePage(config, schedule, occurrence, marker) {
  const projectValue = config.projectType === "select"
    ? { type: "select", select: { name: schedule.project } }
    : { type: "rich_text", rich_text: [{ type: "text", text: { content: schedule.project } }] };
  const payload = await notionRequest("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(config),
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: config.dataSourceId },
      properties: {
        [config.titleProperty]: {
          type: "title",
          title: [{ type: "text", text: { content: occurrence.title || schedule.name } }],
        },
        [config.dateProperty]: {
          type: "date",
          date: { start: occurrence.scheduledAtSeoul },
        },
        [config.projectProperty]: projectValue,
        [config.occurrenceProperty]: {
          type: "rich_text",
          rich_text: [{ type: "text", text: { content: marker } }],
        },
      },
    }),
  });
  if (!payload?.id) throw new Error("Notion 페이지 ID가 응답에 없습니다.");
  return payload.id;
}

function safeScheduleError(error) {
  return cleanText(error?.message || error || "예약 실행 실패", 360, false);
}

const INSTANCE_RE = /^w_[A-Za-z0-9_-]{24,176}$/;

function isValidInstanceId(value) {
  return INSTANCE_RE.test(String(value || ""));
}

function instanceMetaKey(instanceId) {
  return `instance-meta:${instanceId}`;
}

function instanceEnv(env, instanceId) {
  const scoped = Object.create(env);
  Object.defineProperty(scoped, "__instanceId", { value: instanceId, enumerable: false });
  return scoped;
}

function diaryStorageDate(env, date) {
  return env.__instanceId ? `instance:${env.__instanceId}:${date}` : date;
}

function diaryPublicDate(env, date) {
  return env.__instanceId ? String(date || "").slice(`instance:${env.__instanceId}:`.length) : date;
}

function validDiaryRangeKey(value) {
  return value === "0000-01-01" || value === "9999-12-31" || validDateKey(value);
}

function parseDiary(row, env) {
  return {
    date: diaryPublicDate(env, row.date),
    mode: row.mode,
    mood: row.mood,
    achievements: safeParse(row.achievements, []),
    images: safeParse(row.images, []),
    quest: safeParse(row.quest, null),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
function normalizeMoodWords(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(word => String(word).trim().slice(0, 20))
    .filter(Boolean))].slice(0, 16);
}

async function loadSetting(env, key, fallback) {
  return loadRawSetting(env, settingStorageKey(env, key), fallback);
}

async function loadRawSetting(env, key, fallback) {
  const row = await env.DB.prepare(`SELECT value FROM widget_settings WHERE key = ?`).bind(key).first();
  return safeParse(row?.value, fallback);
}

async function saveSetting(env, key, value) {
  return saveRawSetting(env, settingStorageKey(env, key), value);
}

function settingStorageKey(env, key) {
  return env.__instanceId ? `instance:${env.__instanceId}:${key}` : key;
}

async function saveRawSetting(env, key, value) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO widget_settings (key, value, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`
  ).bind(key, JSON.stringify(value), now).run();
}

function cleanText(value, max, trim = true) {
  const text = String(value ?? "");
  return (trim ? text.trim() : text).slice(0, max);
}

function defaultThoughtState() {
  return { items: [], cats: ["아이디어", "방향성"], catOpened: {} };
}

function cleanCategory(value, cats) {
  const category = cleanText(value, 30);
  return cats.includes(category) ? category : cats[0];
}

function normalizeThoughtState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const cats = [];
  (Array.isArray(source.cats) ? source.cats : ["아이디어", "방향성"]).forEach(value => {
    const category = cleanText(value, 30);
    if (category && !cats.includes(category) && cats.length < 10) cats.push(category);
  });
  if (!cats.length) cats.push("아이디어", "방향성");
  const items = (Array.isArray(source.items) ? source.items : []).map(value => {
    const one = cleanText(value?.one ?? value?.content, 240);
    if (!one) return null;
    const created = Number(value?.created) || Date.parse(value?.createdAt) || Date.now();
    const opened = Number(value?.opened) || Date.parse(value?.updatedAt) || created;
    return {
      id: String(value?.id || crypto.randomUUID()),
      one,
      detail: cleanText(value?.detail, 4000, false),
      cat: cleanCategory(value?.cat ?? value?.category, cats),
      created,
      opened,
    };
  }).filter(Boolean);
  const catOpened = {};
  cats.forEach(category => {
    const value = Number(source.catOpened?.[category]);
    if (value > 0) catOpened[category] = value;
  });
  return { items, cats, catOpened };
}

async function loadThoughtState(env) {
  return normalizeThoughtState(await loadSetting(env, "thoughtBox", defaultThoughtState()));
}

function normalizeGoalScope(value) {
  return ["year", "h1", "h2", "month"].includes(value) ? value : "month";
}

function normalizeGoalState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    goals: (Array.isArray(source.goals) ? source.goals : []).map(value => {
      const title = cleanText(value?.t ?? value?.title, 240);
      if (!title) return null;
      return {
        id: String(value?.id || crypto.randomUUID()),
        scope: normalizeGoalScope(value?.scope),
        t: title,
        done: Boolean(value?.done),
        parent: value?.parent ?? value?.parentId ?? null,
        createdAt: Number(value?.createdAt) || Date.now(),
        completedAt: value?.done && value?.completedAt ? String(value.completedAt) : null,
      };
    }).filter(Boolean),
  };
}

async function loadGoalState(env) {
  return normalizeGoalState(await loadSetting(env, "goalBox", { goals: [] }));
}

function setGoalDone(goal, done) {
  if (done && !goal.done) goal.completedAt = new Date().toISOString();
  if (!done) goal.completedAt = null;
  goal.done = done;
}

function normalizeIndexSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const items = {};
  Object.entries(source.items && typeof source.items === "object" ? source.items : {}).forEach(([id, value]) => {
    if (!parseIndexId(id)) return;
    items[id] = {
      scope: value?.scope === "month" ? "month" : "week",
      q: ["S", "D", "M", "O"].includes(value?.q) ? value.q : null,
      st: ["todo", "doing", "done"].includes(value?.st) ? value.st : "todo",
      p: value?.p ? String(value.p) : null,
    };
  });
  return { scope: source.scope === "month" ? "month" : "week", items };
}

async function loadIndexSettings(env) {
  return normalizeIndexSettings(await loadSetting(env, "indexSettings", { scope: "week", items: {} }));
}

function parseIndexId(value) {
  const match = /^(thought|goal):(.+)$/.exec(String(value || ""));
  return match ? { type: match[1], id: match[2] } : null;
}

async function buildIndexState(env) {
  const [thoughts, goals, index] = await Promise.all([
    loadThoughtState(env),
    loadGoalState(env),
    loadIndexSettings(env),
  ]);
  const thoughtItems = thoughts.items.filter(item => item.cat === "방향성").map(item => {
    const id = `thought:${item.id}`;
    const meta = index.items[id] || {};
    return { id, source: "thought", sourceId: item.id, scope: meta.scope === "month" ? "month" : "week", q: meta.q || null, st: meta.st || "todo", t: item.one, p: meta.p || null };
  });
  const goalItems = goals.goals.map(goal => {
    const id = `goal:${goal.id}`;
    const meta = index.items[id] || {};
    const parent = goal.parent ? `goal:${goal.parent}` : null;
    return { id, source: "goal", sourceId: goal.id, scope: meta.scope || index.scope, q: meta.q || null, st: goal.done ? "done" : (meta.st === "doing" ? "doing" : "todo"), t: goal.t, p: meta.p || parent };
  });
  return { items: [...thoughtItems, ...goalItems], scope: index.scope };
}

function validDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3]);
}

function normalizeClockTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(String(value).trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeWorklogLastUsed(raw) {
  const q = Number(raw?.q);
  return {
    proj: cleanText(raw?.proj, 80) || "미분류",
    q: Number.isInteger(q) && q >= 1 && q <= 4 ? q : null,
  };
}

function defaultWorklogState() {
  return {
    mode: "work",
    tasks: [],
    projects: [],
    lastRollWeek: "",
    bannerDismissedWeek: "",
    lastRollCount: 0,
    lastUsed: {
      work: { proj: "미분류", q: null },
      life: { proj: "미분류", q: null },
    },
    columnSplit: { work: 0.73, life: 6 / 11 },
    manualOrder: {},
  };
}

function normalizeWorklogState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const ids = new Set();
  const tasks = (Array.isArray(source.tasks) ? source.tasks : []).map(value => {
    const id = cleanText(value?.id, 120);
    if (!id || ids.has(id) || !validDateKey(value?.date)) return null;
    ids.add(id);
    const q = Number(value?.q);
    const progress = Number(value?.progress);
    const estimate = Number(value?.est);
    const status = ["doing", "done", "wait"].includes(value?.status) ? value.status : "wait";
    const done = value?.done === true || status === "done";
    return {
      id,
      mode: value?.mode === "life" ? "life" : "work",
      date: value.date,
      proj: cleanText(value?.proj, 80),
      q: Number.isInteger(q) && q >= 1 && q <= 4 ? q : null,
      title: cleanText(value?.title, 240),
      due: validDateKey(value?.due) ? value.due : null,
      start: normalizeClockTime(value?.start),
      end: normalizeClockTime(value?.end),
      progress: value?.progress !== null && value?.progress !== undefined && value?.progress !== "" && Number.isFinite(progress) && progress >= 0 ? progress : null,
      est: value?.est !== null && value?.est !== undefined && value?.est !== "" && Number.isFinite(estimate) && estimate >= 0 ? estimate : null,
      status: done ? "done" : status,
      done,
      memo: cleanText(value?.memo, 4000),
      rolledFrom: validDateKey(value?.rolledFrom) ? value.rolledFrom : null,
      progressTouched: value?.progressTouched === true,
    };
  }).filter(Boolean);
  const weekKey = value => /^\d{4}-W\d{2}$/.test(String(value || "")) ? String(value) : "";
  const lastUsed = {
    work: normalizeWorklogLastUsed(source.lastUsed?.work),
    life: normalizeWorklogLastUsed(source.lastUsed?.life),
  };
  const projects = [];
  [
    ...(Array.isArray(source.projects) ? source.projects : []),
    lastUsed.work.proj,
    lastUsed.life.proj,
    ...tasks.map(task => task.proj),
  ].forEach(value => {
    const project = cleanText(value, 30);
    if (!project || project === "미분류" || projects.includes(project) || projects.length >= 3) return;
    projects.push(project);
  });
  const split = (value, fallback, minimum, maximum) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  };
  const taskById = new Map(tasks.map(task => [task.id,task]));
  const manualOrder = {};
  if (source.manualOrder && typeof source.manualOrder === "object") {
    Object.entries(source.manualOrder).slice(0, 180).forEach(([key,value]) => {
      const match = /^(work|life):(\d{4}-\d{2}-\d{2})$/.exec(key);
      if (!match || !Array.isArray(value)) return;
      const ids = [];
      value.forEach(id => {
        const task = taskById.get(String(id || ""));
        if (!task || task.mode !== match[1] || task.date !== match[2] || ids.includes(task.id)) return;
        ids.push(task.id);
      });
      if (ids.length) manualOrder[key] = ids;
    });
  }
  return {
    mode: source.mode === "life" ? "life" : "work",
    tasks,
    projects,
    lastRollWeek: weekKey(source.lastRollWeek),
    bannerDismissedWeek: weekKey(source.bannerDismissedWeek),
    lastRollCount: Number.isFinite(Number(source.lastRollCount)) ? Math.max(0, Math.floor(Number(source.lastRollCount))) : 0,
    lastUsed,
    columnSplit: {
      work: split(source.columnSplit?.work, 0.73, 0.2, 0.82),
      life: split(source.columnSplit?.life, 6 / 11, 0.25, 0.75),
    },
    manualOrder,
  };
}

async function loadWorklogState(env) {
  return normalizeWorklogState(await loadSetting(env, "worklog", defaultWorklogState()));
}

function normalizeImportantCalendarState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const ids = new Set();
  const tasks = (Array.isArray(source.tasks) ? source.tasks : []).map(value => {
    const id = cleanText(value?.id, 120);
    const title = cleanText(value?.title, 240);
    if (!id || ids.has(id) || !title || !validDateKey(value?.due)) return null;
    ids.add(id);
    const createdAt = Number(value?.createdAt);
    const updatedAt = Number(value?.updatedAt);
    return {
      id,
      title,
      proj: cleanText(value?.proj, 80),
      status: ["wait", "doing", "done"].includes(value?.status) ? value.status : "wait",
      due: value.due,
      memo: cleanText(value?.memo, 4000),
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
    };
  }).filter(Boolean);
  return { tasks };
}

async function loadImportantCalendarState(env) {
  return normalizeImportantCalendarState(await loadSetting(env, "importantCalendar", { tasks: [] }));
}

function normalizeWeeklyGoalsState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  let seq = Number.isFinite(Number(source.seq)) ? Math.max(0, Math.floor(Number(source.seq))) : 0;
  const ids = new Set();
  const items = (Array.isArray(source.items) ? source.items : []).map(value => {
    let id = Number(value?.id);
    if (!Number.isInteger(id) || id <= 0 || ids.has(id)) id = ++seq;
    ids.add(id);
    seq = Math.max(seq, id);
    const text = cleanText(value?.text, 240);
    if (!text || !["work", "life"].includes(value?.m)) return null;
    return { id, m: value.m, done: value?.done === true, text };
  }).filter(Boolean).slice(0, 5);
  return { week: cleanText(source.week, 24), items, seq };
}

async function loadWeeklyGoalsState(env) {
  return normalizeWeeklyGoalsState(await loadSetting(env, "weeklyGoals", { week: "", items: [], seq: 0 }));
}

function normalizeNotesState(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const ids = new Set();
  const items = (Array.isArray(source.items) ? source.items : []).map(value => {
    const id = cleanText(value?.id, 120);
    const text = cleanText(value?.text, 1000);
    if (!id || ids.has(id) || !text) return null;
    ids.add(id);
    return { id, text, done: value?.done === true };
  }).filter(Boolean);
  return { items };
}

async function loadNotesState(env) {
  return normalizeNotesState(await loadSetting(env, "notes", { items: [] }));
}
