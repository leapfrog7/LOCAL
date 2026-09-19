import { useEffect, useRef } from 'react'

/** One interruptible, lightly damped spring for button/double-tap zoom. Pinch is direct. */
export function useZoomMotion() {
  const frame = useRef(0)
  const stop = () => { cancelAnimationFrame(frame.current); frame.current = 0 }
  useEffect(() => stop, [])
  const animate = (update: (progress: number) => void) => {
    stop()
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { update(1); return }
    const start = performance.now()
    const step = (now: number) => {
      const seconds = (now - start) / 1000
      if (seconds >= .5) { frame.current = 0; update(1); return }
      const progress = 1 - Math.exp(-12 * seconds) * (Math.cos(15 * seconds) + .8 * Math.sin(15 * seconds))
      update(progress)
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }
  return { animate, stop }
}
