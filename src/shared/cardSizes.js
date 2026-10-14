/**
 * Industry-standard physical card sizes (PRD §10.6). Dimensions are portrait, in mm.
 * Manufacturers vary by a fraction of a millimetre, so a custom size is always available.
 * The display name of each preset is in strings.js under cardSizes.<id>.
 */
export const CARD_SIZES = [
  { id: 'poker', w: 63.5,  h: 88.9  },
  { id: 'bridge', w: 57.15, h: 88.9  },
  { id: 'standard_us', w: 56,    h: 87    },
  { id: 'standard_eu', w: 59,    h: 92    },
  { id: 'japanese', w: 59,    h: 86    },
  { id: 'mini_us', w: 41,    h: 63    },
  { id: 'mini_eu', w: 44,    h: 68    },
  { id: 'tarot', w: 70,    h: 120   },
  { id: 'tarot_us', w: 69.85, h: 120.65 },
  { id: 'square_small', w: 50,    h: 50    },
  { id: 'square', w: 70,    h: 70    },
  { id: 'jumbo', w: 88.9,  h: 127   }
]

export const CARD_SIZE_BY_ID = Object.fromEntries(CARD_SIZES.map(s => [s.id, s]))

/** Pixel size for a physical size at a DPI (used to derive default raster sizes). */
export function mmToPx(mm, dpi) {
  return Math.round(mm / 25.4 * dpi)
}
