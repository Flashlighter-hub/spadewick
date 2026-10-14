/**
 * A child template (PRD §7.2) fills the slots of a parent frame. Earlier it was written as a bare fragment, which is not a
 * document of its own: the canvas editor could not open it ("not valid XML"). A child is now a complete SVG document that
 * carries the size of its parent; the merge with the parent reads its fills from inside the root, as it always did.
 */

/** The child as a complete SVG document (a child that already has a root is returned as it is). */
export function wrapChildFragment(child, parent) {
  if (!child || /<svg[\s>]/i.test(child)) return child
  const root = /<svg\b[^>]*>/i.exec(parent ?? '')?.[0] ?? ''
  const attr = name => new RegExp(String.raw`\s${name}="([^"]*)"`).exec(root)?.[1]
  const size = ['width', 'height', 'viewBox'].map(n => (attr(n) != null ? ` ${n}="${attr(n)}"` : '')).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg"${size}>\n${child.trim()}\n</svg>`
}
