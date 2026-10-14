# Spike C: PDF writing for production output (PRD §24.3), result: passed, without a commercial preflight tool

Run on 2026-10-04. Code: `build.mjs` (writes `out/c.pdf`), `validate.py` (25 checks with qpdf, MuPDF and pdfcpu), `pdfjs.mjs` (pdf.js). It reuses `../cmyk/common.mjs` (spike B). Not part of the application.

## Question
Can the PDF library be extended (or a thin writer added) to set TrimBox/BleedBox, an output intent, DeviceCMYK images, a spot-colour separation and an optional content layer?

## Answer
**Yes: pdf-lib is enough.** Everything below was written with pdf-lib's object API (`context.obj`, `register`, `flateStream`, `page.node.set`) and the page content as a content stream of PDF operators. No second PDF library and no purpose-built writer was needed. One small thing had to be corrected by hand (dates, below).

## What the test page contains
A poker card (63.5 x 88.9 mm) with 3 mm bleed and 10 mm of room for marks around it (page 89.5 x 114.9 mm), written as one page:
- **Boxes:** `MediaBox`, `CropBox`, `BleedBox` (trim + 3 mm), `TrimBox` (63.5 x 88.9 mm), `ArtBox` (trim inset 3 mm, the safe area).
- **Output intent:** `GTS_PDFX`, FOGRA39, with the ISO Coated v2 profile (as in spike B).
- **Image:** the 40 converted patches (spike B) as an 8-bit CMYK image in the `ICCBased` colour space that uses the same profile object as the output intent.
- **Spot colour:** `/Separation /Spadewick#20Gold /DeviceCMYK` with a type 2 tint transform (C0 = 0 0 0 0, C1 = 0.12 0.3 0.75 0.08), used at 100 % and at 50 %.
- **Die line:** its own spot `DieCut` (alternate magenta), 0.5 pt stroke on the trim, with overprint on for fill and stroke (`OP`, `op`, `OPM 1`).
- **Marks:** four pairs of crop marks 3 mm outside the bleed in the `/All` separation (registration: every plate).
- **Layers:** four optional content groups, `Artwork`, `Die line`, `Print marks` and `Guides (screen only)` (shown on screen, not printed), each with a `Usage` entry, an `/OCProperties` default configuration with `AS` print and view events, and the page content wrapped in `/OC ... BDC ... EMC`.

## Results (25 of 25 checks)
**qpdf 12.4.2 (through pikepdf):** no syntax problems; the three boxes are exactly as written, nest correctly (Art in Trim in Bleed in Crop in Media) and measure 63.5 x 88.9 mm trim with 3 mm bleed; the output intent has a 4-component profile; the separations are named as written with a CMYK alternate and a tint function; overprint is on; the image profile and the output-intent profile are one object; the four layers have their names and usage; the content is wrapped in marked content for each of them.

**MuPDF 1.28.2 (through PyMuPDF):** opens, reads the trim and bleed boxes, lists the four layers, and renders: white outside the bleed, paper tint inside it, the spot colour at 100 % darker than at 50 %, the die line magenta on the trim, the crop marks outside the bleed. **Switching a layer off in MuPDF removes exactly what belongs to it:** the die line (139 magenta samples to 0), the marks (67 samples to 0), and the gold and tint squares when Artwork is off.

**pdfcpu 0.16.0 (an independent validator written in Go), strict mode:** passes after the date fix below.

**pdf.js 6.4 (the Firefox engine):** parses the page, lists the four layers by name, reads 44 drawing operations with no warnings. It was not used to render.

## Finding: pdf-lib's dates
pdf-lib writes `CreationDate` and `ModDate` as `D:20261004140605Z`. pdfcpu's strict mode rejects that ("invalid date"); the form given by the PDF specification, `D:20261004140605+00'00'`, passes. Production output should set both dates itself in that form (done in `build.mjs`). qpdf, MuPDF and pdf.js accepted both forms.

## What this does not prove
- **No commercial preflight tool** (Acrobat Preflight, callas pdfToolbox, PitStop) was available, so "without errors in a commercial preflight tool" is **not shown**. The checks above are the free substitutes agreed for the spike (three readers, a strict validator, and checks of each production feature). A printer's preflight may still flag things these do not look at (for example PDF/X identification, fonts, image resolution, total ink).
- **Not PDF/X:** the file does not carry `GTS_PDFXVersion`, XMP metadata, a document ID or `Trapped`. Setting them is possible in pdf-lib (the Info dictionary and the catalog accept any entries), but conformance is not claimed or tested.
- **Separations were tested for structure and for the alternate colour only.** Whether a RIP puts the spot on its own plate cannot be shown without a separation viewer or a RIP; MuPDF paints the CMYK alternate.
- **One page, one image, no text.** Fonts (the text engine draws outlines, so none are needed), several pages, an image per card, and file size for a sheet of 9 cards are phase 4.1 work.
- Gradients in a spot colour, transparency flattening and a spot colour used by an image are not tested.

## Consequences for the plan
1. **Phase 4.1 writes the production PDF with pdf-lib** (already a dependency), with the object-level code of `build.mjs` as the starting point. No purpose-built writer.
2. Set the PDF dates in the specification's form (A69).
3. The die line and marks go on their own layers and spot/registration colours, as tested; the manufacturer presets (§18) decide which are on.
4. Ask a printer or use a commercial preflight on a sample before the first release (Appendix C), since this spike could not.
5. **Reinstall the helpers:** `npm install` in `spikes/pdf`, `pip install --target py pymupdf pikepdf`, and `GOBIN=<spikes/pdf/bin> go install github.com/pdfcpu/pdfcpu/cmd/pdfcpu@latest` (the `py/`, `bin/` and `node_modules/` folders were deleted after the run).
