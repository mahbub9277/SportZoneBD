import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDebounce } from './useDebounce'

export function useFilterState<T extends Record<string, unknown>>(initialState: T, debounceKeys: (keyof T)[] = [], debounceMs = 300) {
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

  const serializedFilters = JSON.stringify(debounceKeys.length > 0 ? debouncedFilters : filters)
  const serializedInitialState = JSON.stringify(initialState)

  useEffect(() => {
    const filterSnapshot = JSON.parse(serializedFilters) as T
    const initialSnapshot = JSON.parse(serializedInitialState) as T
    const newParams = new URLSearchParams()
    for (const key in filterSnapshot) {
      if (String(filterSnapshot[key]) && filterSnapshot[key] !== initialSnapshot[key]) {
        newParams.set(key, String(filterSnapshot[key]))
      }
    }
    setSearchParams(newParams, { replace: true })
  }, [serializedFilters, serializedInitialState, setSearchParams])

  return { filters, setFilters, debouncedFilters }
}