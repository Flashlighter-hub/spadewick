// Line icons (24 x 24, drawn with the current colour) for the canvas tools. Fixed markup of this file: nothing from a template or a card.
export const TOOL_ICONS = Object.fromEntries([
  ['select', '<path d="M5 3.5l13.5 6.2-5.8 1.9-1.9 5.8z"/>'],
  ['text', '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'],
  ['image', '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="M20.5 16l-4.8-4.8L7 19.5"/>'],
  ['rect', '<rect x="4" y="6" width="16" height="12" rx="2.5"/>'],
  ['ellipse', '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>'],
  ['component', '<path d="M12 3l4 4-4 4-4-4z"/><path d="M12 13l4 4-4 4-4-4z"/><path d="M3 12l4-4 4 4-4 4z" transform="translate(9 0)"/>']
])

// The align and distribute buttons
export const ALIGN_ICONS = Object.fromEntries([
  ['left', '<path d="M4 4v16"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/>'],
  ['hcenter', '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>'],
  ['right', '<path d="M20 4v16"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/>'],
  ['top', '<path d="M4 4h16"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/>'],
  ['vcenter', '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>'],
  ['bottom', '<path d="M4 20h16"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/>'],
  ['distX', '<path d="M4 4v16M20 4v16"/><rect x="9.5" y="8" width="5" height="8" rx="1"/>'],
  ['distY', '<path d="M4 4h16M4 20h16"/><rect x="8" y="9.5" width="8" height="5" rx="1"/>']
])
