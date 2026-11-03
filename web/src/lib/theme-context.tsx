import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyResolvedTheme, readThemePreference, resolveTheme, writeThemePreference, type ResolvedTheme, type ThemePreference } from './theme'

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference(pref: ThemePreference): void
}

const ThemeContext = createContext<ThemeContextValue>({ preference: 'system', resolved: 'light', setPreference: () => {} })

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<ThemePreference>(readThemePreference)
  const [systemDark, setSystemDark] = useState(() => media().matches)
  useEffect(() => {
    const m = media()
    const onChange = () => setSystemDark(m.matches)
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [])
  const resolved = resolveTheme(preference, systemDark)
  useEffect(() => {
    applyResolvedTheme(resolved)
    document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.setAttribute('content', resolved === 'dark' ? '#0E1311' : '#F5F3EE'))
  }, [resolved])
  const setPreference = useCallback((pref: ThemePreference) => {
    writeThemePreference(pref)
    setPref(pref)
  }, [])
  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
