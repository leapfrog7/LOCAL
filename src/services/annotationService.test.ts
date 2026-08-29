import { describe, expect, it } from 'vitest'
import type { AnnotationStroke } from '../domain/types'
import { clampAnnotationPoint, eraseStrokeAt, pointToSource } from './annotationService'

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
})
