# Spadewick command line

The command line runs the same code as the application, without a window. It is part of the packaged application: on Windows,
`resources\spadewick.cmd` (beside the application's `resources` folder) starts it. From a source checkout, build first
(`npm run build`) and run `node out/main/cli.js <command>`.

```
Spadewick command line

Usage: spadewick <command> [options]

Commands
  info                            Summary of the project
  list <what>                     sets, cards, fields, templates, assets, fonts, icons, snapshots, presets
  validate                        Check field rules, quantities, pictures, icons, fonts and text fit (exit 1 on errors)
  preflight [--preset <name>]     The print readiness check (exit 1 on errors)
  export <kind>                   tts, png, pdf, production-pdf, images
  render --card <name or ID>      One card as a PNG (--out file.png, --width px, --side front|back)
  compare <snapshot> [<snapshot>] What changed since a snapshot, or between two (--format text|markdown|csv|html|json)
  import <file> --set <set>       Import a CSV, JSON or Excel (.xlsx) file (--mode append|merge, --key <field>, --mapping <file.json>, --sheet <name or number>, --dry-run)
  snapshot create <name> | list | restore <name or id>
  profiles list | show <name>     The saved export profiles of the project
  watch <kind>                    Export now and again whenever the project changes (--interval ms, --also <file>, --reimport <file>, --runs n)
  version, help

Options
  --project <folder>              The project (default: the current folder)
  --set <name|code|id>            Only this set (repeat for several; default: all sets)
  --cards <filter>                Only cards matching a filter such as "faction == 'Red'"
  --out <folder or file>          Where files go (export: a folder; render: a file)
  --preset <name>                 A manufacturer preset (see "list presets")
  --profile <name>                A saved export profile of the project
  --options <file.json>           Export settings from a JSON file
  --opt key=value                 One export setting (repeat), e.g. --opt dpi=600 --opt bleedMm=3
  --export-anyway                 production-pdf: export even when the print readiness check has errors
  --ignore-file-problems          import: go on although the CSV breaks the CSV rules (a stray quote, a row with the wrong number of columns)
  --only-errors                   preflight: show errors only
  --library <folder>              The folder of your own presets (or set SPADEWICK_LIBRARY)
  --json                          Machine-readable output
  --quiet                         Print nothing but results and errors
  --dry-run                       Say what would be written and write nothing
  --force                         Write even though another program has the project open

Exit codes: 0 done; 1 the check ran and found problems; 2 wrong usage; 3 the project cannot be opened.
Commands that change the project refuse to run while another program (the application, another command) has it open, unless --force is given.
Not in this version: cloud (see the PRD, section 21).
```

## Example: build on every push

When the data of a project changes, check it and make the files for the manufacturer:

```
spadewick validate --project MyGame
spadewick export tts --project MyGame --out build
spadewick export production-pdf --project MyGame --preset printninja --out build
```

`validate` and `export production-pdf` exit with 1 when they find problems, so a build stops before a print order is made.
Run them from any automation that can run a command on Windows.
