# Spadewick

A portable, offline, Windows 10/11 card-game design tool: card data table, SVG templates, and a **Help** tab with a guide to formulas, template tokens, conditions, text fitting and rich text; export to Tabletop Simulator, print-and-play PDF and PNG sheets. The full specification is in [PRD.md](PRD.md).

## What is in it

Card data table with fields, copies and card IDs; SVG templates drawn in a canvas editor (several elements at once, gradients, shadows, text styles, typing on the card, reusable **components**), with template inheritance, conditions and fitting text; **card backs** for every set (a template of its own, a back of its own for a card); a **virtual table** to playtest alone (decks, hands, groups of dice, counters, picture tokens, an optional turn order, saved tables; it follows the project when a card or a template changes; it can be **shared with other players** directly, by trading two codes, with each player seeing only their own hand and no project needed by the guests); the game's **rules** as Markdown pages with pictures and card references; export to Tabletop Simulator, print-and-play PDF, PNG sheets and a print-production PDF with a readiness check; snapshots with "what changed?"; and a command line.

## Run it locally

Short version below; the full walkthrough (requirements, tests, building the Windows exe, troubleshooting) is in [SETUP.md](SETUP.md).

You need [Node.js](https://nodejs.org) 20 or newer (22 and 24 work) and git. **No C++ compiler or Visual Studio is needed.**

```
git clone https://github.com/Flashlighter-hub/spadewick.git
cd spadewick
npm install
npm run dev
```

`npm install` downloads ready-made builds of the one native module (better-sqlite3) for both Node (used by the tests) and Electron (used by the app), so nothing is compiled.

| Command | What it does |
|---------|--------------|
| `npm run dev` | Starts the app with live reload |
| `npm test` | Unit and integration tests |
| `npm run test:e2e` | End-to-end tests in Chromium (see `tests/README.md`) |
| `npm run build` | Builds the app bundles |
| `npm run dist` | Builds the app, then checks that the packaged app can load its database module (then restores the Node build of better-sqlite3 for the tests). Use this, not `electron-builder` on its own |
| `npm run native` | Fetches the Electron binary and the Electron build of better-sqlite3 again |
| `npm run docs` | Writes `docs/command-line.md` and `docs/svg-naming-guide.md` from the program's own text (a test fails when they are out of date) |

## Command line

The application also runs without a window: `info`, `list`, `validate`, `preflight`, `export`, `render`, `compare`, `import`, `snapshot`, `profiles` and `watch`. In a packaged (unpacked) build, start `resources\spadewick.cmd`; from a checkout, `npm run build` and then `node out/main/cli.js <command>`. See [docs/command-line.md](docs/command-line.md).

In development (`npm run dev`) the app keeps its settings, logs and default `projects/` folder in Electron's user-data folder (`%APPDATA%\spadewick` on Windows), not next to the code; delete it to start fresh. Only the packaged app is portable (PRD §4).

## Fonts and their licences

Spadewick ships 55 extra open-licence font families (SIL Open Font License or Apache 2.0) in `resources/fonts/extra/`, each with its licence file, besides the Liberation and Noto fonts it always had. `THIRD-PARTY-NOTICES.md` lists every family with its licence and copyright holder and says what the licences allow; it is installed with the application. `scripts/fetch-fonts.mjs` fetches the families from a clone of github.com/google/fonts and `scripts/make-font-notices.mjs` rewrites the notices.

## Dependency security

`npm audit` reports a few findings that remain on purpose: they are in the development tools (Vite's dev server, esbuild, the Svelte 4 compiler) and need a move to Svelte 5 and Vite 7 to clear, which is a separate piece of work. The shipped parts are current: Electron 42, sharp 0.35, better-sqlite3 12. After `npm install`, `npm audit` should list about 10 findings and no critical ones.

## If something goes wrong

- **`npm install` tried to compile (node-gyp, MSBuild, "ClangCL") and failed.** Use a current checkout (better-sqlite3 12 or newer has ready-made builds for Node 20 to 24). Delete `node_modules` and run `npm install` again. If your Node version is newer than 24, install Node 22 LTS.
- **`Error: Electron uninstall` when running `npm run dev`.** The Electron binary was not downloaded. `npm install` now fetches it; on an older checkout run `npm run native`, or `node node_modules/electron/install.js`.
- **"NODE_MODULE_VERSION" error when the app starts.** Run `npm run native`.
- **Corporate proxy or no internet during install.** The downloads come from GitHub releases; set `HTTPS_PROXY` or install on a connection that can reach github.com.
- **The window opens but a button does nothing.** Open View → Toggle Developer Tools and send the red messages from the Console.
