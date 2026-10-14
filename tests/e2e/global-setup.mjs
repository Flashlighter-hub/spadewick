import { execSync } from 'child_process'

// Build the real renderer + preload bundles the tests will run against.
export default function setup() {
  execSync('npx electron-vite build', { stdio: 'pipe', env: { ...process.env, FORCE_COLOR: '0' } })
}
