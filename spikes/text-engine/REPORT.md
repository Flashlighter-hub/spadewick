# Spike A (PRD §24.3, phase 0.4): text engine

Run: `node spikes/text-engine/run.mjs` (writes `out/card-*.png`, `out/card-*.svg`, `out/results.json`, prints every check).
Machine: AMD Ryzen 7 7700X, 31 GB, Node 24.14, Windows 11. Nothing here is wired into the app.

## Verdict against the PRD's pass criterion

> A fixture card with kerning, ligatures, a non-Latin script, right-to-left text and inline icons draws correctly and re-renders in under 200 ms.

**Pass on every point, with both shapers.** 29 automated checks per shaper (58 in all), all green; the existing suite is unchanged (462 pass, the same 6 environment failures as before the spike).

| Criterion | Result |
|---|---|
| Kerning | "AV" 2600 units vs 2708 for A+V; switching `kern` off restores 2708 |
| Ligatures | "office" is 4 glyphs with ligatures, 6 without (Garamond `ffi`) |
| Non-Latin, right-to-left | Arabic (joined forms, 3 of 5 letters take contextual shapes) and Hebrew, right-aligned in an RTL paragraph, mixed with Latin in one line (UAX #9 reordering) |
| Inline icons | unbreakable boxes; sized from the text size and their own scale; shrink with the text in shrink-to-fit; stay on the line with following punctuation at every box width from 60 to 400 (341 widths) |
| Measured = drawn | laid-out ink box vs the rendered pixels: at most 0.7 px apart on every case |
| Same as the rasterizer's own shaping | 0.0% differing pixels on all 6 single-line cases (Latin, bold, Garamond ligatures, Arabic, Hebrew, mixed by item) |
| Re-render < 200 ms | 750 x 1050 fixture card, p95 **13.5 ms** after an edit and **13.7 ms** with nothing cached (40 runs). Split: layout 0.3, SVG build 0.1, resvg render 5.3, PNG encode 6.7 ms |

For comparison, the same card as `<text>` through resvg (today's route) takes about 28 ms: drawing outlines is **not** slower.

## What the spike taught us (decisions for the real engine)

1. **Shape whole runs, not words.** My first version shaped each word separately and was 3 px off the rasterizer on "AVATAR To Wa Yo": kerning pairs that involve the space were lost. Shaping a whole run (same span, font, direction) and then splitting the glyphs into words by cluster fixed it to 0.0%. The shapers therefore return a cluster per glyph.
2. **Today's route cannot draw mixed scripts at all.** resvg `<text>` shows missing-glyph boxes for Hebrew and Arabic inside a Latin font run, and drops the whole line when an Arabic `<tspan>` sits inside Latin text. Outlines remove this limitation, which is an argument for §16.2 beyond measuring.
3. **The old per-character estimate** (§7.4) is off by between -3% and +39% on these strings (+7%, +14%, +39%, +35%, -3%, +3%), more than the slack boxes were built to allow.
4. **Shape cache is not needed for the time budget** (shaping costs about 0.3 ms per card), but keeps the door open for long rules text.
5. **Per-glyph outline `<use>` elements are cheap** (107 distinct shapes, 70 KB SVG for the whole card).

## The two shapers

Identical output on everything tested (advance widths equal to the unit on all five strings, same glyph counts).

| | harfbuzzjs 1.6.2 (WASM) | fontkit 2.0.4 (JS) |
|---|---|---|
| Result on the fixture | pass | pass |
| Loads from the app's CommonJS main process | **no** via `require` (top-level await, `ERR_REQUIRE_ASYNC_MODULE`); yes via `await import()` | yes |
| Size | 434 KB wasm + 83 KB JS | 567 KB bundle (5.7 MB in node_modules) |
| Start-up | 7 ms | 44 ms |
| Complex scripts beyond what was tested (Indic, Thai, Khmer) | the same engine family as resvg's own shaper (rustybuzz is a HarfBuzz port) | known gaps and bugs in complex-script shaping |
| Cluster numbers | native | rebuilt from code points (works, and agrees at word boundaries) |

Recommendation: **harfbuzzjs**, and drop fontkit. They tie on everything tested; HarfBuzz is the safer bet for scripts the spike did not cover, and it is the same shaping family the rasterizer uses, so any residual disagreement stays small. Cost: loading via `import()` and shipping one 434 KB wasm file as an extra resource (the packaged app already ships fonts that way, `fontFiles.js`).

## Dependencies for the real engine (all MIT)

`harfbuzzjs` (shaping and glyph outlines), `bidi-js` (UAX #9), `linebreak` (UAX #14). Verdict (2026-10-03): harfbuzzjs chosen, fontkit removed from `package.json`; `shaper-fk.mjs` stays for the record and runs only if fontkit is installed again. Fonts used by the spike are SIL OFL: Lato, EB Garamond, Noto Sans Arabic, Noto Sans Hebrew (in `spikes/text-engine/fonts/`, downloaded from github.com/google/fonts and github.com/notofonts; not shipped).

## Not tested (open risks, honestly)

- **Devanagari, Thai, Khmer, CJK** (left out on request): complex-script reordering and CJK line breaking are unverified. The engine design allows them; the claim "complex scripts shaped correctly" in §16.9 is not yet proven.
- **Variable fonts at other weights**: EB Garamond was drawn at its default instance only.
- **Icon break rule**: an icon is treated like a letter, so `{fire}Flying` (no space) never breaks between them. PRD §16.2 says "unbreakable box, kept with the punctuation that follows it"; whether a break may fall between an icon and a following *word* is not specified.
- **Hard-breaking a word wider than the box** (§7.4 breaks by characters) is not implemented in the spike.
- **Text-in-PNG icons** (PNG/JPEG icons): only vector placeholder icons were drawn.
- **Other machines**: one fast desktop CPU. The 200 ms target has about 15x headroom here; a slow laptop is not measured. macOS and Linux not run.
- **Colour emoji, outline/shadow effects, justification, letter spacing** (§16.6) are not part of this spike.
- The measured-vs-rasterizer comparison covers single lines; whole-paragraph wrapping is checked by invariants (no overflow, no stranded punctuation), not against another renderer.

## Files

`shaper-hb.mjs`, `shaper-fk.mjs` (two adapters, one interface), `layout.mjs` (bidi, UAX #14 breaking, run shaping, fallback, icons, shrink-to-fit), `render.mjs` (outlines to SVG, resvg, pixel comparison), `run.mjs` (checks and timing), `fonts.mjs`. The two shaper-specific packages were added to `devDependencies` in `package.json`.
