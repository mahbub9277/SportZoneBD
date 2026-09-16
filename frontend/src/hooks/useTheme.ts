import { useCallback, useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../app/hooks'
import { selectTheme, toggleTheme as toggleThemeAction } from '../features/settings/theme.slice'

export function useTheme() {
  const theme = useAppSelector(selectTheme)
  const dispatch = useAppDispatch()

  const toggleTheme = useCallback(() => {
    dispatch(toggleThemeAction())
  }, [dispatch])

  return useMemo(
    () => ({ theme, toggleTheme }),
    [theme, toggleTheme],
  )
}