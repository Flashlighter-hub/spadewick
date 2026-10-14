# Spadewick: updates after the PRD

The [PRD](PRD.md) is finished for 2.0 and is not changed for these. This file is where changes asked for after that are written down, one entry each, with what was asked, what it touches, and what is still open. When an entry is built it gets a status line and a note of the tests; a decision that changes the product is then also added to a new numbered row in a later edition of the PRD (the rows to add are listed at the end of this file).

Status: **open** (not started), **planned** (questions answered, ready to build), **built**, **deferred** (on purpose, for a later piece of work).

Found in testing of `Spadewick-2.0.0-dev.4-portable.exe`, 2026-10-06. **The latest build is `Spadewick-2.0.0-dev.15-portable.exe` (2026-10-08, Windows, unsigned, with the application icon; dev.11 is the same without the expanded guide; dev.12 adds the guide).** It holds everything below: the bugfix sprint (dev.10), the drawing helper (U13), the table, the display name, the identifier, the guide and the shared table. The numbers dev.5 to dev.9 were intermediate builds.

---

## Bugs: fixed in the bugfix sprint (dev.10)

Decided 2026-10-06 to leave these two for a sprint of their own; the sprint was dev.10.

### U1. After deleting sets, "New Set" cannot be typed in — built (dev.10)

**Built:** the browser's own `confirm()` and `alert()` are gone from the application. Every question (about 27: deleting a set, card, field, page, table, template, font, icon, preset, profile, snapshot; restoring; changing a card size; leaving a changed table or a template with unsaved changes; collecting the table; the offer to restore a damaged project) is the application's own dialog (`askConfirm` in `stores/prompt.js`, `ConfirmDialog.svelte`). It starts on Cancel, so a stray Enter does not delete; Escape answers no. The cause could not be repeated under automation, so this removes the suspected cause rather than fixing a seen one. **Tests:** e2e `confirmAndTemplateLists` (the dialog, axe, cancel, delete then type in New Set at once, Escape and Tab+Enter, and that no native dialog opens for a card, a field or a template); the test harness answers the application's dialogs like it answered the native ones, and records any native one (`native: true`).

_The original entry:_

**Seen:** after deleting the existing sets, *New Set* opens its dialog but no text can be edited and the template cannot be changed. Reloading the application fixes it.

**Likely cause (not yet confirmed):** deleting a set asks with the browser's own `confirm()`. In Electron that dialog is known to leave the window without keyboard focus until it is switched away from and back. Other places use the same `confirm()` (about 27 calls: deleting a field, a page, a table, a component; leaving a changed table; collecting a table; and more, found with a search for `confirm(` in `src/renderer`).

**Plan:** reproduce first (delete a set, then open New Set); then replace every `confirm()` with an in-app confirmation dialog (like the text prompt), so no native dialog is used at all. Add an end-to-end test that deletes a set and then types in New Set. Check the same sequence for every other place that confirms.

### U12. Tarot sets: the Template and Card back lists cannot be used — built (dev.10)

**Built:** (1) the lists are no longer looked up again each time they are focused (replacing the options of a list that is open can close it); they follow the project's change signal instead, so a template made, saved at another size or deleted shows at once. (2) With no template of the set's exact size, a note says so ("No template of this size (70 × 120 mm) yet, so the Template and Card back lists are empty…") and *Open the library* opens it. A template of another Tarot size (Tarot US) is not offered, as the PRD says (§10.6). The cause could not be repeated either, so if the lists still do not respond in the real window, tell me what is shown. **Tests:** e2e `confirmAndTemplateLists` (a Tarot set with no, another-size and a right-size template; choosing with the keyboard and with the pointer; the list following a template made meanwhile; axe).

_The original entry:_

**Seen:** in a set of Tarot size, the *Template* and *Card back* choices in the sidebar cannot be selected.

**To find out first:** is it the same as U1 (the window has lost keyboard focus after a native dialog), or does it come from the card size? The lists only offer templates of exactly the set's card size (70 × 120 mm for Tarot), so a Tarot set with no Tarot template would show only "none" and look unusable; a template made at another Tarot size (e.g. Tarot US, 2.75 × 4.75 in) would not be offered either.
**Plan:** reproduce with a new Tarot set (with and without a Tarot template, and after a reload), fix the cause, and in any case make the list say *why* it is empty ("No template of this size yet: make one or use one from the library") with a button to the library. E2E test for a Tarot set.

---

## Bugs: found in testing of dev.10

### U13. The application closed when a template from an imported SVG was shown with a card — built (dev.11)
**Seen:** importing `fantasy_rpg_teal_card_template.svg` worked (the template was made), but choosing the template in the Template Editor, with a set whose cards had text in the bound fields, closed the whole application with nothing in the log.

**Cause:** the drawing engine (resvg) is native code and **panics on some drawings; a panic stops the whole process** and leaves no log. Here: a group clipped to the card (rounded corners) that holds several drop-shadow groups, one of which runs off the left edge. The design's `effect_text` is a single line with no wrapping box, centred at the middle of the card, so a long text is about 2,000 units wide and starts at x = -657. The import's earlier guard (`dropOffCanvas`) only looks at the file at import time, so it could not see text that is laid out later. The same engine bug was met before with off-canvas layers (SVG import, A67); it has more forms than can be listed.

**Built:** drawing now happens in a **helper process** (`src/main/safeRaster.js`, `src/main/rasterWorker.js`, a third entry of the main bundle). If the helper dies, the application goes on and the drawing is tried again in plainer forms: **level 1** limits each filter to a region around the card (the shadows stay), **level 2** leaves filters out; only if both fail is there an error ("This design could not be drawn…"). The level a design needed is remembered by its `<defs>`, so a design is not sent to the crash again. Each stop is written to the log (`[raster]`). It is used for cards (`renderCard`: editor, previews, every export), the SVG import preview and the thumbnails of the person's templates; the built-in starters and library thumbnails are still drawn in the application (they are our own drawings).
- **Known limits:** a design that is drawn at level 1 or 2 is drawn without the exact shadows resvg would have given, and nothing says so in the window yet (`report.drawnPlainer` is set when a caller passes a report). A long text with no wrapping box still runs off the card: give it a text box (the text tool) or a shorter text; that is the design's, not a fault.
- **Tests:** integration `safeRaster` (8: an ordinary drawing, the helper surviving a crash and drawing the plainer form, the level remembered, an error and not a stopped program when nothing helps, a drawing resvg refuses, the two plainer forms, **the teal template with a long text rendered from a project**, and importing the teal design). Fixtures `tests/fixtures/svgImport/fantasy_teal.svg` and `tests/fixtures/rasterSafe/teal_bound_template.svg` (the template as the person saved it). Checked in a real Electron window on a copy of the project: the template shows, and all 18 cards render. `npm test`: the same 6 known failures. e2e `svgImport` and `templates` pass.
- **Packaged build checked (2026-10-08, dev.11):** the packaged `Spadewick.exe` (`dist/win-unpacked`, driven with Playwright) made a project, the teal template and a card with the long text; the log shows `[raster] … the drawing engine stopped … trying a plainer form`, the card rendered (about 92 KB of PNG) and the window stayed open. So the helper starts from inside the asar.

---

## Virtual table

All six were built together with the project change signal (U6), which they share. The table's state is still plain data and every move one action, so a host can send what it does to guests later (PRD §22.0); the signal and the new actions were made with that in mind.

### U2. Several dice, and "3d6" — built
Roll more than one die at once, and choose how many dice a roll uses (the owner's game rolls 3d6).
- A die token is now a **dice group**: 1 to 10 dice with the same sides (`MAX_DICE`). One press rolls them all, each from the same seed in order, so a table can still be replayed and a single die rolls exactly as before.
- **Decided:** each die is shown, with the total larger below (as proposed). **Drop the lowest or the highest die** is offered per group (menu: *Keep every die / Drop the lowest die / Drop the highest die*); the dropped die is struck through and left out of the total.
- Dice are put on the table with the *number of dice* and *sides* chosen in the bar (*Add dice*); the number and the sides of a token on the table can be changed from its menu.
- **Several dice together:** Shift- or Ctrl-click chooses more than one token; *Roll chosen* (or R) rolls the chosen dice as one step of undo.
- Saved tables from before still read: a die becomes a group of one with its value.
- **Code:** `shared/table.js` (`addToken`, `setToken`, `roll`, `diceTotal`, `droppedDie`), `TableToken.svelte`, `TableView.svelte`.
- **Tests:** unit `tableTokens` (groups, same seed gives the same dice, a single die rolls as before, drop, undo of several rolls, old tables read); e2e `tableTokens` (three d6 and their total, menu changes, Shift-choose and roll together).

### U3. Recolour dice and counters — built
Colour of the body and of the number/pips, for dice and counters (and picture tokens), chosen in the token's menu (*Colours…*) with the system's colour picker; kept with the table.
- **Decided:** the number's colour is chosen automatically to read on the body (dark on light, light on dark) unless one is picked; *Usual colour* and *Choose automatically* undo each.
- A colour that is not `#rrggbb` is refused; a damaged one in a saved file is dropped.
- **Code:** `shared/table.js` (`cleanColor`, `inkFor`, `tokenColors`), `TokenColorDialog.svelte`.
- **Tests:** unit `tableTokens` (colours, contrast choice, reset, refused values, saving); e2e `tableTokens` (the dialog with axe, the die recoloured, kept in the saved table).

### U4. Round tokens with an imported picture — built
A new kind of token: a circle showing a picture from the project's image library (*Add a picture token…*, which opens the usual image picker); it can carry a label and, optionally, a number like a counter.
- **Decided for the open questions:** three sizes, small, medium and large (chosen before adding, changed later from the menu); **not stackable** (it is a token, not a card); **two-sided: yes**, a second picture can be added from the menu, and *Turn over* or a double-click swaps them.
- The picture is drawn by the table image cache (`asset(id)`); a picture deleted from the library leaves a plain disc. The number (*Show a number*) has − and + under the token.
- **Code:** `shared/table.js` (token kind `token`: `asset`, `asset2`, `side`, `size`, `showNumber`), `lib/tableImages.js`, `TableToken.svelte`.
- **Tests:** unit `tableTokens` (kind, sizes, two sides, saving); e2e `tableTokens` (adding with a picture, size, number, second picture and turning over; a deleted picture).

### U5. Middle mouse button pans the table — built
Holding the middle button and dragging moves the table view like a sheet of paper; the system's autoscroll and the middle click's own action are stopped. Over a pile or a token the middle button also pans (it never drags them). The template editor canvas already did this.
- **Code:** `lib/middlePan.js` (a Svelte action; reusable), used on the table's area.
- **Tests:** unit `tableTokens` (the action on a stand-in element: press, move, release, other buttons, removal); e2e `tableTokens` (a real middle-button drag moves the table, and not a pile under the pointer).

### U6. The table updates itself when cards, templates or backs change — built
While a table is open, a change to a card's data, to a template, or to a card back shows on the table without pressing *Redraw pictures* (the button is kept).
- **The signal:** one event, `{ all: true }` or `{ cards: [ids] }`, from `core/changes.js`. It is raised by every undoable change (`recordChange`), by undo and redo, and explicitly by a set's own settings, fonts and a restored snapshot; changes in quick succession are joined into one event (40 ms). Rows that are never drawn on a card (rules, print colours, export profiles, ICC profiles) say nothing. The signal knows nothing of windows: `onProjectChange(fn)` subscribes; the application's `ipc/index.js` sends it to every window as `project:changed`, and the window passes it on as the event `spadewick:project-changed`. A host can subscribe in the same way and send it to its guests.
- **The table:** `{ cards }` draws only those cards again (their fronts and the backs that show their own data); `{ all }` draws everything again. Then it asks the project (`table:card-info`) for the name, ID and back of the cards concerned, and updates them in the session (`refreshSession`: the present and every state undo and redo can bring back; not a move, so it is not in the log). A card **deleted from the project is marked** ("removed from the project") and the mark goes when it comes back (project undo). A saved table is checked the same way when it is opened.
- A picture that was cleared was never asked for again until its card changed (the face did not depend on the cache); it does now (`epoch`).
- **Follow-up (dev.9):** the table now hears the change signal in its store, all the time, not in the view: the view is not on screen while a template is edited or a card is given another template in another tab, so a change made there was missed and the table showed old pictures until Redraw pictures was pressed. Tested by an end-to-end test (template edited, set template swapped, one card given a template, each while another tab is shown). Only a **saved** template change reaches the table (the editor keeps unsaved edits to itself).
- **Note:** the table's own Undo/Redo (the Edit menu while the table is shown) belongs to the table's moves; undoing a change of the project is done from another tab.
- **Code:** `core/changes.js`, `core/history.js`, `core/tables.js` (`cardInfo`), `ipc/index.js`, `preload`, `stores/projectChanges.js`, `lib/tableImages.js` (`invalidateCards`, `epoch`), `shared/table.js` (`refreshCards`, `refreshSession`), `TableView.svelte`, `TableCardFace.svelte`.
- **Tests:** integration `projectChanges` (what is said for an edit, a bulk edit, an import, a template, a field, a set, undo and redo, snapshot restore, the rules; joining; a failing listener; `card-info`); unit `tableTokens` (refreshing names, backs and marks, undo states, same state when nothing differs, the mark is not saved); e2e `tableTokens` (a renamed card is shown at once and drawn again, a changed template, a deleted card marked and unmarked, a saved table opened later). The e2e harness now forwards the signal to the page as the application does.

### U7. Optional turn order — built
An optional marker that shows whose turn it is: the active hand is highlighted (a mark and a border, and `aria-current`) and named in the bar; *Next turn* (button, or N) moves round the hands. **It restricts nothing**: any hand can still play at any time.
- **Decided for the open questions:** the direction can be **reversed** (a button); hands can be **named** (a small ✎ in each hand's header; empty means Hand 1, Hand 2…); the turn order, its direction and the names **persist in saved tables**. Old tables read as having no turn order.
- Actions (plain data, undoable): `turn`, `nextTurn`, `turnDirection`, `nameHand`. Fewer hands keeps the turn on a hand that exists.
- **Tests:** unit `tableTokens` (off by default, going round both ways, restricting nothing, refused seats, names, saving, undo); e2e `tableTokens` (start, N, a hand playing out of turn, reversing, undo, stopping, axe; naming a hand).

---

## Importing and the display name

### U8. Importing a set: every CSV column is a text field at once — built
On the import screen every column that matches no field starts as *Create new text field*; the person changes one only if wanted (a number field, an image, ignore…). A column that matches an existing field still maps to it; a column with no header stays ignored. A line under the heading says so.
- **Not changed:** the command line's `import` still ignores columns that match nothing (it has nobody to ask; PRD §21).
- **Code:** `DataIoDialog.svelte`. **Tests:** e2e `workflows` (the mapping of a CSV with an unmatched column starts as a new field and imports as one).

### U9. A unique identifier column, and updating every row that shares a value — built
Easily choose one column as the **unique identifier** of a set (*Manage Fields → Unique identifier*). **Optionally**, when a row is edited, every other row that shares its identifier is updated too (*Spread*, a column of the field table).
- **Decided for the open questions:** a match uses the **identifier column**; only the **edited column** is changed, in the rows whose identifier equals this row's; the identifier column itself never spreads. All of it is **one step of undo**. After the edit a message says how many other cards changed. The data service can also say beforehand what an edit would change (`cards:propagate-preview`); the window does not ask first, because Undo takes the whole change back.
- **What the identifier is used for:** the merge key of an import when the file has no card IDs and no key is chosen (the card ID of the file still comes first), and a wavy underline in the card table on identifiers that more than one card has. **It is not enforced as unique**: two cards can share one, and that is what *Spread* works on.
- Deleting or renaming (changing the token of) the field keeps the set's choice right; both are undone with it.
- **Code:** schema 13 (`sets.identifier_field`, `fields.propagate`), `core/cards.js` (`propagationTargets`, `propagateEdit`, `propagatePreview`), `core/sets.js`, `core/fields.js`, `core/dataio.js`, `FieldManager.svelte`, `CardDataEditor.svelte`.
- **Tests:** integration `displayName` (nothing until chosen and marked, spreading as one undo step, bulk edits, blank identifiers, the identifier column itself, rename and delete) and `dataio` (merge on the identifier); e2e `displayName` (the whole flow, the shared-identifier mark, axe in Manage Fields).

### U10. No built-in "Name" column; choose the display-name column (or none) — built
The set no longer has a fixed *Name* column. Each set says **which field is the display name** — or **none** (*Manage Fields → Display name*).
- **Decided for the open questions:**
  - A card with no display name is called by its **card ID** wherever a name is shown.
  - A project made before is **migrated** (schema 13): the old name of every card moves into a text field called *Name* (slug `name`, then `display_name`, `card_name`…, as the first column), chosen as the display name, so nothing changes visibly; the user is told on opening. An existing text field called `name` that holds the same words is used instead of adding one. A snapshot is taken first, as for every upgrade.
  - **`{{display_name}}` keeps working** in templates, formulas and conditions: it is the value of the chosen field.
- A set made in the window starts with a *Name* field, chosen as the display name. A set made through the services (`sets:create`) has none unless `nameField` is given.
- **How it is kept:** `cards.display_name` is no longer typed in; it is the value of the chosen field, kept in the column by database triggers (on insert, on a change of the card's data, and on a change of the set's choice), so lists, exports, snapshots and the command line read it as before and every way of writing a card (editing, import, undo, snapshot restore, the library) keeps it right. `displayName` in `cards:create`, `cards:update` and `cards:batch-update` is kept as a shortcut for "set the display field"; a CSV column called `display_name` fills the display field, or makes a *Name* field when the set has none.
- **Snapshots compare:** a change of a name is now a change of that field; against a snapshot from before it, a name change is still reported as a name.
- **Code:** `db.js` (schema 13, migration 13, triggers), `core/cards.js`, `core/sets.js`, `core/fields.js`, `core/dataio.js`, `core/snapshotCompare.js`, `snapshots/compare.js`, `templateLibrary.js` (sample cards bring their names), `CardDataEditor.svelte`, `FieldManager.svelte`, `Sidebar.svelte`.
- **Tests:** integration `displayName` (a set with and without a Name field, every way a card is written, choosing another field or none with undo, refusing a formula field, renaming and deleting the field, duplicating, `{{display_name}}` rendering, the migration of a version 12 project in both cases); `dataio`, `snapshotCompare`, `templateLibrary`, `setsFieldsCards`, `history`, `cardIds`, `richText` and `production` were brought to the new model; e2e `displayName`, `grid`, `journey`, `a11y` and the others.

---

## Help

### U11. A built-in guide to formulas — built
The *Help → User Guide* menu item opens a **Help tab** (also shown with no project open, with a *Close* button), with every formula function and operator, what each does, an example that can be copied and what it gives; five worked examples; and guides to template tokens, show-if and hide-if, fitting text, field types (including the display name and identifier), rich text, and the table's keys. A search finds entries in all of them.
- The list of functions comes from the formula language itself (`FORMULA_FUNCTIONS` and `FORMULA_OPERATORS` in `main/formula.js`; the evaluator and the guide share them), and the words are in `strings.js` under `help`. **A test fails when a function or operator has no help entry or an entry has no function,** and **every example is worked out by the real evaluator on a sample card** and must give exactly what the guide says (so an example that stops being true fails). The attributes named in the text guides are checked against the text engine's source.
- **Decided for the open question:** the first version has formulas and, as sections, the other six guides listed above.
- **Code:** `shared/help.js`, `HelpView.svelte`, `MainPanel.svelte`, the menu in `main/index.js`. **Tests:** unit `help`; e2e `displayName` (opening, searching, an example's code and result, copy, the sections, axe, with no project).

---

## A table shared between players (PRD §22.0)

Asked for 2026-10-06, built in six steps, in this order. **Decided:** the host sends the cards and their pictures; a guest does not need the project.

| Step | What | Status |
|------|------|--------|
| 1 | The conversation between a host and guests: host-authoritative actions, tested with players that talk in memory | **built** |
| 2 | Hidden hands (and hidden faces of cards lying face down) | **built** |
| 3 | The connection: WebRTC, by trading a connection code (copy and paste), on one network | **built** |
| 4 | The host sends the cards' names and pictures to guests | **built** |
| 5 | Reconnecting, seats that are kept for a guest who drops, the choice of seat | **built** |
| 6 | The table in the window: Share / Join, who is here, what a guest sees and does; the helper (STUN) for the internet | **built** |

### P1. The conversation (steps 1 and 2) — built
`shared/tableNet.js` is the whole conversation with no network in it: every function takes a message in and gives the messages to send out, so the real connection in step 3 only has to carry the same JSON. `tests/helpers/tableNet.js` is a stand-in network that passes the messages from hand to hand in order, the way a data channel does.
- **The host's table is the one that is right.** A guest sends the move it wants (`action`, or `batch` for several as one step, with a number of its own, `cid`); the host checks it, makes it, gives it its place in the order (`rev`) and tells everybody. The guest shows only what the host says. A guest that sees a gap in the order (a lost message) asks for the table again (`resync`); a message that comes twice is applied once.
- **What a guest may do is what a player at a real table may do.** Taking cards from a hand is the hand's own player only (a card can be passed to another hand); only the host collects the table or changes the number of seats; a player names their own hand; the turn order restricts nothing. Everything from another machine is checked before it reaches the table: the shape, the size (4,000 characters), the ids (a pile called `__proto__` is refused, and the table itself no longer trusts an id: it looks up own properties only), the number of tokens (200), and how fast a guest sends (30 a second, coming back with time).
- **Chance belongs to the host.** The seed of a shuffle or a roll is chosen by the host; the one the guest sent is thrown away, so nobody can try seeds until a roll suits them. Everybody sees the same dice and the same order of cards.
- **Hidden hands.** A guest's view (`viewFor`) shows its own hand; the other hands are a number of cards. **A card is a name only when it is face up on the table or in your own hand:** a card lying face down in a pile is only an id, and turning the pile over, or drawing the card into your hand, sends its name (to the player who may see it). A card played face down is known to nobody, the player who played it included. The host sees only their own hand too (`hostView`); a host can also run a table without playing (`hostSeat: null`).
- **How each guest is told:** the host works out, for each guest, what the guest's view would be after the move, and compares it with applying the same move to the view the guest already has. When they are the same only the move is sent (small); when they differ (the move touched what the guest may not see, or showed something new) the guest is sent its new view. Undo, redo and a refresh from the project are sent as views.
- **Undo for several players:** a player takes back their own latest move and puts back their own latest undone move, never somebody else's (the answer is `notYours`); the host can take back any. A guest whose hand goes when the host reduces the seats becomes a spectator and is told so.
- **Names from the project:** `host.refresh(info)` is the U6 refresh for a shared table.
- **Known limits:** a face-down pile shows its ids and its order to a guest who looks at the data (not the names): enough for the window to show backs and counts, not enough to tell what a card is. Ids are given in the order the deck was made, before it was shuffled, so a guest who knew the deck's order could read the shuffled order from them: harmless while a guest does not have the project; step 4 will re-number the cards of a guest's table if it matters. A spectator cannot take a seat later without leaving and joining again (step 5).
- **Tests:** unit `tableNet` (34: seats, hidden hands, face-down faces, who may take from which hand, what is refused, seeds, undo by player, a lost or doubled message, refresh, fewer hands, a host without a seat, and a **random game of 1,500 moves** by the host and three guests, some of them not allowed, in which after every move each guest's view equals what the host would show that player, no card is lost, and no name that a player may not see appears in any message sent to them or in their view).

### P2. The connection and the pictures (steps 3 and 4) — built
The conversation of P1 now runs over a real connection, and the host sends the cards and pictures: **a guest needs only this application, not the project and not its images.** All of it is plain code in `src/renderer/src/lib/`, ready for the window (step 6); nothing in the window uses it yet.
- **Connection codes (`rtcCode.js`):** an invitation (`SPW1-O-…`) made by the host for one guest and an answer (`SPW1-A-…`) given back; one line of letters and digits, about 1,000 to 2,000 characters, with a four-character check so a code damaged in copying is told apart from a wrong one. Pasted text is untrusted: it is refused for shape, size, wrong kind (an invitation where an answer was wanted), a damaged copy, and a description that is not a connection description or that would swell when unpacked; each refusal has a sentence (`shareLink.*`).
- **The connection (`rtcPeer.js`):** WebRTC with a data channel, no server of ours: `openInvitation` (host) and `answerInvitation` (guest) give a channel. On one network the two machines find each other by their own addresses; across the internet pass `iceServers: [{ urls: 'stun:…' }]` (off unless asked for). It gives up after 30 s. **Tested in a real browser** (Edge) with two pages that trade codes: it connects, plays, sends pictures and leaves.
- **The wire (`wire.js`):** a message too long for a channel is cut into numbered pieces and put together again (limits on pieces, size and half-made messages: what arrives is untrusted); it waits when the channel is full. Messages go in **lanes**: a moving, short message is never held up behind a long picture, and the messages of a lane keep their order.
- **The links (`tableLink.js`):** `createHostLink` (invite, accept, who is here, the host's own moves, kick, close) and `createGuestLink` (join, moves, undo, leave, pictures). A guest says who it is when the channel opens; nothing else from a channel that has not is heard.
- **Cards and pictures from the host (step 4):**
  - A guest's view names a card by its place on the table (`c12`), never by its id in the project; a card face down in a pile is only `{ hidden, w, h, back }` (enough to draw the back); a card in another hand is not there at all.
  - A guest asks for a picture by that place. The host checks it (`authorizePicture`): **the face of a card is for a player who may see it** (face up, or in their own hand), a back for any card on the table, and a library image only for a token on the table that shows it. Anything else is refused and nothing is drawn.
  - The host draws with the project's own renderer (`tableLinkApp.js`: the same pictures its own table shows) and the new `table:asset-picture` service (a library image as a PNG of at most 600 pixels, never the file). Pictures are remembered by the host for all guests (300 at most; one that could not be made is tried again), and by a guest once (cards with the same back share one picture). Pictures are PNG, JPEG or WebP only and checked on arrival (a guest never shows a vector image or text from a host).
  - A guest may ask for 40 pictures a second.
  - A change in the project (`host.refresh`, U6) tells the guests to forget their pictures and ask again.
- **Tests:** unit `tableLink` (28: codes, the wire, joining, moves, leaving and breaking, pictures with every refusal, big pictures that do not hold up moves, redraw, the refresh, the rate, and a check that nothing a guest was sent names a card they may not see), integration `tableAssetPicture`, and e2e `tableShare` (7, in a real browser over a real connection). The tests of the conversation were brought to the new view of face-down cards.
- **Done after this (P3):** reconnecting, and the window.

### P3. Coming back, and the window (steps 5 and 6) — built
- **Coming back (step 5).** A guest keeps a **ticket** (a secret for the game, made when they first join) and says it when the channel opens. When a guest's connection breaks without a goodbye, the host **keeps their seat** (shown as *away*, and no other guest is given it, not even by the table growing a hand); they trade codes again with the same ticket and have the seat, their hand and their name back. A guest who says goodbye (*Leave the table*), or is sent away, gives the seat up at once; the host can *Free the seat* of one who is away. A guest who comes again while the old connection is still there replaces it. A guest can also **choose another free seat, or go to watch** (`takeSeat`); fewer hands let go of the seats kept beyond them. A goodbye is now sent before the channel is closed (it was lost before).
- **The window (step 6).**
  - **Share… (host).** From a table that is open (the history is kept): your name, whether to use the public helper to connect across the internet (off by default; the address of the helper is yours to change), *Start sharing*. Then *New invitation* gives a code to copy; the player's answer is pasted back and *Connect* connects. The list shows who is at the table, who is *away* (*Free the seat*), and *Send away*. *Stop sharing* lets everybody go, and the table goes on as the host's own, every hand as it is.
  - **Join… (guest),** from the table's bar or from the welcome screen (**no project needed**): paste the invitation, *Make an answer*, give it to the host. The table appears (the Table tab, or the whole window when there is no project), the pictures come from the host. If the connection is lost a bar says so, with *Connect again…*, which keeps the seat.
  - **What each player sees:** the host sees their own hand and the others as a number of cards (drawn as card backs); a guest sees the same of theirs. Names, pictures, undo and the turn order work as at a table alone; undo takes back your own latest move. Hidden: the cards of a face-down deck are not known, so *Look through* is off for such a pile. Not offered to a guest: new and open tables, saving, collecting every card, changing the number of hands.
  - **Saving:** the host saves the whole table (every hand), not what one player sees of it.
  - **Not offered:** a QR picture of a code; asking the host for a seat at an arbitrary time from the window (the service exists: `takeSeat`); a spectator's own screen (a spectator sees all hands as counts).
- **Tests:** unit `tableNet` (+6 for tickets and seats), `tableLink` (+3 for coming back); e2e `tableShareUi` (8: two windows of the application, one with no project, trade codes over a real WebRTC connection; each sees only their own hand and the host's names are nowhere in the guest's window; the pictures come from the host and the guest draws nothing itself; moves go through the host; what a guest may not do is not offered; a change in the project reaches the guest; leaving and stopping; a window that goes away leaves its seat kept and shown as away). The harness can open a second window as a player with no project (`app.newGuestPage()`).
- **Still to look at in a real situation (see the checklist):** two computers, on one network and across the internet with the helper; a connection that really breaks (a cable, sleep) and comes back.

---

## Built since

### B1. Built-in components and icons — built (dev.5; in dev.11)
- **12 built-in components** in the component library from the first start (read-only; "Save changes to library" on one makes a component of the person's own): round digit slots (gem, ring, glow), square digit slots (plate, cut-corner, outline), name banners (ribbon, plate, scroll) and text field blocks (parchment, dark panel, framed). They show `{{cost}}`, `{{power}}`, `{{toughness}}`, `{{name}}` and `{{rules}}`; text shrinks to fit and is centred in the digit slots and banners. Code: `src/main/componentStarters.js`, `src/main/core/components.js`; the dialog marks them "built in" and disables Rename and Delete.
- **13 new built-in icons** for rich text (`{bolt}`, `{icon:crown}`…): basic (bolt, drop, plus, check, coin, sword) and fantasy (crown, skull, gem, moon, potion, tower, wand), in `src/shared/starterIcons.js` next to the original twelve.
- Tests: integration `components` (built-in list, locked, saving over one), e2e `components` (dialog and inserting one).

### B2. The table, the display name, the identifier and the guide — built (in dev.11)
U2 to U11 above, in the order they were built: the data model for sets first (U10, U9, U8: one schema change, **version 13**), the project change signal and the table (U6, U5, U2, U3, U4, U7), then the guide (U11).
- **Schema 13:** `sets.display_field`, `sets.identifier_field`, `fields.propagate`, and the three triggers. A project of version 13 cannot be opened by an earlier build (the usual refusal, PRD §24.2).
- **State of the tests (Windows 11, Node 24):** `npm test`: 1,193 pass; the 6 that fail were failing before this work, for reasons of the machine, not of the code (five PDF checks need `pdftoppm` from poppler, one needs the temporary folder to be removable). `npm run test:e2e` (run with Microsoft Edge as `CHROMIUM_PATH`): 344 pass; the one file that reports a failure (`workflows`) fails only when its temporary folder cannot be removed at the end (the same Windows reason).
- **Side effects worth knowing:** the tests of the older model were brought to the new one (a name given to a card in the test helper is now a field called `card_name`, which is the display field); the toolbar of the table gained groups and keeps its height when a table is changed; the ID cell no longer loses contrast when selected.

---

### B3. The guide grows into a manual — built (2026-10-08; in dev.12)
The Help tab (U11) is now the application's manual, not only a formula reference. **22 topics in 6 groups** (the list on the left has group headings): *Getting started* (Quick start, The window), *Building a game* (Projects, sets and snapshots; Card data; Images and fonts; Templates; The canvas editor), *Writing and formulas* (Formulas; Tokens in templates; Show-if and hide-if; Fitting text; Field types; Rich text; Icons, styles and checks), *Output* (Exporting; Printing and manufacturers), *Playing and rules* (The virtual table; The table's keys; Rules pages) and *More* (The command line; Troubleshooting; Words used here).
- **Formulas** gained a "Writing formulas" part (how to write one, naming fields, quotes, nesting, what a formula gives, choosing with if, comparing, circles, errors, where formulas are used) and six more worked examples (three levels, a colour from a number, a short title, a percentage, a label from two fields, a sum). The 24 functions and 7 operators are unchanged and still come from the evaluator.
- **The menu item** is now *Help → User Guide*. The guide opens on the Quick start; search still looks in every topic.
- **Code:** the words are in `strings.js` under `help`; `shared/help.js` lists the groups, topics and entries (`HELP_GROUPS`, `HELP_ITEMS`); `HelpView.svelte` shows the grouped list. **Tests:** unit `help` (every entry has its words, every example is worked out by the evaluator, every `data-spadewick-` attribute named in the guide exists in the code, every group and topic is complete, the shortcuts named are wired); e2e `displayName` (the guide opens on the Quick start, 22 topics with no project, axe).
- **Checked by reading, not by running the feature:** the descriptions of the window, exports, printing and the table were written from the PRD, the strings and the code; a look through them against the real window is part of the hands-on pass.

---

### U14. A CSV that breaks the CSV rules is reported, not read silently — built (2026-10-08; in dev.13)
**Seen:** a skills file of 18 cards imported 8 (then 1 after a part-fix). Its text had inner quote marks that were not written as two quotes (`"Level 1 - "On a hit..."`) and two fields ended in `.""`. A stray quote ends a quoted field early; a doubled closing quote keeps it open; either way the rows after it run into one field and are lost, and a second file of the same project lost one card without a word.

**Built:** the CSV reader still reads such a file exactly as before (`parseCsv` is unchanged for its callers), but `parseCsvDetailed` also says where the file breaks the rules, by line of the file: **a quote that closes a field and is followed by more text; a quote that opens in the middle of a field; a quoted field that is never closed; a row with more or fewer columns than the header** (empty cells past the header, a trailing comma, a blank line, a BOM and CRLF are fine). One quote problem is named per row, not one for each quote that follows it.
- **The import dialog** shows a warning (an alert) above the validation report: how many problems, how many rows could be read, a table of *Line* and *Problem* in words (with how to write a quote inside a field), and a checkbox, *I have seen these problems: import what was read anyway*. **Import stays disabled until it is ticked.** A clean file or a JSON file shows nothing.
- **The command line:** `import` writes nothing from such a file, prints the lines and exits 1; `--ignore-file-problems` imports what was read (with a warning); `--dry-run` reports the problems and goes on; `watch --reimport` fails that run with the first line. `--json` carries `fileProblems`.
- **Code:** `src/main/csv.js`, `core/dataio.js` (`parseFile`, `readFile`, `readDataFile` give `issues`), `DataIoDialog.svelte`, `src/cli/commands.js`, `args.js`, strings `dataIoDialog.issue.*`, a Troubleshooting entry in the guide. **Tests:** unit `csv` (11 for the issues), integration `dataio`, `cliWrite`, e2e `workflows` (the warning, the disabled button, axe, a clean file).
- **Not done:** the importer does not repair the file; JSON files have no such problems to report.

---

### U15. Reorder the sets in the left panel — built (2026-10-08; in dev.13)
The sets in the sidebar can be dragged into a new order, and the order is kept with the project (it is the order of the list everywhere sets are shown, and the existing `sets:reorder` service writes it).
- **Dragging:** pick a set up and drop it above or below another; a line shows where it will land, the set being dragged is dimmed, and the set that is open stays open. A drag that changes nothing writes nothing.
- **Keyboard:** Alt+Up and Alt+Down on a set move it one place; the focus stays on it and a screen reader is told "Green moved to position 1 of 3". A set that cannot go further does nothing.
- **Not undoable,** like the order of columns (it is a view of the project, not an edit of cards). If saving the order fails the list goes back and says so.
- **Code:** `Sidebar.svelte` (`putSets`, `setDragStart`, `setDragOver`, `setDrop`, `setKeydown`), `reorderIds` from `lib/grid.js`, strings `sidebar.dragToReorderSets`, `setMoved`, `reorderFailed`, and a sentence in the guide (Projects, sets and snapshots; The window). **Tests:** e2e `setOrder` (drag to the top and to the bottom, nothing left marked, a no-op drag, kept after reopening, Alt+Up/Down with focus and announcement, axe, the open set stays open); integration `setsFieldsCards` already covers the service.

---

### U16. The Pelt & Plunder templates sized for Spadewick, and an SVG sizing guide in Help — built (2026-10-09; the guide is in dev.14)
**Found:** the 31 SVGs in `Pelt and Plunder V0.2.2/templates` were drawn at 300 dpi with 3.175 mm (37.5 px) of bleed (tarot 902 × 1492, poker 825 × 1125) but gave their size as plain pixels. Spadewick reads plain pixels as 96 to the inch, so a tarot card looked like 239 × 395 mm, the shape check failed (letterbox bars) and a bleed of 3.175 mm cut off 12 units, not 37.5.
**Done to the files:** the root `width` and `height` are now the printed size in millimetres, trim plus bleed (tarot **76.35 × 126.35 mm**, poker **69.85 × 95.25 mm**); the `viewBox` and every drawn element are untouched. 30 card files changed (tarot 5, poker 3, backs 4, previews 18); `previews/rune_sheet.svg` is not a card and was left. A backup of the folder is `_archive/pelt_plunder_templates_v0.2.3_before_mm_sizes.zip`, `tools/gen.py` and `gen2.py` write the same sizes, and the folder's README has a Spadewick sizing section. **Checked with Spadewick's own importer** (bleed of 3.175 mm entered): every file reads as 70 × 120 or 63.5 × 88.9 mm, proposes Tarot or Poker, and the shape matches; five imported and drawn cards (tarot creature and hunter, poker skill, both kinds of back) come out at the card's shape with no transparent bars.
**Built in the application:** a Help topic **SVG sizing guide** (13 entries: the one rule, a table of every card size in mm and in pixels at 300 dpi with and without bleed, saying the size in mm with an example header, the no-bleed way, files with bleed, the safe area, square corners, a design of the wrong shape, picture resolution, Figma/Illustrator/Inkscape/Affinity, a check after import, and a checklist). The import dialog's bleed help no longer says bleed in exports is not built.
**Not changed:** the import still removes the bleed (the print export carries the edge outward), so art drawn into the bleed is not kept; keeping it as an "included" bleed on import would be a feature of its own.

---

### U17. Handles and positions shifted in a template whose view box does not start at 0 0 — fixed (2026-10-09; not in an exe yet)
**Seen:** after importing the Pelt & Plunder skill card, the box of a text (and every handle) was drawn to the lower right of the words it belongs to, so a text set to Wrap or Shrink did not seem to sit in its box, and the X and Y in the properties were 37.5 too large.
**Cause:** the canvas measured positions in the drawing's own units. A design imported with its bleed taken off has a view box that starts at 37.5 37.5 (also any design whose artboard does not start at 0 0), so everything was measured 37.5 units from where the card shows it. Drags were not affected (they move by differences), but the handles, the hit areas, the X and Y and the snapping to the card's edges were.
**Fixed:** `CanvasEditor.svelte` measures in card units (the view box's origin is taken off). **Test:** e2e `canvasViewBox` (a view box of 37.5 37.5 750 1050 and a group moved by 37.5: the handles are on the element, X and Y read 100 and 100; it failed with 137.5 before). The other canvas, layout, template and import e2e files still pass.
**Also found, not a fault in Spadewick:** the Pelt & Plunder templates mark their wrapped text with their own attributes (`data-wrap-width`, `data-line-height`, `data-max-lines`) and a `tspan` around the token. Spadewick reads only its own text box and fit (a width, a height, `data-spadewick-field` and `data-spadewick-text-fit`), so an imported text keeps its token but is drawn on one line from its baseline until it is given a Fit. A new entry in the SVG sizing guide (*Text that should wrap or shrink*) says what to write.

---

### U18. A design that links to pictures outside its own folder imported as a flat grey card — fixed (2026-10-10; in dev.15)
**Seen:** the Pelt & Plunder "no text" templates (and the backs) imported purely white or grey. Each links to two full-card textures in `templates/textures/` (`../../textures/back_texture_*.png`, `front_overlay_*.png`) from a folder two levels down.
**Cause:** an imported design may only link to pictures next to it or below its folder, on purpose (a design from elsewhere must not read your disk; a test keeps `../a.png` out). The two textures were not found, so each was left as a grey box the size of the card, covering the art. The dialog said "not found" with a *Locate…* button, once per picture, and not again for the next design.
**Fixed:** *Locate…* now also points Spadewick at the picture's **folder**: the other pictures of that folder are found by name, and the folder is remembered for the designs that follow (until Spadewick is closed). A design is still never allowed to reach other folders by itself. A note in the dialog says so. Checked with the real Pelt files: with the `textures` folder pointed at, all four kinds import with their textures and draw as the dark textured cards they are.
**Code:** `svgImport/clean.js` (`searchedIn`), `analyze.js`, `core/svgImport.js`, `SvgImportDialog.svelte` (`searchDirs`, remembered across designs). **Tests:** integration `svgImport` (only the folders pointed at, by name, nonsense ignored, both pictures from one folder, no grey box left). A Help entry in the SVG sizing guide: *Pictures a design links to*.

### U19. The canvas is locked to the card, and elements may spill past it — built (2026-10-10; in dev.15)
Asked for: the template's size is locked after it is chosen (never larger or smaller), and objects may spill outside the template, keep their form, and be made larger or smaller without changing the template's size.
- **The lock (data service):** a template's canvas (the root's `viewBox`, `width` and `height`) cannot be changed by a save: `templates:update` refuses it ("This template's canvas is 500 × 700 units and is locked to the card…") and writes nothing. Everything inside the canvas, and elements far outside it, save as before. The card size was already locked at creation. Not covered by the lock, on purpose: the deliberate **Bleed…** action, import and re-import, and the library and packages (they make or replace a template, they do not edit one). A bare child fragment and a template with no view box are left alone.
- **The lock (editor):** the source dialog says so when the view box, width or height is edited, and Save stays off until it is put back (a refused save also says why).
- **The pasteboard:** the canvas editor now reaches 35 % of the card's longer side past the card on every side. The picture is drawn over that area too (the card's view box is widened for the screen picture only), what lies outside the card is dimmed and the card's edge is outlined, and elements there can be selected (also by the marquee and the Layers panel), dragged and resized by handles or by typing in the properties. The scrolling area has room for it, and the first view is centred on the card. Only the card is in the exports. **Not changed:** the grid, trim, safe and bleed guides stay on the card; the rulers measure the card.
- **Side effects:** the Konva canvases of the editor are now larger than the card (the card is `.stage-host`); the tests that took the last canvas for the card now use the host (`workflows`, `templateEditor`, `canvasPaint`, `layout`). A library test that replaced a template with one of another size now keeps the canvas.
- **Code:** `shared/templateCanvas.js`, `core/templates.js` (`update`), `CanvasEditor.svelte` (`pad`, `applySize`, `withPasteboard`, `drawVeil`), `TemplateEditor.svelte`. **Tests:** unit `templateCanvas`; integration `templateCanvasLock`; e2e `canvasPasteboard` (the picture outside the card, taking hold of, moving and resizing a spilling element and one wholly outside, the size unchanged, the source dialog's refusal) and the existing canvas suites.
- **Not built:** keeping art drawn into the bleed of an imported design (the import still takes the bleed off); a user setting for the width of the pasteboard.

---

### U20. Every element of an imported design is a layer, and every layer can be resized and recoloured — built (2026-10-10; in dev.15)
**Asked for:** an imported SVG keeps as many objects as possible as layers, each editable (size, colour…), "as if it were a full SVG editor"; some trims could not be resized.
**Found:** the import gave ids (the thing that makes an element a layer) only to the *direct children of the root*. The Pelt & Plunder files put all their art in one `<g id="trim">`, so the design had a single layer, the group, and the group could not be resized (a group, a path, a line, a polygon had no way to be resized at all, only moved).
**Built:**
- **Import:** every element at every depth is a layer (not definitions such as gradients, clip paths and filters, and not the pieces of a text), named after the design's own name or, for a tool's own names such as `path1234`, by its kind (`path`, `path_2`); a design keeps its first 2,000 layers and says so. The real Pelt cards went from a handful of layers to 58–208 each (every one of their elements).
- **Templates made before:** *Template → Make every element a layer* does the same to the open template, as one step of undo, and says how many it made.
- **Resizing:** groups, paths, polygons, polylines, lines and the like have all eight handles, and W and H in the properties. They have no size of their own, so the resize is written as one `matrix` transform (computed from the element's place on the card and its parent's, so it is right inside moved or scaled groups); the path data is not rewritten. A rotated element still cannot be resized.
- **Colours:** Fill and Stroke (colour, width) on a group pass on to every shape in it that sets that attribute itself, so a whole trim can be recoloured at once; shapes with none stay as they are. A single path, line or shape takes its own.
- **Clicking:** a group that holds layers does not take clicks on its own empty area (its layers are on top and take theirs); it is selected from the Layers panel and then can be moved and resized with handles.
- **Also fixed on the way:** a menu command sent to the canvas (zoom, grid…) is remembered by the store and ran again when the editor next opened; the editor now ignores commands sent before it opened. A resize or a move that changes nothing no longer writes `translate(0 0)`. The card is kept centred in the view until the person zooms or scrolls.
- **Code:** `svgImport/build.js`, `lib/docEdit.js` (`layerize`), `CanvasEditor.svelte` (`measure`, `anchorsFor`, `geometryApplied`, `paintTargets`, `syncContainerHits`), `TemplateEditor.svelte`, `LayersPanel.svelte`. **Tests:** unit `docEdit` (3), integration `svgImport` (2: nested layers, the limit), e2e `canvasLayers` (7: Make every element a layer and its undo, clicking a shape in a group, resizing a path by typing and by a handle, resizing a group and a line, recolouring a path and a group, outline colour). Help: two new entries in *The canvas editor*.
- **Not built:** merging or splitting paths, point editing, boolean operations, a style that follows a CSS class of the design (styles are inlined on import), and resizing a rotated element.

---

### U21. Thirty built-in icon components — built (2026-10-10; not in an exe yet)
Asked for: 20 to 30 fully drawn fantasy, science fiction and marker icons that can be used inline and as components on a card, added to the components section (and not shared with anyone: they are in the application's own built-in list, not in a project's icon library).
- **The icons (30, all original):** *fantasy* — sword, shield, potion, crown, skull, spellbook, key, magic wand, rune stone, flame; *science fiction* — rocket, planet, atom, robot head, energy cell, blaster, targeting reticle, cog, circuit chip, DNA helix; *markers* — heart, lightning bolt, hourglass, flag, coin, eye, padlock, star badge, warning, location pin. A picture of all of them is `docs/built-in-icons.png`.
- **How they are made:** each is a 64 × 64 drawing of two to eleven **named parts** (a blade, a fuller, a guard, a grip, a pommel…), with a dark outline, a two-tone gradient fill and one highlight, so a card can mix them. Each part has its own `data-spadewick-id`, so after placing one the panel lists the parts and each can be recoloured, and each is a layer that can be moved and resized (a group of layers: every layer is selectable and resizable, see U20). They show no card data (`fields` is empty), scale from a badge to the height of a line of text, and have unique gradient names that are renamed when two are placed.
- **Where:** `src/main/componentIcons.js` (the drawings and the helpers: star, cog, gradients), added to `componentStarters.js` as numbers 13 to 42; they are read-only like the other built-in components (cannot be renamed or deleted; saving over one makes a component of the person's own). The library dialog finds them by name (`sword`, `rocket`…) and shows 42 built-in tiles.
- **Tests:** integration `components` (42 built in, 30 icons named and in three kinds of ten, no fields, every part named and different, every gradient defined, read only); e2e `components` (42 tiles, find `sword` and put it in a template: its parts are named). The Help entry for components says forty-two come built in.
- **Not built:** these are components (placed with the Components button). They are not added to the rich-text icon library (`{icon:name}` inside card text, which is one colour and follows the text); say if some should be, and which.

---

## Order proposed

1. ~~U1 and U12~~ deferred to a bugfix sprint.
2. ~~U8, U10 and U9~~ built.
3. ~~U6, U5, U2, U3, U4, U7~~ built.
4. ~~U11~~ built.

Done: the bugfix sprint (U1, U12, dev.10), U13 (the drawing helper), and the build of `2.0.0-dev.11` (2026-10-08).

**State of dev.11 (2026-10-08):** `npm test` 1,278 of 1,284 pass (the same 6 environment failures); `npm run test:e2e` 365 of 365 tests pass (`workflows` reports only the temp-folder cleanup EPERM); the packaged exe was started and the teal template drawn (U13 above); the exe carries the application icon (`build/icon.svg`, `build/make-icon.mjs`, `win.icon` in `electron-builder.yml`); it is **not signed** (decided: no signing yet).

**Left before a release (all need a person, other hardware or an account):** the hands-on list below; the shared table on two computers; Tabletop Simulator loading an export; a printed PDF; a commercial preflight tool; the GitHub workflow of phase 0.5 (never run); a new PRD edition with the seven rows below and a rewritten Appendix C (Windows only, offline); `THIRD-PARTY-NOTICES`, a privacy statement and ECI's redistribution confirmation; the trademark check; the beta (3–5 designers, about 2 weeks).

## To add to the master checklist (manual, in the real window)

**Shared table, on two computers:** Share… on one, Join… on the other (also from the welcome screen with no project open); the codes by message; each sees only their own hand; cards and pictures arrive; draw, play, flip, dice; names change in the project and show on the guest's table; put the guest's computer to sleep or unplug it, then *Connect again…* and have the seat back; the same across the internet with the helper switched on (and say what happens on a network that blocks it).

The automated tests cover these in Chromium; a look in the packaged window is still owed (native menus and dialogs are not in them):
- Help → *User Guide* opens the Help tab, with and without a project; a search; Copy puts an example on the clipboard.
- A new set has a *Name* column; Manage Fields: Display name, Unique identifier and Spread; an edit of a Spread column changes the cards with the same identifier and Undo takes it back.
- Open a project from dev.4: it says that the names moved into a *Name* field, and looks the same.
- Import: columns that match nothing start as new text fields.
- Table: 3d6; drop the lowest; Shift-click two dice and *Roll chosen*; Colours…; a picture token (two sizes, a second picture, turn over, number); the middle button over the felt and over a pile; Start turns, N, reverse, naming a hand; change a card's name and its template with the table open; delete a card and undo (from another tab); save a table, delete a card, open the table.

## Rows to add to the next edition of the PRD

(Shared table, steps 1 and 2: the host's table is the one that is right and the host chooses every seed; a hand is seen only by its own player and a card's name only when it is face up or in your hand; a player can take back only their own latest move; the table does not trust ids from another machine. §22.0.)

The decisions that change the product, each to become a numbered row (Appendix A) when the PRD gets its next edition:
1. A card has no built-in name; a set names the field that is its display name, or none; `{{display_name}}` is that field's value; a card without one is called by its ID. (U10; §5, §6, §13)
2. A set may name a unique identifier column; it is the merge key of an import without card IDs; a field may be marked to spread its edits to the cards that share the identifier, as one step of undo. (U9; §5, §6)
3. Importing starts with every unmatched column as a new text field. (U8; §5.5)
4. The project has one change signal naming what changed (all, or cards), joined in quick succession; the table and later a host's guests follow it. (U6; §7.9, §22.0)
5. The table has groups of dice with an optional drop of the lowest or highest, token and counter colours, round picture tokens (three sizes, two-sided, optional number), the middle-button pan, and an optional turn order that restricts nothing. (U2 to U5, U7; §7.9)
6. The Help tab holds a guide that is built from, and tested against, the formula language and the text engine. (U11; §12)
7. Schema version 13. (§13, §24.2)

---

### U28. Fonts that come with Spadewick, and their licences — built (2026-10-10; in dev.17)
55 open-licence families (SIL Open Font License or Apache 2.0, 101 files, about 43 MB) are bundled in `resources/fonts/extra/`, each with its licence file, listed in `manifest.json`; they work in every project by family name and show in the font pickers and Manage Fonts. `THIRD-PARTY-NOTICES.md` (installed with the application) lists each family, licence and copyright holder. Tool scripts: `scripts/fetch-fonts.mjs`, `scripts/make-font-notices.mjs`. Test: `tests/integration/bundledFonts.test.js`. Bold of a variable-font family may be synthesized.

---

### U29. A card's own version of its template — built (2026-10-11; not in an exe yet)
Asked for: each card that uses a template has an invisible instance of it, which can be edited for that card (art, custom text), the template staying one.
- **What is kept:** not a copy of the template but a small patch of it (`cards.instance_json`, schema 15): attributes changed, the words of a text element, elements removed, elements added (with where). Elements are found by their `data-spadewick-id` or `id`, or for an element with neither by its place in the template. A change to the template reaches the card in everything the card did not change itself. Patches are limited in size and refuse scripts and event handlers.
- **Where:** select a card in the card table, then Edit this card's template… (under the preview, in the toolbar, or the right-click menu). The canvas editor opens on the template's source with this card's changes, drawn with this card's data; Save keeps the difference only; *Back to the template* clears it. Undo covers both. Duplicate copies the changes.
- **Drawing:** every drawing of the card (preview, exports, table, text check, preflight) applies the patch to the template's text before the card's data is put in; the editors' own drawings of a chosen source do not. The back of the card is not affected.
- **Code:** `src/main/instance.js` (diff, apply), `core/instances.js`, `ipc/instances.js`, `render.js`, `InstanceEditorDialog.svelte`, `CanvasEditor` (`cardId`, `lockCard`). **Tests:** unit `instance` (10), integration `instances` (6). Help: *A card's own version of its template*.
- **Limits:** an element of a *child* template that has no id is found by its place in the child's own text, which differs from the merged template (give such elements ids in the template editor); the canvas editor's own Undo is not used inside this dialog: Cancel discards what was done there; big pictures added to one card are kept inside its patch (limit about 400 KB), so use an image field and the library for shared art.

---

### U30. Visual polish and consistency pass — built (2026-10-11; dev.19)
Asked for: review the project as an outsider and make it smoother, more consistent and easier on the eyes without removing or changing any feature. Reviewed by running the real window (every tab, the main dialogs, light and dark).
- **Sidebar:** *+ New Set* and *+ New Set from Template…* now sit directly under the list of sets (they were pushed to the very bottom, below the set's settings); the settings of the chosen set (card size, template, card back, set code) are one group under a *This set* heading with a divider.
- **Colours that were broken in dark mode:** warning text (`--color-warning-text`), success text and a few others were used but never defined, so they fell back to a dark brown that is unreadable on the dark theme. They are now defined for both themes in `App.svelte`, with the fallbacks removed (`--color-warning`, `--color-warning-text`, `--color-success-text`, `--color-surface-hover`, `--color-selected`, `--radius-md`).
- **One control size:** buttons, fields and lists use `--font-size-control` (12px); before, some were 13px and some 12px, so toolbars and dialogs did not line up. Radii that were typed as 5, 6, 8, 9, 10 or 11px use the `--radius`/`--radius-sm` tokens; type of 9px is 10px.
- **Check boxes and radio buttons:** aligned with their label text and given a pointer cursor over the label (they sat a pixel or two high).
- **Card Data:** the *Delete* button of a selection is an outlined danger button that fills on hover (a solid red block in the toolbar was the loudest thing on the screen); the preview says "No template" / "No card back" with an information mark in the accent colour instead of a red warning triangle (it is a state, not an error).
- **Tests:** `cardSize` expects the new *This set* heading; two stale counts fixed (`a11y`: 8 view tabs; `displayName`: 24 guide topics, after U29).
- **Not changed:** every feature, shortcut, menu and stored value. The e2e tests `canvasZoom` (200%) and `canvasPasteboard` fail the same way on the dev.18 bundle when run with Microsoft Edge instead of the project's Chromium; they are environment, not this change.
