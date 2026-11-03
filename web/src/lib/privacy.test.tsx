import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Delta, Money, Quantity, UnitPrice } from '@/components/format'
import { PRIVACY_STORAGE_KEY } from '@/config'
import { PrivacyProvider, readPrivacy, usePrivacy } from './privacy'

function Toggle() {
  const { toggle } = usePrivacy()
  return (
    <button type="button" onClick={toggle}>
      toggle
    </button>
  )
}

function Figures() {
  return (
    <PrivacyProvider>
      <Toggle />
      <p data-testid="money">
        <Money minor="457691800" currency="KES" />
      </p>
      <p data-testid="delta">
        <Delta minor="-120050" currency="KES" />
      </p>
      <p data-testid="qty">
        <Quantity value="40" />
      </p>
      <p data-testid="price">
        <UnitPrice value="100.00" currency="USD" />
      </p>
    </PrivacyProvider>
  )
}

describe('privacy mode', () => {
  it('shows values by default', () => {
    render(<Figures />)
    expect(screen.getByTestId('money').textContent).toContain('4,576,918.00')
  })

  it('masks every amount, quantity, and price and persists the choice', () => {
    render(<Figures />)
    act(() => screen.getByText('toggle').click())
    for (const id of ['money', 'delta', 'qty', 'price']) {
      const text = screen.getByTestId(id).textContent ?? ''
      expect(text).toContain('••••••')
      expect(text).not.toMatch(/\d/)
    }
    expect(localStorage.getItem(PRIVACY_STORAGE_KEY)).toBe('true')
    expect(readPrivacy()).toBe(true)
  })

  it('restores the stored preference on load', () => {
    localStorage.setItem(PRIVACY_STORAGE_KEY, 'true')
    render(<Figures />)
    expect(screen.getByTestId('money').textContent).not.toContain('4,576,918')
    expect(screen.getAllByLabelText('Hidden value').length).toBeGreaterThan(0)
  })

  it('never shows a missing value as zero', () => {
    render(
      <PrivacyProvider>
        <Money minor={null} currency="KES" />
      </PrivacyProvider>,
    )
    expect(screen.getByText('Incomplete')).toBeInTheDocument()
  })
})
