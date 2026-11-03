import { useRouterState } from '@tanstack/react-router'
import { useLayoutEffect, useRef } from 'react'

/** Classes for the underline element: 2px cobalt, slides in 200 ms, no motion when the user asks for reduced motion. */
export const activeIndicatorClass =
  'pointer-events-none absolute bottom-0 left-0 h-0.5 bg-primary opacity-0 transition-[transform,width] duration-200 ease-out motion-reduce:transition-none'

/**
 * Slides one underline to the active link in a row of route links (TanStack marks it data-status="active").
 * Put `containerRef` on the positioned (relative) row and `indicatorRef` on the underline element.
 * It changes the underline's style directly, so a route change causes no extra React render.
 */
export function useActiveIndicator<C extends HTMLElement = HTMLElement>() {
  const containerRef = useRef<C>(null)
  const indicatorRef = useRef<HTMLSpanElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const shownRef = useRef(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    const indicator = indicatorRef.current
    if (!container || !indicator) return

    const place = () => {
      const active = container.querySelector<HTMLElement>('[data-status="active"]')
      if (!active) {
        indicator.style.opacity = '0'
        shownRef.current = false
        return
      }
      // Jump without sliding when it first appears, so it never slides in from the left edge.
      indicator.style.transitionDuration = shownRef.current ? '' : '0ms'
      indicator.style.transform = `translateX(${active.offsetLeft}px)`
      indicator.style.width = `${active.offsetWidth}px`
      indicator.style.opacity = '1'
      shownRef.current = true
    }

    place()
    // Re-measure when link widths change, for example when fonts load or text is translated.
    const observer = new ResizeObserver(place)
    observer.observe(container)
    return () => observer.disconnect()
  }, [pathname])

  return { containerRef, indicatorRef }
}
