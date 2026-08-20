import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function filesUnder(folder) {
  const entries = await readdir(folder, { withFileTypes:true });
  const nested = await Promise.all(entries
    .filter(entry => entry.name !== ".git" && entry.name !== "node_modules")
    .map(entry => entry.isDirectory() ? filesUnder(resolve(folder, entry.name)) : [resolve(folder, entry.name)]));
  return nested.flat();
}

const htmlFiles = (await filesUnder(root)).filter(file => extname(file).toLowerCase() === ".html");

test("every inline widget script parses", async () => {
  const failures = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter(match => !/\bsrc\s*=|type\s*=\s*["'](?:application\/json|importmap|module)["']/i.test(match[1]));
    scripts.forEach((match, index) => {
      try { new vm.Script(match[2], { filename:`${file}#inline-${index + 1}` }); }
      catch (error) { failures.push(error.message); }
    });
  }
  assert.deepEqual(failures, []);
});

test("every local HTML asset reference resolves to a file", async () => {
  const missing = [];
  for (const file of htmlFiles) {
    const html = await readFile(file, "utf8");
    const references = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
    for (const reference of references) {
      if (/^(?:[a-z]+:|\/\/|#|data:)/i.test(reference)) continue;
      const clean = reference.split(/[?#]/, 1)[0];
      if (!clean || /\$\{|\{\{/.test(clean)) continue;
      const target = resolve(dirname(file), decodeURIComponent(clean));
      try { await access(target); }
      catch { missing.push(`${file}: ${reference}`); }
    }
  }
  assert.deepEqual(missing, []);
});
