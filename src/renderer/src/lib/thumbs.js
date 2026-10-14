/** Asset thumbnails as object URLs, fetched once and cached (PRD §9.4). */
const cache = new Map()   // asset id -> Promise<string | null>

export function thumbUrl(id) {
  if (!cache.has(id)) {
    cache.set(id, window.spadewick.assets.getThumbnail(id).then(bytes => {
      if (!bytes?.length) return null
      return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
    }).catch(() => null))
  }
  return cache.get(id)
}

/** Forget a cached thumbnail (after the asset's image was replaced or deleted). */
export function forgetThumb(id) {
  cache.get(id)?.then(url => url && URL.revokeObjectURL(url))
  cache.delete(id)
}

export function forgetAllThumbs() { for (const id of [...cache.keys()]) forgetThumb(id) }
