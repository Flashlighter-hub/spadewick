/**
 * What the host's table draws its pictures with in the application: the project's own renderer (the same pictures the table shows the
 * host) and the library's images, through the services of the window. A guest never needs any of this.
 */
export const appRender = {
  front: async (cardId, width) => ({ mime: 'image/png', data: await window.spadewick.templates.render({ cardId, width }) }),
  back: async (cardId, width) => ({ mime: 'image/png', data: await window.spadewick.templates.render({ cardId, width, side: 'back' }) }),
  asset: async (id, width) => window.spadewick.table.assetPicture({ id, width })
}
