/**
 * Pure helpers behind the card table (PRD §6.1): virtual scrolling, spreadsheet-style keyboard
 * navigation, selection and drag-reordering. Kept free of Svelte/DOM so they can be unit tested.
 */

/** Rows to render for the current scroll position, with a little overscan. `end` is exclusive. */
export function visibleRange({ scrollTop, viewportHeight, rowHeight, total, overscan = 6 }) {
  if (total <= 0) return { start: 0, end: 0 }
  const first = Math.floor(scrollTop / rowHeight)
  const last = Math.ceil((scrollTop + viewportHeight) / rowHeight)
  return { start: Math.max(0, first - overscan), end: Math.min(total, last + overscan) }
}

/**
 * Where the active cell goes for a navigation key.
 * Tab/Shift-Tab wrap across rows; Tab past the very last cell asks for a new row (`addRow`).
 * @returns {{ row: number, col: number, addRow?: boolean }}
 */
export function moveActive(pos, key, { shift = false } = {}, { rows, cols }) {
  let { row, col } = pos
  const clamp = (v, max) => Math.max(0, Math.min(max - 1, v))
  switch (key) {
    case 'ArrowUp':    return { row: clamp(row - 1, rows), col }
    case 'ArrowDown':  return { row: clamp(row + 1, rows), col }
    case 'ArrowLeft':  return { row, col: clamp(col - 1, cols) }
    case 'ArrowRight': return { row, col: clamp(col + 1, cols) }
    case 'Enter':      return { row: clamp(row + (shift ? -1 : 1), rows), col }
    case 'Tab':
      if (shift) {
        if (col > 0) return { row, col: col - 1 }
        return row > 0 ? { row: row - 1, col: cols - 1 } : { row, col }
      }
      if (col < cols - 1) return { row, col: col + 1 }
      if (row < rows - 1) return { row: row + 1, col: 0 }
      return { row, col, addRow: true }
    case 'Home': return { row, col: 0 }
    case 'End':  return { row, col: cols - 1 }
    default:     return { row, col }
  }
}

/**
 * Multi-select with click / shift-click (range from the anchor) / ctrl-click (toggle).
 * @returns {{ selected: string[], anchor: string | null }}
 */
export function applySelection({ ids, selected, anchor }, clickedId, { shift = false, ctrl = false } = {}) {
  if (shift && anchor && ids.includes(anchor)) {
    const [a, b] = [ids.indexOf(anchor), ids.indexOf(clickedId)].sort((x, y) => x - y)
    return { selected: ids.slice(a, b + 1), anchor }
  }
  if (ctrl) {
    const next = selected.includes(clickedId) ? selected.filter(id => id !== clickedId) : [...selected, clickedId]
    return { selected: next, anchor: clickedId }
  }
  return { selected: [clickedId], anchor: clickedId }
}

/** Move `movingIds` (kept in their current relative order) so they sit before the item at `targetIndex` of the original list. */
export function reorderIds(ids, movingIds, targetIndex) {
  const moving = ids.filter(id => movingIds.includes(id))
  if (!moving.length) return ids
  const before = ids.slice(0, targetIndex).filter(id => !movingIds.includes(id))
  const after = ids.slice(targetIndex).filter(id => !movingIds.includes(id))
  return [...before, ...moving, ...after]
}

/** Move one list item (column reorder). */
export function moveItem(list, from, to) {
  if (from === to || from < 0 || from >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item)
  return next
}

export const clampWidth = (w, min = 60, max = 800) => Math.max(min, Math.min(max, Math.round(w)))
