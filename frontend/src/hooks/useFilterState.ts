import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDebounce } from './useDebounce'

type FilterState<T> = {
  [K in keyof T]: [T[K], (value: T[K]) => void]
}

export function useFilterState<T extends Record<string, any>>(initialState: T, debounceKeys: (keyof T)[] = [], debounceMs = 300) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filters, setFilters] = useState<T>(() => {
    const state = { ...initialState }
    for (const key in state) {
      const paramValue = searchParams.get(key)
      if (paramValue !== null) {
        if (typeof state[key] === 'boolean') {
          state[key] = (paramValue === 'true') as T[Extract<keyof T, string>];
        } else if (typeof state[key] === 'number') {
          state[key] = Number(paramValue) as T[Extract<keyof T, string>];
        } else {
          state[key] = paramValue as T[Extract<keyof T, string>];
        }
      }
    }
    return state
  })

  const debouncedFilters = useDebounce(filters, debounceMs)

  useEffect(() => {
    const newParams = new URLSearchParams()
    for (const key in filters) {
      if (String(filters[key]) && filters[key] !== initialState[key]) {
        newParams.set(key, String(filters[key]))
      }
    }
    setSearchParams(newParams, { replace: true })
  }, [JSON.stringify(debounceKeys.length > 0 ? debouncedFilters : filters), setSearchParams, JSON.stringify(initialState)])

  return { filters, setFilters, debouncedFilters }
}