import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PrivacyProvider, readPrivacy, usePrivacy } from './privacy'
import { browserStorage, readStored, writeStored } from './storage'
import { readThemePreference, writeThemePreference } from './theme'

function Hidden() {
  return <p>{String(usePrivacy().hidden)}</p>
}

describe('blocked browser storage', () => {
  const own = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

  beforeEach(() => {
    // Browsers that block site data throw SecurityError on the property access itself.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })
  })

  afterEach(() => {
    if (own) Object.defineProperty(globalThis, 'localStorage', own)
    else delete (globalThis as { localStorage?: Storage }).localStorage
  })

  it('falls back instead of throwing', () => {
    expect(browserStorage()).toBeUndefined()
    expect(readStored('anything')).toBeNull()
    expect(() => writeStored('anything', '1')).not.toThrow()
    expect(readThemePreference()).toBe('system')
    expect(() => writeThemePreference('dark')).not.toThrow()
    expect(readPrivacy()).toBe(false)
  })

  it('still mounts the privacy provider', () => {
    render(
      <PrivacyProvider>
        <Hidden />
      </PrivacyProvider>,
    )
    expect(screen.getByText('false')).toBeInTheDocument()
  })
})
