export interface PageTransform { scale: number; x: number; y: number }

export function boundPageView(view: PageTransform, page: { width: number; height: number }, viewport: { width: number; height: number }, rotation = 0, marginScale = 1): PageTransform {
  const scale = Math.min(4, Math.max(.25, Number.isFinite(view.scale) ? view.scale : 1))
  const rotated = Math.abs(rotation % 180) === 90
  const width = (rotated ? page.height : page.width) * scale * marginScale
  const height = (rotated ? page.width : page.height) * scale * marginScale
  const limitX = Math.max(0, (width - viewport.width) / 2)
  const limitY = Math.max(0, (height - viewport.height) / 2)
  return { scale, x: limitX ? Math.max(-limitX, Math.min(limitX, Number.isFinite(view.x) ? view.x : 0)) : 0, y: limitY ? Math.max(-limitY, Math.min(limitY, Number.isFinite(view.y) ? view.y : 0)) : 0 }
}

/** Preserve the point beneath the pinch centre, including when the centre moves. */
export function focalPageView(start: PageTransform, scale: number, startFocal: { x: number; y: number }, nextFocal = startFocal): PageTransform {
  return { scale, x: nextFocal.x - (startFocal.x - start.x) * scale / start.scale, y: nextFocal.y - (startFocal.y - start.y) * scale / start.scale }
}
