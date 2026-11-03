import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router'
import { useState } from 'react'
import { Toaster } from 'sonner'
import { ApiProblem } from '@/api/problem'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { PrivacyProvider } from '@/lib/privacy'
import { SessionProvider } from '@/lib/session'
import { ThemeProvider, useTheme } from '@/lib/theme-context'
import { router } from './router'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) => !(ApiProblem.is(error) && error.status >= 400 && error.status < 500) && count < 1,
      },
      mutations: { retry: false },
    },
  })
}

function ThemedToaster() {
  const { resolved } = useTheme()
  return (
    <Toaster
      theme={resolved}
      position="bottom-right"
      closeButton
      offset={16}
      mobileOffset={{ bottom: 88 }}
      toastOptions={{
        classNames: {
          toast: '!bg-raised !text-ink !border-line !shadow-e3 !rounded-lg !font-sans',
          description: '!text-muted',
          actionButton: '!bg-accent !text-on-accent',
        },
      }}
    />
  )
}

export function App() {
  const [client] = useState(createQueryClient)
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PrivacyProvider>
          <TooltipProvider>
            <SessionProvider>
              <RouterProvider router={router} />
            </SessionProvider>
            <ThemedToaster />
          </TooltipProvider>
        </PrivacyProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
