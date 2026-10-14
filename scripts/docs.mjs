/**
 * The documentation pages that are made from the program's own text, so they cannot drift from it (PRD §21.6, §19):
 *   docs/command-line.md      from the help text of the command line
 *   docs/svg-naming-guide.md  from the guide that the SVG import dialog shows
 * `node scripts/docs.mjs` writes them; tests/unit/docs.test.js fails when the files are not what this makes.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { HELP } from '../src/cli/commands.js'
import { strings } from '../src/shared/strings.js'

export function buildDocs() {
  const g = strings.svgImport
  const cli = `# Spadewick command line

The command line runs the same code as the application, without a window. It is part of the packaged application: on Windows,
\`resources\\spadewick.cmd\` (beside the application's \`resources\` folder) starts it. From a source checkout, build first
(\`npm run build\`) and run \`node out/main/cli.js <command>\`.

\`\`\`
${HELP.trimEnd()}
\`\`\`

## Example: build on every push

When the data of a project changes, check it and make the files for the manufacturer:

\`\`\`
spadewick validate --project MyGame
spadewick export tts --project MyGame --out build
spadewick export production-pdf --project MyGame --preset printninja --out build
\`\`\`

\`validate\` and \`export production-pdf\` exit with 1 when they find problems, so a build stops before a print order is made.
Run them from any automation that can run a command on Windows.
`
  const guide = `# ${g.guideTitle}

${g.guideIntro}

- ${g.guideNames}
- ${g.guideBox}
- ${g.guideConditions}
- ${g.guideIcons}
- ${g.guideText}
- ${g.guideImages}

## Tools

- ${g.guideFigma}
- ${g.guideIllustrator}
- ${g.guideInkscape}
- ${g.guideAffinity}
`
  return { 'command-line.md': cli, 'svg-naming-guide.md': guide }
}

if (process.argv[1] && process.argv[1].endsWith('docs.mjs')) {
  const dir = join(process.cwd(), 'docs')
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(buildDocs())) writeFileSync(join(dir, name), text.replace(/\r?\n/g, '\r\n'))
  console.log('docs written')
}
