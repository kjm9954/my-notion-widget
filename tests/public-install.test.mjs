import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker, { publicWidgetInstanceUrl } from "../worker.js";

const INSTANCE = "w_abcdefghijklmnopqrstuvwxyz123456";
const OTHER_INSTANCE = "w_654321zyxwvutsrqponmlkjihgfedcba";

test("공개 템플릿의 직접 위젯 주소에 개인 인스턴스를 자동으로 붙인다", () => {
  assert.equal(
    publicWidgetInstanceUrl(
      "https://kjm9954.github.io/my-notion-widget/Worklog/worklog.html",
      INSTANCE,
    ),
    `https://kjm9954.github.io/my-notion-widget/Worklog/worklog.html?w=${INSTANCE}`,
  );
  assert.equal(
    publicWidgetInstanceUrl("https://kjm9954.github.io/my-notion-widget/", INSTANCE),
    `https://kjm9954.github.io/my-notion-widget/?w=${INSTANCE}`,
  );
});

test("placeholder와 기존 개인 키를 새 복제본의 키로 교체한다", () => {
  const placeholder = publicWidgetInstanceUrl(
    "https://kjm9954.github.io/my-notion-widget/public-connect.html?from=growth-page%2Fgoals.html&w=NOTION_WIDGET_INSTANCE_ID",
    INSTANCE,
  );
  const replaced = publicWidgetInstanceUrl(
    `https://kjm9954.github.io/my-notion-widget/game-log-diary/today.html?w=${OTHER_INSTANCE}`,
    INSTANCE,
  );
  assert.equal(new URL(placeholder).searchParams.get("w"), INSTANCE);
  assert.equal(new URL(placeholder).searchParams.get("from"), "growth-page/goals.html");
  assert.equal(new URL(replaced).searchParams.get("w"), INSTANCE);
});

test("다른 사이트와 위젯이 아닌 경로는 수정하지 않는다", () => {
  const foreign = "https://example.com/widget.html?w=NOTION_WIDGET_INSTANCE_ID";
  const unknown = "https://kjm9954.github.io/my-notion-widget/private/admin.html";
  assert.equal(publicWidgetInstanceUrl(foreign, INSTANCE), foreign);
  assert.equal(publicWidgetInstanceUrl(unknown, INSTANCE), unknown);
});

test("연결 페이지는 로컬 원본 데이터를 읽거나 지우지 않는다", async () => {
  const html = await readFile(new URL("../public-connect.html", import.meta.url), "utf8");
  assert.match(html, /Notion으로 연결하기/);
  assert.match(html, /notion-widget\.wldnjsdkk\.workers\.dev\/auth\/notion\/start/);
  assert.doesNotMatch(html, /localStorage|removeItem|clear\s*\(/);
});

test("OAuth 시작은 만료되는 state를 저장하고 Notion 인증으로 이동한다", async () => {
  let saved = null;
  const env = {
    KV: {
      async put(key, value, options) { saved = { key, value, options }; },
    },
    NOTION_CLIENT_ID: "client-id",
    NOTION_REDIRECT_URI: "https://worker.example/auth/notion/callback",
  };
  const response = await worker.fetch(
    new Request("https://worker.example/auth/notion/start?return_to=https%3A%2F%2Fexample.com"),
    env,
    {},
  );
  const location = new URL(response.headers.get("location"));
  assert.equal(response.status, 302);
  assert.equal(location.origin + location.pathname, "https://api.notion.com/v1/oauth/authorize");
  assert.equal(location.searchParams.get("client_id"), "client-id");
  assert.equal(location.searchParams.get("redirect_uri"), env.NOTION_REDIRECT_URI);
  assert.match(saved.key, /^oauth-state:/);
  assert.equal(saved.options.expirationTtl, 600);
  assert.equal(JSON.parse(saved.value).returnTo, "https://example.com");
});
