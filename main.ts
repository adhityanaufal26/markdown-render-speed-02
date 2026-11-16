// Driver for markdown-render-speed-02: reads the cases, renders each one
// with the local parser, and writes the resulting HTML array. The input
// is a JSON array of {markdown} cases (an object keyed by index is
// accepted too); the output is a JSON array of HTML strings in the same
// order, one entry per case.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR || '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const raw = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
const cases = Array.isArray(raw)
  ? raw
  : Array.isArray(raw.cases)
    ? raw.cases
    : Object.values(raw);

const html = [];
for (let i = 0; i < cases.length; i++) {
  const md = cases[i] && cases[i].markdown;
  html.push(parse(typeof md === 'string' ? md : String(md ?? '')));
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
