// Entry of the command line: `node cli.js <command>` (built to out/main/cli.js), or `spadewick <command>` through the launcher.
import { runCli } from './run.js'

// The exit waits for the output to be written, so a pipe never loses the end of a long result
runCli(process.argv.slice(2)).then(code => process.stdout.write('', () => process.exit(code)))
