import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Account } from '@/api/types'
import { renderWithApp } from '@/test/render'
import { AccountCard } from './AccountViews'

const usdAccount: Account = {
  id: '00000000-0000-4000-8000-000000000001',
  categoryId: '00000000-0000-4000-8000-000000000002',
  name: 'Brokerage',
  currency: 'USD',
  trackingMode: 'balance',
  currentValueMinor: '1129103',
  convertedValueMinor: '146681771',
  monthlyChangeMinor: '21286442',
  isLiability: false,
  isIncludedInNetWorth: true,
  categoryName: 'Securities',
}

describe('AccountCard', () => {
  it('labels the monthly change in the base currency the API reports it in', async () => {
    renderWithApp(<AccountCard item={{ account: usdAccount }} baseCurrency="KES" />)
    const change = (await screen.findByText('this month')).parentElement!
    expect(change).toHaveTextContent('+KES212,864.42')
    expect(change).not.toHaveTextContent('USD')
  })
})
