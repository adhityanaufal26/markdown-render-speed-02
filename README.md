# Fast marked drop-in

A faster drop-in replacement for [marked](https://github.com/markedjs/marked) 18.1.3.

Renders exactly marked's HTML byte-for-byte on all 720 cases — CommonMark 0.31.2
and GFM 0.29 spec examples plus 40 generated READMEs — while running about
**2.59x faster** than marked.

## Files

- `parse.js` — dependency-free JavaScript module. Exports `parse(markdown)`,
  which returns the same HTML string marked 18.1.3 produces for the same input.
- `main.ts` — program that reads cases and writes HTML (uses `parse.js`).

## Usage

```js
import { parse } from "./parse.js";

const html = parse("# Hello\n\nSome **bold** text.");
console.log(html);
```

No dependencies, no build step — `parse.js` runs as-is in Node or in a browser.

## Performance

Measured locally on the 720-case suite:

| | min | median |
| --- | --- | --- |
| this renderer | 273.1 ms | 315.4 ms |
| marked 18.1.3 | 707.0 ms | 722.9 ms |

Same output, ~2.59x faster.
