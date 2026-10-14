# Spike B: CMYK conversion and output intent (PRD §24.3), result: passed

Run on 2026-10-04. Code: `common.mjs`, `run.mjs` (conversions), `pdf.mjs` (PDF writing), `ref.py` (second engine), `validate.py` (two PDF readers), `sharpcheck.mjs`. Outputs in `out/`. Not part of the application.

## Question
Can the image library convert RGB to a *given* CMYK ICC profile with a chosen rendering intent and black point compensation, and can the result be embedded in a PDF with the profile as output intent?

## Answer
- **The image library the application uses now (sharp / libvips) cannot.** Its `withIccProfile` takes no rendering intent and no black point option (checked in its source), and what it produces differs a lot from a controlled Little CMS conversion: against the same profile with the perceptual intent, mean Delta E 2000 is 3.3 (ISO Coated v2) and 3.5 (CRPC1), worst patch 18; black comes out as 183/164/149/175 where Little CMS gives 212/202/185/242. This is the "if it fails" case of the spike table.
- **A dedicated colour-management library can: `lcms-wasm` 1.0.5 (MIT, Little CMS 2.16 compiled to WebAssembly).** It exposes the transform with intent and flags (black point compensation), 8-bit and 16-bit formats, and the Lab and sRGB built-in profiles. The same engine is already the one inside sharp, so the colour science is unchanged; only the controls are new.
- **PDF output intents work with pdf-lib, which the application already uses.** A profile stream (`/N 4`), an `/OutputIntent` dictionary and a CMYK image written as `DeviceCMYK` or as `ICCBased` with the profile were all written with plain pdf-lib calls (`flateStream`, `obj`, `register`), no new PDF library.

## Profiles used (downloaded, kept only in `profiles/`)
| Profile | Source | Licence text found |
|---|---|---|
| ISO Coated v2 (ECI), FOGRA39, ICC v2 | European Color Initiative, `eci_offset_2009.zip` | The ECI document says the profiles "can be freely downloaded"; the embedded copyright is Heidelberger Druckmaschinen. **No explicit redistribution grant was found in the files**: confirm with ECI before bundling (§17.5). |
| CGATS21_CRPC1 (US sheet-fed class), ICC v4 | ICC registry, color.org | Embedded text: "may be used, embedded, exchanged, included in commercial software and shared without restriction. It may not be altered..." (X-Rite, made available by IDEAlliance). Suitable for bundling. |

## Results
**1. Same conversion by a second engine.** 40 patches (neutrals, primaries, secondaries, skin tones, pastels, dark and saturated colours) x 2 profiles x 4 settings (perceptual or relative colorimetric, with or without black point compensation) through lcms-wasm and through Pillow's ImageCms (Little CMS 2.18, another binding): **identical in all 320 comparisons** (Delta E 2000 = 0, largest ink difference 0 of 255). Both are Little CMS, so this proves the integration (formats, flags, ink order, inversion), not the algorithm. Independence of the result is covered by 2.

**2. Against a colour computed without any library.** sRGB converted to Lab (D50) by a formula in `common.mjs`, then the CMYK result read back through the profile with the same settings, Delta E 2000:
| Profile and setting | median | colours within 5 | worst |
|---|---|---|---|
| ISO Coated v2, relative + black point | 0.23 | 33 of 40 | magenta 19.5, green 18.4, blue 14.7, cyan 13.9 |
| CRPC1, relative + black point | 2.04 | 31 of 40 | green 16.6, blue 15.3, magenta 15.1, cyan 13.7 |
The worst colours are the saturated screen colours that no press can print (expected; they are what the soft proof's out-of-gamut warning in §17.5 is for). CRPC1 with relative colorimetric and **no** black point compensation is poor (median 12.7) because that profile's black is much lighter than sRGB black: the setting matters, and black point compensation fixes it. This is why the choice has to be exposed.

**3. The numbers make sense.** White gives no ink on both profiles. Black on ISO Coated v2 is C87.5 M78.4 Y64.7 K92.5 (total 323 %, within the 330 % of that condition); on CRPC1 it is K100 with 129 % CMY (total 229 %). Grey ramps rise smoothly with the black plate taking over in the shadows. Intent and black point compensation change the result as they should: perceptual vs relative differ by a mean Delta E of 2.8 (ISO) and 5.8 (CRPC1), black point on vs off by 1.3 and 3.1; the black plate for ISO Coated v2 goes from 94.9 % to 92.5 % with compensation.

**4. Speed.** One card image, RGB 8-bit to CMYK 8-bit, relative + black point: 0.8 megapixels (63.5 x 88.9 mm at 300 dpi) in 36 ms, 3.2 megapixels (600 dpi) in 92 ms.

**5. The PDF in two independent readers.** Two PDFs (one per profile), two pages each (CMYK image as `DeviceCMYK`, and as `ICCBased` with the profile), with the profile as `/OutputIntents` (`GTS_PDFX`, identifier, registry).
- **qpdf 12.4.2** (through pikepdf): syntax check reports no problems; one output intent; `DestOutputProfile` has `N = 4` and is byte-identical to the profile file (SHA-256); both images' decoded samples are byte-identical to what was written.
- **MuPDF 1.28.2** (through PyMuPDF): both pages open and render; the output intent is present; the images are read as 4-component `DeviceCMYK` and as `ICCBased(CMYK, <profile name>)`; the white patch renders white and the black patch dark, red as a plausible red.

## What this does not prove
- **No commercial preflight tool** (Acrobat, callas, PitStop) was available. The PDF is not claimed to be PDF/X: no `GTS_PDFXVersion`, no TrimBox or BleedBox, no spot colour, no layers. Those are spike C.
- **Ghostscript** was not installed and was not downloaded (it installs system-wide on Windows).
- The second engine is Little CMS too, so engine independence rests on result 2.
- Only RGB sources were tested (what Spadewick has). CMYK values given by the person (§17.5) bypass the conversion.
- Very large images: 3.2 megapixels was timed; the WebAssembly heap grows with the image, so a production path should convert in strips (not tested here).

## Consequences for the plan
1. **Use `lcms-wasm` for all colour conversion in phase 4.1** (images and flat vector colours, soft proof, total ink), with the settings exposed in the export profile (§17.5). Keep sharp for resizing and decoding. Add `lcms-wasm` as a dependency (it loads like harfbuzzjs: WebAssembly, loaded with `import()`, in `dependencies`).
2. **PDF output intent needs no new library.** Spike C decides whether pdf-lib suffices for boxes, separations and layers.
3. **Bundled profiles:** CRPC1 can be bundled. ISO Coated v2 needs ECI's confirmation, otherwise it is imported by the person like the profiles that cannot be bundled (§17.5).
4. **Reinstall the helpers:** `npm install` in `spikes/cmyk`, and `pip install --target py pymupdf pikepdf` (the `py/` folder was deleted after the run: 93 MB).
