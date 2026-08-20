import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  loadReadingLibrary,
  mergeReadingQuotes,
  normalizeBookOneLine,
  normalizeReadingBookPage,
  normalizeNestedQuotePage,
} from "../reading-notion.js";

function richText(value) {
  return [{ plain_text:value, type:"text", text:{ content:value } }];
}

test("reading count excludes only dropped books while recent books stay completed-only", async () => {
  const html = await readFile(new URL("../reading-notes/reading-count.html", import.meta.url), "utf8");
  assert.match(html, /const counted = .*filter\(book => book\.status !== 'dropped'\)/);
  assert.match(html, /const finished = counted\.filter\(book => book\.status === 'done'\)/);
  assert.match(html, /total:counted\.length/);
  assert.match(html, /counted\.forEach\(book =>/);
  assert.match(html, /recent:finished\.slice\(\)/);
});

test("quote drawers render the full filtered list inside their scroll areas", async () => {
  const [largeDrawer, compactDrawer] = await Promise.all([
    readFile(new URL("../reading-notes/quote-drawer.html", import.meta.url), "utf8"),
    readFile(new URL("../reading-notes/drawer.html", import.meta.url), "utf8"),
  ]);
  assert.match(largeDrawer, /const result = filteredItems\(\);/);
  assert.doesNotMatch(largeDrawer, /filteredItems\(\)\.slice/);
  assert.match(compactDrawer, /function visibleQuotes\(\) \{ return filteredQuotes\(\); \}/);
  assert.doesNotMatch(compactDrawer, /filteredQuotes\(\)\.slice/);
});

test("does not count the keep-only 인생책 tag as a completed book", () => {
  const book = normalizeReadingBookPage({
    id:"book-life",
    properties:{
      "제목":{ type:"title", title:richText("인생책") },
      "상태":{ type:"multi_select", multi_select:[{ name:"인생책" }] },
      "분야":{ type:"multi_select", multi_select:[] },
    },
  });
  assert.equal(book.status, "owned");
  assert.equal(book.isLifeBook, true);
});

test("normalizes the summary callout in a per-book quote database", () => {
  const quote = normalizeNestedQuotePage({
    id:"note-1",
    created_time:"2026-08-20T00:00:00.000Z",
    properties:{ "이름":{ type:"title", title:richText("[P. 117] 그릿의 성장 비밀") } },
  }, "book-1", [{
    id:"callout-1",
    type:"callout",
    callout:{ rich_text:richText("summary                            \n우리는 환경에 적응하며 성장한다.") },
  }]);

  assert.equal(quote.id, "nested:note-1");
  assert.equal(quote.bookId, "book-1");
  assert.equal(quote.page, "117");
  assert.equal(quote.text, "우리는 환경에 적응하며 성장한다.");
  assert.equal(quote.readOnly, true);
  assert.equal(quote.source, "nested-database");
});

test("ignores the untouched 생각 한 줄 template placeholder", () => {
  const quote = normalizeNestedQuotePage({
    id:"note-placeholder",
    properties:{ "이름":{ type:"title", title:richText("[P. 1] 메모") } },
  }, "book-1", [{
    type:"callout",
    callout:{ rich_text:richText("summary\n생각 한 줄") },
  }]);
  assert.equal(quote, null);
});

test("includes each book's one-line property and removes exact per-book duplicates", () => {
  const oneLine = normalizeBookOneLine({
    id:"book-1",
    one:"  자신이 사랑하는 일을 오래 지속시켜야 한다.  ",
    edited:"2026-08-20T00:00:00.000Z",
  });
  assert.equal(oneLine.text, "자신이 사랑하는 일을 오래 지속시켜야 한다.");
  assert.equal(oneLine.note, "이 책의 한 줄");
  assert.equal(oneLine.source, "book-one-line");
  assert.equal(oneLine.readOnly, true);

  const merged = mergeReadingQuotes([], [oneLine, { ...oneLine, id:"nested:duplicate", source:"nested-database" }]);
  assert.equal(merged.length, 1);
});

test("loads quotes from each book's nested quote database instead of top-level callouts", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    calls.push(path);
    let payload;
    if (path === "/v1/data_sources/books/query") {
      payload = { results:[{
        id:"book-1",
        created_time:"2026-08-01T00:00:00.000Z",
        last_edited_time:"2026-08-01T00:00:00.000Z",
        properties:{
          "제목":{ type:"title", title:richText("그릿") },
          "상태":{ type:"multi_select", multi_select:[{ name:"완독" }] },
          "분야":{ type:"multi_select", multi_select:[] },
          "이 책의 한 줄":{ type:"rich_text", rich_text:richText("이 책의 한 줄도 함께 읽는다.") },
        },
      }], has_more:false };
    } else if (path === "/v1/data_sources/quotes/query" || path === "/v1/data_sources/years/query") {
      payload = { results:[], has_more:false };
    } else if (path === "/v1/blocks/book-1/children") {
      payload = { results:[{ id:"database-1", type:"child_database", child_database:{ title:"필사 갤러리" } }], has_more:false };
    } else if (path === "/v1/databases/database-1") {
      payload = { data_sources:[{ id:"nested-source-1" }] };
    } else if (path === "/v1/data_sources/nested-source-1/query") {
      payload = { results:[{
        id:"note-1",
        created_time:"2026-08-20T00:00:00.000Z",
        properties:{ "이름":{ type:"title", title:richText("[p.38] 그릿이란 무엇인가?") } },
      }], has_more:false };
    } else if (path === "/v1/blocks/note-1/children") {
      payload = { results:[{
        id:"summary-1",
        type:"callout",
        callout:{ rich_text:richText("summary\n열정과 끈기는 목표를 오래 붙드는 힘이다.") },
      }], has_more:false };
    } else {
      throw new Error(`unexpected Notion request: ${path}`);
    }
    return new Response(JSON.stringify(payload), {
      status:200,
      headers:{ "content-type":"application/json" },
    });
  };

  try {
    const result = await loadReadingLibrary({
      NOTION_TOKEN:"secret",
      NOTION_READING_BOOKS_DATA_SOURCE_ID:"books",
      NOTION_READING_QUOTES_DATA_SOURCE_ID:"quotes",
      NOTION_READING_YEARS_DATA_SOURCE_ID:"years",
    }, { fresh:true });
    assert.equal(result.quotes.length, 2);
    assert.deepEqual(new Set(result.quotes.map(quote => quote.text)), new Set([
      "열정과 끈기는 목표를 오래 붙드는 힘이다.",
      "이 책의 한 줄도 함께 읽는다.",
    ]));
    assert.ok(result.quotes.every(quote => quote.bookId === "book-1"));
    assert.ok(calls.includes("/v1/databases/database-1"));
    assert.ok(calls.includes("/v1/data_sources/nested-source-1/query"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
