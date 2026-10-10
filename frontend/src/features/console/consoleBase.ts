import { createContext, useContext } from 'react'

/**
 * URL prefix of the console currently rendering.
 *
 * The moderator and staff consoles reuse the existing admin module pages. A page that links to a
 * sibling module asks this context for its own prefix, so the same component links inside `/admin`
 * when an administrator uses it and inside `/moderator` (or `/staff`) when a moderator does.
 */
export const ConsoleBaseContext = createContext('/admin')

export function useConsoleBase(): string {
  return useContext(ConsoleBaseContext)
}
