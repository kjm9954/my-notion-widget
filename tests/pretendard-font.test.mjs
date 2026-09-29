import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const theme=new URL('../cream-olive-garden/',import.meta.url);
const pages=['worklog-cream-olive-garden','notes','weekly-goals','deadlines','week-review','month-calendar'];

test('all six widgets preload the same bundled font and no longer depend on a font CDN',async()=>{
  for(const page of pages) {
    const html=await readFile(new URL(`Worklog/${page}.html`,theme),'utf8');
    assert.match(html,/<link rel="stylesheet" href="\.\.\/pretendard\.css\?v=20260929-selfhost-font">/,page);
    assert.match(html,/<link rel="preload" href="\.\.\/assets\/fonts\/pretendard-1\.3\.9\/PretendardVariable\.woff2" as="font" type="font\/woff2" crossorigin>/,page);
    assert.doesNotMatch(html,/https?:[^"']*(?:jsdelivr|fonts\.google|unpkg|cdnjs)/,page);
  }
});

test('official full Pretendard variable binary is unmodified and ships its license',async()=>{
  const font=await readFile(new URL('assets/fonts/pretendard-1.3.9/PretendardVariable.woff2',theme));
  assert.equal(font.toString('ascii',0,4),'wOF2');
  assert.equal(font.length,2057688);
  assert.equal(createHash('sha256').update(font).digest('hex'),'9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4');
  const license=await readFile(new URL('assets/fonts/pretendard-1.3.9/OFL.txt',theme),'utf8');
  assert.match(license,/Copyright \(c\) 2021, Kil Hyung-jin/);
  assert.match(license,/SIL OPEN FONT LICENSE Version 1\.1/);
});

test('shared font covers form controls, loading, tooltips and store errors without a preview subset',async()=>{
  const css=await readFile(new URL('pretendard.css',theme),'utf8');
  assert.match(css,/font-weight:45 920/);
  assert.match(css,/src:url\("\.\/assets\/fonts\/pretendard-1\.3\.9\/PretendardVariable\.woff2"\)/);
  assert.doesNotMatch(css,/local\(/);
  assert.match(css,/button, input, select, textarea, option \{ font-family:inherit; \}/);
  assert.match(css,/\[data-store-error-indicator\] \{ font-family:var\(--widget-font-family\) !important;/);
  const notes=await readFile(new URL('notes-theme.css',theme),'utf8');
  assert.doesNotMatch(notes,/WLPreview|data:font/);
  assert.match(notes,/#notes-roof-v8 textarea/);
  const read=await readFile(new URL('Worklog/read-widgets.css',theme),'utf8');
  assert.match(read,/\.read-loading \{ font:13px\/1\.65 var\(--widget-font-family\)/);
  assert.match(read,/\.wr-tooltip \{[^}]*font:600 12px\/1\.6 var\(--widget-font-family\)/);
});
