/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENCIES, orderCurrencyCodes } from './currency'

describe('currency catalog', () => {
  it('offers every currency the server supports', () => {
    const goCatalog = readFileSync(resolve(__dirname, '../../../internal/domain/currencies.go'), 'utf8')
    const block = /supportedCurrencies\s*=\s*map\[string\]struct\{\}\{([\s\S]*?)\n\}/.exec(goCatalog)?.[1] ?? ''
    const server = [...block.matchAll(/"([A-Z]{3})"/g)].map((m) => m[1]).sort()
    expect(server.length).toBeGreaterThan(20)
    expect(CURRENCIES.map((c) => c.code).sort()).toEqual(server)
  })

  it('orders known codes by the catalog and keeps unknown ones', () => {
    expect(orderCurrencyCodes(['USD', 'XYZ', 'KES', 'ABC', 'KES'])).toEqual(['KES', 'USD', 'ABC', 'XYZ'])
  })
})
