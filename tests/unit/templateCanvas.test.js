/**
 * A template's canvas is the card: its view box, width and height are fixed when the template is made. Elements may spill past it.
 */
import { describe, it, expect } from 'vitest'
import { canvasOf, canvasChange } from '../../src/shared/templateCanvas.js'

const svg = (attrs, inner = '') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`
const BASE = svg('width="63.5mm" height="88.9mm" viewBox="0 0 750 1050"', '<rect width="750" height="1050"/>')

describe('canvasOf', () => {
  it('reads the view box, width and height of the root element', () => {
    expect(canvasOf(BASE)).toEqual({ viewBox: [0, 0, 750, 1050], width: '63.5mm', height: '88.9mm', effective: [0, 0, 750, 1050] })
    expect(canvasOf(svg('viewBox="37.5, 37.5, 750, 1050"'))).toEqual({ viewBox: [37.5, 37.5, 750, 1050], width: null, height: null, effective: [37.5, 37.5, 750, 1050] })
    expect(canvasOf(svg('width="500" height="700"')).effective).toEqual([0, 0, 500, 700])      // no view box: the size of the drawing
  })
  it('gives null for a bare fragment, and no view box when it is not valid', () => {
    expect(canvasOf('<rect width="5" height="5"/>')).toBeNull()
    expect(canvasOf(svg('viewBox="0 0 x 5"')).viewBox).toBeNull()
  })
})

describe('canvasChange', () => {
  it('is null when only what is drawn changes, including elements far outside the canvas', () => {
    expect(canvasChange(BASE, svg('width="63.5mm" height="88.9mm" viewBox="0 0 750 1050"', '<rect x="-400" y="-300" width="2000" height="500"/>'))).toBeNull()
    expect(canvasChange(BASE, BASE.replace('width="750"', 'width="760"'))).toBeNull()           // a rectangle's width, not the canvas's
  })
  it('says the locked size when the view box, the width or the height was changed', () => {
    const locked = { w: 750, h: 1050 }
    expect(canvasChange(BASE, BASE.replace('viewBox="0 0 750 1050"', 'viewBox="0 0 800 1050"'))).toEqual(locked)
    expect(canvasChange(BASE, BASE.replace('viewBox="0 0 750 1050"', 'viewBox="10 0 750 1050"'))).toEqual(locked)   // moving the window moves the card
    expect(canvasChange(BASE, BASE.replace('width="63.5mm"', 'width="70mm"'))).toEqual(locked)
    expect(canvasChange(BASE, BASE.replace(/ viewBox="[^"]*"/, ''))).toEqual(locked)         // a size in mm says nothing of the drawing's own units
  })
  it('lets a drawing with plain width and height and no view box stand for the same canvas, and a missing width or height go', () => {
    const plainDoc = svg('width="500" height="700" viewBox="0 0 500 700"')
    expect(canvasChange(plainDoc, svg('width="500" height="700"'))).toBeNull()
    expect(canvasChange(plainDoc, svg('width="500" height="600"'))).toEqual({ w: 500, h: 700 })
    expect(canvasChange(BASE, BASE.replace(' height="88.9mm"', ''))).toBeNull()                 // the view box still is the canvas
  })
  it('lets spacing and the order of the attributes differ', () => {
    expect(canvasChange(BASE, svg('viewBox="0  0 750,1050" height="88.9mm" width="63.5mm"'))).toBeNull()
  })
  it('keeps nothing when there was no view box, and leaves a bare fragment alone', () => {
    expect(canvasChange(svg(''), svg('viewBox="0 0 9 9"'))).toBeNull()                            // there was no canvas to keep
    expect(canvasChange(BASE, '<g><rect width="5" height="5"/></g>')).toBeNull()
  })
})
