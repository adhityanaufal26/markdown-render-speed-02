# markdown-render-speed-02

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/adhityanaufal26/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/adhityanaufal26/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free JavaScript CommonMark 0.31.2 + GFM 0.29 parser that returns byte-for-byte the HTML marked 18.1.3 renders with its default options — 2.59x faster than marked on the 720-case practice set (273 ms vs 707 ms), with 720/720 cases matching.

## Run it

```sh
MAKEFUN_INPUT_DIR=./input MAKEFUN_OUTPUT_DIR=./output node main.ts
```

`parse.js` exports `parse(markdown)`; `main.ts` reads every case from `$MAKEFUN_INPUT_DIR/cases.json` (default `/input`), renders each with `parse`, and writes `$MAKEFUN_OUTPUT_DIR/html.json` (default `/output`).

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
