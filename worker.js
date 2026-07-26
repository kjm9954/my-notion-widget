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
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    try {
      // ───────── 일기 ─────────
      if (path === "/api/diary/save" && request.method === "POST") {
        const d = await request.json();
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO diary (date, mode, mood, achievements, images, quest, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET
             mode=excluded.mode, mood=excluded.mood, achievements=excluded.achievements,
             images=excluded.images, quest=excluded.quest, updatedAt=excluded.updatedAt`
        ).bind(d.date, d.mode || null, d.mood || null,
               JSON.stringify(d.achievements || []), JSON.stringify(d.images || []),
               JSON.stringify(d.quest || null), d.createdAt || now, now).run();
        return json({ ok: true });
      }

      if (path === "/api/diary/get") {
        const date = url.searchParams.get("date");
        const row = await env.DB.prepare(`SELECT * FROM diary WHERE date = ?`).bind(date).first();
        return json({ ok: true, data: row ? parseDiary(row) : null });
      }

      if (path === "/api/diary/range") {
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");
        const { results } = await env.DB.prepare(
          `SELECT * FROM diary WHERE date >= ? AND date <= ? ORDER BY date ASC`
        ).bind(start, end).all();
        return json({ ok: true, data: (results || []).map(parseDiary) });
      }

      if (path === "/api/diary/dates") {
        const { results } = await env.DB.prepare(`SELECT date FROM diary ORDER BY date ASC`).all();
        return json({ ok: true, data: (results || []).map(r => r.date) });
      }

      if (path === "/api/diary/delete" && request.method === "POST") {
        const { date } = await request.json();
        await env.DB.prepare(`DELETE FROM diary WHERE date = ?`).bind(date).run();
        return json({ ok: true });
      }

      // ───────── 감정 단어 ─────────
      if (path === "/api/settings/mood-words" && request.method === "GET") {
        const row = await env.DB.prepare(`SELECT value FROM widget_settings WHERE key = ?`)
          .bind("moodWords").first();
        return json({ ok: true, data: normalizeMoodWords(safeParse(row?.value, [])) });
      }

      if (path === "/api/settings/mood-words" && request.method === "POST") {
        const body = await request.json();
        if (!Array.isArray(body?.words)) return json({ ok: false, error: "words must be an array" }, 400);
        const words = normalizeMoodWords(body?.words);
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO widget_settings (key, value, updatedAt) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt`
        ).bind("moodWords", JSON.stringify(words), now).run();
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
};

function parseDiary(row) {
  return {
    date: row.date,
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
  const row = await env.DB.prepare(`SELECT value FROM widget_settings WHERE key = ?`).bind(key).first();
  return safeParse(row?.value, fallback);
}

async function saveSetting(env, key, value) {
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
