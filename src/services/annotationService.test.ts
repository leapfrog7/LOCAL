import { describe, expect, it } from 'vitest'
import type { AnnotationStroke } from '../domain/types'
import { clampAnnotationPoint, eraseStrokeAt, eraseStrokeParts, findStrokeAt, pointToSource, snapHighlightToWords } from './annotationService'

const stroke = (id: string, points: { x: number; y: number }[]): AnnotationStroke => ({ id, tool: 'pen', color: '#111111', width: .01, points })

describe('durable page annotations', () => {
  it('clamps normalized coordinates independently of screen dimensions', () => {
    expect(clampAnnotationPoint({ x: 1.4, y: -.2 })).toEqual({ x: 1, y: 0 })
  })
  it('maps displayed coordinates back through page rotation', () => {
    expect(pointToSource({ x: .25, y: .8 }, 90)).toEqual({ x: .8, y: .75 })
    const counterClockwise = pointToSource({ x: .25, y: .8 }, 270)
    expect(counterClockwise.x).toBeCloseTo(.2); expect(counterClockwise.y).toBeCloseTo(.25)
  })
  it('erases the topmost intersecting whole stroke', () => {
    const strokes = [stroke('a', [{ x: .1, y: .1 }, { x: .9, y: .1 }]), stroke('b', [{ x: .1, y: .5 }, { x: .9, y: .5 }])]
    expect(eraseStrokeAt(strokes, { x: .5, y: .49 }).map(item => item.id)).toEqual(['a'])
    expect(eraseStrokeAt(strokes, { x: .5, y: .9 })).toBe(strokes)
  })
  it('selects the topmost stroke and only removes the touched section', () => {
    const strokes = [stroke('a', [{ x: .1, y: .5 }, { x: .9, y: .5 }]), stroke('b', [{ x: .1, y: .52 }, { x: .9, y: .52 }])]
    expect(findStrokeAt(strokes, { x: .5, y: .51 })).toBe('b')
    const erased = eraseStrokeParts([strokes[0]], { x: .5, y: .5 }, .04)
    expect(erased).toHaveLength(2)
    expect(erased[0].points.at(-1)!.x).toBeLessThan(.5)
    expect(erased[1].points[0].x).toBeGreaterThan(.5)
  })
  it('snaps a rough highlight to OCR word lines', () => {
    const highlight: AnnotationStroke = { ...stroke('h', [{ x: .08, y: .2 }, { x: .8, y: .22 }]), tool: 'highlighter' }
    const snapped = snapHighlightToWords(highlight, [
      { text: 'hello', confidence: 95, boundingBox: { x: .1, y: .18, width: .15, height: .06 } },
      { text: 'world', confidence: 95, boundingBox: { x: .28, y: .18, width: .16, height: .06 } }
    ])
    expect(snapped).toHaveLength(1)
    expect(snapped[0].points[0]).toEqual({ x: .1, y: .21 })
    expect(snapped[0].points[1].x).toBeCloseTo(.44)
    expect(snapped[0].points[1].y).toBeCloseTo(.21)
  })
  it('selects shape borders and text note bounds', () => {
    const rectangle: AnnotationStroke = { id: 'box', tool: 'rectangle', color: '#111111', width: .006, points: [{ x: .2, y: .2 }, { x: .8, y: .7 }] }
    const note: AnnotationStroke = { id: 'note', tool: 'text', color: '#111111', width: .006, fontSize: .03, text: 'Review this', points: [{ x: .25, y: .3 }] }
    expect(findStrokeAt([rectangle], { x: .2, y: .45 }, .01)).toBe('box')
    expect(findStrokeAt([rectangle], { x: .5, y: .45 }, .01)).toBeUndefined()
    expect(findStrokeAt([note], { x: .3, y: .31 }, .005)).toBe('note')
  })
  it('removes a touched structured annotation as one object', () => {
    const arrow: AnnotationStroke = { id: 'arrow', tool: 'arrow', color: '#111111', width: .006, points: [{ x: .1, y: .1 }, { x: .9, y: .9 }] }
    expect(eraseStrokeParts([arrow], { x: .5, y: .5 }, .02)).toEqual([])
  })
})
