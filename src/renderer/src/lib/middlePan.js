/**
 * Panning a scrolling area with the middle mouse button (UPDATES U5): hold the middle button and drag, and the area moves under the
 * pointer like a sheet of paper. The system's own "autoscroll" (a mouse press on the middle button) and the paste of a middle click are
 * stopped, so nothing else happens while panning.
 *
 *   <div use:middlePan>…</div>
 */
export function middlePan(node) {
  let from = null

  const stop = e => { if (e.button === 1) e.preventDefault() }

  function down(e) {
    if (e.button !== 1) return
    e.preventDefault()
    from = { x: e.clientX, y: e.clientY, left: node.scrollLeft, top: node.scrollTop, id: e.pointerId }
    try { node.setPointerCapture(e.pointerId) } catch { /* a pointer that is already gone */ }
    node.dataset.panning = 'true'
  }
  function move(e) {
    if (!from) return
    node.scrollLeft = from.left - (e.clientX - from.x)
    node.scrollTop = from.top - (e.clientY - from.y)
  }
  function up() {
    if (!from) return
    try { node.releasePointerCapture(from.id) } catch { /* released already */ }
    from = null
    delete node.dataset.panning
  }

  // mousedown and auxclick are where the system starts its autoscroll and the middle click's own action
  node.addEventListener('mousedown', stop)
  node.addEventListener('auxclick', stop)
  node.addEventListener('pointerdown', down)
  node.addEventListener('pointermove', move)
  node.addEventListener('pointerup', up)
  node.addEventListener('pointercancel', up)
  return {
    destroy() {
      node.removeEventListener('mousedown', stop); node.removeEventListener('auxclick', stop)
      node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move)
      node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', up)
    }
  }
}
