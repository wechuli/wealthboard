import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RouteError } from './RouteError'

function Broken(): never {
  throw new TypeError('Not a minor-unit string: 4576918.25')
}

describe('route error boundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('never renders the exception text, which can carry private amounts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const router = createMemoryRouter([{ path: '/', element: <Broken />, errorElement: <RouteError /> }])
    render(<RouterProvider router={router} />)

    expect(await screen.findByRole('heading', { name: 'Something broke on this screen' })).toBeInTheDocument()
    expect(screen.getByText('TypeError')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('4576918')
    expect(document.body.textContent).not.toContain('minor-unit')
  })
})
