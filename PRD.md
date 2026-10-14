# Product Requirements Document
## Spadewick — Local-First Card Game Design Desktop Application

**Version:** 2.0 (in development; 1.9 was the baseline)  
**Date:** 2026-10-02  
**Status:** §1–§14 are implemented and covered by automated tests, together with §5.8 (card IDs), §7.7 (template storage) and the V2 foundations of §24.2 phases 0.1 (rename), 0.2 (schema guard) and 1.1–1.2; these shipped as **version 1.9 of the application** (Appendix A, A37). §15 (Cloud Storage Connections) and §16–§21 (rich text, print-production PDF, manufacturer presets, SVG import, snapshot compare, command line) are specified and awaiting implementation; §22 lists what is deliberately deferred; §24 gives the V2 delivery plan and risk register (see Appendix A and Appendix B for decisions and verification). Four **urgent** template-editor changes (§8.7: source on demand, layers panel, live image resizing, edge snapping and alignment guides) are built as phase 0.6 and pass the automated suites; a look in the packaged desktop window remains. Second round of owner testing (§28, F6–F12): every set and every template has its own card size, the project palette and the project default card size are gone, templates are made and managed only in the Template Editor, and the panels can be resized (A54–A59). The product is named **Spadewick** (Appendix A, A31); the code, tests, interface and packaging now use the new name

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Users & Use Cases](#3-users--use-cases)
4. [Technical Architecture Overview](#4-technical-architecture-overview)
5. [Project & Data Management](#5-project--data-management)
6. [Card Data Editor](#6-card-data-editor)
7. [Template System](#7-template-system)
8. [Canvas Editor](#8-canvas-editor)
9. [Asset Library](#9-asset-library)
10. [Export System](#10-export-system)
11. [Version Control & History](#11-version-control--history)
12. [Application Shell & Settings](#12-application-shell--settings)
13. [Data Model](#13-data-model)
14. [Non-Functional Requirements](#14-non-functional-requirements)
15. [Cloud Storage Connections](#15-cloud-storage-connections)
16. [Rich Text and Inline Icons](#16-rich-text-and-inline-icons)
17. [Print-Production PDF](#17-print-production-pdf)
18. [Manufacturer Presets](#18-manufacturer-presets)
19. [SVG Import and Automatic Binding](#19-svg-import-and-automatic-binding)
20. [Snapshot Compare](#20-snapshot-compare-what-changed)
21. [Command-Line Mode](#21-command-line-mode)
22. [Considered Later](#22-considered-later)
23. [Out of Scope](#23-out-of-scope)
24. [V2 Delivery Plan and Risk Register](#24-v2-delivery-plan-and-risk-register)
25. [Appendix A — Decisions and Clarifications](#appendix-a--decisions-and-clarifications)
26. [Appendix B — Verification](#appendix-b--verification)
27. [Appendix C — Launch Checklist](#appendix-c--launch-checklist)
28. [Fixes](#28-fixes)

---

## 1. Purpose & Scope

Spadewick is a portable, offline-first, **game-agnostic** desktop application for designing, iterating, and exporting custom card game cards. It targets game designers and hobbyists who prototype card games and need to rapidly produce print-ready or simulator-ready card images without relying on web services, subscriptions, or external spreadsheet software. Everything works with no network; an optional, opt-in connection to the user's own Dropbox, OneDrive or GitHub account lets a team exchange CSV and image files asynchronously (§15).

Spadewick imposes no game-specific structure: there are no built-in card types, stats, or fields. Every user defines the fields, card size, and CSV layout that match their own game (see §2, §5.3, §5.5, §10.6).

The primary export target is a Tabletop Simulator (TTS) deck sheet. Secondary targets are print-and-play PDFs and raw PNG card sheets. The entire application — including all project data, fonts, and assets — is self-contained and portable; no installation is required.

---

## 2. Goals & Non-Goals

### Goals

- Eliminate the spreadsheet-plus-image-editor workflow by providing an integrated card data table and visual template editor in one tool.
- Enable rapid iteration: changing a field value or template token must rerender the preview in under 200 ms for a single card.
- Be fully offline-capable and zero-cost after the one-time download: no feature of §1–§14 needs a network or an account.
- Let teams work asynchronously by exchanging card data, images and exports through the cloud storage they already use, with each person on their own account (§15).
- Be portable: the application and all project data must be relocatable by copying a folder, with no registry entries or system-level installs required.
- Produce correct, pixel-perfect rasterized exports suitable for direct use in Tabletop Simulator, PDF printers, and online print services.
- Be game-agnostic: support the standard card sizes used across the industry (§10.6) and let users define their own field names, so any game's CSV can be imported and synced without reshaping it (§5.5).
- Preserve design work: persistent named snapshots, multi-session undo, and non-destructive batch edits.

### Non-Goals

- Real-time multi-user collaboration, automatic background sync, or syncing the live project folder. (File-level exchange through the user's own cloud accounts is a goal; see §15.)
- Real-time multiplayer or online game hosting.
- Rule engine, game logic simulation, or playtesting within the app.
- Physical print fulfillment integration.
- Mobile or web versions.
- Built-in deck-building or collection management beyond the card design itself.

---

## 3. Users & Use Cases

### Primary User

A solo game designer or hobbyist who:

- Designs card games with 20–500 cards per project.
- Iterates on card balance by editing numbers and text in bulk.
- Produces TTS decks to share with playtesters via the Steam Workshop or direct file transfer.
- Prints cards at home or through a print-on-demand service.

### Core Use Cases

| ID | Use Case |
|----|----------|
| UC-01 | Create a new project, define card fields, and add a first batch of cards via manual entry or CSV import. |
| UC-02 | Design a card template visually, binding SVG text and image elements to card fields. |
| UC-03 | Edit a card field value and see the card preview update in real time. |
| UC-04 | Apply a formula field to compute a derived value (e.g., attack + defense displayed as a stat line). |
| UC-05 | Batch-find all cards whose "faction" field equals "Red" and replace with "Crimson". |
| UC-06 | Snapshot the current project state before a major balance pass. |
| UC-07 | Export the full set as a TTS deck sheet PNG with a companion JSON deck file. |
| UC-08 | Export a print-and-play PDF with bleed, crop marks, and card backs. |
| UC-09 | Add a new card type with different fields without migrating existing cards. |
| UC-10 | Import card art images, tag them, and assign them to cards. |
| UC-11 | Undo across multiple saves to recover a deleted card. |
| UC-12 | Duplicate a project and experiment without affecting the original. |
| UC-13 | Pull a teammate's updated CSV from a shared cloud folder, review the changes, and apply them (§15). |
| UC-14 | Pull images a teammate added to a shared folder, and refresh them when they change (§15). |
| UC-15 | Save card data, images, or an export to a team's cloud folder or GitHub repository without overwriting someone else's newer version (§15). |

---

## 4. Technical Architecture Overview

### Runtime Stack

| Layer | Technology |
|-------|-----------|
| Shell | Electron (portable executable via electron-builder, `--dir` target) |
| Frontend | Svelte + Vite (compiled, bundled into the Electron renderer) |
| Inter-process | Electron contextBridge + ipcRenderer / ipcMain |
| Database | SQLite via better-sqlite3 (one `.db` file per project) |
| Card rendering | SVG template + `{{token}}` substitution → rasterized by resvg-js |
| Image compositing | sharp |
| PDF generation | pdf-lib |
| Canvas editor | Konva (interactive drag/resize overlay on SVG preview) |
| App settings | electron-store (JSON file alongside the executable) |
| Cloud connections (optional) | Provider REST APIs over HTTPS from the main process; OAuth 2.0 (PKCE / device flow); Electron `safeStorage` for credentials (§15) |

### Process Topology

```
Main Process (Node.js)
  ├── IPC handlers: one line per channel, each calling a service (§24.2, phase 0.3)
  ├── core services (src/main/core): project, set, card, field, template, asset, font, history, snapshot,
  │     data import/export, template library and export logic; no dependency on Electron
  ├── better-sqlite3: per-project database
  ├── resvg-js: SVG → PNG rasterization
  ├── sharp: compositing, resizing, sheet assembly
  ├── pdf-lib: PDF assembly
  └── cloud service: provider adapters, sign-in, credential store (§15, optional)

Renderer Process (Svelte)
  ├── Card data table (spreadsheet UI)
  ├── Template editor (SVG source + Konva canvas overlay)
  ├── Asset browser
  ├── Export dialog
  └── Version/snapshot panel
```

### Portability Contract

- The executable, settings file, and all project folders live under one root directory chosen by the user.
- All paths stored in the database are relative to the project folder root.
- No absolute paths are written anywhere.
- No OS-level registry entries or `~/Library` / `%APPDATA%` dependencies. A packaged app keeps everything it writes in a `data/` folder next to the application (settings file, error logs, and Chromium's own caches), and project folders in `projects/` next to it. The location is derived from how the app is packaged: the folder holding the AppImage (Linux), the portable-executable folder (Windows), or the folder holding `Spadewick.app` (macOS). Nothing is written to the OS profile folders.
- **Cloud credentials are the deliberate exception to "everything travels":** tokens are encrypted with the operating system's credential store, so a copied portable folder lists its accounts as signed out and the user connects again. Project files carry only non-secret link metadata (§15.5).

---

## 5. Project & Data Management

### 5.1 Project Structure on Disk

```
<projects-root>/
  my-game/
    project.db          # SQLite database (all card data, templates, fonts metadata)
    /templates          # SVG template files (named by template ID)
    /assets             # User-uploaded images, icons, textures
    /exports            # Generated output files (TTS sheets, PDFs, PNGs)
    /snapshots          # Named snapshot archives (zip of db + assets at snapshot time)
```

The projects root is configured once in electron-store and defaults to a `projects/` folder adjacent to the executable.

### 5.2 Projects, Sets, and Cards

**Project** — the top-level unit of work. Each project has exactly one SQLite database and one directory on disk.

**Set** — a named collection of cards within a project. A project may have multiple sets (e.g., "Base Set", "Expansion 1"). A set has:
- A name and optional description.
- A default template reference. A card's own template takes precedence; a card with none renders with its set's default. The first template created in a set becomes its default, and the card table has a Template column for per-card overrides.
- An ordered list of cards.
- A card size: an industry-standard preset or custom dimensions (§10.6). Every set has its own, chosen when the set is made (Poker is preselected) and changeable later, with a warning when that affects its templates. There is no project-wide default size, and only templates of the set's size can be used in it.
- Export configuration overrides (e.g., DPI).

**Card** — an individual card within a set. A card has:
- A string ID (UUID), stable across renames.
- A display name (can itself be a field reference).
- A reference to a template.
- A JSON blob of field values (`fields_json`).
- A reference to the set it belongs to.
- An ordering index within the set.
- A soft-delete flag (deleted cards are retained until the snapshot is pruned).

### 5.3 Card Fields & Schema

Fields are defined at the **Set** level, not the database schema level, and are entirely user-defined: Spadewick ships no fixed field list. Adding, removing, or renaming a field does not require a schema migration. **Renaming a field's `name` never affects card data or templates**, because they are keyed by `slug`. Changing a `slug` is an explicit, confirmed action that moves existing card values to the new key and rewrites `{{old}}` tokens in all templates (formula expressions that reference the old slug must be edited manually). Adding, removing, or renaming a field does not require a schema migration — it updates only the set's field definition list, and `fields_json` on cards retains whatever keys were stored, with undefined keys defaulting to empty at render time.

**Field Definition** attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `id` | string (UUID) | Stable identifier |
| `name` | string | User-editable display name shown in the editor table. Also the primary key for matching CSV/JSON column headers on import (§5.5). |
| `slug` | string | The `{{token}}` name used in SVG templates. Derived from `name` when a field is created (lowercase, non-alphanumerics → `_`), then independent of it. |
| `type` | enum | `text`, `number`, `boolean`, `image_ref`, `color`, `formula`, and (V2) `rich_text` (§16.7) |
| `default_value` | string | Value inserted for new cards |
| `validation` | optional JSON | Min/max for numbers, regex for text |
| `formula` | optional string | Expression used when type is `formula` |
| `display_order` | integer | Column order in the card editor table |
| `hidden` | boolean | Hides the column in the table without deleting it |

### 5.4 Formula Fields

Formula fields compute a value from other fields on the same card at render time. They are not persisted — they are evaluated on the fly.

**Formula Expression Language:**

A minimal, sandboxed expression language (not JavaScript `eval`). Supported operations:

- String concatenation: `concat(field_a, " / ", field_b)`
- Arithmetic: `add`, `sub`, `mul`, `div`, `round`, `floor`, `ceil`
- Conditional: `if(condition, then_value, else_value)`
- Comparison: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`
- String functions: `upper`, `lower`, `trim`, `length`, `substr`
- Type coercion: `to_number`, `to_string`
- Card identity and numbering (V2, §5.8): `card_id()`, `card_number()` (position in the set, from 1) and `card_count()` (distinct cards in the set)

**Examples:**

```
concat(name, " (", type, ")")
if(gt(attack, 5), "#FF0000", "#000000")
concat(to_string(round(mul(cost, 1.5))), " gold")
```

Formula results are strings or color hex values. Circular references are detected at definition time and rejected.

### 5.5 CSV Import / Export

**Import:**
- The user selects a CSV file from disk, or pulls one from a connected cloud account (§15.8 W2); a pulled file goes through exactly the same steps below and can be remembered for refresh.
- The first row is treated as field headers.
- The app matches each CSV column header to a field by a **full match** (case-insensitive, surrounding whitespace ignored) against the field's **name**; if no name matches, against its **slug**. Names take precedence so a user can import a CSV laid out for their own game, and rename fields in the app to line up with their CSV headers.
- Matched columns are synced: values are written to the matching field on each card, and re-importing the same CSV in merge mode updates those same fields.
- A column named `card_id` is the card's permanent ID (§5.8) and is read first: a row whose ID matches a card in the set updates that card whatever else changed (this is the default merge key); a row without one creates a new card with a generated ID.
- A column named `display_name` (if no field matches it) sets the card's display name.
- A column named `quantity` (if no field matches it) sets the card's built-in quantity (§6.5). A blank value means 1 on a new card and leaves an existing card's quantity unchanged in merge mode. A value that is not a whole number from 0 to 999 is a row error like any other validation failure. A field the user has called "Quantity" takes precedence by the name rule above and is then just an ordinary field.
- Unmatched columns may be: (a) ignored, (b) created as new text fields named exactly as the CSV header, or (c) mapped manually via a column-mapping dialog.
- Import mode: **append** (new cards added) or **merge** (match on a key field, update matching cards, add new ones).
- Rows that fail field validation are shown in a pre-import error table; the user may proceed skipping errors or cancel.
- **A CSV that breaks the CSV rules is reported, not read silently** (UPDATES U14): a quote inside a quoted field that is not doubled, a quote opening mid-field, a field never closed, or a row with a different number of columns than the header. Each is listed with its line before anything is imported, and the import needs the person to say they have seen the problems; the command line refuses such a file unless `--ignore-file-problems` is given.

**Export:**
- Exports the card data table for the selected set(s) as UTF-8 CSV with a header row.
- A `card_id` column is always written first (§5.8).
- Formula fields export their computed values.
- Image reference fields export the asset filename (not a path).
- A `quantity` column with each card's built-in quantity is written (after the field columns) unless one of the exported sets has its own field with the slug `quantity`, so an export can be re-imported without losing copy counts.

### 5.6 JSON Import / Export

**Import:** Accepts a JSON array of card objects, where each object's keys are matched to fields by the same name-then-slug rule as CSV (§5.5). Same merge/append logic as CSV.

**Export:** Exports a JSON array. Includes all fields including computed formula values. Optionally includes card metadata (ID, set name, template name).

### 5.7 Batch Find and Replace

Accessible from the card data editor. Operates on one or more sets.

- **Find:** A literal string or regex match against any subset of text/number fields.
- **Replace:** A literal replacement string, or a replacement with back-references if regex was used.
- **Scope:** All sets in the project, or selected sets only.
- **Field filter:** All fields, or selected fields only.
- **Preview table:** Before committing, shows every matched card with the original and replacement value highlighted.
- **Commit:** Applied as a single undoable operation.


### 5.8 Card IDs and Numbering

> **Status: implemented in version 1.9.** A prerequisite of file sync (§15.18) and of collector numbers on cards. Where the build settled a detail the text left open, Appendix A (A38–A40) records the decision.

Every card gets a **card ID** the moment it is created: a short, readable, permanent code such as `FIRE-0042`, generated by the project. It is separate from the internal identifier the database uses (which the user never sees).

**Why.** A card's name is something a designer changes constantly, so it cannot identify a card. Without a stable ID, a synced file cannot tell "this card was renamed" from "this card was deleted and another added", and per-card settings (template, quantity) would be lost on a refresh (§15.18). The same ID also gives designers the collector number they print on the card.

**The generator** is configured per project (Project → **Card IDs…**) and has these parts:

| Part | Meaning |
|------|---------|
| **Pattern** | Text with tokens: `{set}` (the set's short code), `{n}` (the next number; `{n:4}` pads to four digits), `{author}` (a short code for this installation, see below). Default: `{set}-{n:4}` → `FIRE-0042` |
| **Set code** | 2–6 letters or digits per set, derived from the set name at creation (*Fire Creatures* → `FIRE`) and editable in the set's properties; unique within the project |
| **Counter scope** | per set (default) or per project |
| **Start and step** | default 1 and 1 |
| **Author code** | a two-character code, random per installation on first use and editable; recommended for **teams** (see *Teamwork* below) |

**Rules**

- **Assigned automatically** whenever a card is created: added in the table, duplicated, pasted, imported without an ID, or created by a refresh from a cloud file (§15.18). A duplicate always gets a new ID.
- **Never reused.** Numbers only go up; deleting a card does not free its number, and undoing a deletion brings the card back with its old ID.
- **Permanent in normal use.** The ID is shown in a built-in **ID** column (§6.1) that is read-only by default. It can be edited deliberately; the app checks that the new ID is unique and warns that files and teammates know the card by its ID.
- **Moving a card to another set keeps its ID.**
- **Counter safety.** After an import or a refresh the counter moves past the highest number found in IDs that match the pattern, so a newly generated ID can never equal one just imported.
- **Reserved name.** `card_id` is a reserved column name: a field cannot be created with that name or slug (Field Manager and CSV import offer a different name). Existing fields with that name are renamed on upgrade (`card_id_2`) with a notice.

**Using the ID**

- In templates and text: the tokens `{{@card.id}}`, `{{@card.number}}` (the card's position in its set, from 1, in the current order) and `{{@card.count}}` (number of distinct cards in the set), for example a footer `{{@card.number}}/{{@card.count}}`. The same values are available to formulas as `card_id()`, `card_number()` and `card_count()` (§5.4), and the card filter of §10.1 can use `card_id`.
- In file names (§10.1) as `{{card_id}}`, for example individual PNG files.
- In CSV and JSON: a `card_id` column is **always written first**, and is read first on import (§5.5).

**Import matching** (CSV, JSON, cloud refresh):

- A row whose `card_id` matches a card in the set **updates that card**, regardless of any other column. This is the default merge key; a user-chosen key field (§5.5) remains available for files that come from elsewhere and have no IDs.
- A row without an ID is a **new card** and receives a generated ID.
- A row whose ID is not in the project creates a new card **with that ID** (this is how a teammate's new cards arrive).
- Two rows with the same ID in one file are a row error (§5.5's error table).

**Teamwork.** Two people who each add cards offline, with the same generator settings, will both generate `FIRE-0043`. The PRD handles this in two ways. First, the pattern's `{author}` token (`FIRE-K7-0043`) makes collisions practically impossible; the cloud-link setup recommends it the first time a link is created for a project with more than one author. Second, if a pull brings an ID that already exists locally for a **different** card (content differs substantially), the review of §15.18 shows a **same-ID conflict** and offers *keep both — give the incoming card a new ID* (the default), *replace mine*, or *skip*.

**Existing projects.** On the first open after the upgrade, every card receives an ID in its current display order using the default pattern and set codes derived from the set names. The app offers a snapshot first (§11.1). No card data changes.

**Data model.** Schema version 6 (§13.3): `cards.card_code` (text, unique within the project), `sets.code`, and a small `id_counters` table (scope, next number); the generator pattern and scope are `project_meta` entries.

**Verification.** Unit tests of the pattern parser and padding; integration tests: assignment on every creation path, never-reuse across delete/undo/redo, counter safety after import, reserved-name handling, migration of an existing project, tokens and formula functions rendering, round trip through CSV and JSON with IDs, same-ID conflict handling; end-to-end tests of the ID column and the Card IDs dialog (axe and keyboard, §14.4); strings lint (§14.5).

---

## 6. Card Data Editor

The card data editor is the primary data-entry interface. It presents cards as rows and fields as columns, similar to a spreadsheet.

### 6.1 Table Features

- **Virtualized rendering:** Only visible rows are rendered. Must handle 1,000+ cards without performance degradation.
- **Inline cell editing:** Single-click to select a cell, double-click (or Enter) to enter edit mode.
- **Column reordering:** Drag column headers to reorder. Order is persisted per set.
- **Column resizing:** Drag column dividers. Width persisted per set (`fields.width_px`). The ID, Name, Template and Quantity columns have a fixed width. Column layout is view state and is not part of undo history.
- **Column hiding:** Right-click column header → Hide. Visible columns persisted per set.
- **Row reordering:** Drag row handle. Position determines card order in exports.
- **Multi-row selection:** Click, shift-click, ctrl-click for multi-select.
- **Bulk edit:** With multiple rows selected, editing one cell applies the value to all selected rows in that column, as a single undoable step. This includes the card name and template columns. A hint in the toolbar shows how many rows an edit will affect. Clicking a row's handle selects only that row.
- **Built-in columns:** ID (read-only by default, §5.8), Name, Template and Quantity (§6.5) come before the user-defined fields.
- **Row duplication:** Right-click → Duplicate Card(s).
- **Row deletion:** Delete key or right-click → Delete Card(s). Soft-deleted; undoable.
- **Add row:** Click `+` below last row or press Tab at end of last cell.
- **Context menus:** Right-click a row for Duplicate / Delete; right-click a column header for Hide. A toolbar button lists hidden columns so they can be shown again (also available in Manage Fields).
- **Deleting:** The Delete key removes the selected rows after a confirmation.
- **Keyboard navigation:** Arrow keys, Tab/Shift-Tab, Enter/Shift-Enter move between cells.

### 6.2 Cell Types

| Field Type | Editor Widget |
|------------|---------------|
| `text` | Single-line text input; multi-line expandable for long content |
| `number` | Numeric input with increment/decrement arrows; validates on blur |
| `boolean` | Checkbox |
| `image_ref` | Asset picker (thumbnail + file name); opens asset browser on click |
| `color` | Color swatch + hex input; opens color picker popup |
| `formula` | Read-only display of computed value; tooltip shows formula expression |

### 6.3 Card Preview Pane

A collapsible side pane shows the rendered preview of the currently selected card. The preview:

- Re-renders within 200 ms of any field value change.
- Shows the card at a fixed preview size (configurable: small, medium, large).
- Has a "Full Size" button that opens a dialog showing the card at 1:1 export pixels. The dialog follows the dialog rules of §14.4 (focus is moved into it, Escape closes it).
- Is rendered as an image, never as injected markup, so a template cannot run script in the application (§14.7).

### 6.4 Field Manager

Accessible via a "Manage Fields" button in the table toolbar. Shows a list of all fields for the set with:

- Drag-to-reorder.
- Add / rename / delete field. Renaming a field's name is a plain edit; changing its token (slug) follows the migration rules in §5.3.
- Edit field type, default value, validation, and formula.
- "Add to all cards" button: sets the default value on all cards that do not yet have a value for that field.
- "Bulk-set value" button: opens a dialog to overwrite a field's value on all cards matching a filter.

### 6.5 Card Quantity (copies per card)

Every card has a built-in **Quantity** — how many copies of the card appear in sheet and print exports. It is a column in the card table, right after Template, not a user-defined field, so it exists in every game's project without setup.

- **Default and range:** 1; a whole number from 0 to 999. A blank edit resets it to 1.
- **0** keeps the card in the project but leaves it out of every export (a cut or on-hold card).
- **Editing:** like any cell, including bulk edit across selected rows as one undo step, and undo/redo.
- **Where it applies:** Tabletop Simulator sheets, PDF pages and PNG sheets include `quantity` copies of the card, in card order, each copy taking its own slot (so copies count towards the 69-card TTS sheet limit and the number of cards per PDF page). A card is rendered once and its image reused for every copy. **PNG individual files** are the exception: one file per card, never per copy.
- **Duplicating a card** copies its quantity. The export card filter (§10.1) can use it, e.g. `quantity > 1`.
- **Import/export:** see §5.5.
- **Existing projects:** the migration gives every existing card a quantity of 1, so nothing changes until the user edits it.

---

## 7. Template System

### 7.1 SVG Template Basics

Templates are SVG files stored in the project's `/templates` directory. They are plain UTF-8 text files, editable by hand or within the app.

Token substitution replaces `{{slug}}` occurrences anywhere in the SVG source — in text content, attribute values, `href` attributes, `fill` values, etc. — with the card's field value for that slug.

**Fixed images:** `{{@asset.<asset id>}}` shows a specific library image — the same on every card — and is used as an image element's `href` (a frame, a logo, a texture). It is replaced with a `data:` URI of the asset at render time. A template may use any number of fixed images alongside any number of per-card image fields. If the asset has been deleted the element renders empty rather than failing. The canvas editor writes this token for the user (§8.4); the asset id is not meant to be typed by hand.

**Substitution rules:**

- If the slug maps to a text field: the value is XML-escaped and substituted as-is.
- If the slug maps to an `image_ref` field: the value is replaced with a `data:` URI of the referenced asset (for rasterization) or a relative file path (for in-app preview).
- If the slug maps to a `color` field: the value is a hex color string, usable directly in `fill` or `stroke` attributes.
- Unknown slugs (no matching field) are replaced with an empty string in export mode, and displayed as a highlighted placeholder in preview mode.

### 7.2 Template Inheritance

Templates support single-level inheritance. A **child template** declares a parent:

```xml
<!-- spadewick:parent="base_card" -->
```

The parent template defines named **slots** — regions where child templates inject content:

```xml
<g id="slot_body"><!-- spadewick:slot="body" --></g>
```

The child template defines **slot content**:

```xml
<!-- spadewick:fills="body" -->
<text>{{name}}</text>
```

At render time, the parent SVG is loaded, each slot's `<!-- spadewick:slot -->` comment is replaced with the child's matching slot content, and then token substitution runs on the merged result. This enables:

- A shared `base_card.svg` with card frame, border, and cost badge.
- Per-type children (`creature_card.svg`, `spell_card.svg`) that inject type-specific layout into the body slot.

### 7.3 Conditional Rendering

SVG groups can be shown or hidden based on a field value using data attributes:

```xml
<g data-spadewick-show-if="type == 'Creature'">...</g>
<g data-spadewick-hide-if="legendary == 'false'">...</g>
```

**Condition expression syntax** is the same minimal language as formula fields. At render time, groups whose condition evaluates to false have `display:none` added to their style.

### 7.4 Dynamic Text Rendering

Text elements with dynamic content use a `data-spadewick-text` attribute to declare their rendering behavior:

```xml
<text
  data-spadewick-field="body_text"
  data-spadewick-text-fit="shrink"
  data-spadewick-text-max-size="14"
  data-spadewick-text-min-size="7"
  data-spadewick-overflow-target="body_text_overflow"
  x="20" y="40" width="180" height="60"
/>
```

**Fit modes:**

| Mode | Behavior |
|------|----------|
| `wrap` | Wraps text to the box width at the element's font size; nothing is shortened. |
| `shrink` | Reduces font size from max down to min until the wrapped text fits the bounding box. |
| `overflow` | Renders at max size; any lines that do not fit spill into the element named in `overflow-target`. The overflow target is another SVG text element, rendered only if overflow occurred. |
| `truncate` | Renders at max size; ends the last visible line with `…` if the text exceeds the bounding box. |
| `clip` | Renders at max size; clips at the bounding box boundary (SVG `clipPath`). |

Bounding box is derived from the element's `width` and `height` attributes or its parent `<rect>`.

**Multi-line text:**

- Any `<text>` with `data-spadewick-field` is rendered as one `<tspan>` per line. Words wrap to the box `width`; a newline in the field value always starts a new line; a single word wider than the box is broken by characters.
- When a box is present, the element's `x`/`y` are the box's **top-left corner** (the first baseline sits one ascent below `y`); `text-anchor` aligns lines to the left edge, center, or right edge of the box. Without a box, the value renders on one line and `y` is the baseline.
- `data-spadewick-line-height` sets the line spacing as a multiple of the font size (default `1.2`).
- `data-spadewick-text-fit` is optional on a bound element; `wrap` (the default) wraps without limit. `shrink`, `overflow`, `truncate` and `clip` use the box height as the line limit (`shrink` and `truncate` accept `…` on the last visible line).
- Text is measured with the fonts themselves (the text engine, §16.2, built in phase 2.1): wrapping, shrinking and truncating use real glyph widths, kerning and ligatures, and the text is drawn as outlines. A project can switch back to the earlier per-character estimate, which the engine replaced, in Project → Fonts… (a per-project setting, `text_engine`); the estimate over-measures by several percent, so boxes needed slack.

*V2: the real font measurements are built (§16.2); text is still to gain inline markup, icons, named styles, keyword rules and further controls (spacing, justification, vertical alignment, outline, improved auto-fit) — see §16.*

### 7.5 Colours (there is no project palette)

> **Removed in schema version 7** (Fixes F11). Earlier versions kept a named colour palette per project, used through `{{@palette.name}}` and `palette("name")`. It is gone: the extra window and the indirection did not earn their place, and a template now never depends on anything outside itself.

Colours are set where they are used:

- **In a template**, an element's fill and stroke are chosen with a colour picker or typed as a hex value (§8.4).
- **Per card**, a `color` field (§5.3) holds a colour for each card; a template uses it with `{{field}}` as a `fill` or `stroke`.

**Upgrading.** When an older project is opened, every `{{@palette.name}}` in a template becomes the colour itself, every `palette("name")` in a template condition or a formula field becomes that colour as a text value, and the user is told how many were replaced. The old palette table stays in the file, unused, so the upgrade can be undone by restoring the automatic snapshot taken first (§13.3). A name that no longer exists becomes empty (an empty fill draws nothing).

**Packages.** Template packages written before this change may list colours; they are written into the template when the package is imported (§7.7.4). New packages carry none.

### 7.6 Project Font Management

The project maintains a library of embedded fonts. Fonts are stored as binary blobs in the project database (or as files in a `/fonts` subdirectory) and referenced by name in SVG templates.

**Font management:**
- Import TTF/OTF/WOFF/WOFF2 files. WOFF and WOFF2 are converted to TTF/OTF on import, because the rasterizer can only load TTF/OTF.
- A font's family name and style are read from the font file itself (its `name` table), not guessed from the file name, since templates refer to the internal family name. Importing the same family and style twice is ignored.
- Project fonts are handed to the rasterizer as font files (resvg-js ignores CSS `@font-face`), so exports render identically on every machine without depending on system fonts.
- **Bundled default fonts:** Liberation Sans, Serif and Mono (SIL Open Font License, shipped with the app) are always available. Text with no `font-family`, an unknown family, or a generic family (`sans-serif`, `serif`, `monospace`) renders with these, so text is never invisible.
- The app UI also loads the fonts so the preview matches the export.
- Unused fonts (not referenced by any template) are flagged for cleanup.


### 7.7 Template Storage: Project Templates, the Library and Template Packages

> **Status: implemented in version 1.9** (without icons, which arrive with §16). Replaces the earlier plan to leave template exchange for later (§15.14) and settles how template packs are delivered (Appendix C). Appendix A (A41–A44) records the decisions taken in the build.

**Principle: a project is self-contained.** Everything a project needs to render and edit its cards — its templates, the fonts, icons and assets they use, and its field definitions — lives **inside the project**. Nothing in a project depends on an app-level library at run time. A project can be copied, snapshotted, duplicated or opened on another machine, and its templates travel with it and stay fully editable.

#### 7.7.1 Three places a template can live

| Place | What it holds | Editable? |
|-------|---------------|-----------|
| **Project templates** | The templates one project actually uses (the ones of §7.1–§7.4) | **Yes**, always, in the template and canvas editors (§8) |
| **Template library** (application level, kept in the app's `data/` folder so it travels with the portable app) | **Starter templates**: read-only designs shipped with the app (blank frames for each card size of §10.6 with trim, bleed and safe guides, and a few example designs). **My templates**: designs the user has saved from a project. **Mockups**: the sample cards (fields, values, images) and preview pictures stored with each library template, so a template can be previewed with realistic data before it is used | Starter templates no (copy them to change them); My templates yes, in the library or, more simply, after copying into a project |
| **Template packages** (`.spadewick-template` files) | A template with everything it needs, as one file (§7.7.4), for exchange by e-mail, download or cloud (§15) | Not edited as a file; opened by importing |

*Terminology note.* "Starter templates" are **designs**. They are not the **manufacturer presets** of §18, which are export settings.

#### 7.7.2 The clone rule

**Using a library template copies it into the project.** The copy contains the template's SVG (and its parent, if it inherits, §7.2), plus the fonts, icons and field definitions it needs. The copy is an ordinary project template: it can be renamed, edited, deleted, and it **never changes if the library changes**.

When the project already contains something with the same name, a short dialog resolves it rather than guessing:

| Clash | Offered |
|-------|---------|
| A field with the same slug but a different type or rules | map to the existing field · rename the incoming one · cancel |
| A template of another card size than the set it is to be used in | refused: a set only uses templates of its own size (§10.6); choose a set of that size, or make a new set from the template |
| A font family and style already present | nothing to do (same file is skipped); a different file with the same family is renamed |
| An icon with the same name | keep mine · replace · rename |

The project remembers the **origin** of the copy (library item, version, date, a content fingerprint) for information only.

#### 7.7.3 After copying

- **Update from library…** appears when the library item has a newer version. It shows what changed (like §19.4's re-import) and lets the user replace the copy or keep both; the copy's bindings are kept where element names match. Nothing is ever updated automatically.
- **Reset to original** puts the library version back over the copy, after confirmation; it is one undoable step (§11.2).
- **Save to library** (on any project template) stores a copy under **My templates**, bundling the fonts, icons and field definitions it uses, and lets the user choose up to 12 cards to store as its **mockup**.
- **Export template package…** and **Import template package…** are in the Template Editor (§7.7.5).

#### 7.7.4 Template package

A `.spadewick-template` file is a ZIP (the same ZIP rules as snapshots, §11.1) containing:

- a **manifest**: name, description, author, licence text, version, card size, the app version it was made with;
- the template SVG(s) and any parent template;
- **fonts** (only those the exporter confirms may be redistributed), **icons**, **field definitions** (names, slugs, types, defaults, validation);
- **mockup**: sample cards as CSV or JSON, their images, and preview PNGs.

*Import* asks where to put it — **Library** or **this project** (the default is both: add to the library and use here) — and applies the clone rule. *Export* warns when a bundled font's embedding flag forbids redistribution or the font is not known to be freely redistributable, and asks the exporter to confirm that they have the right to distribute every font and image included. **Limits:** 100 MB, a maximum number of files, ZIP safety checks as in §14.7, and all SVG and icons sanitised on import. A package never contains project card data other than its mockup.

#### 7.7.5 Where the user meets it

- **New set:** the **New set** dialog asks for a name and a card size (Poker preselected); **New set from template** opens the library for every size and makes a set of the template's size (§10.6).
- **The Template Editor is the one place for templates** (there is no separate manager window; Fixes F10). Its left list shows the templates of the active set's card size, can be closed to a thin rail, and can be resized (§12.5). **+** makes a new template: a name and a card size, which is **locked** once the template exists. **Library…** opens the template library (starter templates and My templates, with thumbnails and licence text) to use one in the project, and **Import package…** reads a package. A **Template** menu on the open template offers *Rename*, *Duplicate*, *Save to library*, *Export as a package*, *Update from library*, *Reset to the library version* and *Delete*. The library shows only templates of the active set's card size, except when making a set from a template.
- **Teams:** a package is a file, so it can be pulled from and pushed to a cloud folder like any other file (§15.2); a received package is imported into the project through the clone rule, and a linked package shows "remote has changes" like a CSV (§15.7).

#### 7.7.6 Data model

Schema version 6 (§13.3): a template gets `origin` (JSON: source `blank | library | package | svg-import`, item id, version, fingerprint). The library lives on disk, not in a project database: `data/library/mine/<id>/` holds each of the user's templates in the layout of a package (manifest, SVGs, fonts, assets, mockup); the folders themselves are the index, so there is no separate index file. Starter templates are built into the application.

#### 7.7.7 Verification

Integration tests: cloning (template with a parent, fonts, icons, fields) into an empty project and into one with clashes (every row of the table above); that a project renders and opens **after the library has been deleted**; origin recorded; update/reset flows and their undo; save-to-library bundling and mockup rendering; package export/import round trip and rejection of malformed, oversized and hostile packages; font-redistribution warning. End-to-end tests of the Template Editor and its library dialog (keyboard, axe in both themes, §14.4); strings lint (§14.5).

---

### 7.8 Card Backs

> **As built (A81, 2026-10-06).** Every set has a **Template** and a **Card back** slot (the sidebar, under the card size). The card back is a template of the set's card size, drawn with the card's own data, so a back may show a field (a deck name, a colour) or nothing at all. A card may have a back of its own (the *Card back* column of the card table; empty means "the set's"), for a second deck or a double-faced card. The slots and the column only accept templates of the set's size (§10.6); changing the set's size clears a back that no longer fits; deleting a back takes it from the sets and cards that used it, and one step of undo brings it all back.

- **Making one.** *New back…* in the sidebar makes a template of the set's size from a starting design (classic lattice, plain border, soft glow; colour and accent chosen) with an image layer called `emblem` for a logo, makes it the set's card back and, if asked, opens it in the Template Editor. The Template Editor marks the templates used as backs with a *back* tag. The template library has four card backs (poker and tarot) that are used *as the set's card back* instead of as the front; a template that is only ever a back is saved to the library as a back.
- **Seeing it.** The preview pane has a Front / Back switch (off when the card has no back); it follows a change of the card's back at once.
- **Exports.** The default card back of every export is now *The set's card back* (a plain colour on cards that have none, as before; the colour, a picture and *none* remain as choices). Tabletop Simulator: cards that share a back share one image, and each different back gets its own deck sheet; a back that shows each card's own data gets a sheet of backs (`UniqueBack`). Print PDF: the backs of the interleaved duplex pages are each card's own. Production PDF and per-card images: one back picture for each different back (one for every card whose back shows its data); the layouts *once*, *after* and *separate* follow it. Cards with the same back share one picture (`drawsTheSameOnEveryCard`).
- **Checks.** The print readiness check says when no card has a back (information) or some do not (warning), and checks each back as it checks a front (pictures, safe area, text size, ink, edge) naming it "(back)". The text check draws the backs too. Snapshot compare lists a card whose back changed and can put the old one back. The command line renders a back (`render --side back`) and lists the slots; the card table export has a `_back` column.
- **Schema 11:** `sets.default_back_template_id`, `cards.back_template_id`. A latent defect was fixed on the way: undoing a change of a *set* row replaced the row, and replacing a set deletes its cards; rows that are still there are now updated in place.

### 7.9 The Virtual Table

> **As built (A82, 2026-10-06).** A *Table* tab for playtesting alone, without printing. *New table…* puts the sets of the project on the table as decks (a card as many times as its copies, or once; shuffled or not), with one to six hands, and deals a number of cards to each. Decks are piles; a card on its own is a pile of one; a hand is seen face up.

- **Moving.** Dragging a deck takes its top card (Shift-drag, or the grip above the pile, moves the whole pile); a card lets go onto the table, onto another pile (it lies on top; a stack turned over when the faces differ), or into a hand (at the place of the pointer). Hand cards are reordered, played onto the table (face up) or onto a pile, and passed to another hand. Double-click, or **F**, turns a pile over (the order reverses, as a stack does); **S** shuffles, **R** turns a quarter, **D** draws to the chosen hand, **Shift+D** deals one at a time to every hand, **L** or Enter looks through the pile (every card, filter, take into a hand or onto the table), arrow keys nudge (Shift: further), a pile can be named, locked in place, and *Collect* puts every card back, face down. Hovering or focusing a card shows it large. The table zooms.
- **Dice and counters.** A die of 4 to 20 sides (or any number from 2 to 100 through the action) rolls when pressed; a counter counts with plus and minus; both move and carry a label.
- **Undo and redo** (the Edit menu) step through the moves; *Deal* is one step.
- **Saving.** *Save* and *Open…* keep tables as files in the project's `tables` folder (not part of a snapshot); a table is checked when opened (every card exactly once), and cards deleted since are named and shown without a picture.
- **Pictures** are drawn by the application (fronts, and backs by the key of §7.8, so cards with one back share one picture), at a size that stays sharp when zoomed; *Redraw pictures* draws them again after a template changed.
- **Keyboard and screen readers.** Everything the pointer does has a key or a button (piles and hand cards take focus, hand cards move with the arrow keys, Alt+arrows reorder, Enter plays, Shift+Enter plays face down, the context-menu key opens the menu), and every pile and card has an accessible name.
- **Built to be shared later (A82).** The table is plain data and one pure function (`shared/table.js`: `reduce(state, action)`), every move is one JSON action, and anything random (a shuffle, a roll) carries its own seed; the same actions in the same order give the same table on any machine. A multi-player table over a peer-to-peer connection is §22.

### 7.10 Components and the Component Library

> **As built (A83, 2026-10-06).** A *component* is a reusable part of a template (a cost badge, a frame ornament, a stat box) kept in the **component library** with the template library, so every project can use it. The Template Editor's *Components* button opens the library; *Make component…* (Arrange section) keeps the selection in the library and turns it into an instance in the template.

- **A template stays complete on its own (A55).** Using a component *copies* its parts into the template, inside a group that remembers where it came from (`data-spadewick-component`, `-name`, `-version`); nothing is read from the library when a card is drawn, and a component deleted from the library leaves the template as it was. Each named part keeps its library name in `data-spadewick-part`; the definitions it uses (gradients, filters) come with it under free names, so two copies never share one. A canvas of another width scales the component.
- **Instances.** The panel of an instance names the component and its version and says when the library has a newer one or none. **Update from library** replaces the parts and puts back the colours and words that were changed (fill, outline and text of a named part, set in the panel and kept as overrides); **Back to the library's colours and words** drops them; **Save changes to library** makes what the instance holds the next version (its overrides become part of it); **Detach** makes an ordinary group. A click on a part picks the part; its panel offers *Select the component*.
- **The library** (dialog): thumbnails, search, insert, rename, delete, *Save as file…* and *Add from a file…* for sharing a component as a `.json` file (read back as a new component, never replacing one). It says which fields a component shows that the open set does not have. Pictures of the project's image library that a component uses are put inside it as data, and scripts, event handlers and references to the outside are taken out of anything saved or read.
- Limits: 400 parts to a component; fonts are named, not bundled.

### 7.11 The Rules

> **As built (A84, 2026-10-06).** A *Rules* tab: the rules of the game as **pages of Markdown in a tree**, kept in the project (schema 12, table `rules_pages`), so a snapshot has them. A list of pages, a text to write in and the page as it reads (Write, Both, Read); the text is saved a moment after typing stops, when another page is opened and when the tab is left.

- **Formatting.** The reader (`shared/markdown.js`) covers headings 1–6, paragraphs and line breaks, strong, emphasis, strike-through, code and fenced code, quotes, bulleted, numbered and task lists (nested by indenting), tables with alignment, rules, links and pictures. Nothing written reaches the page unescaped: HTML is shown as text, and links are only the web, a mail address, another page or a heading. A toolbar and the keys (Ctrl+B, Ctrl+I, Ctrl+K) insert the marks.
- **References.** `![alt](asset:Name.png)` a picture of the project's library; `[[Card name]]` a link to a card (opens it in the card table; one that is not there is marked); `![[Card name]]` the picture of a card; `[text](page:Title)` another page; `[text](#heading)` a heading. A dialog picks a card or a page; the image picker inserts a picture.
- **Pages.** New page, subpage, rename (the title box), delete (with the pages below, one step of undo), move up, down, in and out (buttons; arrow keys in the list), fold. Page structure is undoable; the text has the undo of its box (Ctrl+Z in the box goes back in the text).
- **Import and export.** *Add Markdown files…* and *Add a folder…* (also *under this page*): the title is the first level-one heading or the file name; in a folder a file's pages are in a folder of the same name, and a folder with no file becomes a page with no text; pictures beside a file are put into the image library and pointed to from there; the whole import is one step of undo. *Save this page as Markdown…*, *Save all pages as Markdown files…* (a `rules` folder: `01-title.md`, a page's pages in a folder of its own, pictures in `images`) and *Save all pages as one web page…* (contents, pictures and card pictures inside, pages linked; it prints one page per chapter). What is saved can be added again as the same tree.
- **Snapshot compare** lists pages added, removed and changed and can put the old page back.
- Limits: 1000 pages; 1,000,000 characters a page; 500 files an import.

## 8. Canvas Editor

### 8.1 Overview

The canvas editor provides a visual, WYSIWYG way to design templates. It is not a replacement for the SVG source editor — it is a layer on top of it. Underlying changes always produce valid SVG source.

The canvas displays:
1. The rendered SVG preview at 100%: one card unit is one screen pixel (Konva background).
2. Selectable, draggable, resizable handles (Konva objects) overlaid on SVG elements that have a `data-spadewick-id` attribute.

### 8.2 Selectable Elements

Only SVG elements that have been given a `data-spadewick-id` attribute are interactive in the canvas editor. Elements without this attribute are displayed as background content only.

The selected element's resize handles are always drawn and hit-tested above every other element's click area, so an element in front of another can always be resized (Fixes F4).

When the user drags or resizes a handle, the corresponding SVG element's position/size attributes (`x`, `y`, `width`, `height`, `transform`) are updated in the SVG source in real time.

**Transforms and nesting:**

- Elements inside groups that carry `transform` (translate, scale) are displayed and edited in card coordinates: the handle sits on the element as drawn, and edits are converted back into the element's own coordinate system.
- Rotated elements are shown by their axis-aligned bounds. They can be moved (the move is written as a `translate` prepended to the element's transform) and rotated from the properties panel, but not resized by dragging; reset the rotation to resize.
- Groups (`<g>`) and other elements without intrinsic geometry can be moved but not resized.
- Text with no `width`/`height` box has no size of its own: its corner handles scale the font size proportionally, and editing W or H does the same. Choosing a fit mode gives the text a box (see §7.4).

### 8.3 Canvas Toolbar

| Tool | Function |
|------|----------|
| Select (V) | Select and move/resize elements |
| Text (T) | Click to insert a new `<text>` element with a field binding |
| Image (I) | Click to insert a new `<image>` element with a field binding |
| Rectangle (R) | Draw a rectangle; becomes a `<rect>` element |
| Ellipse (E) | Draw an ellipse; becomes a `<circle>` or `<ellipse>` |
| Grid Toggle | Shows/hides an alignment grid drawn in two tones, a dark line with a light line beside it (stronger every 50 units), so it shows on any card colour |
| Snap Toggle | Enables pixel-snap or grid-snap |
| Rulers | Shows rulers in card units that follow the zoom and the scroll (A79) |
| Guides *(urgent, §8.7.4)* | Toggles snapping to card edges and other elements, with alignment lines |
| View source *(urgent, §8.7.1)* | Opens the SVG source in a dialog (template editor toolbar) |

*As built (A79, 2026-10-05): the canvas controls.* **Zoom** (replacing A57): Ctrl+wheel and a trackpad pinch zoom around the pointer, Ctrl+plus, Ctrl+minus, Ctrl+1 (100%) and Ctrl+0 (fit), View → Zoom In, Zoom Out, Actual Size and Fit to Window, and a zoom bar over the corner of the canvas (minus, a menu of steps, plus, Fit). The range is 10% to 800%. The canvas opens at 100%, or smaller when the card does not fit the window. The card picture is drawn again at the new size once the zoom has settled, so it stays sharp. **Pan:** hold Space and drag (while the pointer is over the canvas), or drag with the middle button; the scroll bars still work. **Rulers** are fixed to the edges of the view, labelled in card units, with a step that follows the zoom, and show the extent of the card. **Grid:** the same two-tone line, one screen pixel wide at any zoom; at 100% it is as before (10 units, stronger every 50), zoomed out the fine lines drop away first, zoomed in a finer step appears. **Tools** are icons with their key (V, T, I, R, E) as the tooltip; the view switches (Grid, Trim and bleed lines, Snap, Guides, Rulers) sit together in a group; Escape lets go of the selection. **Selection:** an element is outlined when the pointer is over it and by square handles once selected; a small label shows its size while it is resized and its position while it is moved. **Properties panel:** the same fields in collapsible sections (Position and size, Content, Text, Typography, Appearance, Arrange, Show or hide). Everything the editor writes to the SVG is in card units whatever the zoom. Not built, on purpose: a rotation handle (rotation stays a number in the panel), a hand tool button, and changes to the layers panel.

*As built (A80, 2026-10-06): editing several things at once, and a fuller Appearance.* **Selecting several:** Shift or Ctrl+click adds an element to the selection or takes it out (also in the layers panel), a rubber band on empty canvas selects what it touches (Shift adds), Ctrl+A selects everything that is not hidden or locked, Escape lets go. Several elements show one block with the usual handles: dragging any of them moves them all (snapped as one block to the card, to the others and to the grid), resizing the block scales each with it, the arrow keys nudge all, Delete removes all; each is one step of undo, and Escape in the middle of a drag leaves everything where it was. **Copy, cut, paste, duplicate** (Ctrl+C, X, V, D and the Duplicate button): pasted elements go on top, a little further each time, with free names (`a_copy`, `a_copy2`); the copy is kept for the next template too, and carries the gradients and effects it uses. **Group and ungroup** (Ctrl+G, Ctrl+Shift+G, and buttons): a group is a `<g>` that keeps its place among the layers; taking one apart puts its transform and inherited look into the children, and is refused, with the reason, for a group that has opacity, an effect or a condition. **Align and distribute:** buttons in the toolbar align the edges or centres of the selection (one element aligns to the card, several to the block that holds them) and space three or more evenly across or down; locked elements stay. **Rotation:** a round handle above the element turns it about its centre (Shift snaps to 15 degrees; a label shows the angle); it is written as `rotate(angle cx cy)` as before, and the Rotation number in the panel stays. **Appearance:** fill is a colour, a **linear gradient** or a **radial gradient** (two or more stops with colour, position and angle; each element gets definitions of its own, `grad_<id>`), stroke has width, solid, dashed or dotted lines, ends and corners (the dash follows the width), opacity, a **blend mode** (a `mix-blend-mode` in the style), a **drop shadow** (x, y, blur, colour, opacity) and a **blur** (a filter of its own, `fx_<id>`); all of it applies to every selected element, draws in every output (checked on shapes and on text) and shows as an outline only while the element is being dragged. **Colours of the template:** the colours the template already uses are offered as small swatches under the fill and the stroke. This is *not* a palette (A55): nothing is stored apart from the template, and nothing refers to anything outside it. **Text styles:** a project text style is applied to a text as a **copy** of its values (font, weight, slant, colour, tracking, small capitals, outline, shadow), and the look of a text can be saved as a new style; a template never depends on the project's styles. **Typing on the canvas:** double-click a text, or press Enter on it, to type its words where it sits (the box has the text's size at the current zoom; Enter is a new line, Ctrl+Enter, Escape or clicking away finishes; one step of undo); a new text in a project with no text field is typed at once. A text that shows a field is not typed on (its words come from each card): double-clicking it says so. **Not built, on purpose:** turning several elements at once, Alt-drag to copy, stroke alignment inside or outside (SVG has none), pen and path tools, boolean operations, constraints and components, and layers panel changes.

### 8.4 Properties Panel

When an element is selected in the canvas, a properties panel shows:

- **Position:** X, Y (editable number inputs).
- **Size:** Width, Height (editable; with lock-aspect-ratio toggle).
- **Field binding:** Dropdown to select the field slug bound to this element. For image elements the dropdown also offers **Fixed image (same on every card)…**, which opens the asset picker; the chosen image's name is shown with a Change image button, and choosing None removes it.
- **Text properties (text elements):** Font family, size, weight, style, alignment, fit mode, line height (when a fit mode is set).
- **Rotation:** Angle in degrees about the element's center, written as `rotate(angle cx cy)` in its `transform`.
- **Fill / stroke:** Colour picker or a hex value (§7.5).
- **Opacity.**
- **Z-order:** Bring forward / send backward / bring to front / send to back.
- **Conditional:** Show-if / hide-if expression input.
- **V2 additions:** rich-text switch, the text controls of §16.6, and the trim / safe / bleed guides of §17.4. Templates can be created by **importing an SVG** from another design tool (§19).

### 8.5 Card Picker in Canvas

The canvas shows one card at a time. A card picker at the top of the canvas allows switching between cards in the set to verify the template renders correctly for different data. The picker shows the card's display name.

### 8.6 SVG Source Editor

> **Urgent change (§8.7.1):** the source is no longer shown beside the canvas; a **View source** button opens it in a dialog. The editor described below is unchanged.

A split-pane or tab view provides the raw SVG source alongside the canvas. Changes in the source editor are reflected in the canvas immediately on save/focus-loss. The source editor is a plain `<textarea>` with a syntax-highlighted layer behind it (tags, attributes, values, `{{tokens}}` and comments are coloured; the colours meet WCAG AA contrast in both themes). There is no external editor dependency.

**Editing history:** the template editor keeps its own undo/redo of unsaved edits (canvas drags, property changes, source typing). While a template is open, Undo/Redo step through those edits first, so work-in-progress is never mixed up with changes to card data. Only when there is nothing left to undo in the editor does Undo fall through to the project history. Saving records one project-level undo entry (§11.2).


### 8.7 Template editor improvements (urgent)

> **Status: urgent. Built and verified in a browser run of the end-to-end suite; not yet exercised in the packaged desktop window** (added after a hands-on review of version 1.9; what the build left out is listed under each item as *not built*). Four changes to the template editor and canvas editor, in the order the designer meets them: source code on demand (§8.7.1), a layers panel (§8.7.2), live image resizing (§8.7.3) and edge snapping with alignment guides (§8.7.4). They change §8.3 (toolbar), §8.4 (properties panel) and §8.6 (source editor), and are scheduled as phase 0.6 of §24.2. Appendix A (A50–A53) records the decisions. Priorities use *must* (the feature is not done without it), *should* and *could*.

#### 8.7.1 Source code on demand

**Today.** The template editor has a Source / Split / Canvas switcher, and by default shows the SVG source in a pane beside the canvas. For most designers the code is noise, and it takes half the width away from the canvas.

**Requirement.**

- **Must:** remove the always-visible source pane and the Source / Split / Canvas switcher. The canvas and the properties panel use the whole width.
- **Must:** add a **View source** button to the template editor toolbar (a label as well as an icon, so it is not an unlabelled symbol). It opens the source in a dialog.
- **Must:** the dialog contains the existing source editor unchanged (§8.6): the textarea with the syntax-highlighted layer, the AA colours in both themes, the forced-colours fallback. It follows the dialog rules of §14.4 (focus moves in, Tab stays inside, Escape closes, focus returns to the **View source** button).
- **Must:** edits apply as they are typed, as they do today; there is no separate Apply step. Closing the dialog keeps them. The template editor's own undo history (§8.6) records them exactly as before, so Undo after closing the dialog still steps back through them. A **Revert** button in the dialog restores the source as it was when the dialog opened, as one undo step.
- **Must:** when the source is not valid SVG, the dialog shows the parse error with its line number, the canvas keeps showing the last valid version, and the template can still be closed (the unsaved-changes rules of the editor apply).
- **Should:** when an element is selected on the canvas, the dialog opens with the caret at the start of that element's tag and scrolled into view.
- **Could:** the dialog is resizable and remembers its size for the session.

**Not changed.** Templates are still plain SVG text, editable by hand (§7.1); only where the text is shown changes.

#### 8.7.2 Layers panel

**Today.** Stacking order can be changed one step at a time with four buttons in the properties panel (§8.4), and only for the selected element. To move an element from the back to the middle of a busy card the designer must click repeatedly, and cannot see the order.

**Requirement.** A **Layers** panel next to the canvas lists the card's elements in stacking order, and lets the designer reorder them directly.

- **Must: the list.** Every element that is selectable on the canvas (it has a `data-spadewick-id`, §8.2) is one row, **front-most at the top**, which is the reverse of the order in the SVG source (the last element is painted on top). A row shows a type icon (text, image, rectangle, ellipse, group), a label and, for a bound element, its field (`name`, `art`). The label is the element's visible text, else its field, else its id. Groups show their children indented and can be collapsed. Elements without an id are background content (§8.2) and are not listed; a line under the list says so.
- **Must: selection.** Clicking a row selects the element on the canvas, and selecting on the canvas highlights and scrolls to its row. The panel and the canvas never disagree.
- **Must: reordering by pointer.** Dragging a row to a new position moves the element in the SVG source (a drop line shows where it will land). The canvas redraws within 200 ms. One drag is **one undo step** of the template editor (§8.6).
- **Must: reordering by keyboard.** With a row focused, **Alt+Up** and **Alt+Down** move the element one step, **Alt+Home** to the front (the top of the list) and **Alt+End** to the back. These do the same as the four buttons of §8.4, which stay. Dragging is a pointer shortcut only; nothing in the panel is pointer-only (the lesson of A48). After a move, a polite live region announces it ("Title moved to position 3 of 7").
- **Must: scope.** A row can be moved among its siblings, inside its own group or at the top level. Moving an element into or out of a group is **not** part of this change (§22).
- **Should: visibility and lock.** Each row has two toggles. *Hide* removes the element from the editor's view (the preview is rendered from a copy of the source with the element hidden). *Lock* makes its canvas handle unselectable and undraggable. Both are **editor-only view state**: they are not written to the SVG, not exported, and reset when the template is closed. A hidden or locked row says so in words as well as with an icon (§14.4, colour is never the only signal).
- **Should:** double-clicking a row, or pressing **F2** on it, renames the element's id (`data-spadewick-id`). The new id must start with a letter or underscore, use only letters, digits, dots, dashes and underscores, and be unique in the template; otherwise the panel says why and keeps the old id. Nothing else refers to this id (`data-spadewick-overflow-target` names the element's ordinary `id` attribute, which is not touched), so only the attribute changes, as one undo step.
- **Placement and size.** The list is the **bottom half of the properties panel**, under the properties, and the two are split by a draggable divider (§12.5) with each half scrolling on its own; there is no separate layers panel. It must stay responsive with 200 elements.
- **Accessibility.** The list is a labelled region, every row has an accessible name that includes its type, position and state, focus is visible, and the panel passes axe in both themes (§14.4).

#### 8.7.3 Live image resizing

**Today.** Dragging a resize handle moves only a thin outline. The image itself stays at its old size until the handle is released and the card is rendered again by the main process (a round trip with a 200 ms delay). The designer cannot judge the result while resizing. Moving an element has the same lag.

**Finding: it is possible, for images first.** The picture on the canvas is a bitmap rendered in the main process, which is why it cannot follow the handle. It can follow if the editor draws the moving element itself during the drag, then lets the main process produce the authoritative picture on release:

1. When an element is selected (not at drag start, so a drag never waits), the editor asks the main process for **the card without that element** (the normal render call, §10.5, given a copy of the source in which that element is hidden) and keeps it ready while the element is selected.
2. During a drag or resize, the editor draws the element itself on the overlay, following the handle every frame. For an **image** it draws the source picture (a preview copy of at most 2048 px on its longest side, fetched through `assets:get-preview` the first time the image is selected and then kept) with the element's own fit rule: `preserveAspectRatio` `meet` (the default), `slice` or `none`, so the picture does not distort differently from the final render.
3. On release the geometry is written to the SVG (one undo step, as today), the normal render replaces the overlay, and the two must agree to within 1 px, so there is no visible jump.

**Requirement.**

- **Must:** images (a field of type `image_ref`, or a fixed image `{{@asset.<id>}}`, §7.1) follow the handle while it is dragged, for both resizing and moving, at 30 frames per second or better on a 500 × 700 px card with a 4000 × 4000 px source image.
- **Must:** nothing is written to the SVG until release; a cancelled drag (Escape) leaves everything unchanged.
- **Must:** if the two prepared pictures are not ready when a drag starts, the drag is never blocked: it falls back to today's behaviour (outline only) for that drag.
- **Should:** rectangles and ellipses are drawn live the same way (fill, stroke, corner radius, opacity).
- **Could (built, A77):** text and groups are shown live by re-rendering at most every 120 ms during the drag, so the picture follows with a short lag; exactly live text would need the text engine of §16.2 in the screen process, and it runs in the main process, so the lag stays. The card is rendered again with the element at its dragged place (the same geometry code as the release, `geometryApplied` in `CanvasEditor.svelte`), nothing is written to the SVG until release, Escape puts the first picture back, and a render that arrives after the drag has ended is dropped. Images, rectangles and ellipses keep their own frame-rate stand-in. Verified in the browser run of the end-to-end suite (text drawn at the new place before the mouse is released, gone from the old one, Escape restores); not yet looked at in the packaged window.
- **Built as:** images, rectangles and ellipses whose fill and stroke are plain colours are live; an element with a field-bound fill, a gradient, a `style` attribute, a rotation or a non-uniform parent scale falls back to the outline.
- **Spike (done in a browser run).** The feature was built first and then measured, using Chromium-based Edge 154 through the end-to-end harness, on a 500 × 700 px card with a 4000 × 4000 px source image. Results: the render of the card without the element took **63–67 ms** (limit 150 ms); a resize drag held **58 frames per second** with a worst frame of 50 ms and a 95th-percentile frame of 17 ms (limit 30 fps); fetching the 2048 px preview of that image took 0.4 s, once, in the background after the image is selected, so it never delays a drag. The numbers come from a browser and software rendering, not from the packaged Electron window, so a quick look in the real window is still worth doing. The spike measures the render of "card without the element" and the frame rate above on a mid-range laptop. **Pass:** the render takes under 150 ms and the frame rate holds. **If it fails:** keep the outline but also draw a half-transparent copy of the element's picture inside it (still live, less exact), and record the result in Appendix A.

#### 8.7.4 Edge snapping and alignment guides

**Today.** The **Snap** toggle rounds positions to whole pixels, or to the 10 px grid when the grid is shown (§8.3). There is no snapping to other elements or to the card's edges, and no visual help with alignment.

**Requirement.** A new toggle, **Guides**, next to **Snap** in the canvas toolbar (and in the View menu with the other canvas toggles, §12.2). **Snap** keeps its current meaning.

- **Must: what snaps.** (The trim and safe lines are not offered yet, because they arrive with §17.4; the card edges, the centre lines and the other elements are.) While an element is dragged or resized, its left, centre and right lines, and its top, middle and bottom lines, snap to the matching lines of the **targets** when they come within **6 screen pixels**. Targets are the card's edges and its centre lines, the trim and safe lines when they are shown (§17.4), and the same six lines of every other visible element. When resizing, only the edges being moved snap; a resize that keeps the aspect ratio (the lock, circles, text without a box) does not snap, because moving one edge alone would break the ratio.
- **Must: what is shown.** A snapped line is drawn across the canvas, from the moving element to the element or card edge it snapped to, in a guide colour that has at least 3:1 contrast against both the card and the canvas background, in both themes. Under forced colours it uses the system highlight colour. The lines exist only during the drag: they are not written to the SVG, not exported, and disappear on release.
- **Must: overrides.** Holding **Alt** while dragging suspends guide snapping for that drag. When no target is in range, **Snap** (pixel or grid) applies as before; when a target is in range, the guide wins.
- **Must: precision.** Snapped positions are written as exact values,. Rotated elements use their axis-aligned bounds (§8.2).
- **Must: remembered.** The toggle state is kept between sessions (the setting `canvas_smart_guides`, §12.3), **on by default**.
- **Should: distances.** While an element is dragged, a small label on a line shows the gap in pixels to its nearest neighbour on each side (only neighbours it overlaps in the other direction, so a gap is always a straight line between two facing edges). When the gaps on the two opposite sides are equal (to within half a pixel) both are drawn heavier. Alt hides them with the guides.
- **Should (built as stated):** nudging with the arrow keys does not snap (it is a precise tool); the X and Y fields of the properties panel (§8.4) stay the exact, keyboard-only way to place an element.
- **Performance.** Finding targets takes under 4 ms per frame with 200 elements, so dragging stays at 60 frames per second.
- **Accessibility.** The toggle is a button with `aria-pressed`. The guides are a visual aid only: every action they help with can be done from the properties panel or the layers panel by keyboard.
- **Reduced motion.** Guides appear and disappear without animation.

#### 8.7.5 Verification

Unit tests of the new pure helpers, which are kept free of the screen so they can be tested: the snapping function (candidates, threshold in screen pixels, edge versus centre, resize, the Alt override) and the layer-order function (front-to-back list from an SVG, reorder within siblings, groups). End-to-end tests (§14.4): the **View source** dialog (axe in both themes, focus in and back, Escape, editing and undo, a parse error); the layers panel (keyboard reordering with Alt+arrows, the live announcement, selection in both directions, axe in both themes); the **Guides** toggle (state kept between sessions, `aria-pressed`). The live-resize frame rate and feel are checked by the spike of §8.7.3 and a manual pass on a real desktop, since the end-to-end suite has no real window (Appendix B). Strings lint (§14.5): every new label is in `src/shared/strings.js`.

---

## 9. Asset Library

### 9.1 Asset Storage

Assets (card art, icons, textures, card back images) are stored in the project's `/assets` directory. The database stores metadata for each asset:

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID | Stable identifier |
| `filename` | string | File name within `/assets` |
| `original_name` | string | Name at import time |
| `mime_type` | string | `image/png`, `image/jpeg`, `image/svg+xml`, `image/webp` |
| `width_px` | integer | Pixel width |
| `height_px` | integer | Pixel height |
| `file_size_bytes` | integer | File size |
| `tags` | JSON array | User-assigned tags |
| `notes` | text | User notes |
| `created_at` | timestamp | Import time |

### 9.2 Asset Browser UI

The asset browser is a panel accessible from the sidebar and from image-ref cell pickers. It shows:

- A grid of thumbnails (small / medium / large size toggle).
- A search bar (searches filename, original name, tags, notes).
- Tag filter chips (click to filter by tag).
- Unused assets filter (shows only assets not referenced by any card field or placed as a fixed image in a template).
- Sort by: name, date added, file size.

### 9.3 Asset Operations

- **Import:** Drag-and-drop, file-picker, or **Import from cloud…** (§15.8 W4). Multiple files at once. Supported formats: PNG, JPEG, WEBP, SVG. Files are copied into `/assets` with a UUID-derived filename to avoid conflicts.
- **Tag management:** Click asset → tag editor in properties panel. Tags are free-form strings with autocomplete from existing tags.
- **Upload to cloud / Refresh from cloud:** push an asset to a connected account, or re-pull an asset that was imported from one (§15.8 W4, W6).
- **Replace:** Swap an asset's file while preserving its ID — all cards referencing this asset ID automatically pick up the new image without any field edits.
- **Delete:** If an asset is referenced by one or more cards, a warning lists those cards. The user must confirm; deletion removes the file and the metadata row (references on cards become broken — shown as a missing-image indicator).
- **Usage tracking:** Each asset's detail view shows a list of cards that reference it, with a "Navigate to card" button, and a list of the templates that place it as a fixed image (§7.1). The delete warning names both.
- **Export:** Assets can be individually exported (copied) to a chosen folder under their original file name; an existing file is never overwritten (a numeric suffix is added).
- **Missing images:** A card field that refers to a deleted asset shows a missing-image indicator in the card table.

### 9.4 Thumbnail Generation

On import, the app generates a 256×256 thumbnail and stores it in the project database as a JPEG blob. Thumbnails are used in the asset browser and in the card editor's image-ref cells to avoid re-loading full-resolution files constantly.

---

## 10. Export System

### 10.1 Export Dialog

The export dialog is a modal with tabs for each export target. Common settings across all targets:

- **Set selection:** Export one set, multiple sets, or all sets.
- **Card selection:** All cards, selected cards only, or a filter expression.
- **Card back:** None, a solid color, or an asset from the library.
- **Output directory:** Defaults to the project's `/exports` folder. Overridable. Optionally also saved to a connected cloud folder (§15.8 W7); the local copy is always written first.
- **Copies:** each card is exported `quantity` times (§6.5). A set whose cards all have quantity 0 cannot be exported.
- **Card selection:** The filter is an expression in the formula language, e.g. `faction == 'Red'`, `cost > 4` or `quantity > 1`; "selected cards" uses the cards selected in the card table.
- **File name template:** A pattern like `{{set_name}}_{{date}}` for output file names. Available tokens: `{{set_name}}`, `{{project_name}}`, `{{date}}` (YYYY-MM-DD), `{{time}}` (HHMM), and for per-card files `{{card_id}}` (§5.8). The default is `{{set_name}}`. The result is always made filesystem-safe.

### 10.2 Tabletop Simulator Export

TTS decks are represented as PNG sheets plus a JSON save file. The sheet sizes, the deck scale and the table layout follow the saved decks Dextrous writes (§10.2.2).

**Sheet layout:**

- Cards are arranged in a grid, left-to-right, top-to-bottom.
- The grid is chosen from the card shape (§10.2.2): 8 columns for cards about as wide as a poker card, 7 for taller ones, up to 7 rows, one slot kept for the card back. A set that exceeds the cards a sheet holds — counting every copy (§6.5) — gets several sheets.
- The last slot of each sheet is the card back image. A sheet has only the rows it needs.
- Card size comes from the set (§10.6): the default 500×700 px is Poker's shape; selecting a preset sets the pixel aspect ratio to match.
- Sheet DPI is not relevant for TTS; pixel dimensions matter.

**Output files:**

```
exports/
  my_set_face.png      # Front face sheet (or my_set_face_1.png, _2.png for multiple sheets)
  my_set_back.png      # Card back (single image at same resolution as one card)
  my_set.json          # TTS saved object file with DeckIDs, CustomDeck, and ContainedObjects
```

**TTS JSON structure requirements:**

The exported `.json` file must be a valid TTS "Saved Object" that can be imported via Tabletop Simulator's "Load Object" menu. It must include:

- `SaveName`, `GameMode`, `Date`, `VersionNumber` (standard TTS fields; use defaults).
- `ObjectStates` array with one Deck object for each set (a set of one card is a single Card object), containing:
  - `CustomDeck` map: one entry per sheet, with `FaceURL` and `BackURL` (the image links, §10.2.1), `NumWidth`, `NumHeight` (the grid of that sheet), `BackIsHidden` (true), `UniqueBack` (false, or true for a sheet of backs), `Type` (0).
  - `DeckIDs` array: one entry per card (100×sheet_index + slot_index).
  - `ContainedObjects`: one entry per card with `Name`, `Nickname` (card display name), `Description` (card notes field or empty), `CardID`, and a `Transform` (face down).
  - `Nickname` (the set name), `Description` and `LuaScript` (empty), and a `Transform` as described in §10.2.2.

**TTS export settings (per set):**

- Card pixel width and height.
- Whether to generate the JSON companion file.
- Card display name field (which field maps to TTS `Nickname`). When the chosen field is **rich text** (§16), the markup is removed and icons are written as their names, so the game shows plain readable text.
- Card description field (which field maps to TTS `Description`).

#### 10.2.1 Image links in the TTS file

> **Status: built** (Fixes F13). Local file links are the first way; hosted links are deferred (§22.4).

**The problem.** Tabletop Simulator reads each deck's `FaceURL` and `BackURL` as an address to fetch, not as a file next to the JSON. A bare file name such as `my_set_face.png` is taken for a web address, and TTS reports *"WWW Image Error: Cannot resolve destination host at [my_set_face.png]"*. The PNG sheets are fine; the JSON just did not say where they are. TTS has no way to put the pictures inside the JSON (they must be an address or a path), so the choice is what to write as the address.

**Goal.** An export that loads in TTS on the machine that made it, with no account, no upload and no network: the JSON points at the sheets on disk.

**Modes.** The TTS export has a setting **Image links**, remembered between sessions (`tts_image_links`, §12.3):

| Mode | `FaceURL` / `BackURL` | Use |
|------|----------------------|-----|
| **Local file paths** *(default)* | The full local path of each sheet as a file link, for example `file:///C:/Users/me/Documents/exports/my_set_face.png` | Loading the deck in TTS on this computer; testing; anyone who will upload the pictures from inside TTS afterwards (§10.2.4) |
| **File names only** | The bare file name, as in versions before this change | A person who will host the images and edit the addresses themselves; tools that read the JSON and expect names |

**Link format (local mode).** Written exactly so, and tested on every platform's path shape:

- The path is the absolute path of the exported file (the export folder chosen in the dialog, or the project's `exports` folder), resolved on the computer doing the export.
- Windows paths: `file:///` + drive + path with **forward slashes** (`file:///C:/Users/me/Game Files/my_set_face.png`). Network paths (`\\server\share\x.png`) become `file://server/share/x.png`.
- macOS and Linux paths: `file://` + the absolute path (`file:///Users/me/exports/my_set_face.png`).
- **Spaces and non-ASCII letters are written as they are**, not percent-encoded, because TTS reads the link as a path. Only three characters that would otherwise change the meaning of a link are encoded: `%` as `%25`, `#` as `%23` and `?` as `%3F`.
- The same link is written wherever the deck is described: in the `CustomDeck` of the deck and in the `CustomDeck` of every contained card.
- Nothing else about the JSON changes; the structure of §10.2 stays valid for TTS's *Load Object*.

**What the user is told.** The export dialog, in local mode, says that the links point to files on this computer: the saved object loads here, but not on another machine, and moving or renaming the export folder breaks it (export again to fix that). The same note sits beside the **Image links** setting. When the export finishes, the result shows the folder the links point to.

**How to load it (shown in the dialog).** Copy or export the JSON into TTS's *Saved Objects* folder (`Documents/My Games/Tabletop Simulator/Saves/Saved Objects`), then in TTS choose *Objects → Saved Objects* and place the deck. To share it, see §10.2.4.

#### 10.2.2 What the user sees

- In the **TTS options** of the export dialog: a choice **Image links** with *Local file paths (this computer)* and *File names only*, a one-line explanation of the choice made, and the loading steps above.
- The choice is remembered. Exports without the JSON file (the checkbox *Generate JSON companion file* is off) write no links, and the setting is not shown as relevant.
- The result of an export lists the files and, in local mode, the folder the links point to.

#### 10.2.3 Rules and limits

- **Privacy.** A local link contains the folder path, and therefore usually the person's user name. The dialog says so next to the note about sharing; the JSON should not be posted publicly in local mode.
- **Portability contract (§4).** The project database and the project folder are untouched by this: absolute paths are written only into the exported JSON, which is an output file, never into project data. This is tested.
- **Nothing is checked online.** Whether TTS accepts a particular path is TTS's behaviour; the checklist of §10.2.5 covers the cases to try by hand.
- **Failure.** If the link cannot be built (for example, the export folder has no usable absolute path), the export fails with a plain message and writes nothing, rather than writing a link that cannot work.

#### 10.2.2 Sheet sizes and the decks in the game

- **Grid.** Cards of aspect ratio (width ÷ height) 0.70 or more use 8 columns of at most 512 px; taller cards use 7 columns of at most 585 px. A card is never scaled up. Rows: as many as keep the sheet under 4,400 px tall, at most 7. A poker card at 750 × 1050 px gives 8 × 6 cells of 512 × 717 px; a tarot card gives 7 × 4.
- **Sets of different sizes.** Each set uses the size of its own cards, also when sets of several sizes are exported together: its own grid, picture size and deck scale, and a back of its own size. Tabletop Simulator shapes a card like the cell of its sheet, so a poker set drawn into tarot-shaped cells shows a tarot-shaped card with a see-through gap round the picture.
- **Decks.** Every set is a deck of its own, so a playtest table has one stack per set. Decks are face down (`rotY` 180, `rotZ` 180), side by side on the table with a gap, and as tall as the real card (the game fixes a card's height at scale 1 and shapes the width after the sheet cell): scale = height in mm ÷ 78.232 (poker: 1.13636, tarot 70 × 120: 1.534).
- **Cards.** CardIDs are 100 × the deck number (unique across the whole file) plus the slot.
- **Tests.** `unit/ttsLayout` and `integration/ttsDecks`.

#### 10.2.4 Sharing a deck with Steam Cloud

A deck that is meant for other people needs pictures that TTS can reach on their machines. Until Spadewick can host images (§22.4), the way to share is Steam Cloud, in three steps. Spadewick cannot upload to Steam Cloud itself.

1. Export with **Image links: Steam Cloud**. The JSON points at the local files, so the deck can be tried at once; the result lists the sheets to upload.
2. In TTS, use **Modding → Cloud Manager → Upload** for each listed file and copy the address of each.
3. Paste the addresses in the export window and choose **Write the _cloud JSON**. Spadewick writes `<name>_cloud.json`, a copy of the JSON in which every local link is the pasted address. The first JSON is never changed, so the step can be repeated with corrected addresses. An address must start with `http://` or `https://`; pictures with no address keep their local link and are named in the result.

Cloud Manager keeps the uploaded files until they are deleted there; the export window says to delete them when the playtest is over. Tests: `unit/ttsLayout` (the link rewriting), `integration/ttsDecks`, `e2e/ttsLinks`.

#### 10.2.5 Verification

- **Unit tests** of the link builder (`unit/ttsLinks`): Windows drive paths, paths with spaces and non-ASCII letters, backslashes, network paths, macOS and Linux paths, the three encoded characters, and the two modes.
- **Integration tests** (`integration/export`): in local mode every `FaceURL` and `BackURL` is a link to a file that exists, for one sheet and for several, in the deck and in each contained card; in names mode they are bare names; the default is local; the project database holds no absolute path afterwards.
- **End-to-end tests** (`e2e/workflows`): the setting appears in the TTS tab, is remembered, and changes what is written.
- **By hand, in TTS (checklist for the owner):** load the exported JSON from *Saved Objects* on this computer and see the cards; repeat with an export folder whose path has spaces, with one that has an accented letter, and (on a second machine type if available) a macOS path. Record the results in §28 if any case fails.

### 10.3 Print-and-Play PDF Export

**Layout options:**

- **Page size:** A4, US Letter, A3, US Legal, or custom width × height in mm.
- **Orientation:** Portrait / Landscape.
- **Cards per page:** Auto-fit (maximize cards per page), or manual grid (e.g., 3×3). A manual grid that does not fit the page is rejected with a message that says so.
- **Margin:** Top, bottom, left, right (mm).
- **Spacing:** Between-card gap (mm).
- **Bleed:** Add bleed area (mm) per card. Bleed zone is filled with the card's background color (sampled from SVG) or a user-chosen color.
- **Crop marks:** Toggle. Drawn outside the bleed area.
- **Card backs:** None, or interleaved (each front page is followed by a mirrored back page for duplex printing). The back page mirrors the front horizontally so fronts and backs line up when printed on both sides; the grid is centred on the page so the mirror is exact.
- **Scale:** Print at 100% (true size) or fit to page. Fit scales every card down uniformly so the whole grid fits within the margins.
- **Card size (physical):** any preset from §10.6, or custom width × height in mm. Drives the rendered pixel resolution at the chosen DPI.
- **Export DPI:** 150, 300, or 600. Drives rasterization resolution.

**Copies:** each card is printed `quantity` times (§6.5); the quantity also decides how many back images follow when duplex backs are on.

*A manufacturer-ready **production PDF** (CMYK, bleed, trim and bleed boxes, preflight) is specified in §17; manufacturer settings are bundled as presets in §18.*

**Output:** A single PDF file. Each page contains one or more card images composited via `sharp` and assembled into the PDF via `pdf-lib`.

#### 10.3.1 Fitting the cards on the page

- **As many as fit at true size.** With an automatic grid, a page takes as many cards of the real card size as it can hold. Poker cards (63.5 × 88.9 mm) fit 3 × 3 on Letter and on A4; the margin and gap the dialog starts with (10 mm and 3 mm) would hold only 2 × 2.
- **How.** The margin and gap are reduced only as far as needed to fit more cards: the gap first (down to 0, or, with crop marks, the room the marks need), then the margin, never below 5 mm and never raised above what was typed. A grid that fits to the hair counts as fitting.
- **Off switch.** *Fit as many cards on a page as it can take* (on by default, `fitMore`) can be turned off to keep the margin and gap exactly as typed. A grid chosen by hand, and *Fit to page*, are never changed.
- **Sizes.** With the card size "the set's size", each card size has pages of its own, with its own grid: poker and tarot cards are never put in one grid. A size chosen in the dialog applies to every set. The preview shows the first size and says when there are several; PNG sheets are made one for each size too (`_sheet_1.png`, `_sheet_2.png`).
- **Tests.** `integration/pdfFit`.

### 10.4 PNG Sheet Export

Exports all cards in a set as a flat PNG sprite sheet. Useful for bulk distribution or custom importers.

**Settings:**

- Cards per row (determines sheet width).
- Card pixel size.
- Background color (for gaps/padding).
- Padding between cards (px).
- Optional: export each card as an individual PNG file (numbered or named by display name field). One file per card, regardless of quantity.
- In the sheet, every card appears `quantity` times (§6.5).

### 10.5 Rendering Pipeline

For each card, the rendering pipeline is:

1. Load the template SVG source.
2. Resolve template inheritance (merge parent + child SVG).
3. Evaluate all formula fields for the card.
4. Perform token substitution: replace `{{slug}}` with field values (HTML-escaping text; inlining image assets as `data:` URIs).
5. Apply conditional rendering: evaluate `data-spadewick-show-if` / `data-spadewick-hide-if` on every group; add `display:none` to hidden groups.
6. Apply dynamic text rendering: for each `data-spadewick-text-fit` element, measure and shrink or overflow text as configured.
7. Collect fonts: the bundled defaults plus every project font the template references, passed to resvg-js as font files.
8. Pass the final SVG string to resvg-js → PNG buffer.
9. Hand the PNG buffer to `sharp` for any compositing, resizing, or sheet assembly.

### 10.6 Card Sizes

Spadewick does not assume any game's card dimensions. Cards are portrait; a set may be rotated to landscape by swapping width and height. The following industry-standard sizes are built in (dimensions as commonly specified by card printers; vendors vary by a fraction of a millimetre):

| Preset | Size (mm) | Size (in) | Typical use |
|--------|-----------|-----------|-------------|
| Poker / Standard US | 63.5 × 88.9 | 2.5 × 3.5 | Playing cards, most US/TCG-style games |
| Bridge | 57.15 × 88.9 | 2.25 × 3.5 | Bridge-width decks |
| Standard USA | 56 × 87 | 2.2 × 3.43 | Board-game cards (US) |
| Standard European | 59 × 92 | 2.32 × 3.62 | Board-game cards (EU) |
| Japanese / Yu-Gi-Oh! | 59 × 86 | 2.32 × 3.39 | Japanese TCG sleeves/cards |
| Mini American | 41 × 63 | 1.61 × 2.48 | Small-format games |
| Mini European | 44 × 68 | 1.73 × 2.68 | Small-format games |
| Tarot | 70 × 120 | 2.76 × 4.72 | Tarot / large-format |
| Tarot US | 69.85 × 120.65 | 2.75 × 4.75 | Tarot / large-format (US) |
| Small Square | 50 × 50 | 1.97 × 1.97 | Tile-like cards |
| Square | 70 × 70 | 2.76 × 2.76 | Square cards |
| Jumbo | 88.9 × 127 | 3.5 × 5 | Oversized / reference cards |
| Custom | user-defined | — | Any other dimensions (mm) |

Every set has its own card size, chosen when the set is made (Poker preselected) and changeable later; there is no project default and no "inherit". Every template has one too, chosen when it is made and then **locked**. A set can only use templates of its own size, so wherever templates are listed or chosen for a set (the Template Editor's list, the set's default template, a card's template, the library) only those of the same size appear. Two sizes are the same when their physical dimensions agree. The size drives:

- **Template canvas:** a new template is created at the pixel size of the card size chosen for it.
- **Raster size:** the project's pixel width (`card_width_px`, default 500) is kept, and the pixel height follows the physical aspect ratio (e.g. Tarot at 500 px wide → 857 px tall). Projects created before presets existed keep their stored pixel size until a size is chosen.
- **TTS and PNG sheet exports:** sheets need uniform cards, so the first selected set's size applies.
- **PDF export:** defaults to the set's physical size; the export dialog may choose any preset or a custom size instead.

**Template of a different shape:** a template of the set's size should always match, but if the template's own aspect ratio still differs from the set's card size (hand-edited SVG), exports letterbox it (scale to fit, centred, transparent bars; nothing is stretched or cropped) so every exported card is exactly the set's size.

Presets live in one shared list so every export target offers the same sizes. A set's size is chosen in the project panel (and in the New set dialog); a template's size in the New template dialog.

**Changing a set's size.** Allowed, with a question first when it matters: the question says that the set's default template, and any template chosen for individual cards, that belong to another size are let go (the cards fall back to the set's default; the cards' data is never touched), and that no template of the new size exists yet if that is so. Nothing is asked when the set has no cards and nothing would be let go.

---

### 10.7 Live preview in the export dialog

The export dialog for Tabletop Simulator, print-and-play PDF and PNG sheets has a **Preview** on its right side. It always shows what the first sheet or page of the export will look like with the options now set, and follows every change (set, card selection, card back, page and grid options, cards per row, and so on) a moment after the last one.

- **What it shows.** Tabletop Simulator: the first sheet of the first chosen set, with the grid, cell size and deck scale, and the card back. Print-and-play PDF: the first page with the cards, bleed, gaps, margins and crop marks as printed, and the back page when duplex backs are chosen. PNG sheet: the sheet of the first cards (up to 60), or the first card when one file is made for each card. A line above the pictures says how many cards, decks or pages the export will make.
- **How it is made.** By the export itself, limited to the cards of the first sheet or page and written to a temporary folder that is removed again, so the preview cannot disagree with the export. The PDF page is drawn from the same page layout as the PDF (`pdfGeometry`), because a PDF cannot be turned into a picture without another program.
- **Not shown.** The production PDF and the print-service images have their own panels and no preview. With no set chosen, or no card to draw, the preview says so; a failure is said in words and never stops the export.
- **Accessibility.** Each picture has a text alternative and the summary line is text; the update message is read out as a status.
- **Tests.** `integration/exportPreview`, `e2e/exportPreview`.

## 11. Version Control & History

### 11.1 Named Snapshots

A snapshot is a complete, named copy of the project's state at a point in time. Snapshots are stored in the project's `/snapshots` directory as zip archives (with a small metadata file for the name, description and date) containing:

- A copy of `project.db`, written after the write-ahead log has been folded in so every committed change is included.
- A copy of all files in `/assets`, `/templates` and `/fonts`.

**Snapshot operations:**

- **Create:** Name + optional description. Created instantly via zip.
- **List:** Shown in a side panel with name, date, and description.
- **Restore:** Replaces the current project state with the snapshot's contents: the database and the asset, template and font folders are replaced, so files added after the snapshot are removed. Requires confirmation. The current state is automatically saved as an auto-snapshot before restore (so a restore can itself be reversed), the archive is verified before anything is changed, and if the restore fails midway the project is rolled back to the auto-snapshot.
- **Delete:** Removes the snapshot zip file.
- **Compare:** each snapshot can be compared with the current project or with another snapshot, and individual changes taken back (§20).
- **Export:** Copies the snapshot zip to a user-chosen location, or saves it to a connected cloud account (§15.2). Snapshots can be moved between machines this way.
- **Diff (future):** Not in v1.0; reserved.

Snapshots are independent of undo history. Undo/redo does not move through snapshots.

### 11.2 Multi-Session Undo / Redo

All mutating operations are recorded as undo entries in the project database. Undo history persists across application restarts.

**Undo storage:**

An `undo_log` table in the database stores entries with:
- Operation type (e.g., `UPDATE_CARD_FIELD`, `DELETE_CARD`, `RENAME_FIELD`, `BATCH_REPLACE`).
- A JSON payload sufficient to reverse and re-apply the operation.
- Timestamp.
- Sequence number.

**Undo/redo behavior:**

- Undo stack limit: 1,000 entries (configurable in app settings). Oldest entries are pruned when the limit is reached.
- Undo and redo apply the reversal/reapplication synchronously and then refresh the affected UI.
- Multi-card batch operations (batch replace, bulk field set) are a single undoable entry.
- Template edits are undoable (SVG source stored as before/after in the undo entry).
- Asset imports and deletions are undoable. Files leaving `/assets` are held in a hidden `.cache/undo` folder inside the project (excluded from snapshots) until the undo entry is pruned.

---

## 12. Application Shell & Settings

### 12.1 Window Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [Menu Bar]                                                  │
├───────────┬─────────────────────────────────────────────────┤
│ Sidebar   │                  Main Panel                      │
│           │                                                  │
│ - Project │  [Tab: Card Data | Template Editor | Assets]     │
│   tree    │                                                  │
│ - Sets    │                                                  │
│ - Assets  │                                                  │
│ - Snaps   │                                                  │
│           │                                                  │
└───────────┴─────────────────────────────────────────────────┘
│ Status bar: project name · set name · card count · autosave  │
└─────────────────────────────────────────────────────────────┘
```

### 12.2 Menu Bar

**File**
- New Project
- Open Project (project folder)
- Open Project File (`project.db` picker; opens the project folder that contains it)
- Import from Cloud… (§15.8)
- Recent Projects (last 10, stored in electron-store)
- Close Project
- Duplicate Project (copies folder to a new name/location)
- Reveal in Explorer / Finder
- Export → (TTS / PDF / PNG Sheet)
- Preferences (includes Cloud accounts, §15.4)
- Quit

**Edit**
- Undo / Redo
- Find and Replace (card data)
- Select All Cards

**View**
- Toggle Sidebar
- Card Preview Size (Small / Medium / Large)
- Toggle Rulers / Grid / Snap / Guides (canvas editor only)

**Project**
- Manage Fields
- Card IDs… (§5.8)
- Icons… and Text styles & keywords… (§16)
- Check print readiness… (§17.7)
- What changed since… (§20)
- Manage Fonts
- Cloud Links… (§15.8 W8)
- Create Snapshot
- View Snapshots

**Help**
- About
- Open Logs Folder
- Check for corruption (runs SQLite `PRAGMA integrity_check`)

Open Logs Folder opens `data/logs`, which holds `spadewick.log` (errors raised by any operation, with a timestamp and the operation name; rotated at 1 MB, one previous file kept).

### 12.3 Application Settings (electron-store)

| Setting | Default | Description |
|---------|---------|-------------|
| `projects_root` | `./projects` | Root directory for all project folders |
| `recent_projects` | `[]` | Array of last 10 opened project paths |
| `undo_limit` | `1000` | Maximum undo entries per project |
| `autosave_interval_seconds` | `30` | How often the app writes uncommitted in-memory state to the DB |
| `preview_size` | `medium` | Default card preview size in the data editor |
| `theme` | `system` | `light`, `dark`, or `system` |
| `ui_layout` | *(sizes)* | The widths and heights of the panels and whether the template list is open (§12.5) |
| `default_export_dpi` | `300` | Default DPI for PDF exports |
| `canvas_smart_guides` | `true` | Snapping to edges and alignment guides in the canvas editor (§8.7.4) |
| `tts_image_links` | `local` | How the Tabletop Simulator file refers to its images: `local` (full file paths), `names` (bare file names) or `cloud` (local links, then Steam Cloud addresses), §10.2.1, §10.2.4 |
| `cloud_accounts` | `[]` | Connected cloud accounts and their encrypted credentials (§15.13) |
| `cloud_check_on_open` | `false` | Check linked cloud files when a project is opened (§15.12) |
| `cloud_client_overrides` | `{}` | Per-provider client IDs for organisations with their own app registration (§15.11) |

**Removed: font hinting.** An earlier draft listed a `font_render_hints` setting. The renderer (resvg-js) exposes no hinting control, and rendering a text-heavy card with the option on and off produced byte-identical output, so a setting would have done nothing. It is not offered; if a future renderer exposes hinting it can be added as a setting then.

### 12.4 Autosave

The application autosaves in-memory state to SQLite every N seconds (configurable). The status bar shows the time since the last save and displays "Saving..." briefly when a save completes. There is no explicit "Save" menu item — all changes are immediately written to the database on commit (after each cell edit, template save, etc.), making autosave a secondary safety net only.

### 12.5 Resizable panels

> **Status: built** (Fixes F8). The interface is the user's to arrange, within limits that keep every panel usable.

**What can be resized.** The project panel (the left column), the template list in the Template Editor, the properties panel of the canvas editor, the split between the properties and the layers inside it, and the card preview pane in the card table. The Small, Medium and Large choices of View → Card Preview Size (and Preferences) set the width of the preview pane, so there is one source for it.

**How.** Each boundary has a divider: drag it with the mouse, or focus it and use the arrow keys (12 pixels a step), Page Up and Page Down (largest and smallest), and Home or a double-click (back to the original size). A divider is a focusable `separator` with its value, minimum and maximum announced (§14.4). Every panel has a minimum and a maximum width, so a panel can never be dragged out of reach; the properties/layers split keeps at least 15% for each half, and each half scrolls on its own.

**Open and closed.** The template list can be closed to a thin rail with a button, and opened again; the state is remembered.

**Remembered.** The arrangement is saved in the application settings (`ui_layout`, §12.3), so it survives a restart and travels with a portable install. Preferences has a **Reset** button that puts every panel back to its original size.

---

## 13. Data Model

### 13.1 Core Tables (project.db)

```sql
CREATE TABLE sets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  card_size   TEXT,   -- preset id or 'custom'; every set has one (§10.6)
  card_mm_w   REAL,   -- used when card_size = 'custom'
  card_mm_h   REAL,
  default_template_id TEXT, -- cards with no template of their own render with this one (§5.2)
  code        TEXT          -- short code used in card IDs, unique in the project (§5.8)
);

CREATE TABLE fields (
  id            TEXT PRIMARY KEY,
  set_id        TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK(type IN ('text','number','boolean','image_ref','color','formula')),
  default_value TEXT,
  formula       TEXT,
  validation    TEXT,   -- JSON
  display_order INTEGER NOT NULL DEFAULT 0,
  hidden        INTEGER NOT NULL DEFAULT 0,
  width_px      INTEGER,  -- column width in the card table; NULL = default
  created_at    INTEGER NOT NULL,
  UNIQUE(set_id, slug)
);

CREATE TABLE cards (
  id           TEXT PRIMARY KEY,
  set_id       TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT '',
  template_id  TEXT,
  quantity     INTEGER NOT NULL DEFAULT 1,   -- copies in exports (§6.5)
  fields_json  TEXT NOT NULL DEFAULT '{}',
  sort_order   INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES templates(id),
  svg_source  TEXT NOT NULL,
  origin      TEXT,                 -- where a copy came from (§7.7.6)
  card_size   TEXT,                 -- preset id or 'custom'; chosen when the template is made, never changed (§10.6)
  card_mm_w   REAL,                 -- millimetres, for a custom size
  card_mm_h   REAL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE assets (
  id               TEXT PRIMARY KEY,
  filename         TEXT NOT NULL UNIQUE,
  original_name    TEXT NOT NULL,
  mime_type        TEXT NOT NULL,
  width_px         INTEGER,
  height_px        INTEGER,
  file_size_bytes  INTEGER,
  tags             TEXT NOT NULL DEFAULT '[]',  -- JSON array
  notes            TEXT NOT NULL DEFAULT '',
  thumbnail_jpeg   BLOB,
  created_at       INTEGER NOT NULL
);

CREATE TABLE fonts (
  id           TEXT PRIMARY KEY,
  family_name  TEXT NOT NULL,
  style        TEXT NOT NULL DEFAULT 'Regular',
  filename     TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL
);

CREATE TABLE undo_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  op_type      TEXT NOT NULL,
  payload      TEXT NOT NULL,  -- JSON
  created_at   INTEGER NOT NULL
);

CREATE TABLE redo_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  op_type      TEXT NOT NULL,
  payload      TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE project_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
-- Rows: schema_version, name, created_at, card_size (preset id or 'custom'), card_mm_w, card_mm_h, card_width_px, card_height_px, export_dpi
```

Schema version 6 adds, besides `sets.code` above: `cards.card_code TEXT` (the permanent card ID, §5.8, unique where not null), `templates.origin TEXT` (JSON note of where a copy came from, §7.7.6) and

```sql
CREATE TABLE id_counters (
  scope TEXT PRIMARY KEY,   -- a set id, or '@project' for a per-project counter (§5.8)
  next  INTEGER NOT NULL
);
```

The card ID settings (`card_id_pattern`, `card_id_scope`, `card_id_start`, `card_id_step`) are `project_meta` entries; the author code belongs to the installation (the settings file), not to a project.

### 13.2 Index Strategy

```sql
CREATE INDEX idx_cards_set_id       ON cards(set_id, sort_order) WHERE deleted = 0;
CREATE INDEX idx_fields_set_id      ON fields(set_id, display_order);
CREATE INDEX idx_undo_log_seq       ON undo_log(seq DESC);
CREATE INDEX idx_redo_log_seq       ON redo_log(seq DESC);
CREATE UNIQUE INDEX idx_cards_code  ON cards(card_code) WHERE card_code IS NOT NULL;
CREATE UNIQUE INDEX idx_sets_code   ON sets(code) WHERE code IS NOT NULL;
```

### 13.3 Database Versioning

The `project_meta` table stores a `schema_version` key. On open, the app compares this version to the current expected version and runs any pending migrations. Migrations are additive: new tables and columns only. **Versions** (numbers follow the order of implementation): **6** card IDs, set codes and template origin (§5.8, §7.7; shipped in 1.9); **7** (built) a card size for every set and every template, the project default card size and the project palette removed (§10.6, §7.5, Fixes F9 and F11); **8** (built) the Rich text field type: SQLite cannot change a CHECK constraint, so the fields table is rebuilt with `rich_text` among the allowed types and every row copied (§16.7, A65); **9** (built) the tables `icons`, `text_styles` and `keyword_rules` (§16.8, A66); **10** (built) template bleed (`bleed_mm`, `bleed_mode`, `bleed_color`) and the tables `icc_profiles`, `print_colors` and `export_profiles` (§17.8, A70); **planned:** **11** the cloud-links table (§15.13). **Forward guard (implemented in 1.9):** a project whose schema version is *newer* than the running application is refused with a message giving both format numbers, and is never opened or modified (no table is added, no folder created, and it is not offered for recovery as a damaged database); the project that was open stays open. Builds before 1.9 cannot have this guard, which is why 1.9 is the baseline that all later formats rely on. **Upgrades:** before migrating an older project the application writes an automatic snapshot ("before upgrade from format N to M"), so the earlier state can always be restored, and tells the user what changed. Existing data is never destructively transformed.

---

## 14. Non-Functional Requirements

### 14.1 Performance

| Metric | Target |
|--------|--------|
| Card preview re-render (single card, changed field) | < 200 ms |
| Table scroll (1,000 cards visible) | 60 fps (virtualized) |
| TTS export (100 cards, 500×700 px each) | < 30 seconds |
| PDF export (100 cards, 300 DPI) | < 60 seconds |
| Application cold start (no project open) | < 3 seconds |
| Project open (500 cards) | < 2 seconds |
| Undo / redo operation | < 100 ms |
| *V2:* single card re-render with rich text and icons | < 200 ms |
| *V2:* production PDF, 100 cards, 300 ppi CMYK (phase 1) | < 90 seconds |
| *V2:* snapshot compare summary, 1,000 cards | < 3 seconds |
| *V2:* command-line start to first output | < 3 seconds |

### 14.2 Reliability

- The SQLite database is opened in WAL mode to prevent corruption on unexpected shutdown.
- Before any destructive operation (restore snapshot, batch delete cards), a write-ahead transaction is used. If the operation fails midway, the database rolls back to a consistent state.
- When a project is opened, its database is checked (`PRAGMA integrity_check`). If it fails, or cannot be opened at all, the project is not opened as-is: the user is offered the most recent snapshot. Restoring keeps the damaged database next to the project as `project.corrupt-<timestamp>.db`. With no snapshot available the user is told so and the project stays closed.

- A project made by a newer version of the application is refused rather than opened (§13.3).
- Cloud pulls change the project only after the whole file is downloaded and verified, as one transaction and one undo step; a failed or cancelled transfer leaves the project unchanged (§15.10).

### 14.3 Portability

- **Supported platform for V2.0: Windows 10 and 11 (64-bit) only (A71).** The app must run on Windows from a copied folder with no prerequisites installed. macOS 12+ and Ubuntu 22.04+ remain the intended targets of a later release; the code stays portable (no Windows-only paths or APIs outside guarded branches), but nothing is built, tested or promised for them in V2.0.
- All dependencies are bundled into the Electron executable (no `node_modules` required at runtime).
- `electron-builder` target: `--dir` (unpacked directory) and `portable` (one file) for Windows. The macOS (`--dir`) and Linux (AppImage) targets stay in the configuration for later and are not built or tested for V2.0.
- The app must not write to any path outside its own directory (including the `data/` and `projects/` folders of §4), the OS temp directory, or an explicitly user-chosen path.
- Bundled fonts (Liberation, SIL OFL) are shipped as files next to the application's resources, because the renderer reads fonts by path and cannot read them from inside the packed application archive.

### 14.4 Accessibility

The target is WCAG 2.1 level AA for the whole interface, in both the light and the dark theme.

- **Keyboard:** every interactive control is keyboard-operable. The card table can be driven completely from the keyboard (arrow keys, Home and End to move; Shift+Up/Down to extend the row selection; Enter or F2 to edit and Escape to cancel; Space to toggle a checkbox cell; Tab to move between cells; Delete to delete the selected cards). The view switcher is a tab list with roving focus (arrow keys, Home, End).
- **Focus order and focus visibility:** focus order follows reading order (navigation, then views, then content). A visible focus indicator is drawn on every keyboard-focused control.
- **Dialogs:** opening a dialog moves focus into it; Tab and Shift+Tab stay inside it; Escape closes it and returns focus to the control that opened it. While a dialog is open the rest of the application is inert and hidden from assistive technology. Stacked dialogs release the background only when the last one closes.
- **Structure for assistive technology:** the window has landmarks (navigation, main, status); the card table is exposed as a grid with row and column counts, even though only visible rows are in the document; every control that is not a text field has an accessible name; toast messages are announced through a polite live region, and status text (bulk-edit hint, unsaved changes) is exposed with `role="status"`.
- **Colour is never the only signal:** selected rows have an edge bar and `aria-selected`; the current set and view have `aria-current`, bold text and an edge bar; errors have an icon and words; unsaved template changes are stated in words.
- **Contrast:** text and interface components meet AA contrast in both themes, including the syntax-highlighted source editor.
- **Operating-system preferences:** forced colours (Windows High Contrast) keeps selection and the active cell visible as outlines; "more contrast" strengthens borders and secondary text; "reduce motion" switches animations and transitions off; the theme setting `system` follows the OS light/dark preference.

**How this is verified:** the end-to-end suite runs the axe-core engine (WCAG 2.0/2.1 A and AA rules) on every screen and dialog in both themes, and separate tests assert the keyboard, focus, structure, colour and OS-preference behaviours above (see Appendix B). Screen-reader speech output and the OS-level contrast switches themselves cannot be exercised in an automated run (Appendix B).

### 14.5 Internationalisation

- v1.0 is English-only. **All user-facing strings are in a single strings file**, `src/shared/strings.js`, grouped by area (`common`, `menu`, `errors`, `dialogs`, `toasts`, and one group per screen). Code never contains user-visible text; it asks for it by key with `tr('area.key', { params })`. A string may contain `{placeholders}`, or be a function of its parameters (used for plurals).
- Adding a language means adding one more file with the same shape and selecting it with `setCatalog`; any key missing from it falls back to English, and a key that exists nowhere is shown as the key itself so it is visible and greppable rather than a crash.
- This applies to the main process as well as the interface: menu labels, native dialog titles and file-type names, error messages shown to the user, the text of automatic snapshots, field validation messages, and the names of the card-size presets. The rule covers code shared by both processes as well.
- The rule is enforced by an automated test that reads the real source, parses it, and fails on any inline user-facing text (markup text, `aria-label`/`title`/`placeholder`/`alt`, toast/confirm/prompt/alert text, menu and dialog labels, error messages), on a key that is used but missing, on a string that is no longer used, on a duplicate key, and on a string whose `{placeholders}` are not all supplied by the call site.
- The card data editor and export system correctly handle Unicode text in field values.
- RTL text in card fields is passed through to the SVG template as-is; RTL layout in the template is the designer's responsibility.

### 14.6 File Size Targets

- Application executable: < 200 MB (Electron baseline + bundled node modules).
- A project with 200 cards and 50 MB of assets: project.db < 5 MB (assets are separate files).

### 14.7 Security

- Template SVG is user content and is treated as untrusted. It is never injected into the application's page as markup: previews are shown as images, and the one copy the canvas editor measures is stripped of scripts, event handlers and external references first.
- The renderer page carries a Content-Security-Policy that blocks inline script and remote resources. The window blocks navigation and new windows to anything outside the application.
- Snapshot archives are checked on restore: entries that would extract outside the target folder are refused, and every entry's checksum is verified.
- A hostile template (script, `onload`, external image) is part of the automated tests.
- Cloud connections (§15) add no network access to the renderer: provider traffic runs only in the main process, sign-in uses the system browser, credentials never reach the renderer, and files downloaded from a cloud account are treated as untrusted input (§15.11).

---

## 15. Cloud Storage Connections

> **Status: specified, not yet implemented.** Everything in §1–§14 is implemented and tested; this section is new scope added in v1.6. Where it changes an earlier statement, that statement has been updated in place (§1, §2, §4, §5.5, §9.3, §10.1, §11.1, §12, §13, §14, §23).

### 15.1 Purpose and principles

Spadewick stays **offline-first**: every feature in §1–§14 works with no network and no account. Cloud connections are an opt-in layer that lets a team exchange the files a card project is built from, asynchronously, through storage the team already uses.

A user can connect their own account on **Dropbox, OneDrive and GitHub**, and then:

1. **Pull** CSV/JSON card data and image files from the platform into a project;
2. **Refresh** previously pulled files when someone else has updated them;
3. **Push** (save) card data, images and export results back to the platform.

Principles that every requirement below follows:

- **Explicit, never ambient.** Nothing is sent or fetched unless the user starts it (or has switched on the one optional check in §15.12). No background sync, no telemetry.
- **File-level, not project-level.** Individual files are exchanged. The live project folder (`project.db`, WAL files) is **never** synced through a cloud service — a database written by two machines through a file-sync client corrupts. Teams share *inputs and outputs* (CSV, images, exports, snapshot archives), not the working project.
- **Each person uses their own account.** There are no shared credentials. Access control is whatever the platform enforces for that person.
- **No silent data loss.** Pulls are previewed and undoable; pushes never overwrite a version the user has not seen (§15.7).
- **A failure leaves the project unchanged.** A dropped connection, an expired token or a revoked permission produces a message and nothing else.
- **The renderer never sees credentials.** All provider traffic happens in the main process (§15.11).

### 15.2 What can be exchanged

| Kind | Pull (cloud → project) | Push (project → cloud) |
|------|------------------------|------------------------|
| **Card data** — CSV, JSON | Feeds the existing import flow (§5.5, §5.6): same name-matching, mapping dialog, validation table, append/merge modes, and quantity column. | The same CSV/JSON that §5.5/§5.6 export, for one or more sets. |
| **Images** — PNG, JPEG, WEBP, SVG | Become library assets (§9). A pulled image keeps a link to its source so it can be refreshed. | Any library asset can be uploaded. |
| **Export results** — TTS sheets and JSON, PDF, PNG sheets | — | Saved to a cloud folder instead of (or as well as) the local `/exports` folder (§10.1). |
| **Snapshot archives** (§11.1) | — | The snapshot ZIP can be saved to the cloud (a safe way to hand a project state to a teammate; they restore it from the file). |
| **Template packages** (§7.7.4) | Imported into the project through the clone rule, or into the library; a pulled package keeps a link so it can be refreshed | A template exported as a package, with its fonts (where redistribution is allowed), icons, palette, fields and mockup |

Whole projects and loose font files are **not** exchanged (§15.14). A project's design travels as a **template package** (§7.7.4), so a team shares its card design as a file without sharing the project.

### 15.3 Providers

| Provider | API | Account types | Team/shared content |
|----------|-----|---------------|---------------------|
| **Dropbox** | Dropbox API v2 | Personal and Dropbox Business | Shared folders, team folders / team space |
| **OneDrive** | Microsoft Graph | Personal (Microsoft account) and work/school (Entra ID) | My files, Shared with me, SharePoint document libraries |
| **GitHub** | GitHub REST API (Contents and Git Data) | GitHub.com accounts; organisation repositories where the app is installed | Any repository the account and the installed app can reach |

GitHub is different in kind: files live in a **repository and branch**, and every save is a **commit**. That makes it a natural fit for CSV and text-like assets that a team wants history and review for; it is a poor fit for large binary art (§15.10 limits).

### 15.4 Accounts and sign-in

**Where:** Preferences → **Cloud accounts** lists the connected accounts and has a Connect button per provider. Connecting is also offered inline the first time a cloud action is chosen. A user may connect several accounts, including more than one for the same provider (e.g. personal and work).

**Flow for Dropbox and OneDrive** — OAuth 2.0 authorization-code flow with **PKCE** for a public (installed) client:

1. The user chooses Connect. The app opens the provider's sign-in page in the **system browser**. An embedded browser window is never used for sign-in, so the app never handles the user's password or second factor.
2. The app listens on a one-shot **loopback** address (`127.0.0.1`, ephemeral port) for the redirect, checks the `state` value, exchanges the code (with the PKCE verifier) for tokens, and closes the listener immediately — also after 5 minutes or on cancel.
3. The app reads the account's display name and identifier from the provider, shows them in the list, and stores the tokens (§15.5).

**Flow for GitHub** — the OAuth **device flow** (no redirect, no secret): the app shows a short code and the provider's verification address, opens it in the browser, and polls until the user approves. The app is a **GitHub App** (not an OAuth App) so that access is limited to the repositories the user or organisation chose to install it on, with only the *Contents* permission, instead of the all-repositories `repo` scope. Organisation owners must install it on the organisation before members can reach its repositories; the account list explains this when a repository is not visible.

**Scopes (least privilege):**

| Provider | Scope | Notes |
|----------|-------|-------|
| Dropbox | `files.metadata.read`, `files.content.read`, `files.content.write`, `account_info.read` | Full-Dropbox access is needed to browse team folders; see §15.15 for the alternative. |
| OneDrive | `Files.ReadWrite`, `User.Read`, `offline_access` | `Files.ReadWrite.All` is added only when the user opens shared/SharePoint content. |
| GitHub | GitHub App permission *Contents: read & write*, *Metadata: read* | Per-repository, set at installation. |

**Disconnect:** removes the account from the list, deletes its stored tokens, and asks the provider to revoke them where the provider supports it. Links in projects that used the account stay in the project but show "account not connected" until it is connected again (§15.7).

**Token refresh:** access tokens are refreshed automatically with the stored refresh token (GitHub App user tokens are short-lived and refreshed the same way). If refresh fails (revoked, expired, password change), the account shows "Sign in again" and the action that needed it stops with that message.

### 15.5 Credential storage and portability

Credentials are the one thing that must **not** travel with a project or with the portable folder.

- Tokens are stored encrypted with the operating system's credential facility (Electron `safeStorage`: Windows DPAPI, macOS Keychain, Linux Secret Service/kwallet). The encrypted blob is kept in the application settings file under `data/` (§4); the plaintext never touches disk.
- Because the encryption key belongs to the operating-system user, copying the portable folder to another machine or user leaves the accounts listed but **signed out**; the user connects again. This is intended and is stated in the account list.
- If no operating-system credential store is available (typical on a bare Linux desktop session), tokens are kept **in memory for the session only** and the user is told; they are never written in plaintext. On Linux the application checks which storage backend the system actually provides: the weak fallback that stores secrets with a fixed key is treated as **unavailable**, not as secure (spike D, §24.3).
- Tokens are never written to `project.db`, snapshots, exports, logs (§12.2 log redaction applies: any `Authorization` header or token-shaped value is masked), error messages, or the renderer process.
- What *is* stored in a project is non-secret: which provider, which file, and which version was last synced (§15.6, §15.13). That metadata travels with the project, so a teammate who opens the same project and connects **their own** account can use the same links, provided their account can access the same files.

### 15.6 Remote files and links

A **remote reference** identifies one file on a platform, independent of its display name:

| Provider | Identity | Version marker (used for change and conflict detection) |
|----------|----------|--------------------------------------------------------|
| Dropbox | file ID (`id:…`), path for display | `rev` and `content_hash` |
| OneDrive | drive ID + item ID | `eTag` and `cTag`; `sha1Hash`/`quickXorHash` for content |
| GitHub | repository + branch + path | blob `sha` (and the branch's head commit for the UI) |

A **link** ties a remote reference to something in the project. Links are created by a pull ("Remember this file for refresh") or by a first push, and are listed in **Project → Cloud links**:

- **Card-data link:** remote CSV/JSON ⇄ one set, plus the remembered import settings (column mapping, import mode, key). The key is the **card ID** (§5.8) unless the file has none, in which case the user picks a key field. Refreshing re-applies the same settings, so a teammate's updated CSV merges the same way every time.
- **Asset link:** remote image ⇄ one library asset (same asset ID, so every card and template that uses it picks up a refreshed image — the behaviour of "Replace", §9.3).
- **Export destination link:** a remembered cloud folder (or repository/branch/path) for a kind of export, so "Save to cloud" goes to the same place each time.

Each link stores the last synced version marker, a content hash, the time, and the direction of the last transfer. Renaming or moving the file on the platform does not break a link (identity is by ID; for GitHub, which has no stable file ID, a moved or renamed file shows as "remote missing" and can be re-pointed).

### 15.7 Sync states and conflict handling

Spadewick never merges file contents automatically. For each link it compares two things since the last sync: *did the remote version marker change?* and *did the local side change?* (a CSV link compares a hash of what a push would write; an asset link compares the local file hash; export links have no local side).

| Remote changed | Local changed | State | What the user can do |
|:--:|:--:|-------|----------------------|
| no | no | **Up to date** | — |
| yes | no | **Remote has changes** | **Refresh** (pull). |
| no | yes | **Local has changes** | **Push**. |
| yes | yes | **Conflict** | Pull and review first, **save as a new file** beside the remote one, or **overwrite** (explicit confirmation). |

Other states: **Remote missing** (deleted, moved out of reach, or renamed on GitHub), **No access** (permission removed), **Account not connected**, **Offline / provider unavailable**. None of them changes local data.

**Pull (refresh) behaviour**
- Card data: the file is downloaded, then goes through the same validation/preview as a manual import (`previewOnly`): the user sees how many cards would be added, updated or skipped, and the error table, *before* anything is written. Applying it is a single undoable step (§11.2).
- Images: the new file replaces the asset's file under the same asset ID. The previous file is kept in the undo cache so the refresh is undoable (§11.2). Cards, templates and previews update automatically.
- A refresh that finds the remote file byte-identical to what was synced reports "already up to date" and writes nothing.

**Push (save) behaviour**
- Before writing, the app re-reads the remote version marker. If it differs from the last synced one, the push stops and the conflict choices above are shown. Where the provider supports a **conditional write** (Dropbox `update` mode with the known `rev`; OneDrive `If-Match` with the `eTag`; GitHub's required blob `sha`), the write itself carries the marker, so a change that lands between the check and the write is also refused rather than overwritten.
- **Overwrite** is always a deliberate choice, names the person/time of the remote change when the provider reports it, and mentions that the provider keeps earlier versions (Dropbox version history, OneDrive version history, Git history).
- **Save as a new file** writes `<name> (Spadewick <date> <time>).<ext>` next to the original (GitHub: a new file on the same branch, or a new branch — the user chooses).
- A successful push updates the link's version marker, so the next refresh by the same person is "up to date".

### 15.8 Workflows

**W1 — Connect an account.** Preferences → Cloud accounts → Connect → provider → sign in in the browser (or enter the device code for GitHub) → the account appears with its name. Disconnect is on the same row.

**W2 — Pull a CSV or JSON file.** File → **Import from cloud…** (or the Import button in the card table, "From cloud…") → choose account → browse or search (folders, "Shared with me", repositories and branches for GitHub; only CSV/JSON files are selectable) → choose the file → the existing import dialog opens on the downloaded data with the column mapping, mode and preview described in §5.5 → *Import*. A checkbox **Remember this file so I can refresh it** (on by default) creates the card-data link with the chosen settings.

**W3 — Refresh card data.** In the card table toolbar and in Project → Cloud links: **Refresh from cloud** for the open set. If the remote file changed, the preview/validation step of W2 runs with the remembered settings; if not, the user is told it is up to date.

**W4 — Pull images.** Asset browser → **Import from cloud…** → browse (multi-select files, or choose a folder to take all images inside it, non-recursively by default with an "include subfolders" option) → each image becomes an asset with a link. Name collisions are not an issue because assets have their own IDs and keep the original file name for display. **Refresh from cloud** on one asset, on the selection, or on every linked asset.

**W5 — Save card data to the cloud.** Card table → Export dialog → destination **Cloud** (CSV or JSON, one or more sets) → pick the folder (or repository/branch/path) and file name → Save. For GitHub, a commit message field is shown with a default of `Spadewick: update <file name> (<project name>)`. A card-data link is created or updated, so the next push goes to the same place and the conflict check of §15.7 applies.

**W6 — Save images to the cloud.** Asset browser → select assets → **Upload to cloud…** → choose destination → Save. Existing remote files are never replaced silently (§15.7).

**W7 — Save exports to the cloud.** Export dialog (TTS, PDF, PNG sheet) → **Output: local folder / cloud folder / both**. The export is rendered into the local `/exports` folder first (so a failed upload never loses the result), then uploaded; the dialog reports each upload's outcome and offers Retry. File names follow the pattern of §10.1.

**W8 — Review and refresh everything.** Project → **Cloud links** lists every link with its state (§15.7), provider, remote path, last synced time and who/when changed it remotely if the provider reports it. Buttons: *Check all now* (the only way to check without opening a specific file), *Refresh*, *Push*, *Open in browser*, *Unlink*. Unlinking forgets the link only; the local data and the remote file are untouched.

**Team pattern (informative).** A designer owns `cards.csv` in a shared folder and pushes it after a balance pass; an artist drops finished art into a shared `art/` folder; each teammate opens the project, uses *Check all now*, reviews and applies the CSV changes, refreshes the images, and exports. Handing over a point-in-time project state is done by pushing a snapshot ZIP (§15.2) and restoring it elsewhere.

### 15.9 Technical design

**Where it runs.** A **cloud service** in the main process (`src/main/cloud/`) owns all provider traffic, authentication, token storage, retry and progress. The renderer calls it only through IPC channels (`cloud:accounts`, `cloud:connect`, `cloud:disconnect`, `cloud:browse`, `cloud:pull`, `cloud:push`, `cloud:links`, `cloud:check`, …), exactly as it calls every other feature; no channel returns a token.

**Provider adapters.** Each provider implements one small interface, so adding a provider (or a file kind) does not touch the rest of the app:

```
authorize({ openBrowser, signal }) → { account, credentials }
refresh(credentials) → credentials
account(credentials) → { id, displayName }
list(credentials, container, { query, kinds, cursor }) → { entries[], nextCursor }
containers(credentials) → [ roots: My files, Shared with me, drives, repositories… ]
stat(credentials, ref) → { name, size, mimeType, version, modifiedAt, modifiedBy? }
download(credentials, ref, { toFile, signal, onProgress }) → { version, sha256 }
upload(credentials, target, { fromFile, ifVersion?, signal, onProgress }) → { ref, version }
revoke(credentials)
```

**Networking.** Requests use Electron's network stack (`net`), which honours the operating-system proxy and certificate settings used in corporate networks. Pagination follows each provider's cursor. Rate-limit and server errors (`429`, `5xx`, `Retry-After`) are retried with exponential backoff and jitter, at most 4 times, and surface a clear message if they keep failing. Every transfer shows progress and can be cancelled; cancelling leaves no partial file.

**Transfers.** Downloads go to a temporary file in the OS temp directory (§14.3), are verified (size, provider hash where given, and for images that the image decoder can read them), and are only then moved into the project or handed to the importer. Uploads stream from disk. Large files use each provider's resumable mechanism (Dropbox upload sessions, Graph upload sessions); GitHub uses the Contents API for small files and the Git Data (blob) API for larger ones.

**Provider specifics**

| | Dropbox | OneDrive | GitHub |
|--|--|--|--|
| Sign-in | PKCE + loopback | PKCE + loopback (MSAL-style public client, `common` tenant) | Device flow (GitHub App) |
| Browse | `files/list_folder`, team root via path-root header | `/me/drive`, `/me/drive/sharedWithMe`, SharePoint drives | installations → repositories → branch → tree/contents |
| Download | `files/download` | `/items/{id}/content` | raw blob |
| Upload | `files/upload` (+ sessions) | `PUT /content` (+ upload session) | `PUT /contents/{path}` (commit) |
| Conditional write | `mode: update` with known `rev`, autorename off | `If-Match: <eTag>` | blob `sha` required; stale → 409 |
| Version history | version history | version history | Git history |
| Practical file limit | 100 MB (app limit) | 100 MB (app limit) | **100 MB hard**; warn above 25 MB |

Implementers must verify each endpoint, scope name and limit against the provider's current documentation when building the adapter; provider APIs change faster than this document.

**GitHub specifics.** The user picks a repository and branch (default: the repository's default branch). A push is one commit authored by the signed-in user. If the branch is protected and refuses the commit, the app offers to commit to a new branch instead; opening pull requests, resolving merges, and Git LFS are out of scope.

### 15.10 Limits, reliability and errors

- **Size:** single files up to 100 MB (the GitHub hard limit, applied to all providers for consistency). CSV/JSON pulled for import are capped at 20 MB (far above any realistic card list). Larger files are refused before downloading, with the reason.
- **Atomic:** a pull changes the project only after the whole file has been downloaded and verified; applying card data is one transaction (§14.2) and one undo step.
- **Concurrent use:** one transfer per link at a time; different links may transfer in parallel (at most 3 at once overall).
- **Offline:** cloud actions report "No connection" and change nothing; the rest of the app is unaffected. The project is fully usable offline with whatever was last pulled.
- **Errors are specific and actionable:** *Sign in again*, *You no longer have access*, *File not found*, *File too large*, *The provider is rate-limiting requests — try again in N seconds*, *Not a valid image*, *The CSV has errors* (the existing validation table). Provider error bodies are logged (without credentials, §15.5) to `data/logs` for support.
- **Performance:** cloud operations are not bound by the §14.1 targets, but they must never block the interface: all run asynchronously with progress and a Cancel button, and the app stays usable while they run.

### 15.11 Security and privacy

- **Public client, no embedded secrets.** The app ships only public client identifiers. PKCE protects the code exchange; the loopback listener binds to `127.0.0.1` only, accepts one request, validates `state`, and is closed after use. (Where a provider's "desktop" client type issues a client secret, it is treated as non-secret and does not grant any access without the user's sign-in.)
- **Tokens:** §15.5. Never in the renderer, project, snapshots, exports or logs.
- **CSP unchanged.** The renderer's Content-Security-Policy (§14.7) still forbids network access beyond itself; it does not need to be loosened, because the renderer never talks to providers. Only the sign-in page is opened externally, in the system browser.
- **Downloaded content is untrusted input:** images are decoded by the image library and rejected if invalid; SVG assets are rendered through the same sanitised paths as any template SVG (§14.7); CSV/JSON go through the existing validation; remote file names are used for display only — local names are generated (assets already use UUID file names), so a remote name can never write outside the project.
- **Least privilege:** requested scopes are listed in §15.4 and are the minimum that allow browsing, reading and saving files; the app never reads other file types or other folders than the ones the user opens.
- **What leaves the machine:** only what the user chose to push, plus authentication and listing requests to the chosen provider. Nothing is sent to the Spadewick authors. The About dialog states this.
- **Organisations:** teams whose administrators restrict third-party apps can register their **own** OAuth app/GitHub App and enter its client ID in Preferences → Cloud accounts → Advanced (`cloud_client_overrides`, §15.13); the default identifiers are then not used for that provider.
- **Revocation:** Disconnect revokes at the provider where supported; the provider's own "connected apps" page can always revoke access independently, after which the account shows "Sign in again".

### 15.12 Interface, accessibility and i18n

- The cloud file browser is a dialog following §14.4: opening it moves focus into it; the list is a labelled list/tree with arrow-key navigation, Enter to open a folder or choose a file, Backspace to go up, a search field, and a visible current path; sign-in status, progress and errors are announced through live regions; nothing relies on colour alone (sync states carry an icon **and** words).
- The device code for GitHub is shown large, selectable, with a Copy button and the verification address as text as well as a link.
- All strings, including provider names' surrounding text, errors and the states of §15.7, are in the strings file (§14.5) and covered by the strings lint test. Provider **brand names** are not translated.
- **Settings** (§12.3): a single optional behaviour — *Check linked files when a project is opened* (off by default) — runs the *Check all now* of W8 once at open, only for accounts that are connected, and never changes data by itself; it only shows the states.
- Menu additions (§12.2): File → *Import from Cloud…*; Project → *Cloud Links…*; Preferences → *Cloud accounts*.

### 15.13 Data model and settings

**Project database** (schema version 8, additive, §13.3): one new table holding only non-secret link metadata, so it can be copied, snapshotted and shared with a project.

```sql
CREATE TABLE cloud_links (
  id               TEXT PRIMARY KEY,
  provider         TEXT NOT NULL,           -- 'dropbox' | 'onedrive' | 'github'
  account_hint     TEXT NOT NULL DEFAULT '',-- display name/email only, to help pick the right account
  kind             TEXT NOT NULL,           -- 'card_data' | 'asset' | 'template_package' | 'export'
  remote_ref       TEXT NOT NULL,           -- JSON: provider-specific identity (§15.6)
  remote_path      TEXT NOT NULL DEFAULT '',-- display path, refreshed on each check
  set_id           TEXT REFERENCES sets(id) ON DELETE CASCADE,
  asset_id         TEXT REFERENCES assets(id) ON DELETE CASCADE,
  format           TEXT,                    -- 'csv' | 'json' for card data
  import_settings  TEXT,                    -- JSON: mapping, mode, key field (card data)
  last_version     TEXT,                    -- remote version marker at last sync
  last_hash        TEXT,                    -- content hash at last sync
  last_synced_at   INTEGER,
  last_direction   TEXT,                    -- 'pull' | 'push'
  created_at       INTEGER NOT NULL
);
```

Links are view-state-like metadata: they are not part of the undo history, but the data a pull applies is (§15.7). Deleting a set or asset removes its links (cascade).

**Application settings** (§12.3, electron-store under `data/`):

| Setting | Default | Description |
|---------|---------|-------------|
| `cloud_accounts` | `[]` | Connected accounts: id, provider, display name, scopes, connected-at, and the **encrypted** credential blob (§15.5) |
| `cloud_check_on_open` | `false` | Run *Check all now* when a project is opened |
| `cloud_client_overrides` | `{}` | Optional per-provider client IDs for organisations that register their own app |

### 15.14 Explicitly outside this section

Real-time co-editing, automatic or background sync, merging two edited versions of a file, syncing `project.db` or the whole project folder, sharing or permission management on the platform, comments, pull-request creation, Git LFS, and other providers. **Follow-ups that fit the existing link model without redesign:** loose font files as pullable files, and further providers (an adapter, §15.9). (Templates are exchanged as packages, §7.7.4.)

### 15.15 Prerequisites and open decisions

**Registrations the project owner must complete before release (outside the codebase):**

- **Microsoft:** an Entra app registration (public client, multi-tenant + personal accounts) with **publisher verification**, so work/school users are not stopped at an admin-consent screen.
- **Dropbox:** a Dropbox app (scoped access); production status requires Dropbox's review once more than 50 users connect.
- **GitHub:** a GitHub App with device flow enabled and *Contents* permission, set public so any organisation can install it.

**Decisions needed from the product owner** (the text above uses the *recommended* option so the section is complete; changing an option changes only the items named):

| # | Decision | Recommended | Consequence of the alternative |
|---|----------|-------------|-------------------------------|
| D1 | Dropbox access type | Full Dropbox | An *app folder* needs no team-folder browsing permission but confines the app to `Apps/Spadewick/`, so a team could not use its existing shared folders. |
| D2 | Who registers the apps | The Spadewick project, with per-provider override (§15.11) | Making every team register its own removes the verification burden for the project but makes setup a barrier for individual users. |
| D3 | Order of delivery | GitHub → Dropbox → OneDrive (§15.16) | Any order is technically possible; GitHub first because its sign-in needs no review. |

### 15.16 Delivery phases

1. **Framework** — cloud service, adapter interface, account store with `safeStorage`, `cloud_links` table (schema v8), Preferences → Cloud accounts, Cloud links panel, fake-provider test harness (§15.17).
2. **GitHub** (device flow, simplest sign-in, no verification) — pull/refresh/push for card data and images; proves the conflict model with a provider that enforces it (`sha`).
3. **Dropbox**, then **OneDrive** — adds shared/team browsing and resumable uploads.
4. **Export and snapshot destinations** (W7, snapshot push) on every connected provider.

**V2.0 includes GitHub and Dropbox; OneDrive follows in V2.1** (§24.1). Each phase ships only when its tests (§15.17) pass; a provider whose registration is not complete is simply not offered in the Connect list.

### 15.17 Verification

Continuous integration cannot sign in to real accounts, so the logic is tested against **fake providers**: a local HTTP server per provider implementing the subset of that provider's API the adapter uses (listing, download, upload with its real conditional-write behaviour, rate limits, expired tokens, revoked access, shared content). The same **adapter conformance suite** runs against every fake:

- sign-in (PKCE loopback with correct and forged `state`; GitHub device-flow polling, slow-down and denial), token refresh and revocation;
- list with pagination, search, shared/team roots; download with progress, cancel, and verification failure (hash mismatch, invalid image, oversized);
- upload new, update with the right version, update with a stale version (must fail, never overwrite), save-as-new;
- retries on `429`/`5xx`; offline; expired credentials; permission removed;
- link states (all rows of §15.7), refresh of card data (preview, apply, undo) and of an asset (cards update, undo restores the old file);
- credentials: never present in `project.db`, snapshot ZIPs, logs, IPC replies or the renderer; plaintext never written when `safeStorage` is unavailable;
- the renderer's CSP is unchanged and no renderer network request is made;
- end-to-end: connect → pull CSV with remembered settings → remote changes → refresh preview → apply → undo; pull images → refresh; push CSV → conflict → save as new; all through the real interface with axe checks on the new dialogs (§14.4) and the strings lint (§14.5).

**Manual (needs real accounts, listed in Appendix B.2):** one real sign-in and one pull/refresh/push round trip per provider, on a personal and on a work/school or organisation account where applicable.


### 15.18 Keeping data files in step with the fields

The aim: **a designer changes the structure of their cards inside Spadewick — adds, renames or removes fields — and never has to open the CSV or JSON to fix its columns by hand.** The linked file follows the app when the user pushes; the app follows the file when a teammate pulls, with a visible, undoable review in both directions. (The field tools themselves are the Field Manager and column menu of §6.4; this section is only about what happens to a linked file.)

**What is written on a push.** For a card-data link, the file always has one column per field, in the fields' display order, using the field **names** as headers (names are what people see in a spreadsheet and what import matches first, §5.5; slugs are an internal detail). The built-in columns follow: `display_name` and `quantity` (§6.5). Hidden fields are still written. The file is UTF-8 with a header row (CSV) or an array of objects (JSON).

| Change made in the app | What the next push does | What a teammate sees on refresh |
|------------------------|-------------------------|---------------------------------|
| **Add a field** | Adds the column at the field's position, empty or with the field's default value | "New column *Rarity*" → **create the field** (pre-checked); its type is suggested from the values (number, true/false, colour, otherwise text) |
| **Rename a field** | Renames the header; the field's slug is unchanged, so templates keep working | "*Cost* is now *Mana*" → **rename the field** (pre-checked) |
| **Remove a field** | Asks first: "Remove the column *Rarity* from the file? Teammates will be offered to remove the field too." Then removes the column | "Column *Rarity* is no longer in the file" → **keep the field** (default, data is kept) or **remove it** |
| **Reorder fields** | Reorders the columns | Nothing: order is not treated as a change (an option applies the file's order) |
| **Change type, default or validation** | No effect on the file | Not synced: these are local rules |
| **Add or remove cards** | Rows are added or dropped | Cards are matched by **card ID** (§5.8): new IDs become new cards, rows missing from the file are listed, and an unchecked option removes those cards |
| **Rename a card** (change its name or any value) | The row's cells change; its ID does not | An ordinary update to the same card; its template, quantity and position are kept |
| **Same ID, different card** (two people added cards offline) | — | A **same-ID conflict** is shown (§5.8): keep both with a new ID for the incoming card (default), replace mine, or skip |

**Telling a rename from a remove-and-add.** For each linked file the app remembers, per column, which field it belongs to and what the header was at the last sync. On a pull, a remembered header that is gone, together with a new header in the same column position whose values match the old column's values (about 80% of rows or more), is proposed as a **rename**. When it is ambiguous the user sees both "removed" and "new" with a *This is a rename* toggle. Because the saved import mapping is keyed by **field**, not by header text, a rename never breaks a link.

**Review before anything changes.** A pull shows a **Structure changes** section above the card-data preview of §15.7 (new, renamed and removed columns, each with a checkbox), then the cards that would be added, updated or removed. Applying it is **one undoable step** that includes the field changes. Structure changes also count as changes for conflict detection (§15.7): if both sides changed, the conflict dialog says so.

**Two modes per link** (chosen when the link is created, changeable later):

- **Follow the app** (default): the file's structure follows the fields as described above.
- **Data only**: Spadewick updates the values of columns it already knows and leaves everything else in the file — extra columns, column order, notes added by teammates — exactly as it found it. Choose this when others rely on a layout Spadewick should not rewrite.

**Slugs and templates.** A slug (the `{{token}}` name, §5.3) lives in the project, not in the file. Renaming a *name* is always safe; renaming a *slug* updates this project's templates (§5.3) but not a teammate's copy of the template, which travels separately as a template package (§7.7.4). The app therefore warns before a slug change on a field that belongs to a linked file, and the push dialog lists it so the team can share an updated package.

**Verification (adds to §15.17).** Fixtures cover every row of the table above in both directions for CSV and JSON; rename detection (clear, ambiguous, and false-positive cases); a header-only change that must not touch cell data; *Data only* mode preserving unknown columns, their order and quoting byte-for-byte; and a full round trip (change fields in the app → push → pull into a second project → identical fields and cards).

### 15.19 Access to cloud features (placeholder)

The owner's decision (see Appendix C): **everything in this document except cloud synchronisation stays free for everyone.** A paid, one-time **key**, stored on the user's machine and checked offline, is required only to **connect an account and to pull or push files** (§15.8). Local import and export of CSV, JSON, images, PDFs and every other file never need a key. The licensing model — key format, trial, expiry, per-major-version coverage, team packs, what happens when a key is missing — is **not yet specified** and is tracked as an open item in §24 and Appendix C (L6). Until it is written, no cloud code is built that assumes a particular mechanism: the cloud service asks one question ("may this action run?") through a single gate so the mechanism can be added later without touching the providers.

---

## 16. Rich Text and Inline Icons

> **Status: all of §16 is built** except automatic hyphenation from a language dictionary: the text engine (§16.2, phase 2.1, A64), rich text (§16.3, §16.7, phase 2.2, A65), the icon library, text styles, keyword rules and the text check (§16.4, §16.5, §16.9, phase 2.3, A66) and the text controls with the improved auto-fit (§16.6, phase 2.4, A66). Hyphenation works at the soft hyphens (`{shy}`) a person places, because no dictionary is bundled (A66). Extends §7.4 and §8.4; replaces the text-measuring approximation of §7.4 with real font metrics.

### 16.1 Purpose

Card text is more than plain strings: rules text needs **bold or italic keywords**, symbols that sit in the line of text and **grow and shrink with it** (a tap symbol, a cost icon, a suit), and the typographic controls a designer expects. This section adds, for card text only:

1. a small **text markup** for emphasis, colour and icons;
2. an **icon library**: icons the user imports once and uses by name in any text;
3. **keyword rules**: write `Flying` in the data; it always appears the way the project defines it;
4. the missing **text controls** (spacing, justification, vertical alignment, outline, and so on) and better auto-fitting.

All of it works offline, is stored as plain text in the card data (so it survives CSV and JSON), and renders identically in every export (TTS, PNG, print-and-play and production PDF).

### 16.2 Text engine (foundation)

§7.4 estimates text width character by character because the rasterizer cannot measure text. That is not good enough for icons that must sit exactly in a line, for justified text, or for a vector PDF. The text engine therefore:

- **measures and shapes text with the actual font files** (bundled and project fonts, §7.6) through a shaping library (for example HarfBuzz compiled to WebAssembly), so what is measured is what is drawn, including kerning, ligatures and non-Latin scripts and right-to-left text;
- breaks lines using the Unicode line-breaking rules, treats an inline icon as an unbreakable box, and keeps an icon with the punctuation that follows it;
- produces one description of the laid-out text — lines, styled runs, icon boxes, positions — from which both the raster render (§10.5) and the vector PDF (§17) are drawn, so they cannot disagree. **Text is drawn as outlines (glyph shapes) in every output**, never handed to the rasterizer to shape again: this is what guarantees that measured and drawn text are identical, makes screen and print match, and means fonts cannot go missing at print time. `<text>` elements remain the way templates are *written*; the outlines are produced when a card is rendered;
- falls back to the bundled font for a missing glyph and reports it (§16.9).

*Proof of concept first:* the design above was checked by spike A (§24.3) before the engine is built, and **passed** (2026-10-03, A62): HarfBuzz compiled to WebAssembly (`harfbuzzjs`) is the shaper; the current estimator stays available behind a switch until the engine passes its own tests. Two rules came out of the spike. **Text is shaped per run** (the same style, font and direction), not per word, and the glyphs are then assigned to words by cluster; shaping word by word loses the kerning around spaces and measured text would no longer equal drawn text. **An inline icon behaves like a letter for line breaking:** it never separates from a word or punctuation that touches it without a space (`{fire}Flying` stays together); a space on either side allows a break.

*Effect on existing projects:* wrapping becomes more accurate, so some existing text may break a line differently. The first time a project is opened after the upgrade, the app takes a snapshot (§11.1) automatically, but only when some card's text would change, and shows which templates' text changed size or line breaks (a notice with the number of cards and the template names; "no card changed" when none did). The project then moves to the engine; the earlier estimate stays available per project in Project → Fonts… No card data changes.

*As built (phase 2.1).* `src/main/text/` holds the engine; `src/main/render.js` runs it after token substitution. **Fonts** (`fonts.js`): for each text, the requested families (CSS `font-family`), weight and slant give a chain of faces: the project's fonts first, then the bundled ones, ending with Liberation Sans and the bundled **Noto Sans Arabic and Hebrew** (SIL OFL, shipped in `resources/fonts` with their licences), so a character the requested font lacks is drawn from the next face that has it. **Shaping** (`hb.js`): HarfBuzz through `harfbuzzjs`, one face per file, one reused shaping buffer (a buffer per call can exhaust the WebAssembly memory), results cached by text. **Layout** (`layout.js`): runs are shaped whole and split into words by cluster; Unicode line breaking (`linebreak`) and bidirectional reordering (`bidi-js`); a word wider than the box is broken by characters; the vertical model of §7.4 is kept (a line is size x line height tall, the baseline 0.85 x size below its top), so existing templates keep their positions; the five fit modes (`wrap`, `shrink` in steps of 1 down to the minimum, `overflow`, `truncate` with a real ellipsis, `clip`); icons are supported by the layout (an unbreakable box that scales with the text) and wait for the icon library to be drawn. **Drawing** (`outline.js`): all glyphs of one fill become one `<path>` of absolute coordinates, so a gradient fill spans the whole text. **The SVG pass** (`svgText.js`): bound elements first (with overflow targets filled), then every other `<text>`; font properties are inherited from ancestors (`font-*`, `letter-spacing`, `text-anchor`, `direction`, in attributes and `style`, with units em, %, pt and so on); `<tspan>` with its own weight, slant, size, family or fill is supported; the element's other attributes (id, transform, fill, opacity, clip-path…) stay on the `<g>` that replaces it. Left to the rasterizer, and counted in the report: `rotate`, `textLength`, text decoration, `word-spacing`, `font-variant`, writing mode, baseline shifts, per-glyph or per-tspan positions, `<textPath>`, CSS classes from a `<style>` block, and text inside a clip path; a bound element of that kind is laid out the old way. Text with no size takes the rasterizer's own default of 12. **Per project**: `text_engine` in `project_meta` is `outlines` (new projects) or `estimate`; a project without the setting counts as `estimate` until it is opened, when it moves to `outlines` as described above.

*Measured (spike A and the build):* the outlines are pixel-identical to the rasterizer's own shaping for single lines (kerning, bold, serif italic, Arabic, Hebrew), the laid-out box equals the drawn pixels within a pixel, and a re-render of a card with a shrink-to-fit paragraph, Arabic and tspans takes about 9 ms warm and 31 ms for the first card (target 200 ms). The rasterizer's own text draws missing-glyph boxes for Arabic or Hebrew in a Latin font run, which the engine avoids.

### 16.3 Markup

Markup is **opt-in per text element** so existing text with an asterisk or a brace is never reinterpreted. It is on automatically for elements bound to a field of the new type **Rich text** (§16.7); for any other text element it is a checkbox in the properties panel.

| You write | You get |
|-----------|---------|
| `**bold**` | bold |
| `*italic*` | italic |
| `***both***` | bold italic |
| `__underline__`, `~~strike~~` | underline, strikethrough |
| `{icon:fire}` | the icon named *fire* |
| `{fire}` | the same, when *fire* is the name or an alias of an icon and not a reserved word |
| `{icon:fire x1.4}` | the icon at 140% of its normal size |
| `{icon:fire color=#cc3333}` | the icon in that colour |
| `{color:#cc3333}…{/color}`, `{size:120%}…{/size}`, `{font:Name}…{/font}` | colour, relative size, or font for a span |
| `{style:keyword}…{/style}` | a named text style from the project (§16.5) |
| a newline | a new line; a blank line starts a paragraph (§16.6) |
| `{nbsp}`, `{shy}` | a non-breaking space, an optional hyphenation point |
| `\*`, `\{`, `\\` | a literal `*`, `{`, `\` |

Unmatched markup (`**oops`) is shown literally rather than hiding text, and is listed by the checks in §16.9. Names are case-insensitive; names with spaces use hyphens or underscores.

*As built (phase 2.2).* The parser is `src/shared/richText.js` (shared, so the interface and the engine read markup the same way). Emphasis follows the flanking rule of Markdown: an opening marker needs a non-space after it, a closing one a non-space before it; `__` also needs a word boundary, so `snake__case` stays as written, and a lone `_` or `~`, or a run longer than three, is plain text. Pairs may cross each other; a marker or tag with no partner is kept as the characters it was written with and listed as a problem (`unmatched`). Colours must be hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), a size is 10 to 500 per cent and sizes nest by multiplication, a font name may not contain quotes, angle brackets, braces or backslashes: anything else is shown as written, so nothing but a checked value reaches the picture. `\*`, `\_`, `\~`, `\{`, `\}` and `\\` are literal. `{style:name}` applies the text style of that name (phase 2.3, §16.5); a name with no such style draws the text plain and is listed as an `unknownStyle` problem. `{nbsp}` and `{shy}` are the characters U+00A0 and U+00AD; a line that breaks at a soft hyphen shows a hyphen, and when that hyphen would not fit the last piece moves to the next line. Underline and strikethrough run on across the spaces between words of one colour and size. **Bold and italic** use the font's own bold and italic faces; a font without one has it synthesized (italic by slanting the outlines 12 degrees, bold by a second copy shifted 0.03 em and a little more advance), and a real face is always preferred (A65). **Which text is read as markup:** an element bound to a field of the Rich text type, an element whose content is a token of such a field (the pipeline marks it before the tokens are filled in), and any text element carrying `data-spadewick-rich="true"` (the checkbox "Rich text (markup)" in the properties panel, §16.7); every other text is drawn as written. In a project still on the earlier estimate (§16.2) a Rich text field shows as plain text.

### 16.4 Icon library

**What it is.** A project-level library (Project → **Icons…**, the same kind of screen as the asset browser, §9.2) of images that can be dropped into text by name. It reuses the asset store, so icons can come from the cloud connections (§15) and are included in snapshots like any asset.

**Importing.** Drag in files, choose a folder, or import a ZIP. SVG is preferred (it scales without loss); PNG, JPEG and WEBP are accepted. The icon's **name** comes from the file name, lower-cased with spaces turned to hyphens (`Fire Ball.svg` → `fire-ball`); duplicates are numbered and the user can rename on the spot. A re-import with the same name offers *replace* (references stay valid).

**Cleaning.** Imported SVG is sanitised as in §14.7 (scripts, event handlers and external references removed), its view box is normalised, and the app detects whether it is **single-colour** (one fill, or `currentColor`) or **multi-colour**.

**Per-icon settings** (defaults are sensible; most users never change them):

| Setting | Meaning |
|---------|---------|
| Name and aliases | what goes inside `{ }`; a name can be renamed, and the app then offers to update every card, keyword rule and text style that uses it (like a field slug, §5.3) |
| Tags and notes | for search, as for assets |
| Size | multiple of the text size; default 1.0 (the icon is as tall as the line's cap height plus a little) |
| Vertical position | shift up or down relative to the baseline, to centre it on the text |
| Spacing | extra space before and after |
| Colour | **follow the text colour** (default for single-colour icons: the icon is drawn in the surrounding text's colour) or **keep original colours** |

**Scaling.** An icon is sized in proportion to the font size at the point where it is used. When text shrinks to fit (§16.6), its icons shrink with it; line height grows if an icon is taller than the text it sits in; the box the text fits into is measured with the icons included.

**The library screen** shows a grid with a live preview at several text sizes, usage counts (cards, templates, keyword rules), an *unused* filter, search by name, alias or tag, and a warning on delete that lists where the icon is used.

**Starter icons.** A small set of original, freely usable icons (suits, a star, a heart, a shield, a few arrows and generic symbols) is included so the feature is usable on first open. Third-party icon sets are the user's own import; the import screen reminds users to check each set's licence.

*As built (phase 2.2).* The starter set is built, in `src/shared/starterIcons.js`: `star`, `heart`, `shield`, `fire`, `diamond`, `club`, `spade`, `circle`, `arrow-right`, `arrow-left`, `arrow-up` and `arrow-down`, original single-colour shapes that follow the text colour, scale with the text (and with `x1.4` and the `{size}` span) and sit on the baseline. The same shapes are drawn by the text engine (outlines) and shown in the cell editor and the card table. An icon that does not exist is drawn as a hollow square and listed in the text report (`missingIcons`), never dropped. The engine takes an optional resolver, so the project icon library of phase 2.3 can supply icons by name and override these. The library screen, import, per-icon settings and rename-with-references came in phase 2.3 (below).

*As built (phase 2.3).* **Project → Icons…** opens the library: a grid of the project's icons (a preview, name and use count), search by name, alias or tag, a filter (all, not used, one colour, several colours), import from files, a folder or a ZIP, and a panel for the selected icon with a preview at three text sizes, its name, aliases, tags, notes, size, vertical position, spacing and colour mode, *Replace picture* and *Delete*; the built-in icons are listed below (an icon of the same name in the project is used instead). **Import** accepts SVG, PNG, JPEG and WEBP (and a ZIP of them, under the limits of §14.7: 500 files, 100 MB unpacked, no path outside the target, every entry inflated no further than it declares). Names come from the file name, lower-cased with spaces turned to hyphens; a taken name is reported, and the person chooses to replace the icon (its id, settings and every use stay valid) or leave it; the API can also number it (`fire-2`). An SVG is sanitised (§14.7), its view box read (or its width and height), and it is stored as one colour (every colour replaced by `currentColor`, its own colour kept on the root so *keep original colours* still has it) or as it came when it has several colours, gradients, patterns, images or a style block. A picture is shrunk to 512 px and stored as PNG. The engine draws an SVG icon nested in the card with the colour of the text around it (or of its colour span), a picture as an image; spacing before and after, size, vertical position and the shape of the icon (a wide icon is wider) all count in the line. **Renaming** an icon updates every card (in Rich text fields), keyword rule and template text that uses the old name or an alias, in one undo step; **deleting** warns with where it is used, and text that uses it then shows the placeholder box. **Usage** counts cards, templates, keyword rules and text styles. The library lists aliases that belong to two icons as ambiguous; a name wins over an alias."

### 16.5 Text styles and keyword rules

**Text styles.** A **named text style** bundles font, weight, style, size multiple, colour, spacing and effects (for example *Keyword*, *Flavour text*, *Cost*). A style is applied with `{style:name}…{/style}` or by a keyword rule, and changing the style changes every card at once. Edited at Project → **Text styles & keywords…**.

**Keyword rules.** The scenario: your game has a keyword *Flying*; designers type it in plain text, and it must always look the same, with a symbol, in every language of the rules text. A rule says:

| | |
|--|--|
| **When the text contains** | a word or phrase (whole word by default; optionally ignore case; optionally a pattern) |
| **Show it as** | a text style, an icon, an icon followed by the text, or replacement text |
| **Applies to** | all rich text, or chosen fields |

Rules are applied when the card is drawn; the stored data stays plain, so a CSV opened in a spreadsheet still reads naturally. A preview line in the dialog shows each rule on sample text. Rules can be turned off per text element.

*As built (phase 2.3).* **Project → Text styles & keywords…** has two tabs. **Text styles:** a list and a form for the selected style (bold, italic, underline, strikethrough, small capitals, font, size multiple, colour, letter spacing in thousandths of an em, outline width and colour and a hard shadow, in em), a preview, usage counts, rename (which updates `{style:old}` in cards and templates and the rules that use it, in one undo step) and delete. A style name is a key like an icon name. In text, a style applies under whatever the markup itself says (`{color}` beats the style's colour, sizes multiply, bold and italic add up); a style that does not exist shows as plain text and is listed by the text check. **Keyword rules:** an ordered list; each has the word or phrase, *whole word* (default, Unicode-aware), *ignore case*, *pattern* (a regular expression: refused when longer than 200 characters, invalid, using a back-reference, or with a repeat inside a repeat, because such patterns can take exponential time; a plain keyword is at most 100 characters), how to show it (a text style, an icon, an icon followed by the text, or other text), whether it applies to all rich text or chosen Rich text fields, on or off, and a preview on a sample text that the person can change. Rules are tried in order and a word a rule has claimed is not offered to the next; they apply only to rich text, never to a Text field, and not in an element with `data-spadewick-keywords="off"` (the checkbox "Apply keyword rules" in the properties panel). The rich text editor's **Insert keyword** button lists the plain words of the enabled rules.

### 16.6 Text controls

The properties panel (§8.4) gains controls for **any** text element (rich or not). Existing: font family, size, weight, style, left/centre/right alignment, fit mode, minimum and maximum size, line height (§7.4).

| Control | Options |
|---------|---------|
| **Auto-fit** (extends §7.4) | `shrink` gains a **step** (0.25–1 pt), an option to **tighten letter spacing first** (down to a limit, such as −3%) before reducing size, an option to **keep icons in proportion**, **maximum lines** as an alternative to a box height, and a visible indicator when text has hit the minimum size and still does not fit |
| **Letter spacing** | tracking, in thousandths of an em (and per-style) |
| **Word spacing** | extra space between words |
| **Line height** | as today, plus *exact* (in points) as an alternative to a multiple |
| **Paragraph spacing** | space before/after a paragraph (a blank line in the text) |
| **Alignment** | left, centre, right, **justify** (last line left-aligned) |
| **Vertical alignment** in the box | top (today's behaviour), middle, bottom |
| **First-line indent** and **bulleted lines** | lines starting `- ` get a bullet (a character or an icon) and a hanging indent |
| **Text transform** | none, UPPERCASE, lowercase, Title Case, small caps (the font's real small caps when it has them) |
| **Balance lines** | evens out line lengths (useful for card titles) |
| **Avoid single-word last lines** | moves a word down to avoid a lone word on the last line |
| **Outline** | width and colour, drawn behind the fill |
| **Shadow** | offset and colour (a hard shadow; no blur, so print output stays vector) |
| **Hyphenation** | off by default; on uses the language's dictionary where one is bundled, and `{shy}` points always |

*As built (phase 2.4).* Every control is an attribute of the text element, set in the properties panel under **Typography** (so templates stay plain files and the controls are the same in every export): `letter-spacing` in em (tracking, shown in thousandths of an em), `word-spacing` in em, `data-spadewick-line-height` (a multiple, or an exact height with a unit such as `18pt`), `data-spadewick-paragraph-spacing` (em: a blank line becomes this gap between paragraphs, once however many blank lines there are), `data-spadewick-text-align="justify"` (with `text-anchor` for left, centre and right; the spare room goes into the spaces of every line but the last of a paragraph), `data-spadewick-valign` (`top`, `middle`, `bottom` in a box taller than the text), `data-spadewick-indent` (em, the first line of each paragraph), `data-spadewick-bullets="true"` with `data-spadewick-bullet` (a character, default •, or `icon:name`: lines starting with `- ` become bullets and the lines after a bullet hang under the text), `data-spadewick-text-transform` (`uppercase`, `lowercase`, `title`, `small-caps`: the font's real small capitals when it has the `smcp` feature, otherwise lower case letters as capitals at 0.8 of the size), `data-spadewick-balance="true"` (the narrowest measure that gives the same number of lines), `data-spadewick-avoid-orphans="true"` (a slightly narrower measure that leaves at least two words on the last line, never adding a line), `data-spadewick-outline="width colour"` (stroked behind the text) and `data-spadewick-shadow="dx dy colour"` (a hard copy behind it; no blur), with colours as hex only. **Auto-fit (shrink)** gains `data-spadewick-text-step` (0.25, 0.5 or 1), `data-spadewick-tighten` (letter spacing is tightened in steps of 0.5 % of an em down to this limit at each size before the size goes down), `data-spadewick-icon-scale="fixed"` (icons keep their size while the text shrinks; by default they shrink with it) and `data-spadewick-text-max-lines` (a limit on the number of lines, alone or with the box height, for shrink, overflow and truncate). When shrink reaches its minimum and the text still does not fit, the properties panel shows a warning for that element (from the text report of the last render) and the text check lists it. Text styles use the same properties for outline, shadow, tracking and small capitals. **Hyphenation** is by `{shy}` only: no dictionary is bundled, so there is no language setting (A66).

### 16.7 The Rich text field type and editing

- A new field type **Rich text** (§5.3) stores the markup as ordinary text. In the card table the cell shows the styled result; editing opens a small multi-line editor with a toolbar — **Bold, Italic, Underline, Colour, Insert icon** (a searchable picker showing the library), **Insert keyword** — and a live preview of the card text. Ctrl+B and Ctrl+I work as expected. The markup can always be edited as plain text instead.
- In the canvas editor, a text element bound to a Rich text field renders rich automatically; a text element bound to a plain field has a **Rich text** checkbox.
- **Find and replace** (§5.7) searches rich text fields as text, including markup.
- **CSV and JSON** carry the markup as is (§5.5). A CSV opened in a spreadsheet shows `{fire}` and `**Flying**`; importing it elsewhere works as long as the icon names exist (§16.9).
- **Cloud and snapshots:** icons are assets, so they travel with the project and are pulled like images (§15). Keyword rules and text styles are project data and are included in snapshots.

*As built (phase 2.2).* **Field type:** `rich_text` in the Fields dialog (template packages carry it too). **Card table:** the cell shows the styled result on one line (an icon as its shape); Enter, F2, a double-click or typing a character opens the editor, which floats over the table. **Editor:** a multi-line box holding the markup itself, a toolbar (Bold, Italic, Underline, Text colour, Insert icon with a search over the starter set), Ctrl+B, Ctrl+I and Ctrl+U, a live preview, and a list of the markup's problems (unmatched markup, invalid values, an icon that does not exist, an unknown style); a button on a selection wraps it and the same button takes the markers off again; Ctrl+Enter saves, Escape cancels, and moving focus out of the editor saves. **Insert keyword** (phase 2.3) lists the plain words of the enabled keyword rules and types the chosen one; the Insert icon picker lists the project's icons before the built-in ones. **Converting** a field between Text and Rich text first shows a panel with the cards that would look different, as they look now and as they would after the change, and changes the type only on confirmation (cards where nothing differs change at once). **Import** into a Rich text field asks, when such a field is mapped, whether the incoming text is read as markup (the default) or kept exactly as written by escaping it. **Find and replace** searches the markup and shows Rich text results without it. **Plain text:** the Tabletop Simulator card name and description, the export filter and formula arguments read a Rich text field without markup (an icon as its name); there are no table sort or search features yet, so nothing else needs it today. **CSV and JSON** carry the markup as stored.

**Where the markup is removed.** Markup is for drawing cards only. Everywhere a field is used as *plain text* — the Tabletop Simulator card name and description (§10.2), file names (§10.1), the card filter (§10.1), the Find and Replace results list (§5.7), formula arguments when a rich-text field is used in a formula, and the card table's sort and search — the markup is stripped and an icon is replaced by its name. A formula field may feed a rich-text element (the element's Rich text checkbox decides). **Converting an existing Text field to Rich text** shows a preview of the cards whose appearance would change (text containing `*`, `_`, `~` or `{`) before it is applied; **imports into a Rich text field** can treat the incoming text as literal (escaping it) or as markup, chosen in the import dialog.

### 16.8 Data model

Schema version 8 (built) added the field type value `rich_text` (§13.3). **Schema version 9 (built, A66)** added three tables. `icons`: id, `name` (unique, a key such as `fire-ball`), `aliases` (JSON list), `asset_id` (the picture is an asset, tagged `icon`), `size` (a multiple of the text size), `v_offset` and `spacing` (em), `color_mode` (`follow` or `keep`), `single_color`, `aspect`, `tags`, `notes`. `text_styles`: id, `name` (unique key), `props` (JSON: font, weight, slant, size multiple, colour, tracking, outline, shadow, small capitals). `keyword_rules`: id, `match`, `whole_word`, `ignore_case`, `is_pattern`, `mode` (`style`, `icon`, `icon_text`, `replace`), `action` (JSON), `scope` (null or a JSON list of field slugs), `enabled`, `sort_order`. All three are covered by undo and redo and are in snapshots. Element attributes in the SVG (so templates remain plain files): `data-spadewick-rich`, `data-spadewick-keywords="off"` and the text controls of §16.6 (each listed under "As built" there).

### 16.9 Checks and limits

A **text check** (also part of the print preflight, §17.7) reports: unmatched markup; **missing icons** (shown in the card as a visible placeholder box, never silently dropped, and listed with the cards that use them — including after a CSV import); characters missing from the chosen font; text that does not fit even at the minimum size; icon names that are ambiguous (an alias used by two icons).

**Fonts and rights.** Because text becomes outlines (§16.2), the check also reads each font's **embedding permission** (the font's own flag) and warns when a font forbids embedding or outlining for commercial printing, before an export that would need it (also a preflight finding, §17.7).

*As built (phase 2.3).* **Project → Check text…** draws every card through the text step (no pictures are made, and whichever text engine the project uses) and lists what it found, grouped so that a problem many cards share is one line with the count and the cards (the first five by name): **errors** (an icon that does not exist or whose picture is gone; a character no font has; text that does not fit at the minimum size; a project font that a template uses and whose own flag forbids embedding; a card that could not be drawn), **warnings** (unmatched or invalid markup, a text style that does not exist, an unknown icon parameter, an alias two icons share, a font that allows only preview and print) and **notes** (a text left to the rasterizer because it uses something the engine does not draw). Each line says the template and the element. *Only errors* filters the list. The service (`core/textCheck.js`) is what the print preflight (§17.7) will reuse.

**Undo.** Icons, text styles and keyword rules are project data covered by undo and redo (§11.2); renaming an icon together with the references it updates is one undo step.

**ZIP imports** of icon sets use the same ZIP safety limits as snapshots (§14.7): a maximum number of files, a maximum total unpacked size, a maximum compression ratio, and no paths outside the target.

Limits: **colour emoji are not supported** — outlined text cannot carry colour glyphs, so an emoji typed into card text draws as a plain shape or a missing-glyph box and is flagged by the text check; use an icon instead. Icons are drawn as images in text, not as font glyphs, so they cannot be selected as text in a PDF; blur effects are not offered; right-to-left and complex scripts are shaped correctly but icons and bullets in right-to-left text are placed in logical order (checked by tests on fixtures, no native-speaker review in this version).

### 16.10 Verification

Unit tests: the markup parser (nesting, escapes, malformed input, very long text); keyword rule matching (whole word, case, overlap, order); icon sizing, baseline and scaling under shrink; line breaking with icons; fit invariants (the laid-out text is never larger than its box, minimum size honoured). Golden-image tests compare rendered cards for fixed fixtures (fonts bundled, so exact). Integration tests: icon import (SVG, PNG, ZIP, duplicates, unsafe SVG), rename with reference updates, CSV round trip with markup, missing icons after import. End-to-end tests: the rich-text cell editor and picker by keyboard, the properties panel, accessibility (axe) on all new dialogs and the toolbar (§14.4), and the strings lint (§14.5). Performance: a single card re-renders within 200 ms with rich text (§14.1).

---

## 17. Print-Production PDF

> **Status: phase 1 and the preflight built** (CMYK raster production PDF, phase 4.1, A70; preflight, phase 4.3, A72; specified in v1.8). Manufacturer presets (§18, phase 4.2) and the vector output of phase 2 (§17.6) are not built. Extends §10.3; relies on the text engine of §16.2.

### 17.1 Purpose

The print-and-play PDF of §10.3 is for printing at home. A designer who sends a game to a manufacturer needs something different: a file that a print shop's pre-press accepts without questions. This section defines a **production PDF** with the properties manufacturers ask for, a **preflight** that tells the user what to fix before they upload, and a **colour workflow** for converting screen colours to ink.

### 17.2 What manufacturers require (the standards behind the feature)

These requirements recur in the public artwork guides of card and board-game manufacturers (the individual guides are summarised in §18; the numbers below are what they have in common — each manufacturer's own values are in the presets):

| Requirement | Typical value | Why |
|-------------|---------------|-----|
| **File type** | PDF, usually one card per page; some accept PNG/JPG at the right size | Pre-press tools expect PDF |
| **Colour** | **CMYK** (not RGB); a named output profile for the press (for example a coated or uncoated sheet-fed profile) | Presses print four inks; RGB is converted by the printer, often with a dull result |
| **Resolution** | **300 ppi minimum** at final size; 600 for fine line art | Below that, images look soft |
| **Bleed** | **3 mm (0.125 in)** on every side, artwork extended into it | Cutting is not exact; without bleed a white edge can appear |
| **Safe area** | **3 mm (0.125 in)** inside the trim line | Text and symbols near the edge can be cut off |
| **Page boxes** | MediaBox, **TrimBox** (final card), **BleedBox** (trim plus bleed) | Tells pre-press where the card is |
| **Black text** | Small black text in **100% K** (C0 M0 Y0 K100), often set to overprint; **rich black** (for example C40 K100) only for large black areas | Four-colour black text misregisters and looks fuzzy |
| **Total ink coverage** | Limited (commonly around 300% for coated stock, lower for uncoated) | Too much ink smears and takes too long to dry |
| **Fonts** | Embedded, or converted to outlines | Missing fonts change the layout |
| **Standard** | **PDF/X-4** (live transparency, colour-managed) or **PDF/X-1a** (CMYK and spot only, transparency flattened — the most compatible) | Standards guarantee what is inside the file |
| **Die line** | A separate cut path, often a **named spot colour** (for example `dieline`) or a non-printing layer | Shows the cutter where to cut; also corner radius |
| **Hairlines** | Strokes thinner than about 0.25 pt may not print | |
| **Small text** | Below about 6 pt (8 pt for reversed-out text) is risky | |

*Sources and notes in §18. Values differ per manufacturer; the product never assumes them — the user picks a preset (§18) or edits the settings.*

### 17.3 The production export

In the Export dialog (§10.1), the PDF tab gets a **Mode** switch: **Print-and-play (home printing)** — today's behaviour, §10.3 — and **Production (manufacturer)**. Production mode has these settings; a manufacturer preset (§18) fills them in:

| Setting | Options |
|---------|---------|
| **Standard** | PDF/X-4:2008 (default) · PDF/X-1a:2001 · plain CMYK PDF (no standard claimed). Until the output has been checked with an independent commercial preflight tool, the interface and the file's document information describe it as **"PDF/X-4-style, unvalidated"** rather than claiming conformance (R4, §24.4) |
| **Colour** | **Convert to CMYK** with a chosen output profile (default) · **Keep RGB** (PDF/X-4 only; the printer converts) |
| **Output profile** | A library of free profiles shipped with the app (see §17.5) plus **import your own** (manufacturers publish theirs) |
| **Rendering intent** | Relative colorimetric with black-point compensation (default) · perceptual · saturation · absolute |
| **Page layout** | One card per page, page size = trim + bleed, **TrimBox** and **BleedBox** set (default) · optional extra margin for **crop marks** and **registration marks** outside the bleed |
| **Fronts and backs** | Separate files `…_fronts.pdf`, `…_backs.pdf` · one file with backs after fronts · one file with each back after its front · "backs only once" for a shared back |
| **Bleed** | From the preset or custom; see §17.4 |
| **Safe area** | From the preset or custom; drawn as a guide in the canvas editor (§17.4) and checked by preflight |
| **Die line** | None · spot colour with a configurable name · non-printing layer · both; corner radius from the card size (§18.3) |
| **Text** | **Convert text to outlines** (default; fonts cannot go missing and the printer cannot reflow it) · embed subset fonts |
| **Black rules** | Pure black text → 100% K (default on); large black areas → rich black with chosen values; overprint for black text (default per preset) |
| **Images** | Placed images keep their resolution; those above 600 ppi are reduced to 600; lossless compression by default, JPEG at a chosen quality as an option |
| **Total ink limit** | A percentage (default from the profile); areas above it are reduced and reported |
| **Spot colours** | Colours with a spot name (§17.5: print colours, decided in A70) are written as spot separations by the vector output of phase 2; the raster output of phase 1 prints them as their inks |
| **Metadata** | Title, creator, the output-intent profile name, and for PDF/X the required identification entries |
| **Quantity** (§6.5) | Off by default in production (the manufacturer prints the quantity you order; one page per distinct card). Optional "repeat copies" for manufacturers that want every copy |

**Which phase delivers what.** Phase 1 (CMYK raster, §17.6) offers: standard, colour conversion and profile, rendering intent, page layout, boxes, marks, fronts and backs, bleed, safe area, die line, image resolution, ink limit and metadata. The settings **Convert text to outlines / embed fonts**, **pure-K black text**, **overprint**, **rich black for large areas** and **spot colours in vector artwork** need vector output and are **phase 2 only**; in phase 1 they are shown disabled with the reason, and text is part of the raster image. In phase 1 the file contains no transparency, so PDF/X-1a-style output is straightforward.

**Back to the user:** the dialog's right side shows a **proof preview** — the card as it will print (§17.5, soft proof) — and the **preflight** summary (§17.7). *Export* is disabled while preflight has errors, with a clearly labelled *Export anyway* for users who know better.

*As built (phase 4.1).* The work is in `src/main/production/` (`settings.js`, `raster.js`, `pdf.js`, `engine.js`), `src/main/colour/lcms.js` (colour conversion with `lcms-wasm`, spike B, A68), the services `core/production.js`, `profiles.js`, `printColors.js` and `exportProfiles.js`, and the dialog `ProductionPanel.svelte` inside the PDF tab of the Export dialog (a **Mode** switch: *Printing at home* or *A manufacturer (production)*). Built as specified in the table above: **standard** (PDF/X-4, PDF/X-1a or plain CMYK PDF; the file's Subject says "PDF/X-4-style, unvalidated" and the identification entries that would claim conformance are not written, R4), **colour** (convert to CMYK through the profile, or keep RGB with PDF/X-4 or plain), **output profile**, **rendering intent** with **black point compensation**, **resolution** (72 to 1200 ppi, 300 default), **bleed** and **safe area**, **crop and registration marks** (room for them outside the bleed), **die line** (a named spot colour that overprints, a non-printing layer, or both, with a corner radius, 3.175 mm by default), **fronts and backs** (two files, one file with the backs after the fronts, each back after its front, or one back at the end), **total ink limit** (the cyan, magenta and yellow plates are scaled together and the black plate kept; the highest total before the limit is reported), **quantity** (off by default; *repeat copies* writes a page for every copy), **metadata** (title, producer, the profile and intent), **saved settings** (named, kept in `export_profiles`) and a **proof** (below). One card is one page; the page is the trim plus the bleed (plus the room for marks) with `MediaBox`, `CropBox`, `BleedBox`, `TrimBox` and `ArtBox` (the safe area), the profile as output intent, and the card as an 8-bit CMYK image in the `ICCBased` colour space of that profile, Flate-compressed. Layers (Artwork, Die line, Print marks) exist only when a die line or marks are asked for. PDF dates are written in the form of the specification (A69). A card is rendered at the chosen resolution, flattened onto paper (print has no transparency in phase 1) and converted in strips of rows; 100 cards at 300 ppi take about 8 seconds on the development machine (target: 90 s), and the export can be cancelled (no file is left behind). Not built (as the text above says for phase 1): text as outlines or fonts, pure-K black text, overprint of black, rich black for large areas and spot colours inside the artwork (all need the vector output of phase 2); reducing images above 600 ppi (the card is rendered at the chosen resolution, at most 1200, so there is nothing above 1200 to reduce). *Built since:* the preflight panel and the export gate (phase 4.3), manufacturer presets (phase 4.2) and **the JPEG option (A77): Picture compression in the production panel, lossless by default, or JPEG at a quality of 50 to 100. The encoder is `production/jpeg.js` (the image library cannot write CMYK from CMYK values): baseline, no subsampling; CMYK is written as every PDF producer writes it (Adobe marker, inverted values, `/Decode [1 0 1 0 1 0 1 0]`) and RGB as plain components with `/ColorTransform 0`. Checked against two independent decoders (the image library and Pillow: the CMYK comes back with a mean error of 0.02 at quality 95); not yet opened in a commercial preflight tool, and for smooth artwork lossless is often smaller, so lossless stays the default.**

*Print colours (the open question Q1 of §28.3, decided in A70).* A **print colour** is a row of the project (`print_colors`: name, screen colour, optional ink values in percent, optional spot colour name), managed in **Print colours…** in the production panel. It is matched to the design **by its screen colour**: where a flat area of the card has exactly that colour, the production export prints the ink values given instead of the profile's conversion (anti-aliased edges keep the profile's conversion). A spot colour name is kept for the vector output; in phase 1 it is printed as its ink values and the export says so ("The spot colour X was printed as its CMYK inks"). No element or field needs to be marked.

*Output profiles (§17.5).* One profile ships: **CGATS21_CRPC1** (US sheet-fed coated, from the ICC profile registry; its own text allows use, embedding and sharing without restriction; shipped unaltered with its licence note). Others are **imported** in **Profiles…** from the manufacturer's file: it must be a CMYK output profile (`prtr`), up to 12 MB, and is named from its own description (a second copy gets a number); the person can add a licence note. An imported profile is stored in the project as an asset tagged `icc-profile` (so it travels with snapshots; it never appears in the picture library) and importing and removing are one undo step. **ISO Coated v2 (FOGRA39) from the European Color Initiative is not bundled**: no explicit redistribution grant was found in its files (spike B), so it is imported by the person; the dialog points to eci.org.

*Bleed in templates (§17.4).* A template has a **bleed mode** (Template menu → **Bleed…**): **included** (the canvas is the trim plus the stated bleed; the editor draws the trim and safe lines inside it), **extend** (the default: the edge of the rendered card is mirrored outward when the file is made) or **fill** (a chosen colour). A template of trim size can be widened to include a bleed with one button; the content is wrapped in a group that is moved by the bleed, so it keeps its place relative to the trim, and the change is one undo step. When the export's bleed is smaller than the template's own it is cut; when larger, the template's outermost pixels are carried further. The **canvas editor** has a **Trim and bleed lines** toggle drawing the trim line, the safe line (3 mm) and, for a template that includes bleed, the bleed edge, each dashed in its own colour and labelled in words; the lines are never written to the file. The extend mode mirrors the edge as the specification says; rounded transparent corners become paper white and are mirrored into the bleed, which the preflight of phase 4.3 is to warn about.

*Proof (§17.5).* The panel shows the card the way it will print: converted to the profile and shown again in sRGB, with the colours the press cannot reproduce highlighted (a pixel whose shown colour differs from the wanted one by more than a set amount in any channel), optional trim and safe lines, the highest total ink, the share of the card out of range, how many pixels the print colours set exactly, and any spot colour printed as inks. The panel says a soft proof is a guide and recommends a physical proof. Not built: the soft proof of the whole preview in the canvas editor and the card table.

### 17.4 Bleed, trim and safe area in templates

Cards are usually drawn at trim size, and the bleed has to come from somewhere. A template therefore has a **Bleed** property with three behaviours:

1. **Template includes bleed.** The template's canvas is trim size plus the bleed on each side, and says so (for example, a 69.5 × 94.9 mm canvas for a 63.5 × 88.9 mm card with 3 mm bleed). The editor draws the trim line and the safe line over the canvas. This is the right choice for new templates meant for production.
2. **Extend the edges (default for older templates).** At export the outermost row and column of pixels are extended (mirrored) into the bleed. Good for flat backgrounds and borders; the preflight warns when the edge is not plain.
3. **Fill with a colour.** As §10.3's bleed colour.

The **canvas editor** (§8) shows three guides for the active card size: the **trim** line, the **safe** line and the **bleed** edge, in addition to the grid. The guides are labelled in words as well as colours and can be hidden. When a manufacturer preset is active, its values are used.

### 17.5 Colour workflow

- **Output profiles.** The app ships a small set of freely redistributable CMYK profiles for the common press conditions (for example a European coated profile such as FOGRA39 and a US sheet-fed profile). Profiles that manufacturers name but whose licence does not allow bundling (some are bundled only with commercial design software) are **imported by the user** from the file the manufacturer provides; presets (§18) say which profile they expect. Each bundled profile's licence is listed in the About dialog.
- **Colours** get optional **CMYK values** and an optional **spot colour name** (for metallic or special inks). **Decided (A70, §28.3):** the project palette that was to carry these is gone (§7.5), so they live in a project list of **print colours** matched to the design by screen colour (see *As built* in §17.3). With none given, CMYK comes from converting the RGB value through the output profile.
- **Converting images** uses the same profile and intent, and raster layers are converted once per export.
- **Soft proof.** The preview can **simulate the printed result** (convert to the output profile and back for display) and optionally **highlight colours that are out of the press's range** — bright screen colours that will print duller. Soft proofing is a guide, not a calibrated proof; the dialog says so and recommends ordering a physical proof.
- **Total ink coverage** is measured on the converted pixels and on vector colours; the limit comes from the preset or profile.

### 17.6 Output technology and phases

The renderer today turns each card into a raster image (§10.5), so text and shapes arrive in a PDF as pixels. That is acceptable for many manufacturers at high resolution but cannot give vector text or 100% K text. Production export is therefore delivered in two phases, each useful on its own:

| Phase | Output | Meets |
|-------|--------|-------|
| **1 — CMYK raster production PDF** | Each card rendered at 300–600 ppi, converted to CMYK through the output profile, embedded in a PDF with TrimBox, BleedBox, output intent, crop/registration marks and die line; preflight panel; manufacturer presets; soft proof | Consumer and print-on-demand services and many offset manufacturers that accept 300 ppi CMYK PDF; the common case |
| **2 — Vector production PDF** | The laid-out card (§16.2) is drawn as vector: shapes, **text as outlines or embedded fonts with 100% K black**, vector icons, CMYK/spot colours, live PDF/X-4 transparency; raster images embedded at native resolution. Elements the PDF cannot express (blur filters, some blend modes) are rasterized in place and reported by preflight. PDF/X-1a mode flattens transparency | Offset manufacturers that require vector black text and PDF/X |

**Before phase 2 starts,** the exact list of SVG features the vector writer supports is written down in this section (shapes, paths, transforms, clipping, solid and linear gradients, opacity, embedded raster and SVG images, outlined text); everything else — blur and other filters, masks, blend modes, patterns — is **rasterized in place** at 600 ppi and reported by preflight. Phase 2 uses the same text engine (§16.2) as the screen render, so what the user sees is what is printed. The PDF is written by the app's own PDF writer (the library already used for §10.3, with an extension for colour spaces, boxes, output intents and spot colours) rather than a bundled third-party converter.

### 17.7 Preflight

A checklist runs **before** export and is also a standalone command (Project → **Check print readiness…**, and `spadewick preflight`, §21). Each finding names the card, the element where it can be found, and what to do, and offers **Show me** (selects the element in the canvas). Severity: **Error** (blocks export, can be overridden), **Warning**, **Info**.

| Check | Severity | Notes |
|-------|----------|-------|
| No bleed (edge not extended or template lacks bleed) | Error | links to §17.4 |
| Text or icons outside the safe area | Warning | per element, per card |
| Raster image below the target resolution at its placed size | Warning (below 300 ppi); Error (below 150) | effective ppi shown |
| Text smaller than the minimum size; reversed-out text smaller than its minimum | Warning | minimums come from the preset, defaults 6 pt / 8 pt |
| Stroke thinner than the minimum | Warning | default 0.25 pt |
| Small black text that is not pure K | Warning | auto-fixed if the black rule is on |
| Total ink coverage above the limit | Warning | reduced automatically; the maximum is reported |
| Colours outside the output profile's range | Info | with the soft-proof overlay |
| Elements that need transparency flattening (PDF/X-1a) | Info | listed, and rasterized in place |
| Missing fonts, missing icons (§16.9), missing images | Error | |
| Card back missing, or sizes of front and back differ | Error | |
| Page boxes or output intent inconsistent | Error | internal consistency check |
| Die line missing when the preset requires one | Warning | |
| A font that forbids embedding or outlining is used (§16.9) | Warning | names the font and the cards |
| Deck size breaks the manufacturer's rules (minimum, maximum, or a multiple — §18.2), counting quantities when "repeat copies" is on | Warning | for example "53 cards; this manufacturer prints in multiples of 9 — add 1 or remove 8" |
| File size very large | Info | |

*As built (phase 4.3).* The engine is `src/main/preflight/` (`engine.js`, `static.js`, `settings.js`) with the service `core/preflight.js` (channels `preflight:*`); the interface is **Project → Check print readiness…** (`PreflightDialog.svelte`) and a **Print readiness** section at the top of the production panel (`PreflightList.svelte` shows the findings in both). It runs for the production settings and the selection of the export dialog, follows them a moment after each change, and gates the export. **Built (every row of the table above except two):** no bleed; text or icons outside the safe area; pictures below the resolution at their placed size (warning below 300 ppi, error below 150; the effective ppi is worked out from the picture's pixels and the box it fills, honouring `slice` and `meet`); text under the minimum size and reversed (light) text under its own minimum (sizes in points from the text step's own report, with the template's transforms); strokes thinner than the minimum; small pure-black text (a warning that it prints as a mix of four inks, and information once a print colour sets #000000 to 100 % K alone: the phase 1 form of the black rule); total ink above the limit (with the highest value); colours outside the press range (information, with the share of the card); elements that need transparency (information; elements hidden by the starter templates' guides are ignored); missing fonts' characters, missing icons, text that does not fit, a card that cannot be drawn (from the text check, which now reports to the preflight through a hook), and a font that forbids embedding (a warning); a missing picture of a card or template, or of the card back; the card back (none chosen, picture gone, picture of another shape: errors); the edge that becomes the bleed (transparent rounded corners, or an edge with more than a dozen colours, in *extend* mode: a warning); a template whose own bleed is smaller than the export's (information); a missing output profile and contradictory settings (marks over the bleed, a safe area as large as half the card: errors); a required die line that is not chosen (a warning, for presets); and a very large file (information). **Not built:** *deck size breaks the manufacturer's rules* (needs presets, §18, phase 4.2). Findings are **grouped** (a problem many cards share is one line with the count and the cards) and ordered error, warning, information; each names the template and element and what to do, and **Show me** opens the template editor on that template, selects the element, and shows a card that has the problem. **Gating:** errors disable *Export* until the person ticks **Export anyway**; warnings and information never block. **Minimums** (smallest text 6 pt, reversed text 8 pt, thinnest line 0.25 pt, 300 and 150 ppi, black text up to 12 pt, die line required) are kept in the project (`project_meta`), edited in the preflight dialog, and can be overridden for one run. The colour checks draw each card at 100 ppi, so a project of 100 cards is checked in a few seconds. *Internal consistency:* every production PDF is read back after it is written and its boxes (nested, with the bleed and safe area asked for), output intent and colour space are checked; the result is `report.verified` (a finding here is a defect of the writer).

### 17.8 Data model and settings

Schema version 10 (**built**, A70): `templates.bleed_mm`, `bleed_mode` ('included', 'extend' or 'fill') and `bleed_color`; `icc_profiles` (name, the asset that holds the file, colour space, description, licence note); `print_colors` (name, screen colour, optional C, M, Y, K in percent, optional spot name, order: where CMYK and spot values live, §28.3); `export_profiles` (name, kind, JSON options) used by the dialog and later the command line (§21). All three tables and the template columns are covered by undo and redo and are in snapshots. Not built: default minimums for preflight (phase 4.3).

### 17.9 Verification

- **Automated PDF inspection** (using the PDF library plus a small purpose-built reader): page count and order; **MediaBox, TrimBox, BleedBox** values and their nesting; output intent present for PDF/X; **no RGB colour operators** in CMYK mode; text-to-outline versus embedded fonts; black text fills are exactly K=1 in phase 2; spot colour names; crop and registration mark positions; die line geometry; image ppi.
- **Pixel tests** (render the PDF with the Poppler tools already used in CI for §10.3): the card sits exactly inside the trim; bleed colour reaches the page edge; backs align with fronts.
- **Colour tests:** known conversions within a stated tolerance (for example pure black, pure white and primary colours through each bundled profile); total-ink calculation on test charts.
- **Preflight tests:** a fixture card for every row of §17.7, each deliberately wrong, expecting exactly that finding and the correct *Show me* target; a clean card expecting none.
- **Presets:** every preset (§18) renders a sample deck without errors and its file passes its own preflight rules.
- **Not automatable (Appendix B.2):** acceptance by a real manufacturer's pre-press and a **physical proof**, and independent validation of PDF/X conformance with a commercial preflight tool (Acrobat Preflight or pdfToolbox), since free validators cover only some of the standard. *Decision (2026-10-02): proof orders cost money and are **deferred indefinitely**; until they happen, every preset is labelled "not proof-tested" and the app makes no claim that a manufacturer will accept a file.*
- **Performance targets** (§14.1): 100 cards, 300 ppi CMYK, in under 90 seconds (phase 1); the interface stays responsive and the export can be cancelled.

### 17.10 Out of this section

Imposition onto press sheets (manufacturers do this), ICC profile *creation*, calibrated hard proofing, trapping, PDF/A, Pantone libraries (a spot colour is a name plus an alternate CMYK; the user enters values from their own swatch book), booklet and box templates.

---

## 18. Manufacturer Presets

> **Status: built** (phase 4.2, A73; specified in v1.8). Uses §17 (production PDF) and §10.4 (PNG output).

### 18.1 Purpose

Every manufacturer asks for slightly different bleed, safe margins, resolution, colour mode and file structure. A **preset** is a saved bundle of those requirements. Choosing *Print with: The Game Crafter* in the Export dialog sets the card size, bleed, safe area, resolution, colour mode, file type, page structure and preflight rules in one step, so a designer does not have to find, read and re-type a printer's artwork guide.

### 18.2 What a preset contains

| Field | Meaning |
|-------|---------|
| Name, manufacturer, link to the artwork guide | shown in the dialog |
| **Card sizes it applies to** | Spadewick size presets (§10.6) the manufacturer offers; sizes not listed are marked "check with the manufacturer" |
| **Output kind** | production PDF (§17), per-card images (PNG/JPEG), or both |
| Trim, **bleed**, **safe margin** | millimetres or inches, as the manufacturer states them |
| **Pixel size** | for image uploads: derived from trim + 2 × bleed at the DPI |
| DPI, colour mode, output profile | for example 300 ppi, CMYK, a named profile |
| Page structure | one card per page; fronts/backs files; back orientation |
| Black text and ink rules | pure K, overprint, rich-black recipe, ink limit |
| Die line | none, spot colour name, corner radius |
| Preflight minimums | text size, line weight, resolution |
| **Deck size rules** | minimum and maximum cards per deck, and a required multiple (many manufacturers print and cut in sheets of a fixed number of cards); *verify* for each manufacturer before the preset ships |
| **Source and date checked**, and **tested with a proof?** (yes/no) | shown to the user; presets older than 12 months are marked "re-check" |
| Notes | quirks, in plain words |

Presets are **data files** (JSON) shipped with the app and **editable and shareable**: the user can duplicate a preset, change it, import one from a file, and use their own manufacturer's values. Updating the shipped presets is part of the release checklist (Appendix C), and a preset file can also be pulled from a cloud folder (§15).

### 18.3 Presets shipped (initial list)

These values come from the manufacturers' public artwork guidance and template pages **as found on 2026-10-02**. Manufacturers change their rules and some pages could not be read in full, so every row carries its source, the date, and "tested with a proof: no" until a physical proof has been ordered. Cells marked *verify* were not stated in what was reviewed and must be confirmed before the preset ships. **The in-app text always tells the user to read the manufacturer's current guide and to order a proof copy.**

| Preset | Output | Trim · bleed · safe | Pixels / DPI | Colour | Notes |
|--------|--------|---------------------|--------------|--------|-------|
| **The Game Crafter — poker** | per-card images | 2.5 × 3.5 in · 1/8 in · 1/8 in | **825 × 1125 px** at 300 DPI (trim 750 × 1050) | images; colour mode *verify* | Prints at 300 DPI; keep content 1/8 in inside the cut |
| **MakePlayingCards — poker** | per-card images | 2.5 × 3.5 in · about 1/8 in (36 px) · 36 px | **minimum 822 × 1122 px** at 300 DPI | RGB images (converted by the printer) — *verify* | Their template marks a red safe line 36 px inside the cut; about 36 px is cut from each side of the upload |
| **DriveThruCards — poker** | per-card images or PDF | 2.5 × 3.5 in · 1/8 in · 1/8 in | final layout **2.75 × 3.75 in** (825 × 1125 px) at 300 DPI | *verify* | Other sizes: *verify* |
| **PrintNinja — playing/tarot/card game** | production PDF | trim by product · bleed required (*verify* the value on the product page) · tarot safe margin 5 mm (0.197 in) | **300 ppi minimum** | **CMYK** | Print-ready PDF; their page lists the exact setup per product |
| **Panda Game Manufacturing — cards** | production PDF | by card · **3 mm bleed** · **3 mm** margin | **300 ppi or above** | **CMYK**, profile **U.S. Sheetfed Uncoated v2** (user imports it, §17.5) | Black text pure K, set to overprint; boards and boxes need 18 mm bleed (not cards) |
| **Longpack Games — cards** | production PDF | by card · **3 mm bleed** · **3 mm** margin | *verify* | **CMYK** | Large black borders: recommended C40 M0 Y0 K100 |
| **WinGo Games — cards** | production PDF | **3 mm bleed** from the die cut · **3 mm** margin inside it | *verify* | **CMYK** | |
| **Generic offset, metric** | production PDF | any · 3 mm · 3 mm | 300 ppi (600 for line art) | CMYK; PDF/X-4 | A safe default when a manufacturer is not listed; also the baseline several of the above describe |
| **Generic print service, US** | per-card images or PDF | any · 1/8 in · 1/8 in | 300 DPI | CMYK or RGB as chosen | A safe default for US print-on-demand services |

**Sizes with bleed** (bleed does not scale with the card; 1/8 in each side at 300 DPI): poker 2.5 × 3.5 in → 825 × 1125 px · bridge 2.25 × 3.5 in → 750 × 1125 · mini 1.75 × 2.5 in → 600 × 825 · tarot 2.75 × 4.75 in → 900 × 1500 · jumbo 3.5 × 5 in → 1125 × 1575. The sizes of §10.6 are used; preset-specific sizes are listed per preset.

**Corner radius** for the die line: **1/8 in (3.175 mm)** is the common standard for poker, bridge and most trading-card sizes; tarot and large cards are often a little larger (about 1/8–5/32 in, 3.5–4 mm). The user can set any radius. The radius is used for the **die line** and for the rounded transparent corners of **digital** exports (such as Tabletop Simulator sheets); **print artwork is never rounded** — it stays square and runs into the bleed, and the die line shows the cutter where to cut.

**Candidates reviewed but not yet shipped** (guides not read in full, or not found): Ludo Fact, Cartamundi, MBprint (Poland), Launch Tabletop, Boda Games, PrintRunner, Mr. Playing Card. Each is added only when its guide is read and the values are recorded.

### 18.4 Behaviour

- **In the Export dialog**, a **Preset** menu appears at the top of the PDF (production) tab and the PNG tab. Choosing one fills the settings; **any change turns the label into "Custom (based on …)"**. The preset's source link and "checked on" date are shown beside it, with a one-line reminder to confirm with the manufacturer.
- **In the canvas editor**, the preset's trim, safe and bleed guides are shown (§17.4).
- **Preflight** (§17.7) uses the preset's minimums and rules.
- **A card size the manufacturer does not offer** produces a clear message ("this preset lists poker only; check with the manufacturer") instead of a silent wrong output.
- **Per-card image output** names files as the preset asks, or by §10.1's file name pattern, and uses the preset's pixel size.
- **Saved export profiles** (§17.8) can start from a preset, so the command line (§21) can repeat an export exactly.

### 18.5 Maintenance and verification

- Each preset has a schema check (all required fields; units valid; pixel size equals trim + 2 × bleed at the DPI; bleed ≥ 0 and safe ≥ 0), run in the unit tests.
- Each preset renders a sample deck and passes its own preflight in the integration tests.
- A release-checklist item (Appendix C) reviews the "checked on" dates; anything older than 12 months is re-read before release.
- *Acceptance:* a **physical proof** would be ordered for a preset and its "tested" flag set only after the proof arrives correctly. **Decision (2026-10-02): proofing is deferred indefinitely** (it costs money), so every preset carries the label **"not proof-tested"** and the dialog says the user should confirm with the manufacturer. The flag exists so the label can change later without a redesign.

*As built (phase 4.2).* The format and its checks are `src/shared/presets.js`, the nine shipped presets are data in `src/main/presets/shipped.js`, the service is `core/presets.js` (channels `presets:*`), and the interface is `PresetBar.svelte` (the **Preset** menu at the top of the production panel and of the new per-card image panel), `PresetsDialog.svelte` and `ImageExportPanel.svelte` (in the PNG tab, mode **Per-card images for a print service**). **Shipped:** all nine presets of §18.3 (The Game Crafter, MakePlayingCards, DriveThruCards, PrintNinja, Panda, Longpack, WinGo, Generic offset metric, Generic print service US), each with its source, **checked 2026-10-02**, **not proof-tested**, and a `verify` list naming the values the guide did not state, which are left at a safe default and shown as "Not confirmed" (A73). A preset's `guideUrl` is the manufacturer's site, not a page of it. **Choosing a preset** (`presets:apply`) fills the production settings (standard, colour mode, bleed, safe margin, resolution, back layout, die line with its name and radius, ink limit), expects its output profile by name among the imported profiles (and says to import it when it is not there), hands its preflight minimums and deck rule to the preflight, and lists the rules that need the vector output (pure black text, overprint of black, rich black) as not applied yet. **Any change** to a filled-in setting turns the label into **"Custom (based on …)"**, and putting it back removes the label. The panel shows the source and date, *Re-check* for a preset older than 12 months, *Not proof-tested*, the reminder to read the manufacturer's current guide and order a proof, the unconfirmed values, a **card size the manufacturer does not offer** (also a preflight warning), and the notes. The preset chosen is kept with the settings (and in saved export profiles). The canvas editor's safe line uses the safe margin of the production settings. **Preflight** uses the preset's minimums and its **deck-size rule** (minimum, maximum, multiple; counting quantities when repeat copies is on; "add 8 or remove 1"), and adds notes for an unconfirmed value, a missing profile and a rule that needs vector output. **The person's own presets** are JSON files in `<library folder>/presets`, shared by all projects: a preset (shipped or not) can be **duplicated** (the copy remembers what it came from and is never marked proof-tested), the copy **edited** in a form, **exported** to a file, **removed**, and a file **imported** (a bad file is refused with the reason; a taken id gets a number; an imported file is never "tested"); a broken file in the folder is skipped and counted. **Per-card images:** every card as PNG or JPEG of the pixel size that trim plus twice the bleed makes at the resolution (the pixel size of a card is now computed from the millimetres, so a manufacturer's 825 × 1125 px is exactly that; an odd pixel goes to the right and bottom), the bleed from the template or from its edge, files named by the card ID (or the file name pattern) and never overwriting each other, one shared card back, the dpi written into the file, RGB colours (the service converts them), cancel with no half-written files. **Built since (A77):** the print readiness check in the image panel too (the production checks in RGB, with the preset's minimums and deck rule, **Export anyway** after errors, Show me). **Not built:** the pixel size per card size for presets that state several (no shipped preset states more than one) and the preset's *file name* rule (none of the nine states one; the §10.1 pattern is used).

---

## 19. SVG Import and Automatic Binding

> **Status: built** (phase 3.1, A67; specified in v1.8). Builds on the template system (§7), the canvas editor (§8) and the asset library (§9). Everything below is built as described except the two points listed under *As built*: bleed and the printable naming guide.

### 19.1 Purpose

Many designers already draw card frames in Figma, Illustrator, Inkscape, Affinity Designer or Sketch. Spadewick should not ask them to redraw: they **design the look in the tool they know, export an SVG, and Spadewick turns it into a data-driven template** — recognising which layer is "name", "cost" or "art" and binding it to the right field.

### 19.2 Workflow

**Template → Import SVG…** (in the Template Editor's list, §7.7.5), then a guided dialog:

1. **Choose file(s).** One SVG per template; several can be imported at once.
2. **Size.** The dialog reads the file's width, height and view box (points in Illustrator, pixels in Figma and Inkscape, millimetres or inches when stated) and proposes the closest card size from §10.6. The user confirms or changes it; if the shape differs, the letterboxing rule of §10.6 is explained, and **Fit to card**, **Keep size** and **Crop** are offered. If the file includes a bleed area, the user can say so (§17.4).
3. **Clean-up report** (automatic, shown as a list the user can read):
   - removed: scripts, event handlers, external references, `foreignObject`, animations, editor metadata and layers marked hidden;
   - **images**: embedded images are extracted into the asset library (identical ones once); linked (external) images ask the user to locate them or leave a placeholder;
   - **fonts**: every font family used is listed with "available" or "missing"; missing ones can be mapped to an installed or bundled font, or imported (§7.6);
   - **text that is already outlines** (a common export setting) is listed: it cannot be bound to a field, and the dialog says how to re-export with text kept as text;
   - **unsupported or print-unsafe features** (blurs, some blend modes, patterns, masks) are listed, because they are fine on screen but flagged by print preflight (§17.7).
4. **Binding review** (§19.3).
5. **Result.** The template is created as a **project template** (origin `svg-import`, §7.7; the user may also *Save to library*) — not a replacement — with a preview rendered from the first card, and opens in the canvas editor.

### 19.3 Automatic binding

Spadewick looks at each element's **id** and **layer or object name** (the attribute each tool writes: `id`, `data-name`, `inkscape:label`, `aria-label`) and at **text content**, and proposes a binding:

| In the design file | Spadewick proposes |
|--------------------|------------------|
| A text element whose name is a field name or slug (case-insensitive; spaces, hyphens and underscores treated alike), for example a layer called `Name` or `cost` | bind the text to that field; the original text is the sample value |
| A text element whose content already contains `{{slug}}` | keep the token |
| A text element named `name_box` / a rectangle with the same name as the text plus `_box` | use the rectangle as the text's **box** (§7.4) with `wrap`/`shrink` fit; the original font size becomes the maximum |
| An image or rectangle named after an image field, for example `art` | an image element bound to that field, positioned and sized to the shape (with a clip if the shape is rounded) |
| A rectangle, ellipse or path whose name is a colour field | bind its fill to that field |
| A layer named `if:<expression>` or `hide-if:<expression>` | show or hide it with that condition (§7.3) |
| A layer or object named `icon:<name>` | an inline icon placeholder; with text, becomes `{icon:name}` markup (§16) |
| Anything else | left as plain artwork |

The **binding review** is a table of every candidate: a preview thumbnail, the detected name, the element type, the proposed field (a drop-down, with *create a new field named …* and *don't bind*), and a confidence note ("exact match", "close match: *Cost* → *Mana cost*"). Matches are **pre-checked only when exact**; the rest wait for the user. Selecting a row highlights the element in a preview. The user can accept all, adjust, or skip binding entirely and bind later in the canvas editor.

A short **naming guide** is built into the dialog (and available as a printable page): *name your layers after your fields*, for Figma, Illustrator, Inkscape and Affinity, including how to export so that names and text survive (keep text as text, include layer names or ids, embed images). Because export options differ between versions of those tools, the guide is checked against current versions before each release (Appendix C).

*As built (phase 3.1).* The work is in `src/main/svgImport/` (`xml.js` a forgiving XML reader that never expands an entity and drops the DOCTYPE, `clean.js`, `css.js`, `geometry.js`, `size.js`, `bind.js`, `build.js`, `canvas.js`, `analyze.js`) and the service `src/main/core/svgImport.js` (`pick`, `pickImage`, `analyze`, `apply`; channels `svgimport:*`). The dialog is `SvgImportDialog.svelte`, opened from the template list (**Import SVG…**, several files in turn, with *Skip this file*) and from the Template menu (**Re-import design…**, shown for templates whose origin is `svg-import`).

- **Size.** The unit is read from `width`/`height` (mm, cm, in, pt, pc, Q, px) or, when the file has only plain numbers, assumed: points for Adobe Illustrator (recognised from the comment it writes), pixels for the others. A size in pixels is treated as a guess for the purpose of proposing a card size: the preset with the closest *shape* is proposed (a landscape design stays landscape as a custom size); a physical size (mm, in, pt) also counts. When no preset is within 5 % of the shape, the design's own size is proposed as a custom size. **Fit to card**, **Keep size** and **Crop** are done by choosing the template's view box (a design that already has the card's shape is untouched); the template is 500 px wide like every new template. A bleed in millimetres may be entered and is cut off (bleed in exports is not built, §17.4).
- **Clean-up report.** Counts of what was taken out: scripts, event handlers and `javascript:` links, `foreignObject`, animations, editor metadata (titles, descriptions, `inkscape:`, `sodipodi:`, `sketch:`, `serif:`, `i:` data), hidden layers (`display:none`, `visibility:hidden`), references to anything outside the file, `@import` and `@font-face`, and pictures that could not be read. Style sheets are moved onto the elements as attributes (so a later edit is not overruled by a class); a sheet with selectors that cannot be moved is kept, made safe. Embedded pictures (PNG, JPEG, WEBP, checked by their bytes, up to 20 MB) go to the asset library, an identical one once; a linked picture is looked for next to the design (only inside its folder, never an absolute path or `..`), can be located by the person, and is otherwise a grey box. Fonts are listed with *available* or *missing* (the project's fonts and the bundled ones; system fonts are never used) and a missing one can be mapped to an available family. Outlined text is detected for a group of paths named like a text field (or containing "outline"). Print-unsafe features (filters and blurs, masks, patterns, blend modes) and a design of more than 3 000 elements are reported.
- **Off-canvas layers.** An element with transparency, a mask, a filter, a clip or a blend mode that lies wholly outside the picture is left out (reported), because the rasterizer stops the whole program on such a layer (found while building this). It cannot be seen, so nothing is lost.
- **Binding.** Names are read in the order `data-name`, `inkscape:label`, `id`, `aria-label`; Illustrator's `_x5F_` escapes are decoded; a name a tool makes unique (`name_1`) is a *close match* and waits for the person. A group that wraps one text, picture or shape gives its name to it (Illustrator names the layer, not the object). The proposals of §19.3 are all built: text to field, existing `{{slug}}` tokens, `name_box` rectangles as the text's box (the box becomes `x`, `y`, `width`, `height`, `shrink` with the original size as maximum and half of it as minimum; an invisible box rectangle is removed), pictures and rectangles to picture fields (a rounded or non-rectangular shape becomes a clipped picture; a frame stroke stays; Figma's pattern-filled rectangle is understood and its picture is the sample), shapes to colour fields (the fill becomes the token), `if:`/`hide-if:` conditions and `icon:` placeholders (a text with `data-spadewick-rich` holding `{icon:name}`). A text moved by its own transform (as Illustrator writes every text) is put at its place (`x`, `y`, font size). Only **exact** matches are pre-checked. Layers a tool names by default (`Rectangle 12`, `Group 3`) are not candidates. A new field can be created for a layer; its name is made a slug that does not collide (`name_2`).
- **Result.** One undo step makes the fields, the pictures and the template (origin `{ source: 'svg-import', file, bindings, fingerprint, fit, bleedMm, fontMap }`); the template becomes the set's default when it has none and the size fits; when the set has no card, one is made from the design's own texts (and picture) so there is a preview. Saving the template to the library is the existing Template menu entry.
- **Re-import** (§19.4): the new design goes through the same dialog with the size locked. Bindings are kept by layer name (and the number of the layer with that name); they are listed as *kept from the last import* and pre-checked; new names go through the review. A summary lists names added, removed, moved or resized, and restyled (from a fingerprint of every named layer, kept with the template). A bound layer that is no longer in the design can be kept as it is in the template. The template is replaced; Undo brings the earlier version back. Edits made in the canvas editor after the import are replaced too, which the dialog says.
- **Not built:** the printable naming guide (the guide is in the dialog), and the guide has not been checked against current versions of the tools (Appendix C: real exports from beta testers). Fixtures (`tests/fixtures/svgImport/`) are written to resemble Figma, Illustrator, Inkscape, Affinity and Sketch output, plus a hostile file.

### 19.4 Re-importing an updated design

Designers keep refining the look. **Re-import design…** on an existing imported template lets the user pick a newer SVG and then shows what changed: elements added, removed, moved or restyled. Existing **bindings are kept** by element name; new named elements go through the binding review; removed ones are listed and can be kept or deleted. The previous version is available through the template's own undo (§8.6) and snapshots. (Re-importing from a file kept in a cloud folder is covered by the template follow-ups in §15.14.)

### 19.5 Security and limits

Imported SVG is untrusted (§14.7) and is sanitised before it is stored or previewed. Maximum file size 20 MB. Not imported: PDF, AI, PSD or EPS files (export an SVG from the tool); SVG fonts; embedded `@font-face` rules (fonts are matched by name as in §7.6). Extremely complex files (thousands of paths) import but a warning explains the effect on preview speed.

### 19.6 Verification

Fixture SVGs written to resemble the structure each tool produces (Figma, Illustrator, Inkscape, Affinity, Sketch), exercising: units and size detection; id-collision handling (`name`, `name_1`); outlined text; embedded and linked images; hidden layers; hostile content (scripts, event handlers, external references). Tests assert the exact clean-up report, the proposed bindings and confidence levels, the created template's rendering for a sample card, re-import keeping bindings, and that nothing unsafe is ever stored. **Real exports** from each tool, supplied by beta testers (Appendix C), are added to the fixtures before release. Accessibility checks on the dialog (axe, keyboard-operable review table), and the strings lint (§14.5).

---

## 20. Snapshot Compare ("What changed?")

> **Status: built as a first version (phase 5.1)** (specified in v1.8; see *As built* below for what is in and what waits). Extends §11.1 (Named Snapshots). The same change view is reused for previewing cloud refreshes (§15.7, §15.18).

### 20.1 Purpose, in plain words

A designer does a balance pass, then asks: *"What did I actually change since last Thursday?"* or *"Did I break something?"* Today a snapshot can only be restored whole. This section lets the user **see what changed** between a snapshot and now (or between two snapshots), in language that does not require knowing how the app stores data, and **take back** any single change without restoring everything.

### 20.2 Where it lives and what the user sees

- In the Snapshots panel each snapshot has a **What changed?** button (compare with now). A **Compare…** button next to it lets the user pick a second snapshot to compare two points in time. Project → **What changed since…** is a shortcut that asks which snapshot.
- The screen opens with a **headline in plain language**, for example: *"Since "Before balance pass" (3 days ago): 12 cards changed, 3 added, 1 removed. 1 field added. 2 templates changed."* If nothing differs it says **"Nothing has changed since this snapshot."**
- Below it, **tabs**: **Cards** (default) · **Fields** · **Templates** · **Images and icons** · **Fonts & settings**. Each tab shows a count, and tabs with no changes are dimmed.
- **Cards tab:** a list that can be filtered by **Changed / Added / Removed** and searched by name or by field value. Each row shows the card's name and **what changed in words**, for example *Cost: 3 → 4 · Text edited · Template changed*. Colours are never the only signal: changes also use words and symbols (**+ added, − removed, ~ changed**), per §14.4.
- **Opening a card** shows the **old and new card side by side** (rendered images of both versions), with a switch to **overlay** or **slider** view, and below it the field-by-field list. Long text shows **word-level** highlighting of what was added and removed.
- **Fields tab:** fields added, removed or renamed (name, type, validation), in plain words.
- **Templates tab:** each changed template shows old and new rendered with the same sample card, and an optional view of the SVG source differences for those who want it.
- **Images and icons tab:** added, removed or replaced files, shown as thumbnails.
- **Fonts & settings:** font changes, card-size changes.

### 20.3 Taking changes back

Every change has an **Undo this change** (labelled with what it will do: *"Set Cost back to 3"*). The user can also tick several and press **Restore selected**, or use a column-level action such as **Restore all Cost values**. For added cards: *"Remove this card"*; for removed cards: *"Bring this card back"*. For templates: *"Use the old version"*.

- Restoring never touches anything the user did not select.
- All restores in one action are **one undoable step** (§11.2) and are announced ("Restored 5 values on 3 cards"), so the user can step back.
- Restoring a removed card restores its data, its template link, its quantity (§6.5) and its position as far as possible; images it used are restored from the snapshot if they were deleted since.

### 20.4 Sharing what changed

**Export change list** writes a readable summary as **Markdown**, **CSV** or **HTML** (a table of cards and changed values, plus the field and template summary). Typical uses: patch notes for playtesters, a changelog for the team, or something to attach to a commit when the project is stored in GitHub (§15). The Markdown headline is the same plain-language sentence shown on screen.

### 20.5 How cards are matched

Cards, fields, templates and assets are matched by their **stable internal ids**, so a renamed card is still the same card and a field rename is reported as a rename, not as one field removed and another added. When a snapshot comes from a **duplicate** of the project (§12.2 Duplicate Project) the ids still match; for a project that was rebuilt from CSV, the **card IDs** (§5.8) match the cards, and where a file has none the screen offers to **match cards by a key field** (the same idea as the key field in §5.5).

### 20.6 Technical notes

- Comparing needs no restore: the snapshot is unpacked read-only into a temporary folder (inside the OS temp directory, §14.3) and its database opened read-only; the temporary copy is deleted when the screen is closed. The live project is never modified by looking.
- The difference is computed in the main process; the screen first receives only the **summary and the list**, and card images are rendered **on demand** as the user scrolls, so a set of 1,000 cards opens in about 3 seconds (§14.1).
- Old card images are rendered from the snapshot's own templates, fonts and assets, so the "before" picture is the card as it really looked.
- Differences in internal bookkeeping (modified-times, sort order, column widths, view settings) are ignored; only things a designer would call a change are listed.
- The same engine produces the **change view** for a cloud refresh (what will change if I pull this file) and, later, for comparing any two project copies.

**Prerequisite:** comparing and rendering from a snapshot requires the pipeline to work against an explicit project handle instead of the single open project; this is the headless-core work of §24 (phase 0.3).

### 20.7 Verification

Integration tests build a project, snapshot it, then change data (edit, add, delete, reorder, rename a field, change a template, replace an image) and assert the exact summary, the per-card wording, and that **ignored differences produce no entries**. Restore tests: each kind of restore, selected restores, the one-undo-step rule, and that unselected items are untouched. Matching tests (duplicated project; key-field matching). A performance test with 1,000 cards. Export-format tests (Markdown, CSV, HTML). End-to-end tests drive the screen with the keyboard, and axe checks cover it in both themes (§14.4). Strings are all in the strings file (§14.5), including the plural forms of the headline.


*As built (phase 5.1, first version).* The engine is `src/main/snapshots/compare.js` (a pure reading of two databases, matched by stable ids), the service `core/snapshotCompare.js` (channels `snapshots:compare-*`) and the screen `SnapshotCompare.svelte`, opened inside the Snapshots panel by **What changed?** (compare with now) or **Compare…** (two snapshots, or one and now). **Built:** the plain-language headline; tabs **Cards** (filter changed/added/removed, search by name, card ID or value; each row says what changed in words with + − ~ symbols; opening a card draws the old and new card side by side, from the snapshot's own templates, fonts and images, and shows word-level highlighting of edited text), **Fields** (added, removed, renamed, type, rules, default, formula) and **Templates, images and fonts** (added, removed, changed; a template's design, size and bleed). A renamed card or field is one rename. Modified-times, order, column widths and view settings are ignored. **Taking back** (only when comparing with the open project): *Undo this change* per value, *Restore all changes to this card*, checkboxes with *Restore selected*, *Remove this card* for an added card and *Bring this card back* for a removed one (into its set, with its data, template when it still exists, quantity and position; not when its set is gone). Everything in one action is **one undo step**; a change that can no longer be taken back is counted and reported. Comparing two snapshots is read-only. The snapshot is unpacked into the operating system's temporary folder, opened as a project of its own (an old one is upgraded in that copy only) and removed when the screen closes. **Added after the first version (A77):** the tabs now also cover sets (a new name, code or card size) and pictures with thumbnails; a changed template is drawn before and after on a sample card of its set, with its source differences line by line; the pictures of a card or a template can be seen **side by side, as an overlay with a slider for the amount, or as a divider slider**; *Restore all {field} values* takes back one field on every shown card; **Use the old version** takes back a changed or deleted template and **Bring this image back** a deleted picture (with its file; one undo step each, like the cards); **Export change list…** writes Markdown, CSV or HTML (the same text the command line prints with `compare --format`); **Project > What Changed Since…** asks which snapshot. **Not built, on purpose:** taking back field changes (a field that is removed or retyped can break other cards, so it is shown, not restored), a changed picture (its file would have to be swapped under the undo log), and removing an added template or picture (cards may use it). Decisions A75, A77.

---

## 21. Command-Line Mode

> **Status: built as a first version (phase 5.2)** (specified in v1.8; see *As built* under §21.6 for what is in and what waits). Uses the same code as the interface; adds no new rendering or data features.

### 21.1 Why a user would want a command line

A command line lets a computer, not a person, run Spadewick. In practice, a designer or team wants it to:

1. **Rebuild every output after the data changes, without clicking.** *"The CSV changed — regenerate the TTS deck, the print files and the PNG sheets."* One command, same result every time.
2. **Run Spadewick on a server or in automation (CI).** With the GitHub connection (§15), a push of an updated CSV can trigger a build that produces the deck and attaches it as a download — no one has to open the app.
3. **Check a game before spending money.** `validate` and `preflight` fail loudly if a card has a missing image, an icon that does not exist, a value out of range, or something a manufacturer will reject (§17.7). That is a gate in front of an expensive print order.
4. **Work across many projects.** A publisher with twenty games can export all of them overnight.
5. **Edit in other tools and see results.** *Watch mode* re-exports when the CSV, a template or an image changes, so a designer working in a spreadsheet or an SVG editor gets a fresh deck on every save.
6. **Reproducible builds and history.** Exports are deterministic: the same project and settings give the same files, so they can be compared, checked and archived with a release.
7. **Accessibility and preference.** Some users work entirely from a terminal or with scripts and assistive tools that work better there.

It is **not** a scripting language or a plugin API (§23): it runs the app's existing operations from the outside; it does not add a way to extend them.

### 21.2 How it is run

The application executable doubles as the command-line tool: `Spadewick --cli <command> …`, with a small `spadewick` launcher script placed beside it on each platform for convenience. **Prerequisites and risks:** the commands run the same code as the interface, so the headless core of §24 (phase 0.3) must exist first; a graphical program on Windows cannot reliably print to a console, so the Windows launcher is a small command script that runs the executable in its no-window mode; the Linux AppImage may need its extract-and-run option on machines without FUSE. All three are tested on every system (spike E, §24.3). It starts without opening a window, works on Windows, macOS and Linux (including a machine with no display), and needs no account and no network unless a command says so. Startup to first output takes under 3 seconds (§14.1).

### 21.3 Commands

| Command | What it does |
|---------|--------------|
| `info` | Summary of a project: sets, card counts, templates, fields, card sizes, schema version |
| `list sets|cards|fields|templates|assets|icons|snapshots` | Tables for people (default) or `--json` |
| `validate` | Checks all data (field rules, required images, missing icons and fonts, quantities); exit code 1 if anything fails |
| `preflight --preset <name>` | The print-readiness checks of §17.7 for a preset |
| `export tts|png|pdf|production-pdf` | The exports of §10 and §17 with the same options as the dialogs; accepts `--profile <saved profile>` or `--preset <manufacturer preset>` and `--set`, `--cards <filter>`, `--out` |
| `render --card <name-or-id>` | One card as a PNG, for a quick look or a thumbnail |
| `import <file.csv|json> --set <set>` | CSV/JSON import (§5.5) with `--mode append|merge`, `--key <field>`, `--mapping auto|<file>`, `--dry-run` that prints the preview and exits |
| `snapshot create|list|restore` | Snapshots (§11.1); `restore` always makes the automatic pre-restore snapshot |
| `compare <snapshot> [<snapshot>]` | The change list of §20 as Markdown, CSV, HTML or JSON |
| `cloud check|pull|push --link <name>` | The cloud operations of §15 for existing links (needs the licence key of §15 and an account already connected on this machine) |
| `watch` | Re-run a saved export profile whenever the project's files change |
| `profiles list|show` | The saved export profiles shared with the interface (§17.8) |
| `version`, `help` | |

Global options: `--project <folder>` (or the current directory), `--json` (machine-readable output), `--quiet`, `--verbose`, `--no-color`, `--dry-run` for anything that writes, and `--lang` for message language (§14.5).

### 21.4 Behaviour and safety

- **Exit codes** are stable and documented: 0 success; 1 the check ran and found problems; 2 bad usage; 3 project cannot be opened or is damaged (the recovery of §14.2 is not attempted silently — the message says how); 4 a network or sign-in problem.
- **Reading is safe while the app is open.** Commands that only read (`info`, `list`, `validate`, `preflight`, `export`, `render`, `compare`) can run while the interface has the project open. Commands that write (`import`, `snapshot restore`, `cloud pull`) refuse with a clear message when the interface has the project open, unless `--force` is given; a lock file guards against two writers.
- **Same rules as the interface:** the same validation, the same undo history (an import from the command line is one undoable step the interface can undo), the same file-size and path rules, the same security (§14.7).
- **Cloud in unattended use:** the stored sign-in of §15.5 is encrypted per operating-system user, so a CI machine cannot reuse it. For unattended runs a **provider access token can be supplied by an environment variable** (never on the command line, and never printed or logged); this is documented with a warning to use least-privilege tokens.
- **No hidden network use:** commands other than `cloud` never connect to the internet.
- **Deterministic output:** file names follow the pattern of §10.1; timestamps appear only where the pattern asks for them.

### 21.5 Example: build on every push

A documented, copy-and-paste GitHub Actions workflow shows the idea: when the CSV in the repository changes, install the app, run `validate`, then `export tts` and `export production-pdf --preset <manufacturer>`, and attach the files as a build artifact. It is provided as documentation, not something the app configures.

### 21.6 Verification

Integration tests run the command line as a **subprocess** on fixture projects and assert exit codes, output text and JSON, files produced, and that the results equal what the interface's handlers produce for the same options. Tests cover: every command's success and failure paths; concurrency (read while the interface holds the project; refusal of writes); `--dry-run` writing nothing; watch mode reacting to a changed CSV, template and image; deterministic output (two runs, identical bytes apart from documented fields); credentials never printed (logs scanned); start-up time. The documentation page for the command line is generated from the same definitions as `help`, so they cannot drift.


*As built (phase 5.2, first version).* The code is `src/cli/` (`args.js`, `commands.js`, `run.js`, `index.js`), a second entry of the main-process build, so `npm run build` also writes `out/main/cli.js`. It runs with plain Node (`node out/main/cli.js <command>`, used by the tests) and with the application's own Electron as a plain program (`ELECTRON_RUN_AS_NODE=1 Spadewick.exe cli.js <command>`, tried on a copy of a real project from the development tree); the launcher `resources\spadewick.cmd` (from `scripts/spadewick.cmd`) does the second, **but the packaged launcher has not been tried, because no package was built in this phase**. A GUI executable that prints to a console is not used (§21.2). **Built:** `info`; `list sets|cards|fields|templates|assets|fonts|icons|snapshots|presets`; `validate` (field rules and quantities, picture fields whose asset or file is gone, cards with no template, and the text check: missing icons, characters and fonts, text that does not fit; exit 1 on errors); `preflight` (the checks of §17.7 with `--preset`, `--profile`, `--opt`, `--only-errors`; exit 1 on errors); `export tts|png|pdf|production-pdf|images` (`--set`, `--cards`, `--out`, `--preset`, `--profile`, `--options file.json`, `--opt key=value`, `--dry-run`; **a production PDF is held back while the preflight has errors unless `--export-anyway`**, as in the dialog; per-card images are byte-identical to the interface's); `render --card <name or card ID>`; `compare <snapshot> [<snapshot>]` (text, `--format markdown`, or JSON; the engine of §20); `version`, `help`; `--json`, `--quiet`, `--verbose`, `--dry-run`, `--project`. Exit codes 0, 1, 2 (usage: unknown command, option, set, preset or card, with a message and no stack trace) and 3 (not a project, damaged, or made by a newer version; recovery is never attempted). Settings are built as the dialog builds them: preset, then saved profile, then options file, then `--opt`. Presets of the person are read from `--library` or `SPADEWICK_LIBRARY` (the application's own library folder is not located automatically). **Added after the first version (A77):** `import <file.csv|file.json> --set <set>` (`--mode append|merge`, `--key`, `--mapping auto|<file.json>`, `--dry-run`; the same reading, mapping and checking as the interface, one undoable step; invalid rows are listed and give exit 1), `snapshot create|list|restore` (a restore keeps the state before as an automatic snapshot, as in the interface), `profiles list|show`, and `watch <export kind>` (the export runs at once and again whenever the project database, the pictures, the fonts or a file named with `--also` change, after the files have stopped changing; `--interval`, `--runs` to stop after n runs, `--reimport <file>` to import a changed data file again before each export; a failed run is reported and the watch goes on). **The lock (§21.4):** the application writes `.spadewick.lock` in the project folder when it opens a project and removes it when it closes it; a command that writes (`import`, `snapshot create|restore`, `watch --reimport`) takes the lock while it runs and does not start while another **running** program holds it (exit 3, with the program named) unless `--force`; a lock whose program has ended is ignored; reading never looks at the lock. The help text is also written to `docs/command-line.md` (and the SVG naming guide to `docs/svg-naming-guide.md`) by `node scripts/docs.mjs`, and a test fails when the files differ from what the program says. **The packaged launcher was tried (spike E for Windows, passed 2026-10-05):** built with `electron-builder --win dir`, `resources\spadewick.cmd` answered `version` in 0.6 s and ran `info`, `validate`, `export images` and `export production-pdf` on a copy of a real project, using the bundled fonts and profile. **Not built:** `cloud` (deferred, A74), `--lang` (the interface has one language) and the colour option (no colour is used), and the launchers for macOS and Linux (A71). Reading a project of an older format upgrades it first, as opening it does (with the automatic snapshot of §5.8). Decisions A76, A77.

---

## 22. Considered Later

> **Status: deliberately deferred** (added in v1.8). These are real candidates, written down so the V2 design does not rule them out. Nothing here is built until the owner moves it into a numbered section.

### 22.0 A table shared between players (peer to peer)

> Deliberately deferred (A82). The virtual table (§7.9) is built so that it can be shared: its state is plain data and every move is one action with its own seed. A shared table would connect two or more copies of the application directly (WebRTC), by trading a connection code, with the host's table as the one that is right and the guests sending their moves; hands would be seen only by their own player. Across the internet it needs a public STUN helper to connect and, behind strict networks, a relay (TURN); both would be optional and used only to connect. Open questions: whether a guest needs the project (the host would send the cards and their pictures), how a dropped connection is joined again, and whether a code can be shown as a QR picture.

### 22.1 Spreadsheet formats (Excel, OpenDocument)

**Priority now:** **CSV and JSON stay the main data formats** (§5.5, §5.6), together with the in-app field editing and file-structure sync of §15.18. Spreadsheet formats are an extra route into the same import and export, not a replacement.

When taken up, the scope would be:

- **Import** `.xlsx` and `.ods` files: the user picks the sheet and the header row; values (not formulas) are read; dates and numbers are converted to text in a documented way; merged cells, images inside cells and multiple header rows are reported rather than guessed. After that the file behaves exactly like a CSV (name matching, mapping dialog, validation, append/merge, quantity, structure review, §5.5 and §15.18).
- **Export** `.xlsx` with a header row, one sheet per set, column widths and number types where known.
- **Open questions:** which file-reading library and licence; whether to write back to a spreadsheet the team keeps extra columns in (the *Data only* mode of §15.18 already protects those).

### 22.2 More play targets

**Tabletop Simulator is first and foremost.** It is the target the owner works with, and §10.2 remains the primary digital export. Candidates to improve it before any other target is added (each needs confirming with real use of the game):

1. **Save directly into the game's own folders** (the Saved Objects folder of the installed game, found automatically on Windows, macOS and Linux) so a deck appears in the game's **Objects → Saved Objects** menu without copying files by hand.
2. **Several decks in one saved object** and **different backs per card or per deck** (§10.1, and back templates from the competition review), so a game with factions or card types exports as one tidy object.
3. **Shareable images:** upload the sheets to a cloud folder or a GitHub repository through the connections of §15 and write the **public image addresses** into the deck file, so a playtester can load it without receiving image files.
4. **Card names and descriptions** from chosen fields, which §10.2 already supports; markup in rich text is stripped there from V2.0 on (§16.7).
5. **Tokens, tiles and boards** if components beyond cards are ever added (decision C2 of the competition review).

**Other targets (deferred):** Screentop.gg (sprite sheet plus JSON), PlayingCards.io, Tabletopia, Card Game Simulator, and Playtest Parlor. Each is mostly a different file layout of images the app already renders; each would be a short section of its own with the format's current documentation and a fixture.

### 22.3 Other deferred ideas

- **Linked local files:** like a cloud link (§15.6) but to a CSV on disk, so the app can keep a spreadsheet beside the project in step with the fields (§15.18) without any cloud account.
- **Project as plain files** (a folder of CSV, SVG and JSON that works with Git); needs a decision on §23's "projects are not Git repositories".
- **Language variants** (one set, several languages, exported in one run).
- **Balance view** (counts and charts by any field, and data warnings).
- **Back templates** (backs with fields, per-set or per-card backs).
- **Named styles for shapes** (beyond the text styles of §16.5).


### 22.4 Hosted images for Tabletop Simulator

**Priority now:** local file links (§10.2.1) are what exists. A deck for other people needs images that TTS can fetch from anywhere; today that is done inside TTS (§10.2.4). When taken up, the scope would be:

- A third mode of **Image links**: **Base address**: the user types the address the sheets will be hosted at, and the JSON gets `<address>/<file name>`. Spadewick uploads nothing.
- A fourth: **Upload**: Spadewick uploads the sheets and writes the returned links. The first hosts to consider are those already planned in §15 (GitHub raw links, Dropbox direct links); Imgur and a **private storage** option are further candidates.
- **Open questions:** which host or hosts; whether uploads are public by link (card art is then visible to anyone with the address) and how that is shown; account sign-in through §15's connection framework; whether unchanged sheets are skipped on a re-export (by content hash); how to avoid TTS showing a stale cached picture when a sheet is replaced at the same address (a version in the address); size limits of each host for a full sheet; what happens to links when a host removes a file.

---

## 23. Out of Scope

The following are explicitly deferred and must not influence v1.0 architecture decisions:

- **Real-time collaboration and automatic sync:** No shared databases, live co-editing, automatic merging, or background sync. Teams exchange individual files through their own cloud accounts (§15); the project folder itself is never synced.
- **Version-control integration (Git):** Projects are not Git repositories. Snapshots are the v1.0 answer to versioning.
- **Scripting / plugin API:** No user-facing scripting or plugin system. The command-line mode (§21) runs the application's own operations from outside; it is not an extension mechanism.
- **Animation or video export:** Cards are static images.
- **Rule engine or game logic:** No turn structure, deck randomisation, or game simulation.
- **Online marketplace or asset store:** No in-app purchase or catalogue. Remote files come only from the user's own connected accounts (§15).
- **Automatic cloud backup:** The user is responsible for backing up the projects folder. (Pushing a snapshot ZIP to the cloud, §15.2, is a manual action, not a backup service.)
- **Multiple windows:** A single application window. Multiple projects require multiple application instances.
- **Card scanning or OCR import:** No image-to-card-data pipeline.
- **Automatic cloud updates:** The portable executable does not auto-update. The user downloads and replaces it manually.


---

## 24. V2 Delivery Plan and Risk Register

> **Status: planning** (added in v1.9, after a critical review of the V2 sections). This section orders the work, states what depends on what, and lists the risks. Sizes are relative (S, M, L, XL), not calendar estimates.

### 24.1 Release cuts

| Release | Contents |
|---------|----------|
| **V2.0** | Phase 0 (foundations) · Phase 1 (card IDs, template storage, schema guard) · Phase 2 (text engine, rich text, icons) · Phase 3 (SVG import, template packages) · Phase 4 (production PDF **phase 1**, manufacturer presets, preflight) · **Phase 5 (snapshot compare, command line)**. **Fully offline** (A74): no cloud, no accounts, no network |
| **V2.1 (planned)** | The cloud: phase 6.0 (the licensing section and the access gate) · Phase 6a (GitHub and Dropbox) · Phase 6b (OneDrive) |
| **V2.2 and later** | Vector production PDF (§17.6 phase 2) · the items of §22 |

**Changed (A74, 2026-10-05): V2.0 is the fully offline version.** The cloud (§15, phases 6.0, 6a, 6b) moves to a later release, after the offline product is finished and in use; snapshot compare and the command line (phase 5), which need no network, move into V2.0 in its place. The original cut kept the cloud in the first release while limiting the number of providers to the two with the simplest registrations (§15.15); that reasoning is kept for when the cloud is built. Vector print output moves later because it is a renderer in its own right (§24.4, R5).

**Platform scope (A71, 2026-10-04).** **V2.0 supports Windows 10 and 11 only.** macOS and Linux are deferred to a later release: no builds, no CI, no spikes D and E for them, and no promise in the interface or the README. The code is **kept portable** (nothing is removed; the build configuration keeps its macOS and Linux targets, unbuilt), so adding them later is a matter of building, testing and signing, not of rewriting. What this changes in the plan: phase 0.5 shrinks to Windows CI; **spike D (Linux credential storage) is no longer a gate for the cloud phase 6a**, because Windows has a dependable store (DPAPI through Electron `safeStorage`); spike E is run for Windows only; the release checklist in Appendix B.2 is run on Windows 10/11 only. Re-evaluate after V2.0 ships.

**Offline first (A74, 2026-10-05).** Nothing in V2.0 talks to a network or needs an account. What this changes in the plan: **phases 6.0, 6a and 6b are deferred** with everything that depends on them (the cloud-links table, schema version 11, §15's provider framework, the access gate and licensing text, GitHub, Dropbox and OneDrive registrations, the credential storage of §15.5, and the cloud follow-ups of §15.14 and §15.18); **phase 5 (snapshot compare §20 and the command line §21) is part of V2.0**; **spike D (credential storage) is dropped from V2.0** (it was only for the cloud); the release checklist and the "paid promise" of §1 are re-read for what V2.0 now promises. Features that exist only to feed the cloud and are not built yet stay specified in §15 and are marked deferred there. Re-evaluate the order when V2.0 ships.

### 24.2 Phases and dependencies

| Phase | Work | Size | Depends on |
|------:|------|:----:|------------|
| **0.1** | **Rename to Spadewick** in code, interface strings, package and app identifiers, folder names, log and file names, documentation; the SVG attribute prefix becomes `data-spadewick-*` while **`data-cardexy-*` stays readable forever** and is rewritten when a template is next saved; a one-time notice in existing projects | M | — |
| **0.2** | **Schema guard**: a project made by a newer version is refused with a clear message instead of being opened and misread. Also released as a small patch on the current line, because older builds are the ones that need it | S | — |
| **0.3** | **Headless core** (**built**, A63): move the logic out of the screen-side handlers into a service layer that takes an **explicit project handle** and has no dependency on the window system; dialogs and settings are passed in. Handlers become thin wrappers | L | — |
| **0.4** | **Spikes** (§24.3), each with a pass/fail criterion | M | — |
| **0.5** | **CI on Windows**: the whole suite on a Windows runner, and a packaging job that builds the unpacked app, checks its native parts and starts the command line through the shipped launcher (**written, A77; it has not run on GitHub yet**: the same steps were run by hand on this machine). *Deferred (A71): macOS and Linux CI move to the release that supports them* | S | — |
| **0.6** | **Template editor improvements (urgent, §8.7)**: source on demand, layers panel, live image resizing, edge snapping and alignment guides. Built; the frame-rate spike passed in a browser run. Ahead of the V2 phases, because it improves the editor that exists today | M | — |
| **1.1** | **Card IDs** (§5.8), schema v6, upgrade of existing projects | M | 0.2 |
| **1.2** | **Template storage** (§7.7): clone rule, origin, library on disk, package format, template library | L | 0.3, 1.1 (for field clashes and IDs) |
| **2.1** | **Text engine** (§16.2) producing outlines; wrapping, shrink and fit on it (**built**, A64; live text while dragging in the canvas, §8.7.3, built later, A77) | XL | spike 0.4-A |
| **2.2** | Rich text markup, Rich text field type, cell editor (**built**, A65; with a starter set of icons) | L | 2.1 |
| **2.3** | Icon library, text styles, keyword rules (schema v9) (**built**, A66; with the text check) | L | 2.1 |
| **2.4** | Text controls and improved auto-fit (§16.6) (**built**, A66) | M | 2.1 |
| **3.1** | **SVG import and automatic binding** (§19) (**built**, A67) | L | 1.2, 2.1 (bound text boxes) |
| **3.2** | Template packages exchanged through files (import/export) | S–M | 1.2 |
| **4.1** | **Production PDF, phase 1**: CMYK raster conversion, boxes, output intent, marks, die line; bleed settings and guides (§17.3–§17.5) (**built**, A70) | XL | 0.3, spikes 0.4-B and 0.4-C |
| **4.2** | **Manufacturer presets** (§18) and saved export profiles (**built**, A73; saved export profiles came with 4.1) | M | 4.1 |
| **4.3** | **Preflight** (§17.7): the checks that need only the SVG and data first; text, icon and font checks after Phase 2 (**built**, A72, except the deck-size rule that needs presets) | L | 4.1; text checks need 2.1 |
| **5.1** | **Snapshot compare** (§20) *(in V2.0, A74; built, A75, A77)* | L | 0.3, 1.1 |
| **5.2** | **Command line** (§21) *(in V2.0, A74; built, A76, A77)* | L | 0.3, 4.2 (profiles) |
| **6.0** | *(deferred to V2.1, A74)* **Licensing section written** (§15.19) and the single access gate | S | owner decisions (Appendix C, L5–L6) |
| **6a** | *(deferred to V2.1, A74)* Cloud framework, **GitHub**, **Dropbox**; card-data link with structure sync (§15.18); image and package links | XL | 0.3, 1.1, 1.2, 6.0 |
| **6b** | *(deferred, A74)* OneDrive | L | 6a, provider verification (§15.15) |
| **7** | Vector production PDF (§17.6 phase 2) | XL | 2.1, 4.1, a written list of supported SVG features |

**Phase 0.3 as built (2026-10-03).** The services live in `src/main/core/`, one module per former handler family (`assets`, `cardids`, `cards`, `dataio`, `export`, `fields`, `fonts`, `history`, `projects`, `sets`, `snapshots`, `templatelib`, `templates`), plus `context.js` and `session.js`. Every service is `fn(ctx, args)`. The **context** holds the explicit project handle (`ctx.project`, `{ dir }` or `null`), the **settings** (`get`, `set`, `store`: electron-store's shape, with an in-memory version for other callers) and a **ui** port (`showOpenDialog`, `showSaveDialog`, `openPath`; a headless context treats every dialog as cancelled, so a command-line caller passes explicit paths). Opening, creating and closing a project are the only places that set `ctx.project`; two contexts can have two projects open at once and never see each other's history. The IPC layer (`src/main/ipc`) is one line per channel and the only place that imports Electron; it hands Electron's dialogs and shell to the core as `ui` and the settings store as `settings`. A test reads every file in `src/main/core` and fails on an import of Electron, a reference to `ipcMain`, an import from the IPC layer or the old global. What stays process-wide on purpose: the card ID author code and the undo limit (both settings of the installation, handed in once by `createContext`), the cache of starter-template thumbnails (immutable), and the cache of open databases keyed by folder (`db.js`). The undo history finds a project's folder from its database handle, so it needs no notion of an open project. The folder chooser of the export dialog (`app:pick-directory`) stays in the IPC layer because it is only a question to the person. Behaviour is unchanged: the existing 462 unit and integration tests and the 169 end-to-end tests pass as before (the same 6 environment-only failures: PDF tests needing `pdftoppm` and one Windows temp-folder cleanup), and 23 tests were added for the core itself (no-Electron guard, project lifecycle, two projects at once, dialogs and settings from the caller, rendering, snapshot and export without a window).

**Built so far (2026-10-05):** every phase of V2.0 (0.1 to 0.3, 0.5 as a workflow, 0.6, 1.1, 1.2, 2.1 to 2.4 with live text while dragging, 3.1, 3.2, 4.1 to 4.3, 5.1 and 5.2) and spikes A, B, C and E (E for Windows). **Not run yet:** the GitHub workflow of 0.5, the hands-on look in the packaged window of the template editor, snapshot compare and the command line, and a commercial preflight tool on the production PDF. **Left out of V2.0 on purpose:** the cloud (A74), spike D, the vector production PDF (phase 7, §17.6), macOS and Linux (A71), dictionary hyphenation (A66: `{shy}` only), and the items each *As built* paragraph lists as not built. The production PDF stands on CMYK conversion (spike B, A68) and PDF writing (spike C, A69).

**What can run in parallel.** Phase 0 items are independent of each other. After 0.3: Phase 1 (1.1 then 1.2) and Phase 4.1 can proceed together, since the raster PDF does not need the new text engine. Phase 2 can start as soon as spike 0.4-A passes. Phase 6a must wait for 1.1 and 1.2 because file sync needs card IDs and template packages.

### 24.3 Spikes (Phase 0.4): prove the risky parts before committing

| Spike | Question | Pass when | If it fails |
|-------|----------|-----------|-------------|
| **A. Text engine** | Can WebAssembly shaping, font outlines and the current rasterizer lay out and draw a card's text, with icons, so that measured width equals drawn width, within the 200 ms re-render target? | A fixture card with kerning, ligatures, a non-Latin script, right-to-left text and inline icons draws correctly and re-renders in under 200 ms | Keep the rasterizer's own text shaping and measure with the same font data through a second path; accept looser fitting for complex scripts; revisit the scope of §16.2 |
| **B. CMYK conversion** | Can the image library convert RGB to a *given* CMYK ICC profile with a chosen rendering intent and black-point compensation, and can the result be embedded in a PDF with the profile as output intent? | Known colour patches convert within a stated tolerance for two different profiles, and the PDF validates in an independent reader | Use a dedicated colour-management library for the conversion; or limit phase 1 to the bundled profiles |
| **C. PDF writing** | Can the PDF library be extended (or a thin writer added) to set TrimBox/BleedBox, an output intent, DeviceCMYK images, a spot-colour separation and an optional content layer? | A one-page PDF with all of these opens in two viewers and in a commercial preflight tool without errors | A small purpose-built PDF writer for production output only |
| **D. Linux credential storage** *(deferred, A71: Windows only for V2.0; Windows DPAPI is the store)* | How does the operating-system secure store behave on Linux without a keyring, and can the app tell secure from fallback storage? | The app reliably detects the weak fallback and treats it as "unavailable" (§15.5) | Session-only tokens on Linux, stated in the interface |
| **E. Command-line packaging** *(V2.0: Windows only, A71; macOS and Linux deferred)* | Does the packaged app run commands with no window on all three systems, with usable output on Windows and a working AppImage on a server without FUSE? | `info` and `export` run from a script on each system | A separate small launcher per system |

**Spike A result (2026-10-03): passed.** Built in `spikes/text-engine/` (report `REPORT.md`, runnable with `node spikes/text-engine/run.mjs`; not part of the application). On the fixture card (Latin with kerning, ligatures in a serif face, Arabic and Hebrew in right-to-left paragraphs, a mixed Latin/Hebrew/Arabic line, four inline icons at different scales, shrink-to-fit) and with two candidate shapers (`harfbuzzjs` and `fontkit`, identical results): the laid-out ink box matches the drawn pixels within 0.7 px; on six single-line cases the outlines are pixel-identical to what the rasterizer shapes itself (0.0% differing pixels); a re-render of a 750 x 1050 card takes 13.5 ms at the 95th percentile (nothing cached 13.7 ms) against the 200 ms target, about half the time of drawing the same lines as `<text>`. The existing 462 automated tests are unchanged. Also found: the rasterizer draws missing-glyph boxes for Hebrew or Arabic inside a Latin font run and nothing at all for an Arabic `<tspan>` in Latin text, which outlines avoid. **Not covered:** Devanagari, Thai, Khmer and CJK (shaping and line breaking), variable fonts at other weights, raster icons, and machines other than one fast desktop; these remain open risks for §16.9 and are to be added to the engine's own tests. Dependencies chosen: `harfbuzzjs` (shaping and outlines; MIT; a 434 KB WebAssembly file, loaded with `import()` because the package cannot be `require`d from the CommonJS main process), `bidi-js` (UAX #9) and `linebreak` (UAX #14).

**Spike B result (2026-10-04): passed, with a different library for the conversion.** Built in `spikes/cmyk/` (report `REPORT.md`). The image library the application uses (sharp) cannot choose a rendering intent or black point compensation and its CMYK differs from a controlled conversion (mean Delta E 3.3 to 3.5, worst 18), so the spike table's fallback applies: **`lcms-wasm`** (Little CMS compiled to WebAssembly, MIT) converts with an explicit intent and black point compensation. 40 colour patches x two profiles (ISO Coated v2 / FOGRA39 from ECI, and the ICC registry's CGATS21_CRPC1 for US sheet-fed) x four settings gave identical numbers in a second engine (Pillow's ImageCms) and, against a colour computed without any library, a median Delta E 2000 of 0.23 and 2.04 (33 and 31 of 40 patches within 5; the rest are saturated screen colours outside any press gamut). White gives no ink, black stays within the profile's ink limit, and the intent and black point settings change the result as they should (without black point compensation the US profile misses by a median of 12.7). A card image of 0.8 megapixels converts in 36 ms, 3.2 megapixels in 92 ms. Two PDFs (one per profile) with the profile as output intent and the image both as `DeviceCMYK` and as `ICCBased` were written with pdf-lib and read by qpdf and MuPDF: no syntax problems, the profile and the samples byte-identical, the colours render. Not proven: a commercial preflight tool, PDF/X conformance, strips for very large images; the licence of the ECI profile for bundling must be confirmed (A68).

**Spike C result (2026-10-04): passed, without a commercial preflight tool.** Built in `spikes/pdf/` (report `REPORT.md`). One page of a poker card with 3 mm bleed, written entirely with pdf-lib's object API: MediaBox, CropBox, BleedBox, TrimBox and ArtBox, the output intent of spike B, an ICCBased CMYK image, a spot colour (`/Separation` named "Spadewick Gold" with a CMYK alternate and tint transform, used at 100 % and 50 %), a die line in its own overprinting spot, crop marks in the registration separation (`/All`), and four optional content layers (one shown on screen and not printed). 25 checks passed in qpdf, MuPDF, pdfcpu (strict mode) and pdf.js: boxes exact and nested, separations and layers as written, and switching a layer off in MuPDF removes exactly what belongs to it. One finding: pdf-lib's date format (`D:...Z`) is rejected by pdfcpu's strict mode, so production output sets its dates as `D:YYYYMMDDHHmmSS+00'00'` (A69). Not proven: any commercial preflight tool (none was available), PDF/X conformance (the identification entries are not written), that a RIP puts the spot on its own plate, and multi-page or full-sheet files.

**Spike E result (2026-10-05, Windows only): passed.** The unpacked application built by `electron-builder --win dir` runs the command line through `resources\spadewick.cmd` (the executable as a plain program with `ELECTRON_RUN_AS_NODE=1`, no window, output on the console): `version` in 0.6 s; `info`, `validate`, `export images` (18 files) and `export production-pdf` on a copy of a real 17-card project, with the fonts and the CMYK profile found in the packaged `resources`. Not tried: a machine with no display, the portable single-file build (it has no `resources` folder beside it; the launcher is for the unpacked build), macOS and Linux (A71).

### 24.4 Risk register

*Likelihood and impact are H (high), M (medium), L (low).*

| ID | Risk | L | I | Mitigation |
|----|------|:-:|:-:|------------|
| R1 | **Text engine** takes much longer than planned, or drawn text differs from measured text | L | M | Built (phase 2.1, A64): measured and drawn text are one description, checked pixel for pixel against the rasterizer. Remaining: scripts beyond Latin, Greek, Cyrillic, Hebrew and Arabic (Indic, Thai, CJK) are untested. Spike A **passed** (§24.3): measured and drawn text agree and the speed target has wide margin, so the likelihood is lowered; the open part is complex scripts beyond Arabic and Hebrew, and the size of the layout work itself. Spike A first; draw text as outlines everywhere so there is one source of truth; keep the current estimator behind a switch until the new engine is proven |
| R2 | **Headless core refactor** touches most handlers and breaks behaviour | M | H | Do it first, with the existing 400 automated tests as the safety net; move one handler family at a time; no new features in the same changes |
| R3 | **CMYK conversion** is inaccurate or the tooling cannot use arbitrary profiles | M | H | Spike B; tolerance-based colour tests; fall back to a dedicated colour library |
| R4 | **PDF/X claims** are wrong, and a manufacturer rejects the file | M | M | Label output "PDF/X-4-style, unvalidated" until a commercial preflight tool has checked it; never claim manufacturer acceptance (A29) |
| R5 | **Vector PDF** is a renderer in its own right and takes over the schedule | H | H | Deferred to V2.2; before starting, write the exact list of supported SVG features and rasterize anything else in place |
| R6 | **Cloud provider drift**: APIs, scopes and review requirements change, and fake-provider tests cannot see it | H | M | Two providers in V2.0; adapter conformance suite; manual round trips each release (Appendix B.2); provider verification started early (§15.15) |
| R7 | **One person cannot build all of V2** | H | H | Release cuts of §24.1; each phase ships on its own; features are cut by phase, not partly built |
| R8 | **No licensing design** blocks the paid feature and the pre-sale | M | H | Phase 6.0; the single access gate (§15.19) keeps the providers independent of the mechanism |
| R9 | **Rename to Spadewick** breaks existing templates and projects | M | M | Read both attribute prefixes forever; write the new one; migration tests with V1 projects; a snapshot offered on first open |
| R10 | **Template clones diverge** and users edit the wrong copy | M | M | The origin note, "Update from library", "Reset to original", and the Template Editor showing which entries are in the project; no automatic updates |
| R11 | **Card ID collisions** between teammates who add cards offline | M | M | The `{author}` token; same-ID conflict review (§5.8); counter safety after every import |
| R12 | **Sync loses data** through a wrong merge or a misjudged rename | M | H | Pulls are previewed and undoable; pushes use conditional writes; "Data only" mode; card IDs as identity; sync tests for every row of §15.7 and §15.18 |
| R13 | **Fonts and images in packages** infringe licences | M | H | Redistribution confirmation and embedding-flag warnings on export; licence text shown on import; fonts only when permitted (§7.7.4) |
| R14 | **Platform differences**: text, colour or PDF output differs between operating systems | M | M | Outlined text and bundled fonts make output deterministic; Windows CI for a subset (0.5); macOS and Linux are out of scope for V2.0 (A71), so the risk returns when they are added |
| R15 | **Manufacturer rules change**, or a preset was transcribed wrongly | H | M | Source and checked-on date on every preset; 12-month review; "not proof-tested" label (A29); users can edit presets |
| R16 | **Opening a V2 project in an older build** silently misreads it | M | H | Schema guard (0.2), patched into the current line |
| R17 | **Legal**: third-party licences, trademark of the new name, terms of service of each provider | M | H | Dependency licence review and trademark searches before charging money (Appendix C); privacy statement |
| R18 | **Scope creep** from §22 and the competition review | M | M | §22 stays "considered later"; additions need an owner decision recorded in Appendix A |
| R19 | **Unverified market assumptions**: prices and features of competitors came from third-party summaries | M | L | Re-verify before public statements (competition review); re-check each release |
| R20 | **Accessibility regressions** in the many new screens | M | M | axe checks and keyboard tests are part of every feature's definition of done (§14.4) |

### 24.5 Definition of done (every phase)

A phase is done when: its automated tests pass on Windows (A71; Linux and macOS return with their support); the strings lint and accessibility checks pass for every new screen; the PRD section is updated to describe what was built; migrations from a project made by the previous release are tested; and the manual checks it adds to Appendix B.2 are listed.

---

## Appendix A — Decisions and Clarifications

Points where the PRD was ambiguous or changed during implementation, with the decision taken. Each is reflected in the section named.

| # | Topic | Decision | Section |
|---|-------|----------|---------|
| A1 | Game-agnostic scope | No built-in card types or fields. Users define their own field names; a CSV/JSON column whose header matches a field name syncs to that field, and unmatched columns are offered as new fields. | §1, §2, §5.3, §5.5 |
| A2 | Card sizes | Thirteen built-in presets plus custom, chosen per project and overridable per set. | §10.6 |
| A3 | Template aspect ratio differs from the set's card size | The template is **letterboxed** (scaled to fit and centred, never stretched or cropped; the bars are transparent) so exports are always exactly the set size. Confirmed acceptable by the product owner. | §10.5, §10.6 |
| A4 | Multi-line text | Text elements support wrapping, explicit newlines, line height and fit modes (wrap, shrink, truncate, overflow, clip). With a width/height box, the text starts at the top of the box. | §7.4 |
| A5 | Which template a card uses | Card's own template, else the set's default template; a card with neither cannot be rendered and exports say so. | §5.2 |
| A6 | Font hinting | The `font_render_hints` setting was **removed**: the renderer has no such control and the output is identical either way. | §12.3 |
| A7 | Fonts in templates | The renderer ignores `@font-face`, so project fonts are passed to it as files; WOFF and WOFF2 are converted to TTF/OTF on import; the family name is read from the font itself; generic families (`serif`, `sans-serif`, `monospace`) are mapped to bundled Liberation fonts. | §7.6, §10.5 |
| A8 | Snapshot format | A ZIP archive written and read by a small built-in module (no dependency), with checksum verification and path-traversal refusal. Restoring first takes an automatic snapshot and rolls back on failure. | §11.1 |
| A9 | Undo storage | Undo entries are before/after row snapshots; asset files that an entry needs are kept in `<project>/.cache/undo`. | §11.2 |
| A10 | Full-size preview | An in-app dialog rather than a separate floating window, so it follows the same keyboard and focus rules as every other dialog. | §6.3 |
| A11 | Opening a project | Both a project folder and a `project.db` file can be opened. A damaged database is never opened as-is; the latest snapshot is offered. | §12.2, §14.2 |
| A12 | Where a packaged app writes | A `data/` folder (settings, logs, browser caches) and `projects/` folder next to the application. Linux ships as an AppImage; Windows and macOS as unpacked folders. | §4, §14.3 |
| A13 | Template safety | Templates are untrusted; previews are images, the measured copy is sanitised, and a Content-Security-Policy is set. | §14.7 |
| A14 | Accessibility target | WCAG 2.1 AA in both themes, verified with axe-core plus targeted keyboard/focus/OS-preference tests. | §14.4 |
| A15 | String lookup function name | The lookup is `tr`, not `t`, because `t` is used as a loop variable throughout the interface code and would silently shadow it. | §14.5 |
| A16 | Copies per card | A built-in Quantity (0–999, default 1) on every card rather than a user field, so it works the same in every game and in every export. Sheets and PDFs repeat the card; individual PNG files do not. A user field already named Quantity is respected and stays a plain field. | §6.5 |
| A17 | Fixed images in templates | `{{@asset.<id>}}` in an image's `href`, chosen from the asset picker in the canvas editor. Counts as asset usage, so such an image is not "unused" and deleting it warns. | §7.1, §8.4, §9.3 |
| A18 | Cloud connections | Opt-in, file-level exchange (CSV/JSON, images, exports, snapshot ZIPs) with Dropbox, OneDrive and GitHub; each user on their own account; explicit actions only; the project folder is never synced because a live SQLite database cannot safely be shared through file sync. The "offline-only" wording of earlier versions became "offline-first". | §1, §2, §15, §23 |
| A19 | Cloud credentials and portability | Tokens are encrypted with the OS credential store and are therefore *not* portable: a copied portable folder asks the user to sign in again. Project files carry only non-secret link metadata. | §4, §15.5 |
| A20 | Cloud conflicts | Files are never auto-merged. Pulls are previewed and undoable; pushes use the provider's conditional write where one exists and otherwise re-check the version first; overwriting is always an explicit choice. | §15.7 |
| A21 | Print-production PDF is a priority | A manufacturer-ready PDF (CMYK, bleed, TrimBox/BleedBox, preflight, soft proof) in two phases: CMYK raster first, vector (100% K text, spot colours) second. Preflight guards the export. The RGB print-and-play PDF of §10.3 stays. | §17 |
| A22 | Rich text and icons are a must | Opt-in markup, a user icon library whose icons scale with text, named styles and keyword rules, and the missing text controls. Needs a text engine with real font metrics (replacing the estimate of §7.4). | §16 |
| A23 | Spreadsheet formats deferred | CSV and JSON remain the main formats. Excel/OpenDocument are recorded under "Considered later". In-app field editing is reflected in linked files without hand-editing them. | §15.18, §22.1 |
| A24 | More play targets deferred, TTS first | Tabletop Simulator is the priority target; other platforms are deferred. Candidate TTS improvements are listed in §22.2. | §22.2 |
| A25 | Manufacturer presets | Data-driven, editable presets from the public guides of common manufacturers, each with source, date and a "proof-tested" flag that stays *no* until a physical proof has arrived. | §18 |
| A26 | SVG import | Designers can draw in their own tool and import an SVG; layers named after fields bind automatically, with a review step; re-import keeps bindings. | §19 |
| A27 | Snapshot compare | "What changed?" in plain language, with side-by-side cards and per-change restore; reusable for cloud refresh previews. | §20 |
| A28 | Command-line mode | Runs existing operations headless for automation, validation gates and CI; not a scripting or plugin interface. | §21, §23 |
| A29 | Proof testing deferred | Physical proofs from manufacturers are not ordered (cost). Presets stay labelled "not proof-tested"; automated checks and fixtures are the verification until then. | §17.9, §18.5, Appendix B.2 |
| A30 | V2 print and text choices confirmed | A CMYK raster production PDF (phase 1) is an acceptable first release; profiles that cannot be bundled are imported by the user; slightly different line breaks in existing text after the text-engine change are accepted. | §16.2, §17.5, §17.6 |
| A31 | Product renamed to Spadewick | The name "Cardexy" is already used by a TCG card-value scanner. A search of web indexes, the npm registry and domain records found nothing for **Spadewick**; the official trademark databases and the platform handles (itch.io, GitHub, Ko-fi, Discord) are **not yet searched** and must be checked before launch (Appendix C). This PRD uses the new name, and since version 1.9 so do the code, tests, interface strings, package and app identifiers (`com.spadewick.app`), the log file (`spadewick.log`) and the SVG attribute prefix (`data-spadewick-*`, comments `spadewick:`). Old `data-cardexy-*` attributes and `cardexy:` comments stay readable permanently: they are rewritten whenever a template is loaded, rendered or saved. | §24.2 |
| A32 | Every project owns editable copies of its templates | Using a library template **clones** it (with fonts, icons and fields) into the project, so a project is self-contained and everything ships together. The library holds starter templates, the user's saved templates and mockups; templates are exchanged as packages. Replaces the "templates later" follow-up and settles pack delivery (L3). | §7.7 |
| A33 | Card IDs | Every card gets a generated, permanent, never-reused ID (pattern with set code, counter and optional author code). IDs are the identity for sync, the default import key, and available as collector numbers on cards. | §5.8, §15.18 |
| A34 | Review corrections applied | Text drawn as outlines everywhere; vector print output deferred to V2.2; phase-specific print settings; "unvalidated" PDF/X labelling; markup stripped in plain-text uses; deck-size rules in presets; schema forward guard; font-embedding checks; Linux credential check; ZIP limits; delivery plan, spikes and risk register. | §16, §17, §18, §13.3, §24 |
| A35 | Release cuts | V2.0 = foundations, IDs and templates, text engine and rich text, SVG import and packages, production PDF phase 1 with presets and preflight, and cloud for GitHub and Dropbox; V2.1 = snapshot compare, command line, OneDrive; V2.2+ = vector production PDF and §22. | §24.1 |
| A36 | Cloud access | Everything except cloud synchronisation stays free; a one-time key stored on the machine and checked offline is required only to connect and sync. The licensing section is still to be written. | §15.19, Appendix C |
| A37 | Version 1.9 scope | What had to exist before V2 work could start: the rename (phase 0.1), the schema guard (0.2), card IDs (1.1) and template storage with packages (1.2), plus removal of Google services from the plan. The headless core (0.3), the spikes (0.4) and cross-platform CI (0.5) are V2 work; 0.5 has a first subset workflow. | §24.2 |
| A38 | Card ID column and import | The ID column sits right after Name, is read-only, and changes only after a warning (Enter, F2 or double-click). A file with a `card_id` column defaults to *Merge*; a row whose ID is new keeps that ID, a blank one gets the next generated ID after the highest ID in the file. In *Append*, an ID that already exists anywhere in the project is replaced by a new one rather than clashing. | §5.8, §6.1 |
| A39 | Card IDs and sets | Set codes are derived from the set name (first word, up to 4 characters, a number added on a clash) and editable in the sidebar; editing a code never rewrites existing IDs. Deleted cards keep their IDs (they are soft-deleted), so an undone deletion returns the same ID. Deleting a whole set removes its cards for good; a later set with the same code starts counting from the start number again. | §5.8 |
| A40 | Upgrading a project | Instead of *offering* a snapshot, the upgrade takes one automatically, before touching the data, and reports the result. Existing fields called `card_id` become `card_id_2`, with data, formulas and templates following, and a notice. | §5.8, §13.3 |
| A41 | Starter templates | Defined in code in the package layout (so they need no files and use the same clone code): a blank frame for each of the twelve card sizes and three example designs. Frames are at trim size with trim and safe guides in a group hidden at render time; canvases that include bleed arrive with §17.4. | §7.7.1 |
| A42 | Fonts in a clone | A font whose family and style the project already has is never replaced. A different file of the same name keeps the project's file and reports it (renaming a family would mean rewriting the font itself). Fixed images are reused when the project already holds the same file. | §7.7.2 |
| A43 | Where templates are started from | *New set from template* is in the sidebar and the template library; a set made this way takes the template's card size and default template. A new *project* is made blank first. Using a template needs a target set for its fields; without one the template is copied and the fields are reported as skipped. | §7.7.5 |
| A44 | Package safety | Only five kinds of path are accepted inside a package; the manifest, entry count (500), unpacked size (100 MB) and every declared entry size are checked before or while unpacking, so an archive cannot expand beyond what it declares; every SVG (templates and images) is sanitised on import. A font whose own licence flag forbids embedding is left out of packages. | §7.7.4, §14.7 |
| A45 | Google services removed | Google Drive and Google Sheets are removed from the plan: no connector, no scope, no registration, no Sheets source. Providers are GitHub, Dropbox and OneDrive; V2.1 adds OneDrive only. | §15, §22.1 |
| A46 | Electron binary on install | Electron 42 has no install hook, so `npm install` alone leaves no binary and `npm run dev` stops with "Electron uninstall". The postinstall script (`scripts/native.mjs`) now runs Electron's own installer when the binary is missing; it skips this when `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (CI) or with `--node-only`. | §4, §14.3 |
| A47 | Accessibility lint warnings | Svelte's static checker reports twelve warnings on the card table, the tab lists, the colour popup, the card preview and the canvas scroller. They describe the composite-widget patterns of §14.4 (the grid is one tab stop and moves between cells with the arrow keys; tab lists use roving tabindex on the tabs; scrollable regions are focusable so keyboard users can scroll them), not missing keyboard support. Each is suppressed with a `svelte-ignore` and a comment saying why, so a new warning is a real signal. The end-to-end axe and keyboard tests remain the check. | §6.1, §14.4 |
| A48 | Column resizing is pointer-only | Dragging a column divider (§6.1) has no keyboard equivalent. Everything else in the table is keyboard-operable. Open item: add a keyboard way to set a column width (for example from the column's context menu) to meet WCAG 2.1.1 fully. | §6.1, §14.4 |
| A49 | Svelte configuration file | `svelte.config.js` is renamed `svelte.config.mjs`, so Node no longer re-parses it as an ES module with a warning on every start. `package.json` stays without `"type": "module"` because the build's output (`out/main/index.js`) must stay CommonJS. | §4 |
| A50 | Source dialog applies edits as typed | The new source dialog (§8.7.1) keeps today's behaviour: edits reach the canvas and the editor's undo history as they are typed, and closing the dialog keeps them. An Apply step was rejected because it would add a state (typed but not applied) that does not exist today. A Revert button covers "I did not mean that". | §8.6, §8.7.1 |
| A51 | Layers panel scope | Only elements that have an id are listed, because those are the only ones the canvas can select (§8.2). Reordering stays among siblings; moving an element between groups is deferred. Hide and lock are editor-only view state, not written to the SVG, so a template can never be exported hidden by accident. Reordering has a keyboard path (Alt+arrows), unlike column resizing (A48). | §8.7.2, §22 |
| A52 | How live resizing works | The canvas picture is a bitmap from the main process. To make it follow the handle, the editor draws the moving element itself during the drag on top of a render of the card without that element, then replaces it with the real render on release. The "card without the element" is the ordinary render call given a source copy with that element hidden, so the main process needed no new render option; only a small `assets:get-preview` call was added for the picture. Images and shapes are live; text waits for the text engine (§16.2) because its wrapping is computed in the main process. The spike passed in a browser run: 63–67 ms for the render without the element and 58 frames per second (§8.7.3). | §8.7.3, §10.5, §16.2 |
| A53 | Two snapping systems | The existing **Snap** (pixel or grid) is kept as it is. **Guides** (edges, centres, other elements, with lines) is a separate toggle, on by default, remembered between sessions. When a guide target is in range it wins over pixel snapping; Alt suspends guides for one drag. A single combined toggle was rejected because designers who want grid-exact placement do not want elements pulled towards each other. | §8.3, §8.7.4 |
| A54 | Card size belongs to each set and each template | The project-wide default card size and "inherit" are removed (Fixes F9). A set is made with a size (Poker preselected) and can change it with a warning; a template is made with a size that is then locked; a set only lists and uses templates of its own size. Existing projects are upgraded without asking: a set with no size takes the project's old default, and a template takes the size of a set that uses it when the shapes agree, else the nearest preset to its shape, else the project's old default; a snapshot is taken first. | §5.2, §7.7, §10.6 |
| A55 | No project palette | Colours are set on elements (picker or hex) and per card (`color` fields) only (Fixes F11). Palette references in templates and formulas are replaced by the colours on upgrade, after a snapshot. The palette table is left in old files, unused. Open question: where CMYK and spot values will live for §17 (§28.3). | §7.5, §13.3, §17.5 |
| A56 | One place for templates | The Manage Templates window is gone (Fixes F10). Making, opening, renaming, duplicating, deleting, saving to the library, exporting, importing, updating and resetting a template are all done from the Template Editor; the library opens from there as a dialog that shows templates of the set's size. | §7.7.5, §12.2 |
| A57 | The canvas has no zoom *(superseded by A79)* | View → Zoom and the toolbar zoom controls were removed at the owner's request (Fixes F6), because they did not work; the canvas was always 100%. | §8.1, §8.3, §12.2 |
| A58 | Two-tone grid | The grid is drawn as a dark line with a light line beside it, stronger every 50 units, instead of detecting the background colour: it works on any card colour, including cards that mix light and dark, with nothing to compute (Fixes F7). | §8.3 |
| A59 | Panels the user can resize | Five boundaries can be dragged or moved by keyboard, within limits, and are remembered; the template list can close to a rail; the layers list moved into the lower half of the properties panel, split by a draggable divider (Fixes F8, §12.5). | §8.7.2, §12.5 |
| A60 | Set code stays in the project panel | The short set code that starts a set's card IDs is still edited in the project panel, beside the card IDs settings of the Card IDs dialog; merging the two is left for later at the owner's request. | §5.8 |
| A61 | Local file links first for Tabletop Simulator | TTS cannot read pictures from inside the JSON, and a bare file name is taken for a web address (Fixes F13). The first fix writes full local file links, which need no account and no network; hosting is a later, separate feature (§22.4). A file-names mode is kept for people who host images themselves. | §10.2.1, §22.4 |
| A62 | Text engine route confirmed (spike A) | Text is shaped with HarfBuzz compiled to WebAssembly (`harfbuzzjs`) and drawn as glyph outlines through the existing rasterizer; fontkit was compared, gave identical results on the fixture, and is not used. Shaping is done per run and split into words by cluster (not word by word); an inline icon never separates from a letter or punctuation that touches it without a space. Devanagari, Thai, Khmer and CJK were deliberately left out of the spike and stay open (§24.3). | §16.2, §24.3 |
| A63 | Core services take a context, not globals | Every former IPC handler became a service `fn(ctx, args)` in `src/main/core`; `ctx` carries the project handle, the settings and the dialog port, and the IPC handlers are one-line wrappers. Chosen over passing the project folder alone (settings and dialogs would still be reached through globals) and over a class per project (a command line or a test would have to construct more than it needs). Settings that belong to the installation rather than to a project (the card ID author code, the undo limit) are handed in once when the context is created. Done in one pass for all families, with the existing tests unchanged as the safety net and no new features. | §24.2, §4 |
| A64 | Text engine built; per-project switch; Noto fallback fonts | Phase 2.1 is built as described under §16.2. Decisions: the switch back to the earlier estimate is a per-project setting (`text_engine`), not an app-wide one, so a shared project cannot draw differently on two machines; an older project is moved on first open with an automatic snapshot taken only when some card's text would change, and a notice naming the templates; **Noto Sans Arabic and Hebrew** are bundled as fallback fonts (about 260 KB, SIL OFL), and other scripts report a missing glyph until a font is imported; the engine is wired into every render (previews, exports, PNG sheets, TTS, PDF) and not into the canvas's live dragging, which waits for a later step. The libraries are runtime dependencies (`harfbuzzjs`, `bidi-js`, `linebreak`): `harfbuzzjs` must be listed under `dependencies` so the build keeps it external, and it is loaded with `import()`. | §7.4, §16.2, §24.2 |
| A65 | Rich text built; starter icons; synthesized bold and italic | Phase 2.2 is built as described under §16.3, §16.4 and §16.7. Decisions: **a small starter icon set ships now** (twelve original shapes) instead of waiting for the library of phase 2.3, so `{icon:…}` really draws on first use, and the library will later override them by name; **bold and italic are synthesized** for a font that has no such face, so the markup always shows (a real face is always preferred), rather than leaving the text unchanged and warning; **no Insert keyword button and no effect of `{style:…}`** until text styles and keyword rules exist (the tag is accepted and listed as an unknown style); the schema moves to version 8 by rebuilding the fields table so the Rich text type is allowed (a project made by this version cannot be opened by an older one, which the forward guard of §13.3 refuses with a clear message); the cell editor is an overlay placed from the cell because table rows are transformed; the planned schema numbers move up by one (§13.3). | §13.3, §16.3, §16.4, §16.7, §24.2 |
| A66 | Icon library, styles, keyword rules, text check and text controls built | Phases 2.3 and 2.4 are built as described under §16.4 to §16.9. Decisions: both phases in one run, in order; **hyphenation uses soft hyphens only** (`{shy}`, already built): no dictionary is bundled and there is no language setting, so nothing can hyphenate wrongly for a language that was never tested; **the text check is built now** as Project → Check text…, on the report the engine already collects, instead of waiting for the print preflight; **all fifteen controls of §16.6** are built, as attributes of the text element; icons are stored as assets (tagged `icon`) with a row in `icons`, SVG icons are drawn nested in the card with the colour of the text and pictures as images; a style or an icon is named by a lower-case key and names are matched case-insensitively with hyphen and underscore alike; keyword patterns are limited and checked because a regular expression can otherwise hang the app; the schema moves to version 9 (a project made by this version cannot be opened by an older one); the planned cloud schema number moves to 10. | §13.3, §16.4 to §16.9, §24.2 |
| A67 | SVG import and automatic binding built | Phase 3.1 is built as described under §19 (see *As built*). Decisions: the whole of §19 including re-import; missing fonts and outlined text are listed and a missing font can be mapped to an available one; size is proposed from the shape of the design (a pixel size is a guess), with Fit, Keep and Crop; the guide is in the dialog only, not a printable page; bleed is cut off, not kept, until exports have bleed. Found while building: the rasterizer ends the program when asked to draw a layer (transparency, mask, filter, clip) that lies wholly outside the picture, so such elements are left out of an import and of its previews. No schema change: the template's existing `origin` column holds the import's record. | §19, §24.2 |
| A68 | Colour conversion for production output uses lcms-wasm | Spike B passed. Phase 4.1 converts images, flat vector colours, the soft proof and the total ink measurement with **`lcms-wasm`**, with the rendering intent and black point compensation chosen in the export profile (§17.5); sharp stays for decoding and resizing. A PDF output intent needs no new PDF library (pdf-lib wrote it); spike C decides the rest. The CRPC1 profile (ICC registry, free to embed and share) can be bundled; the ISO Coated v2 profile from ECI is bundled only after ECI confirms redistribution, otherwise it is imported like profiles that cannot be bundled. | §17.5, §24.3 |
| A69 | Production PDF is written with pdf-lib | Spike C passed: boxes, spot colours, overprint, registration marks and layers need no purpose-built writer. Phase 4.1 builds on the object-level code of the spike. PDF dates are written in the specification's form with an explicit offset (`+00'00'`). A commercial preflight tool or a printer's check of a sample file is required before release, because the spike could not run one (Appendix C). | §17.3 to §17.7, §24.3 |
| A70 | Production PDF, phase 1, built | Phase 4.1 is built as described under §17 (see *As built*). Decisions: **everything of 4.1 in one run** except presets (4.2) and preflight (4.3); **print colours are a project list matched by screen colour** (closes Q1): flat areas of that colour get exactly the given inks, a spot name is kept for the vector output and the raster output says it printed it as inks; **one profile ships (CRPC1), ISO Coated v2 is imported by the person** until ECI confirms redistribution; **all four layouts of fronts and backs**; the standard is described as "PDF/X-4-style, unvalidated" and no identification entries that would claim conformance are written; the template bleed is a mode per template (included, extend, fill) with a button that widens a trim-size canvas; the schema moves to version 10 and the planned cloud schema number moves to 11; imported profiles are assets tagged `icc-profile`, hidden from the picture library. Lesson: strings in a PDF written by pdf-lib are hex-encoded, so a test must read them with the library, not search the bytes. | §5.8, §13.3, §17, §28.3 |
| A71 | Windows only for V2.0 | **V2.0 is built, tested and released for Windows 10 and 11 only.** macOS and Linux are deferred, not removed: the code stays portable and the macOS and Linux build targets stay in the configuration, unbuilt and untested. Spike D no longer gates the cloud phase; 0.5 is Windows CI; spike E is Windows only; the release checklist (Appendix B.2) is run on Windows. Reason: the owner develops and tests on Windows; the remaining macOS and Linux work is verification, signing and packaging that does not change the product. Re-evaluate after V2.0 ships. | §4, §14, §15.5, §21, §24, Appendix B.2 |
| A72 | Print preflight built | Phase 4.3 is built as described under §17.7 (see *As built*). Decisions: **every check that does not need presets**; **Show me** jumps to the template editor, the element and a card with the problem; **errors disable Export, with Export anyway**; **the minimums are project settings** with the PRD's defaults, edited in the preflight dialog; the text check reports to the preflight through a hook (one pass over the cards); the print black rule of phase 1 is a print colour for #000000 with 100 % K; every written PDF is verified against its settings. | §17.3, §17.7 |
| A73 | Manufacturer presets built | Phase 4.2 is built as described under §18 (see *As built*). Decisions: **presets drive the production PDF and a new per-card image export**; **all nine presets ship, each unconfirmed value named and left at a safe default** (nothing is guessed silently); **the person's presets are JSON files in the library folder, shared by all projects**; **the deck-size rule is a preflight warning when a preset states one**. Found while building: the pixel size of a card is computed from the millimetres (not from a rounded bleed in pixels), so a manufacturer's 825 × 1125 px comes out exactly; a card image of an odd size puts the extra pixel on the right and bottom. | §10.4, §17.7, §18 |
| A74 | Offline first: V2.0 has no cloud | **V2.0 is fully offline.** The cloud (§15; phases 6.0, 6a, 6b) is deferred to a later release; snapshot compare (§20) and the command line (§21) join V2.0. Reason: finish and use the product that needs no accounts, registrations or network before taking on the provider framework, credential storage and the licensing decisions it needs (Appendix C, L5 and L6). Nothing already built depends on the cloud, and schema 10 stays the current schema (the planned cloud-links table, numbered 11, waits). | §1, §15, §24.1, §24.2 |
| A75 | Snapshot compare built as a first version; version label 2.0 | Phase 5.1 is built as described under §20 (see *As built*). Decisions: **the first version covers the headline, the Cards, Fields and Templates/images/fonts tabs, side-by-side pictures, word-level text differences and taking back card changes (values, names, quantity, template, card ID, added and removed cards) as one undo step**; the rest of §20 is listed under *Not built*. **The earlier snapshot is opened as a throw-away project in the temporary folder**, which gives the old card pictures from its own templates and fonts for free and keeps the open project untouched. **Taking back is limited to cards**; fields, templates, images and fonts are shown but not restored, because restoring them can break other cards. The package and this document are labelled **2.0 (in development)**. | §20, §11.1 |
| A76 | Command line built as a first version; resources found from chunks | Phase 5.2 is built as described under §21 (see *As built*). Decisions: **the first version is the read-and-export commands** (`info`, `list`, `validate`, `preflight`, `export`, `render`, `compare`); commands that write to the project, watch mode, cloud and batch wait. **The program is a second entry of the existing build and a launcher script**, not a mode of the window process, so it needs no window system and prints to a console. **A production PDF is not written while the preflight has errors unless the person says `--export-anyway`**, the same rule as the dialog. The second entry made the build put shared code into `out/main/chunks/`, which moved the place the bundled fonts and profiles were looked for; they are now looked for in `process.resourcesPath` and then in `resources/` two and three folders above the code (fixed in `fontFiles.js`, guarded by the built-program test). | §21, §10, §17 |
| A77 | The rest of the offline V2.0 | **Live text while dragging** re-renders the card at most every 120 ms with the element at its dragged place (the §8.7.3 *could*); **snapshot compare** gains side-by-side, overlay and slider views, template pictures and source differences, sets, picture thumbnails, column-level restore, restoring templates and deleted pictures, the change list export and the menu shortcut (fields stay read-only, because restoring them can break cards); **the command line** gains `import`, `snapshot`, `profiles`, `watch` and the project lock (a lock file written by the application and by commands that write; only a running program counts), and its help and the SVG naming guide are written to `docs/` from the program's own text; **the production PDF** gains JPEG compression with its own encoder (CMYK in Adobe's inverted form with `/Decode`); **the image export panel** gets the print readiness check; **Windows CI** is the whole suite plus a packaging job; **spike E (Windows) passed** with the packaged launcher. A second build entry for the command line moved shared code into chunks, which is why the bundled resources are now looked for in three places (A76). | §8.7.3, §17.3, §18, §20, §21, §24 |
| A78 | Visual refresh, no behaviour change | The look is modernised through the design tokens and the shared control styles (`App.svelte`) and a few component styles: an indigo-violet accent with a gradient for the main action and the current item, softer dividers with stronger edges kept on buttons and fields (3:1, WCAG 1.4.11), rounder corners (8 px, 14 px for dialogs), shadows, a dotted canvas surround, slim scroll bars, a blurred dialog backdrop, a welcome screen with a glow, and a fresh dark and light palette. Nothing was moved, renamed or resized; the accessibility rules of §14.4 are unchanged (focus outline of 2 px, the edge bar on selected rows and the current set, reduced motion, more contrast and forced colours), and the whole end-to-end suite, with its axe checks in both themes, passes. **Also (the one behaviour change of the refresh): a text element with no field binding and no inner elements has a Text box in the properties panel (§8.4), so freetext is typed there instead of in the SVG source; one undo step per edit.** | §14.4, §8.4 |
| A79 | A modern canvas: zoom, pan, rulers, grid, tools and panel | At the owner's request (2026-10-05, answering a proposal) the canvas gets **zoom and pan** (reversing A57, whose cause, controls that did nothing, is gone: the stage is scaled and everything the editor writes stays in card units), keyboard shortcuts for the tools and the zoom, **rulers** and a **grid** that follow the zoom, an icon toolbar with the view switches grouped, hover outlines and a size or position label while dragging, and a **sectioned properties panel**. Not built: a rotation handle (owner: not now) and layers panel changes. The first view stays 100% so that existing habits and tests hold. | §8.3, §8.4, §12.5 |
| A80 | Editing several things at once; a fuller Appearance | At the owner's request (2026-10-06), the first five items of the gap list: **multi-select with copy, paste, duplicate and grouping; align and distribute with rotation; gradients, shadows and stroke options; reusable colours and text styles; typing on the canvas.** Decisions: **several elements are one block** (a single rectangle stands for them in the resize frame, below their own handles, because Konva would otherwise drag every attached element on its own); **definitions belong to the element** (`grad_<id>`, `fx_<id>`), so a copy never changes the original; **no palette** (A55 stands): reusable colours are the ones the template already uses, and a text style is applied as a copy, so a template stays complete on its own; **words are typed only on text that shows no field**; **blend modes use the style** (the renderer ignores them as attributes); **rotation of one element only**. A loop that asked for the text styles again and again on a project with none was found by the tests and fixed before release. | §8.3, §8.4, §7.5 |
| A81 | Card backs: a slot for the set, an override for the card | At the owner's request (2026-10-06), **card back designer.** Decisions: **one back per set, and a back of its own for a card** (not a second face of every card); **a back is a template** of the set's size, drawn with the card's own data, so it needs no new kind of thing and the whole template editor is the designer; **the default of every export is the set's card back**, with the plain colour as the fallback, so a project that has no backs exports as before; **cards that share a back share one picture**, and a back that shows a card's data gets one of its own (Tabletop Simulator: a sheet of backs with `UniqueBack`); **the print readiness check and the text check treat a back as a front**. Found on the way: undoing a change of a set row replaced the row and so deleted its cards (history now updates a row that is still there). Starter backs are library items marked `purpose: back` and are used as the set's back. | §7.8, §10.2, §10.3, §17, §20 |
| A82 | The virtual table: solo first, built to be shared | At the owner's request (2026-10-06). **Answer to the owner's question:** a peer-to-peer table is possible. The browser engine in the application has WebRTC, so two players can be connected with no server of ours by trading a short connection code (copy and paste); on one network that is enough, across the internet two home routers usually need a free public helper (STUN) to find each other, and strict networks a relay (TURN), which is a service. It would be opt-in and only at connect time, so it does not disturb A74 (offline first). **Decision (the owner's): the solo table first, P2P as its own step afterwards.** The table is therefore built as plain data and one pure function, every move one JSON action, randomness carried in the action as a seed (`shared/table.js`), so a host-and-guests table can later send the same actions in the same order. Other decisions: **a deck is a pile and a card on its own is a pile of one** (one kind of thing to move); **dragging a deck takes its top card**; **a stack turned over reverses**; **a hand is seen face up**; **saved tables are files in the project's `tables` folder**, not part of a snapshot; **pictures are drawn by the application** and cards with one back share one. | §7.9, §22 |
| A83 | Components: copied into the template, updated from the library | At the owner's request (2026-10-06). **Decision (the owner's): a library of components, copied into each template, with update-from-library** (not project-only, not copies with no link). A template therefore stays complete on its own (A55): the parts are inside it, the group only remembers where they came from, and a template does not need the library to be drawn. **Instances may change colours and words, not structure** (the changes are kept as overrides and put back on update); a structure that is changed in an instance is saved to the library with *Save changes to library* or let go with *Detach*. Definitions a part uses get free names on every copy, so two copies never share one; pictures of the project are put inside the component as data; what comes from a file is made safe. | §7.10, §7.5 |
| A84 | The Rules: Markdown pages in a tree, in the project | At the owner's request (2026-10-06). **Decision (the owner's): per project, several Markdown pages in a tree**, with a side-by-side editor and preview, import and export of single files and of a whole folder, and a place in snapshots (so the pages live in the project database, schema 12). Our own reader covers the part of Markdown a rulebook uses and escapes everything else, so a page cannot run anything; references to cards (`[[Card]]`, `![[Card]]`), pictures of the project (`asset:`) and other pages (`page:`) are data the page fills in. Exports write relative picture links (`images/…`) and imports put such pictures into the image library, so a rulebook round-trips through files. Only a new title is a step of undo; the text has the undo of its box and the snapshots. | §7.11, §20 |


---

## Appendix B — Verification

### B.1 Automated tests

The full suite runs headless with `npm run test:all` and on every push in CI (`.github/workflows/test.yml`). *Unit/integration* tests run the real main-process handlers against real SQLite, resvg, sharp and pdf-lib; *end-to-end* tests drive the built interface in Chromium with the application's real preload script bridged to those same handlers. See `tests/README.md`.

| Requirement | Verified by |
|-------------|-------------|
| §5.1–5.3 Projects, sets, cards, fields, default templates | `integration/projects`, `integration/setsFieldsCards`, `unit/validate` |
| §5.4 Formulas, circular detection | `unit/formula` |
| §5.5–5.6 CSV/JSON import and export, field matching | `unit/csv`, `integration/dataio`, `e2e/workflows` |
| §5.7 Find and replace | `integration/findReplace`, `e2e/workflows` |
| §6.1–6.2 Card table: virtual grid, keyboard, selection, bulk edit, columns, cell editors | `unit/grid`, `e2e/grid`, `e2e/workflows` |
| §6.3–6.4 Preview pane, field manager | `e2e/journey`, `e2e/workflows` |
| §6.5 Card quantity (column, bulk edit, undo, CSV/JSON, TTS/PDF/PNG copies, migration) | `integration/quantity`, `e2e/grid` |
| §7.1–7.3 Templates, inheritance, conditions | `integration/render` |
| §7.1, §8.4, §9.3 Fixed images in templates (render, usage, canvas picker) | `integration/fixedImages`, `e2e/workflows` |
| §7.4 Dynamic text | `unit/dynamicText`, `integration/render` |
| §7.5 No palette: leftover tokens draw nothing, old packages are written into the template, upgrade of old projects; §7.6 fonts | `integration/cardSizeModel`, `integration/render`, `unit/legacyPalette`, `unit/fontFamilies`, `integration/fonts` |
| §8 Canvas editor, source editor | `e2e/workflows`, `unit/svgHighlight` |
| §8.7 Template editor improvements (urgent): source dialog, layers panel, guides toggle, snapping, layer order, live image fit, asset preview. **Built; passes the unit, integration and end-to-end suites**; the desktop window itself needs a manual look | `unit/snap` (including distance gaps), `unit/layers`, `unit/liveFit`, `integration/assets` (preview), `e2e/templateEditor`, `e2e/a11y` (§8.7.5) |
| §10.6 Card size per set and per template: creating, locking, filtering, the warning on changing a set's size, the upgrade of older projects | `integration/cardSizeModel`, `unit/cardSizes`, `e2e/cardSize`, `e2e/templates` |
| §12.5 Resizable panels: limits, keyboard, mouse, remembered, reset; the zoom (A79); the two-tone grid; layers in the properties panel | `unit/layout`, `e2e/layout` |
| §10.2.1 Image links in the TTS file: local file links, names mode, the link format on every platform, the remembered setting, no absolute path in project data | `unit/ttsLinks`, `integration/export`, `e2e/workflows` |
| §7.7.5 One place for templates: new, library, menu actions, package import | `e2e/templates` |
| §9 Asset library | `integration/assets`, `e2e/workflows` |
| §10.1 Export selection and file names | `unit/exportHelpers`, `integration/export` |
| §10.2–10.4 TTS, PDF, PNG sheet (including 100-card time budgets) | `integration/export` |
| §10.5–10.6 Pipeline, card sizes | `unit/cardSizes`, `integration/render`, `integration/export` |
| §11.1 Snapshots | `unit/zip`, `integration/snapshots` |
| §11.2 Undo/redo | `integration/history`, `e2e/workflows` |
| §12 Shell: menus' targets, recent projects, open file, logs, portable root | `integration/shell`, `unit/portable`, `integration/projects` |
| §13 Data model, migrations | `integration/projects`, `integration/setsFieldsCards` |
| §14.1 Performance targets | `integration/export`, `e2e/grid` (scroll) |
| §14.2 Reliability, integrity on open, recovery | `integration/snapshots`, `integration/projects` |
| §14.4 Accessibility | `e2e/a11y` (axe in both themes; keyboard, focus, structure, colour, forced colours, more contrast, reduced motion) |
| §14.5 Strings and Unicode/RTL | `unit/strings`, `integration/render` |
| §15 Cloud connections — **not yet implemented**; will be verified by the adapter conformance suite against fake providers, the end-to-end flows and the credential checks listed in §15.17 | *(planned)* |
| §15.18, §16–§18 and §20–§21 V2 features (§19 and phase 1 of §17 are built) — **not yet implemented**; verification plans are in §15.17, §16.10, §17.9, §18.5, §19.6, §20.7 and §21.6 | *(planned)* |
| §5.8 Card IDs (assignment, never-reuse across delete/undo/redo, counter safety, reserved name, migration, tokens and formulas, CSV/JSON round trip, ID column and dialog) | `unit/cardIds`, `integration/cardIds`, `e2e/cardids`, `e2e/grid` |
| §7.7 Template storage (clone rule and every clash row, one-step undo, project works without the library, save to library, packages, hostile packages, update and reset, template library) | `unit/svgSafety`, `integration/templateLibrary`, `e2e/templates`, `e2e/a11y` |
| §13.3 / §24.2 phase 0.2 Schema guard and pre-upgrade snapshot | `integration/cardIds`, `e2e/cardids` |
| §24 delivery plan and risk register — planning only; the definition of done of §24.5 applies to each phase | *(not code)* |
| §14.7 Security (hostile template, hostile package, ZIP limits) | `e2e/workflows`, `unit/zip`, `integration/templateLibrary` |

### B.2 What automation cannot cover

These need a person at a desktop and are the only manual checks left. One `npm run dev` session covers them; none changes the requirements above.

- The native application menu, native file/folder pickers and OS window chrome (the interface and the handlers behind them are tested; the Electron shell that hosts them is not).
- The packaged builds themselves (AppImage, Windows/macOS unpacked folders) starting on a clean machine.
- Screen-reader speech output (the roles, names and live regions it reads are tested), and the OS-level contrast and reduced-motion switches (their effect is tested by emulation).
- Print quality of exported PDFs on a physical printer; and, for the production PDF (§17) and each manufacturer preset (§18), acceptance by the real manufacturer's pre-press and a physical proof, plus an independent PDF/X preflight with a commercial tool.
- Cloud connections (§15, once built): a real sign-in and a pull/refresh/push round trip against each real provider, on a personal and on a work/organisation account. Fake providers cover the logic, not the providers' live behaviour or their app-review requirements.

---

## Appendix C — Launch Checklist

*This appendix is a business and release plan, not a product requirement: nothing here changes what the application does. It is ordered; each part has a **Done when** line that must be true before the next part starts. **You** marks a task that needs the owner (accounts, money, legal, community); **Dev** marks a task Claude or another developer can do in the repository. Platform rules, fees and size limits change — verify each against the platform's current documentation when you reach that step.*

| Part | Goal | Depends on |
|------|------|------------|
| C.1 | Testing: be sure the released app is safe to hand to strangers | — |
| C.2 | itch.io release, free, with a tip jar (Ko-fi) for other platforms | C.1 |
| C.3 | Template packs: the first products | C.2 |
| C.4 | Discord community: support, feedback, showcase | C.2 (seed it during C.1 beta) |
| C.5 | Pre-sell V2: test demand before building §15 | C.2, C.3 or C.4 under way |

### C.1 Testing

**Automated (Dev)**
- [ ] All unit, integration and end-to-end suites pass on the exact commit to be released (`npm run test:all`), and the CI run for that commit is green. *CI currently runs on pushes to `main` and on pull requests only, so a draft pull request is needed to get CI on a branch.*
- [ ] A production build starts from a clean checkout (`npm ci`, `npm run build`).

**Manual — the checks automation cannot do (You, or a tester you trust).** Run on each of Windows 10/11, macOS 12+ (Intel and Apple silicon if you support both) and Ubuntu 22.04+, first with `npm run dev`, then with the packaged build:
- [ ] Every menu item does what its label says (File, Edit, View, Project, Help), including the keyboard shortcuts.
- [ ] The native file and folder pickers work for: new/open project, open project file, import CSV/JSON, import images, import fonts, export destinations, snapshot export.
- [ ] Window behaviour: resize, minimum size, maximise, restore after restart, quit with unsaved template changes.
- [ ] The theme follows the operating system (light/dark), and the app is usable in the OS high-contrast mode and at 125%, 150% and 200% display scaling.
- [ ] A project path with spaces and non-ASCII characters (for example `Spielkarten Größe`) opens, saves and exports.
- [ ] A real 500-card project opens in about 2 seconds; a 100-card export finishes within the PRD §14.1 times.
- [ ] **Tabletop Simulator:** load an exported deck (sheet and JSON) in the real game; the card count, order, back and a duplicated card (quantity) are correct.
- [ ] **Print:** print a PDF at 100% on a real printer and measure a card with a ruler against the chosen size; check that duplex backs line up when printed on both sides.
- [ ] **Screen reader pass** on the main flows (NVDA or Narrator on Windows, VoiceOver on macOS): open a project, edit a cell, open and close a dialog, export.
- [ ] **Projects folder inside a cloud-synced folder** (Dropbox, OneDrive desktop): confirm the warning in the user guide (C.2) is accurate, because a live SQLite database must not be synced by a file-sync client.
- [ ] Restore a snapshot, undo/redo across a restart, and recovery from a deliberately damaged `project.db` (PRD §14.2).

**Status 2026-10-10 (dev.15, Windows only, A71; unsigned: decision L1 is no signing yet).** Automated: `npm test` 1,278 of 1,284 pass (the 6 are environment-only: 5 PDF checks need `pdftoppm`, 1 EPERM on a temp folder); `npm run test:e2e` 365 of 365 tests pass (`workflows` reports a file failure only for the temp-folder EPERM at its end). Packaged app: `Spadewick.exe` from `dist/win-unpacked` started through Playwright, made a project and the teal template with a long text; resvg stopped, the drawing helper recovered and the card rendered (U13 works from inside the asar). The items below that stay open need a person, a printer, another computer or an account; the macOS and Linux lines are not part of V2.0 (A71) and are not checked.

**Packaging (Dev, then You verify)**
- [X] Version number set for release (currently `2.0.0-dev.15`, 2026-10-08; the release number is set at the end), and shown in the About dialog.
- [X] Application icon created (2026-10-08): `build/icon.svg` (a spade with a candle flame), `build/make-icon.mjs` writes `icon.ico` and `icon.png`; `win.icon` in `electron-builder.yml`; checked in the built exe. Windows only (A71).
- [X] `npm run dist` produces: Windows unpacked folder, macOS unpacked app (both architectures if supported), Linux AppImage.
- [+] The packaged app creates `data/` and `projects/` next to itself, writes nothing to the OS profile folders, and still runs after the folder is moved (PRD §4, §14.3).
- [X] Linux AppImage runs on a stock Ubuntu 22.04 (note any FUSE requirement in the user guide).
- [X] Windows SmartScreen and macOS Gatekeeper behaviour recorded for an unsigned build.
- [DEFERRED] **Decision (You):** sign the builds or not. Unsigned builds work but show scary warnings that cost downloads; signing needs a Windows code-signing certificate and an Apple Developer membership (notarisation). Acceptable plan for a free first release: unsigned, with clear instructions on the page; revisit before charging money.

**Legal and housekeeping**
- [ ] (Dev) `LICENSE`/end-user terms and a `THIRD-PARTY-NOTICES` file listing every bundled library and font with its licence (for example resvg, sharp and its image library, Electron, and the Liberation fonts under the SIL OFL, whose licence text is already shipped in `resources/fonts`).
- [ ] (You) The name **Spadewick** (formerly Cardexy, A31) checked in the official trademark databases (USPTO, EUIPO TMview, WIPO Global Brand Database) and for handle and domain availability before the pages and Discord are created. Web, npm and domain-record searches found nothing, but those are not clearance.
- [ ] (You) A short privacy statement: version 1.x makes no network connections and sends nothing anywhere.
- [ ] (You) Before the first *paid* product, have a qualified person review the licences and terms (this checklist is not legal advice).

**Beta**
- [ ] (You) Recruit 3–5 real card-game designers; each uses the app on a real game for about two weeks and sends their CSV, their pain points and any logs (Help → Open Logs Folder).
- [ ] (Dev) Triage everything reported: any data-loss, crash-on-open or wrong-export bug blocks release; cosmetic issues do not.
- [ ] (You/Dev) A GitHub issue template exists for bug reports (version, operating system, steps, log file).

**Done when:** automated suites are green on the release commit; the manual checks above pass on all three operating systems; the beta found no open data-loss or wrong-export bugs; the packaged builds run from a freshly copied folder; the licence files are in place.

### C.2 itch.io release (free) and the tip jar

**Accounts and payouts (You)**
- [ ] itch.io account and creator page; payout set up (itch asks for payout and tax details when money first moves).
- [ ] Ko-fi account for tips, with a payout method. Ko-fi is the tip jar for every place the app is downloaded from outside itch.io (a GitHub release, a direct link, a mirror). Add GitHub Sponsors or Patreon only if you want those too.
- [ ] Note your country's rules for reporting tip and sales income; consider a separate bank account for it (ask an accountant).
- [ ] **Decision (You):** is the source repository public, or private with downloads only? This decides whether GitHub Releases can be used as a mirror and whether issues can be reported there.

**The itch.io page**
- [ ] Project type: downloadable tool. Pricing: free, or "$0 or donate" with a suggested tip, so itch's own tipping works alongside Ko-fi.
- [ ] Separate download for each platform (Windows, macOS, Linux), each tagged for its operating system.
- [ ] Cover image and 4–6 screenshots (card table, template canvas, an exported TTS sheet, a PDF, the dark theme) and one short GIF per main flow — sizes per itch.io's current guidelines.
- [ ] A 60–90 second demo video: new project → CSV import → template → export.
- [ ] Description that states plainly: what it is, who it is for, **it works fully offline, and the free version is complete** (including exports); what the tip jar is for; what is planned for V2 (without promising dates).
- [ ] Tags (for example card game, tabletop, tool, game design, Tabletop Simulator), system requirements, changelog, known issues, a short FAQ, and the privacy statement.
- [ ] Links to Ko-fi, Discord (C.4) and the issue tracker.

**The user guide (Dev)**
- [ ] A README or guide page: install and first run (including the Gatekeeper/SmartScreen steps), "make your first card in 10 minutes" (UC-01), how CSV columns match field names, card sizes, backs and quantity, where data is stored, **do not put the projects folder in a cloud-synced folder**, how to back up (snapshots), how to report a bug.

**Release process**
- [ ] Tag the release (for example `v1.0.0`) and write the release notes.
- [ ] Publish SHA-256 checksums for each download.
- [ ] Upload with itch.io's command-line uploader (`butler`) so later versions arrive as updates per channel.
- [ ] **Install test from the public page** on a clean machine per operating system, as a stranger would.

**Support**
- [ ] One place for questions (Discord, C.4) and one for bugs (GitHub Issues); response time stated (for example "within a few days").

**Done when:** the page is public; downloads were installed from it on all three operating systems; the tip links work; a new user who has never seen the app (not a beta tester) builds and exports a card in about 10 minutes.

### C.3 Template packs

**Pack delivery — decided (A32).** Packs are **template packages** (§7.7.4) that the user imports into the template library or straight into a project; the clone rule copies everything (fonts, icons, fields) into the project. Until that feature is built, the interim options below work with the current app:

| Option | Works today? | Notes |
|--------|:-:|-------|
| **A. A starter project** (a ZIP the user unzips into their projects folder and opens with File → Open Project; it contains the templates, fonts, sample cards and images) | yes | Good for a first pack: the buyer sees a finished example. The user then builds their own project from it (Duplicate Project, then replace the cards). Templates cannot yet be copied between projects. |
| **B. Loose SVG files** with instructions (create a template, paste the SVG into the SVG source editor) | yes | Fonts and images must be imported by hand. Fine for a free sampler. |
| **C. Template packages** (§7.7) | **not yet — specified** | The intended delivery for a real pack catalogue; available once phases 1.2 and 3.2 of §24 are built. |

*Recommendation: until packages exist, sell the first pack as option A to learn whether people buy; ship the same pack as a package when §7.7 is built.*

**Content and rights**
- [ ] Only original artwork, or art, icons and fonts whose licence allows redistribution inside a paid product. Keep a credits file with each source and its licence (some free icon sets require attribution; the SIL OFL fonts may be bundled).
- [ ] No copyrighted game, character or brand material.
- [ ] A short licence for each pack: buyers may use it in their own games, including commercial ones; they may not resell or redistribute the pack itself. (Have it reviewed, C.1.)

**Pack specification (one genre per pack)**
- [ ] 3–6 templates (front and back), a matching colour scheme, the bundled fonts, an SVG icon set.
- [ ] A sample set of about 20 cards with a documented CSV (column names that match the fields) so the user can replace it with their own data.
- [ ] The card size set correctly (for example Poker, Tarot, Mini).
- [ ] Preview images and a one-page "start here" guide (5 minutes).
- [ ] The pack states which Spadewick version it was tested with.

**Quality gate for every pack (Dev + You)**
- [ ] Open it on all three operating systems; export TTS, PDF and PNG sheet from it with the real app; open the result.
- [ ] Text stays readable at the template's smallest size (use the app's long-text sample cards: wrapping and shrink modes).
- [ ] Three testers (not the author) go from download to an exported deck of their own cards within 30 minutes.

**Selling**
- [ ] A **free sampler** (one template) available from the itch.io page: shows the quality and feeds the community.
- [ ] The first paid pack on itch.io, priced low (you choose the amount; compare packs on itch.io and DriveThruRPG), plus a bundle price once there are three.
- [ ] Update policy stated (for example "free updates for fixes; new genres are new packs").

**Done when:** the sampler and one paid pack are live; three outside testers built decks from them; the licence and credits files are included.

### C.4 Discord community

**Set-up (You)**
- [ ] Server with: `#welcome-and-rules`, `#announcements`, `#help`, `#showcase`, `#feature-requests`, `#bug-reports` (pointing to GitHub Issues as the source of truth), `#template-sharing`, `#playtesting`.
- [ ] Roles: Owner, Moderator, Beta tester, and (optional) Supporter for Ko-fi tippers.
- [ ] Rules: respectful conduct, no pirated or copyrighted art, shared templates must state their licence, and the age minimum Discord requires.
- [ ] At least two moderators; AutoMod and a verification level on to keep spam out; a clear way to report a problem.
- [ ] A permanent invite link, added to the itch.io page, README, Ko-fi page and (if you approve it as a small change) the About dialog.

**Seeding and routine**
- [ ] Invite the beta testers (C.1) before the public launch so the server is not empty.
- [ ] Post a weekly short devlog (what changed, what is next) and a monthly roadmap note; run polls for feature priorities — including which cloud provider comes first (§15.16).
- [ ] Pin the FAQ; turn repeated questions into guide pages.
- [ ] Track four numbers monthly: members, weekly active members, help questions answered, and where new members came from.

**Done when:** the server is public with rules and two moderators, the beta testers are in, a support question was answered end-to-end through it, and the first devlog and a roadmap poll are posted.

### C.5 Pre-sell V2

**Gates (all true before opening sales)**
- [ ] C.2 is done and the free app is stable, so a buyer is paying for the future, not a broken present.
- [ ] The V2 scope is fixed in writing: §15 Cloud Storage Connections and §16–§21 (rich text, production PDF, manufacturer presets, SVG import, snapshot compare, command line), plus anything else you promise.
- [ ] The decisions in §15.15 (D1–D3) are made, and the licensing model is written into the PRD (what is free, what the key unlocks, trial, expiry). *Not yet drafted.*
- [ ] A **hard limit on the promise**: a delivery window you can honour, and a statement of what happens if you miss it.

**The offer (You decide the details)**
- [ ] One early-supporter key covering the whole V2 major version, at a founders' price that ends at the V2 release. State clearly: the free tier stays complete, and the key only unlocks the cloud features.
- [ ] A platform that can take payment, **contact buyers later** and refund them (itch.io, Ko-fi's shop, Patreon, or a licence-native seller). Check each platform's pre-sale and refund rules before choosing.
- [ ] A refund policy in plain words, including a full refund if V2 does not ship by the stated date.
- [ ] Tax and consumer-law check for digital pre-orders in your sales regions (EU withdrawal rights, VAT). A platform that acts as merchant of record handles tax; confirm what it does, and have it reviewed.
- [ ] Keep pre-sale money separate until delivery, so refunds are always possible.

**Validation — decide the numbers before you open sales (You)**

| Item | Your number |
|------|-------------|
| Costs V2 must cover: provider registrations, code signing, Apple Developer membership, licence/payment platform fees, domain | |
| **Go** threshold (for example "pre-sales cover those costs") | |
| **No-go** outcome (stay free; refund everyone; or ship only the cheaper providers first) | |
| Review date | |

**Communication**
- [ ] A V2 page section: what is included (summary of §15), what stays free forever, expected window, refund policy, the order of providers once voted.
- [ ] Announce on itch.io, Ko-fi and Discord; poll the community on provider order.
- [ ] Monthly progress posts; keep the buyers' list safe.
- [ ] Deliver: when V2 ships, buyers receive keys through the same platform; the key mechanism must exist and be tested before shipping (a dependency on the Licensing section above).

**Done when:** the go/no-go decision against your own thresholds is written down, and either V2 development proceeds on `Cardexy_V2` or the refunds are paid and the free app continues.

### C.6 Decisions the checklist needs from you

| # | Decision | Needed by |
|---|----------|-----------|
| L1 | Sign the builds (cost) or launch unsigned with instructions | C.1 |
| L2 | Source repository public or private | C.2 |
| L3 | Pack delivery — **decided**: template packages (§7.7); interim option A until built | C.3 |
| L4 | In-app links to Ko-fi and Discord in the About dialog (a small change that opens the browser; the app has no network code today and no nag screens are planned) | C.2/C.4 |
| L5 | Pre-sale price, delivery window, refund policy and your go/no-go numbers | C.5 |
| L6 | Licensing model (key terms, trial, expiry) written into the PRD — only cloud sync is gated (§15.19); section still to be drafted | C.5 |

---

*End of Document*

---

## 28. Fixes

> **Purpose.** The continuity log of defects found after a feature was specified or built: what the user saw, why it happened, what was changed, and how it is guarded against coming back. Every future fix is added here as the next row of §28.1 and, when it is large enough to need explaining, a short entry in §28.2. A fix that changes what the product is *required* to do also changes the section it affects, and the entry names that section. Decisions that were not defects stay in Appendix A.

### 28.1 Log

| ID | Date | Area | Symptom | Cause | Fix | Guarded by | Sections |
|----|------|------|---------|-------|-----|------------|----------|
| F1 | 2026-10-02 | Install | `npm install` succeeded but `npm run dev` stopped with "Electron uninstall" | Electron 42's package has no install hook, so the binary was never downloaded | The postinstall script runs Electron's own installer when the binary is missing (skipped in CI and with `--node-only`) | Clean install in a fresh folder (manual) | §4, §14.3, A46 |
| F2 | 2026-10-02 | Accessibility lint | Twelve Svelte accessibility warnings on every start, hiding real ones | The card table, tab lists, colour popup, preview and canvas scroller use the composite-widget patterns of §14.4, which the static checker cannot see | Each is suppressed with a comment saying why; a new warning is a real signal again | Svelte compile reports no warnings; `e2e/a11y` | §6.1, §14.4, A47 |
| F3 | 2026-10-02 | Portability | `portable.test.js` failed when run on Windows | The macOS branch of `portableRoot` resolved a POSIX path with the host system's rules, giving `C:\Users\…` | It resolves macOS paths with the POSIX rules, so every host gives the same answer | `unit/portable` | §4, §14.3 |
| F4 | 2026-10-02 | Canvas editor | When one element lies over another (text in front of an image), the selected front element could not be resized: dragging its corner did nothing or switched the selection to the element behind | The resize handles (the transformer) were added to the overlay before the per-element click areas, so every click area was drawn and hit-tested above them. A corner that lies inside another element's area, or the inner half of any corner, was hit by the click area instead of the handle | The resize handles are moved to the top of the overlay whenever an element is selected (and again after every redraw of the click areas) | `e2e/templateEditor` "resizing an element that overlaps another" (fails without the fix, passes with it) | §8.2 |
| F5 | 2026-10-02 | Packaging | The second packaged build opened, but creating a project failed with "Error invoking remote method 'projects:create'" and the log said the database module was built for Node module version 137 while this Electron needs 146 | The packaged app uses the build of better-sqlite3 that sits in `node_modules` when it is packed. `npm run dist` puts the Node build back there after packing (for the tests), and electron-builder's own rebuild step then believed the Electron build was still in place and skipped it, so the next package carried the Node build | The packaging step fetches the Electron build fresh every time and stops if it cannot; electron-builder's own rebuild is switched off; after packing, a check starts the packaged Electron binary and makes it load the packaged database module, and fails the build if it cannot | `scripts/verify-package.mjs`, run by `npm run dist` (proved able to fail: it reports the same version error when pointed at the Node build) | §4, §14.3 |
| F6 | 2026-10-02 | Canvas editor | View → Zoom In and Out did nothing; in the template canvas they only moved the rulers | Not investigated: the owner asked for the zoom controls to be removed | View → Zoom, the toolbar `−` `+` `Fit` and the percentage are removed; the canvas is always 100% | `e2e/layout` (no zoom controls; the zoom commands change nothing) | §8.1, §8.3, §12.2 |
| F7 | 2026-10-02 | Canvas editor | The grid was hard to see on some backgrounds | It was one grey line at low opacity, which disappears on mid-grey or busy art | Two tones, a dark line with a light one beside it, stronger every 50 units | `e2e/layout` (reads the pixels of the grid layer) | §8.3 |
| F8 | 2026-10-02 | Template editor | The panels wasted space and could not be arranged: a fixed template list, a separate layers panel beside the canvas | Fixed widths, and layers placed as a third column | The template list closes to a rail; layers moved into the lower half of the properties panel with a draggable divider; the project panel, template list, properties panel, split and card preview can all be resized, within limits, and are remembered | `unit/layout`, `e2e/layout`, `e2e/a11y` | §8.7.2, §12.5 |
| F9 | 2026-10-02 | Card size | Card size could be set in two places (a project default and the set), and sets and templates of different sizes could be mixed | The project default, the set override with "inherit", and a template with no size of its own | A card size for every set (chosen at creation, changeable with a warning) and for every template (chosen at creation, locked); only matching templates are listed or accepted; older projects are upgraded | `integration/cardSizeModel`, `e2e/cardSize`, `e2e/templates` | §5.2, §7.7, §10.6, §13.3 |
| F10 | 2026-10-02 | Templates | Two places for templates: Project → Manage Templates and the Template Editor | The library, packages and per-template actions were built as a separate window | Everything is done from the Template Editor; the Manage Templates window and menu entry are gone; the library opens from the editor | `e2e/templates` | §7.7.5, §12.2 |
| F11 | 2026-10-02 | Colours | A project palette that the owner did not want | A project-wide colour table with its own window, tokens and formula function | Removed, with everything that used it; colours are set on elements and per card (`color` fields); older projects have palette references replaced by colours | `integration/cardSizeModel`, `integration/render`, `unit/legacyPalette`, `e2e/grid` | §7.5, §13.3 |
| F12 | 2026-10-02 | Project panel | A Views list (Assets, Snapshots) repeated the tabs above the editor | Two ways to reach the same screens | The Views section is removed | `e2e/cardSize` | §12.1 |
| F13 | 2026-10-03 | TTS export | Loading the exported deck in Tabletop Simulator failed with "WWW Image Error: Cannot resolve destination host at [test_set_face.png]" | The JSON gave `FaceURL` and `BackURL` as bare file names; TTS reads them as web addresses | Full local file links by default (`file:///C:/…/test_set_face.png`), with a file-names mode kept; a remembered setting and a note in the export dialog | `unit/ttsLinks`, `integration/export`, `e2e/workflows` | §10.2, §10.2.1, §12.3 |
| F14 | 2026-10-05 | Templates | A starter template (Creature) opened with "The SVG source is not valid XML ... Extra content at the end of the document", and only the frame drew; the library showed two entries with no clear link | A child template was stored as a bare fragment (no root element), which only the renderer's merge understood; the list showed the link only as a small arrow | A child is a complete SVG document that carries its parent's size (older fragments are opened as one and saved that way, packages are wrapped on import); the template list is a tree, with the frame and its children under it | `integration/templateLibrary` (two tests) | §7.2, §7.7, §8 |

### 28.2 Entries

**F4. Resizing an element that overlaps another (2026-10-02).** *Reported:* "When two objects overlap (text in front of an image as an example) you cannot resize the object that is in front and selected. The corner dragging tool does not work."

*Why it happened.* The canvas editor draws the card as a picture and puts one transparent click area on top of it for every selectable element. The resize handles are a separate piece, created once when the editor opens, before any click area exists. Drawing order on the overlay is creation order, and the pointer goes to whatever is drawn last at that spot. So the click areas were all above the handles. For an element standing alone, the outer half of each corner handle sticks out past its own click area, so it still worked, which is why the problem went unnoticed. When another element lies under that corner, its click area covers the whole handle: the press lands on that element's click area, which selects it (or starts moving it), and the resize never starts.

*What changed.* Whenever an element is selected, the resize handles are moved to the top of the overlay, and that is repeated after every redraw of the click areas, because redrawing them adds new ones above. The click areas keep their order, so the element in front still wins a click on the card, and the handles now win a press on a corner. Nothing else about selection, moving or snapping changed.

*Checked by.* An end-to-end test puts a text box wholly inside a rectangle (so every corner of the text is over the rectangle), selects the text, drags its bottom-right corner and expects the saved width and height to change and the text to stay selected. It failed before the change and passes after it.

*Related, not changed.* Clicking on a spot where two elements overlap still selects the front one. To select the one behind, use the layers panel (§8.7.2).

*Where it is not yet covered.* The packaged desktop window has not been used to try this (§8.7 status).

**F5. Packaged app could not open projects (2026-10-02).** *Reported:* "error invoking remote method 'projects:create', using version 137".

*Why it happened.* A packaged Spadewick carries the database module (better-sqlite3) as a compiled file, and that file must be built for the Electron it ships with (module version 146 for Electron 42), not for the Node that runs the tests (version 137). Day to day `node_modules` holds the Node build, because the tests need it. The first package was made from a fresh install, where electron-builder rebuilt the module for Electron, and it worked. `npm run dist` then restored the Node build for the tests. On the next package electron-builder's rebuild step saw its own "already done" note, skipped the work, and packed the Node build. The window opened, because nothing touches the database until the first project is created, and then every project action failed.

*What changed.* `npm run dist` now fetches the Electron build of the module itself, every time and without relying on any earlier state, and stops the packaging if it cannot; electron-builder's rebuild is switched off so the two cannot disagree. After packing, `scripts/verify-package.mjs` starts the packaged Electron binary in its Node mode and makes it load the packaged module: a wrong build fails the `dist` run instead of reaching a user. The Node build is still restored afterwards for the tests.

*Checked by.* The verify step, which fails with the same message the user saw when pointed at the Node build, and passes on the corrected package. A project-creation check inside the packaged window by hand is still worth doing after any change to packaging.

*Affects.* Anyone packaging by running `electron-builder` directly instead of `npm run dist` skips the safeguard: use `npm run dist`.

**F6–F12. Second round of owner testing (2026-10-02).** The owner tested the first desktop build and reported seven things. Each is one row of §28.1; the decisions behind them are A54–A60. In short:

- **Zoom (F6)** was removed, not repaired, at the owner's request.
- **Grid (F7):** a single semi-transparent grey line cannot show on every colour. Detecting the background is fragile on a card that mixes light and dark, so the grid is drawn in two tones side by side; one of the two always contrasts.
- **Panels (F8):** the layers list is no longer a column of its own, because three columns left too little room for the canvas; it shares the right panel with the properties. Every boundary between panels can be moved, so the owner and later users can arrange the screen to their work (§12.5).
- **Card size (F9):** the old model let a template of one size be used in a set of another, and exports then letterboxed it. The size is now a property the template is born with and never loses, and sets only see templates that fit. When a set's size is changed the user is told first what will be let go (the default template and the cards' own templates of the old size); the cards' data is never touched.
- **One place for templates (F10)** and **no palette (F11)** and **no Views (F12)** remove duplicated or unwanted interface.

**Upgrading older projects.** Opening a project made before this change writes an automatic snapshot first, then: gives every set the size the project used to have; gives every template a size (from a set that uses it when its shape agrees, else the nearest preset, else the project's old size; a child template takes its parent's); replaces palette references by their colours. The user is told how many sets, templates and references were affected.

**Not part of this round.** The owner chose to keep the set code in the project panel (A60) and to leave the question of a template appearing empty in a second set for later. Neither is specified here.

**F13. Tabletop Simulator could not find the exported images (2026-10-03).** *Reported:* "When exporting for TTS, an issue pops up: WWW Image Error: Cannot resolve destination host at [test_set_face.png]."

*Why it happened.* In a TTS saved object, `FaceURL` and `BackURL` are addresses. TTS accepts a web address or a `file:///` path, and treats anything else as a web host name; `test_set_face.png` has no `http` or `file`, so TTS looked for a website of that name. The images were exported correctly next to the JSON; the JSON did not point at them. The earlier text of §10.2 said "filename path", which is what the code did.

*What changed.* The default is now a full local file link for each sheet and for the card back, written as the format of §10.2.1 describes, in the deck and in each contained card. The old behaviour stays as **File names only**. The export dialog has an **Image links** choice, remembers it, and explains that a local link works on this computer only. Putting the images inside the JSON is not possible in TTS, and hosting them is a separate, later feature (§22.4); until then, sharing is done from inside TTS (§10.2.4).

*Checked by.* Unit tests of the link format on each platform's path shape, integration tests that every link points at a file that exists, and an end-to-end test of the setting. Loading in TTS itself is a manual check (§10.2.5), because TTS is not available to the automated tests.

*Not covered.* Behaviour of TTS with unusual paths (spaces, accented letters, network drives) is not verified until the owner has tried it.

**F14. A starter template would not open, and two entries were unexplained (2026-10-05).** *Reported:* "When using one of the prebuilt templates, an error occurs: The SVG source is not valid XML ... For the Creature template only the frame part is working. In the Source it says Extra content at the end of the document." And: "why are there two template entries when importing it? Do they connect because there's an arrow? Can we make it a tree?"

*Why it happened.* The Creature design is built from a **shared frame** (the parent, "Creature frame", with a named slot) and the **card content** (the child, "Creature") that fills the slot. The child was stored as loose elements with no `<svg>` root, which the render merge accepts but a real XML reader and the canvas editor do not, so the editor refused it and drew only the parent. The two entries are that pair; the only sign of the link was a small arrow.

*What changed.* A child is now a complete SVG document with the size of its parent, in the starter, in packages when they are imported, and for children saved earlier (opened as a document, kept so when saved); the merge reads its fills from inside the root as before, so cards render the same. The template list is a **tree**: a frame with a "frame" tag, its children under it on a line with a "child" tag.

*Checked by.* Integration tests that the Creature child has one root and its parent's size, that the editor's own render of it equals the stored card, and that an old fragment is repaired and renders the same; an end-to-end test of the tree and the editor opening the child.

*Not covered.* Creating a child by hand in the editor (a frame and its slots are still written in the source; there is no screen for it).

### 28.3 Open questions

| # | Question | Why it matters |
|---|----------|----------------|
| Q1 | ~~Where do CMYK and spot-colour values live now that there is no palette?~~ **Decided (A70):** in a project list of print colours, matched to the design by screen colour (§17.5). | Closed. |
