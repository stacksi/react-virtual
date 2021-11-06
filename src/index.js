import React from 'react'

import useRect from './useRect'
import useIsomorphicLayoutEffect from './useIsomorphicLayoutEffect'
import { requestTimeout, cancelTimeout } from './timer'

const ResetScrollingTimeout = 100

const defaultEstimateSize = () => 50

const defaultKeyExtractor = index => index

const defaultMeasureSize = (el, horizontal) => {
  const key = horizontal ? 'offsetWidth' : 'offsetHeight'

  return el[key]
}

export const defaultRangeExtractor = range => {
  const start = Math.max(range.start - range.overscan, 0)
  const end = Math.min(range.end + range.overscan, range.size - 1)

  const arr = []

  for (let i = start; i <= end; i++) {
    arr.push(i)
  }

  return arr
}

export function useVirtual({
  size = 0,
  estimateSize = defaultEstimateSize,
  overscan = 1,
  paddingStart = 0,
  paddingEnd = 0,
  parentRef,
  horizontal,
  scrollToFn,
  useObserver,
  onScrollElement,
  scrollOffsetFn,
  keyExtractor = defaultKeyExtractor,
  measureSize = defaultMeasureSize,
  rangeExtractor = defaultRangeExtractor,
}) {
  const sizeKey = horizontal ? 'width' : 'height'
  const scrollKey = horizontal ? 'scrollLeft' : 'scrollTop'
  const latestRef = React.useRef({
    scrollOffset: 0,
    measurements: [],
    scrollDirection: undefined,
  })
  const useMeasureParent = useObserver || useRect

  const { [sizeKey]: outerSize } = useMeasureParent(parentRef) || {
    [sizeKey]: 0,
  }
  latestRef.current.outerSize = outerSize

  const defaultScrollToFn = React.useCallback(
    offset => {
      if (parentRef.current) {
        parentRef.current[scrollKey] = offset
      }
    },
    [parentRef, scrollKey]
  )

  const resolvedScrollToFn = scrollToFn || defaultScrollToFn

  scrollToFn = React.useCallback(
    offset => {
      resolvedScrollToFn(offset, defaultScrollToFn)
    },
    [defaultScrollToFn, resolvedScrollToFn]
  )

  const [measuredCache, setMeasuredCache] = React.useState({})

  const measure = React.useCallback(() => setMeasuredCache({}), [])

  const pendingMeasuredCacheIndexesRef = React.useRef([])

  const measurements = React.useMemo(() => {
    const min =
      pendingMeasuredCacheIndexesRef.current.length > 0
        ? Math.min(...pendingMeasuredCacheIndexesRef.current)
        : 0
    pendingMeasuredCacheIndexesRef.current = []

    const measurements = latestRef.current.measurements.slice(0, min)

    for (let i = min; i < size; i++) {
      const key = keyExtractor(i)
      const measuredSize = measuredCache[key]
      const start = measurements[i - 1] ? measurements[i - 1].end : paddingStart
      const size =
        typeof measuredSize === 'number' ? measuredSize : estimateSize(i)
      const end = start + size
      measurements[i] = { index: i, start, size, end, key }
    }
    return measurements
  }, [estimateSize, measuredCache, paddingStart, size, keyExtractor])

  const totalSize = (measurements[size - 1]?.end || 0) + paddingEnd

  latestRef.current.measurements = measurements
  latestRef.current.totalSize = totalSize

  const [range, setRange] = React.useState({ start: 0, end: 0 })

  const element = onScrollElement ? onScrollElement.current : parentRef.current

  const scrollOffsetFnRef = React.useRef(scrollOffsetFn)
  scrollOffsetFnRef.current = scrollOffsetFn

  const isMountedRef = React.useRef(false)

  useIsomorphicLayoutEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  const [isScrolling, setIsScrolling] = React.useState(false)
  const scrollingIdRef = React.useRef(null)

  const debouncedResetScrolling = React.useCallback(() => {
    if (scrollingIdRef.current !== null) {
      cancelTimeout(scrollingIdRef.current)
    }

    scrollingIdRef.current = requestTimeout(() => {
      scrollingIdRef.current = null

      if (isMountedRef.current) {
        setIsScrolling(false)
        latestRef.current.scrollDirection = undefined
      }
    }, ResetScrollingTimeout)
  }, [])

  useIsomorphicLayoutEffect(() => {
    if (!isScrolling) {
      setRange(calculateRange(latestRef.current))
    }
  }, [isScrolling, measurements, outerSize])

  useIsomorphicLayoutEffect(() => {
    if (!element) {
      setRange({ start: 0, end: 0 })
      latestRef.current.scrollOffset = 0

      return
    }

    const onScroll = event => {
      const scrollOffset = scrollOffsetFnRef.current
        ? scrollOffsetFnRef.current(event)
        : element[scrollKey]

      if (event) {
        latestRef.current.scrollDirection =
          latestRef.current.scrollOffset <= scrollOffset
            ? 'forward'
            : 'backward'
        setIsScrolling(true)
        debouncedResetScrolling()
      }

      latestRef.current.scrollOffset = scrollOffset

      setRange(calculateRange(latestRef.current))
    }

    // Determine initially visible range
    onScroll()

    element.addEventListener('scroll', onScroll, {
      capture: false,
      passive: true,
    })

    return () => {
      element.removeEventListener('scroll', onScroll)
    }
  }, [element, scrollKey, debouncedResetScrolling])

  const measureSizeRef = React.useRef(measureSize)
  measureSizeRef.current = measureSize

  const virtualItems = React.useMemo(() => {
    const indexes = rangeExtractor({
      start: range.start,
      end: range.end,
      overscan,
      size: measurements.length,
    })

    const virtualItems = []

    for (let k = 0, len = indexes.length; k < len; k++) {
      const i = indexes[k]
      const measurement = measurements[i]

      const item = {
        ...measurement,
        measureRef: el => {
          if (el) {
            const measuredSize = measureSizeRef.current(el, horizontal)

            if (measuredSize !== item.size) {
              const { scrollOffset, scrollDirection } = latestRef.current

              if (item.start < scrollOffset && scrollDirection === 'backward') {
                defaultScrollToFn(scrollOffset + (measuredSize - item.size))
              }

              pendingMeasuredCacheIndexesRef.current.push(i)

              setMeasuredCache(old => ({
                ...old,
                [item.key]: measuredSize,
              }))
            }
          }
        },
      }

      virtualItems.push(item)
    }

    return virtualItems
  }, [
    defaultScrollToFn,
    horizontal,
    measurements,
    overscan,
    range.end,
    range.start,
    rangeExtractor,
  ])

  const mountedRef = React.useRef()

  useIsomorphicLayoutEffect(() => {
    if (mountedRef.current) {
      if (estimateSize) setMeasuredCache({})
    }
    mountedRef.current = true
  }, [estimateSize])

  const scrollToOffset = React.useCallback(
    (toOffset, { align = 'start' } = {}) => {
      const { scrollOffset, outerSize } = latestRef.current

      if (align === 'auto') {
        if (toOffset <= scrollOffset) {
          align = 'start'
        } else if (toOffset >= scrollOffset + outerSize) {
          align = 'end'
        } else {
          align = 'start'
        }
      }

      if (align === 'start') {
        scrollToFn(toOffset)
      } else if (align === 'end') {
        scrollToFn(toOffset - outerSize)
      } else if (align === 'center') {
        scrollToFn(toOffset - outerSize / 2)
      }
    },
    [scrollToFn]
  )

  const tryScrollToIndex = React.useCallback(
    (index, { align = 'auto', ...rest } = {}) => {
      const { measurements, scrollOffset, outerSize } = latestRef.current

      const measurement = measurements[Math.max(0, Math.min(index, size - 1))]

      if (!measurement) {
        return
      }

      if (align === 'auto') {
        if (measurement.end >= scrollOffset + outerSize) {
          align = 'end'
        } else if (measurement.start <= scrollOffset) {
          align = 'start'
        } else {
          return
        }
      }

      const toOffset =
        align === 'center'
          ? measurement.start + measurement.size / 2
          : align === 'end'
          ? measurement.end
          : measurement.start

      scrollToOffset(toOffset, { align, ...rest })
    },
    [scrollToOffset, size]
  )

  const scrollToIndex = React.useCallback(
    (...args) => {
      // We do a double request here because of
      // dynamic sizes which can cause offset shift
      // and end up in the wrong spot. Unfortunately,
      // we can't know about those dynamic sizes until
      // we try and render them. So double down!
      tryScrollToIndex(...args)
      requestAnimationFrame(() => {
        tryScrollToIndex(...args)
      })
    },
    [tryScrollToIndex]
  )

  return {
    virtualItems,
    totalSize,
    scrollToOffset,
    scrollToIndex,
    measure,
    isScrolling,
  }
}

const findNearestBinarySearch = (low, high, getCurrentValue, value) => {
  while (low <= high) {
    let middle = ((low + high) / 2) | 0
    let currentValue = getCurrentValue(middle)

    if (currentValue < value) {
      low = middle + 1
    } else if (currentValue > value) {
      high = middle - 1
    } else {
      return middle
    }
  }

  if (low > 0) {
    return low - 1
  } else {
    return 0
  }
}

const calculateRange = ({
  measurements,
  outerSize,
  scrollOffset,
}) => prevRange => {
  const size = measurements.length - 1
  const getOffset = index => measurements[index].start

  let start = findNearestBinarySearch(0, size, getOffset, scrollOffset)
  let end = start

  while (end < size && measurements[end].end < scrollOffset + outerSize) {
    end++
  }

  if (prevRange.start !== start || prevRange.end !== end) {
    return { start, end }
  }

  return prevRange
}
