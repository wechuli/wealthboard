import { describe, expect, it } from 'vitest'
import { parseThemePreference, readThemePreference, resolveTheme, THEME_STORAGE_KEY, writeThemePreference } from './theme'

describe('theme resolution', () => {
  it('resolves system against the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
  it('falls back to system for unknown values', () => {
    expect(parseThemePreference(null)).toBe('system')
    expect(parseThemePreference('sepia')).toBe('system')
    expect(parseThemePreference('dark')).toBe('dark')
  })
  it('persists to wealthboard-theme', () => {
    const store = new Map<string, string>()
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
    writeThemePreference('dark', storage)
    expect(store.get(THEME_STORAGE_KEY)).toBe('dark')
    expect(THEME_STORAGE_KEY).toBe('wealthboard-theme')
    expect(readThemePreference(storage)).toBe('dark')
    expect(readThemePreference({ getItem: () => { throw new Error('blocked') } })).toBe('system')
  })
})
