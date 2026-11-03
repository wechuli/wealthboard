import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { PrivacyProvider } from '@/lib/privacy'
import { SessionProvider } from '@/lib/session'
import { ThemeProvider } from '@/lib/theme-context'

/** Renders UI inside every app provider with a memory router. */
export function renderWithApp(ui: ReactNode, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(
    [
      { path: '*', element: ui },
      { path: '/accounts/new', element: <p>New account wizard</p> },
    ],
    { initialEntries: [route] },
  )
  return {
    client,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <PrivacyProvider>
            <TooltipProvider>
              <SessionProvider>
                <RouterProvider router={router} />
              </SessionProvider>
              <Toaster />
            </TooltipProvider>
          </PrivacyProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    ),
  }
}
