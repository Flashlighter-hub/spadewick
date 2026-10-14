/**
 * The tree of the Rules pages (PRD §7.11) as the page list shows it: the pages in order, how deep each is, and where a page can be
 * moved by one step (up, down, in under the page above, out to the level of its parent). Plain functions on the list of pages the
 * service gives ({ id, parent_id, sort_order, … }), so they can be tested without a window.
 */

const byOrder = (a, b) => a.sort_order - b.sort_order || String(a.id).localeCompare(String(b.id))

/** The pages directly below a page (or at the top), in order. */
export const childrenOf = (pages, parentId) => pages.filter(p => (p.parent_id ?? null) === (parentId ?? null)).sort(byOrder)

/** Every page, parents before their pages, with its depth; the pages below a collapsed page are left out. */
export function flatten(pages, collapsed = new Set()) {
  const out = []
  const walk = (parentId, depth) => {
    for (const page of childrenOf(pages, parentId)) {
      const kids = childrenOf(pages, page.id)
      out.push({ page, depth, hasChildren: kids.length > 0, expanded: !collapsed.has(page.id) })
      if (kids.length && !collapsed.has(page.id)) walk(page.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/** The pages from the top down to this one (the page itself last). */
export function pathOf(pages, id) {
  const by = new Map(pages.map(p => [p.id, p]))
  const out = []
  for (let p = by.get(id), guard = 0; p && guard < 100; p = by.get(p.parent_id), guard++) out.unshift(p)
  return out
}

/** Is `id` inside `ancestorId` (at any depth)? */
export const isBelow = (pages, id, ancestorId) => pathOf(pages, id).slice(0, -1).some(p => p.id === ancestorId)

/**
 * Where one step of each kind would put a page, as the `move` of the service wants it ({ parentId, index }), or null when there is
 * no such step.
 */
export function moveTargets(pages, id) {
  const page = pages.find(p => p.id === id)
  if (!page) return { up: null, down: null, indent: null, outdent: null }
  const sibs = childrenOf(pages, page.parent_id)
  const i = sibs.findIndex(p => p.id === id)
  const parent = page.parent_id ? pages.find(p => p.id === page.parent_id) : null
  return {
    up: i > 0 ? { parentId: page.parent_id ?? null, index: i - 1 } : null,
    down: i >= 0 && i < sibs.length - 1 ? { parentId: page.parent_id ?? null, index: i + 1 } : null,
    indent: i > 0 ? { parentId: sibs[i - 1].id, index: childrenOf(pages, sibs[i - 1].id).length } : null,
    outdent: parent ? { parentId: parent.parent_id ?? null, index: childrenOf(pages, parent.parent_id).findIndex(p => p.id === parent.id) + 1 } : null
  }
}

/** The page the selection goes to when a page goes: the one below it, else the one above, else its parent, else none. */
export function neighbourAfterRemoval(pages, id) {
  const page = pages.find(p => p.id === id)
  if (!page) return null
  const sibs = childrenOf(pages, page.parent_id)
  const i = sibs.findIndex(p => p.id === id)
  return (sibs[i + 1] ?? sibs[i - 1] ?? pages.find(p => p.id === page.parent_id) ?? null)?.id ?? null
}

/** A page by its title (any case), for a link written `page:Title`. */
export const pageByTitle = (pages, title) => pages.find(p => p.title.toLowerCase() === String(title).trim().toLowerCase()) ?? null
