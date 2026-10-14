// The copied elements (A80): kept here, not in the editor, so a copy made in one template can be pasted into another.
// The text is the one docEdit.serializeElements makes. It is also put on the system clipboard when the browser allows it.
let held = null

export const holdClip = text => {
  held = text
  try { navigator.clipboard?.writeText(text).catch(() => {}) } catch { /* the copy is still held here */ }
}

export const heldClip = () => held
