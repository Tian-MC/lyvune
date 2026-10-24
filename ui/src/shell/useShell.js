import { createContext, useContext } from 'react'

export const ShellContext = createContext(null)

/** Shell UI state: sidebar, queue panel, Now Playing (see ShellContext.jsx). */
export const useShell = () => useContext(ShellContext)
