import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react'
import { createBrowserRouter, Navigate, Outlet, ScrollRestoration, useParams, useSearchParams } from 'react-router'
import { PageSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { AppShell } from '@/features/shell/AppShell'
import { RouteError } from '@/features/system/RouteError'
import { PublicOnly, RequireSession } from './guards'

function page(loader: () => Promise<{ default: ComponentType }>, nested = false) {
  const Component: LazyExoticComponent<ComponentType> = lazy(loader)
  return (
    <Suspense fallback={nested ? <Skeleton className="h-96" label="Loading" /> : <PageSkeleton />}>
      <Component />
    </Suspense>
  )
}

function Root() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  )
}

/** Paths used by the previous client, the manifest, docs, and server redirects keep working. */
function Redirect({ to }: { to: (params: Record<string, string | undefined>, search: URLSearchParams) => string }) {
  const params = useParams()
  const [search] = useSearchParams()
  return <Navigate to={to(params, search)} replace />
}
const withSearch = (path: string, search: URLSearchParams, extra: Record<string, string> = {}) => {
  const next = new URLSearchParams(search)
  for (const [k, v] of Object.entries(extra)) next.set(k, v)
  const qs = next.toString()
  return qs ? `${path}?${qs}` : path
}
const legacyRedirects = [
  { path: 'transactions', element: <Redirect to={(_p, q) => withSearch('/activity', q)} /> },
  { path: 'transactions/new', element: <Redirect to={(_p, q) => `/?record=${q.get('type') ?? 'deposit'}${q.get('accountId') ? `&accountId=${q.get('accountId')}` : ''}`} /> },
  { path: 'transactions/:id/edit', element: <Navigate to="/activity" replace /> },
  { path: 'reports', element: <Navigate to="/insights" replace /> },
  { path: 'categories', element: <Navigate to="/settings/categories" replace /> },
  { path: 'institutions', element: <Navigate to="/settings/institutions" replace /> },
  { path: 'instruments', element: <Navigate to="/settings/instruments" replace /> },
  { path: 'instruments/new', element: <Navigate to="/settings/instruments?new=1" replace /> },
  { path: 'instruments/:id/edit', element: <Redirect to={(p) => `/settings/instruments?edit=${p.id}`} /> },
  { path: 'accounts/archived', element: <Navigate to="/accounts?show=archived" replace /> },
  { path: 'accounts/:id/edit', element: <Redirect to={(p) => `/accounts/${p.id}?edit=1`} /> },
  { path: 'accounts/:id/valuation', element: <Redirect to={(p) => `/accounts/${p.id}?record=valuation`} /> },
  { path: 'accounts/:id/convert', element: <Redirect to={(p) => `/accounts/${p.id}?action=convert`} /> },
  { path: 'accounts/:id/reconcile', element: <Redirect to={(p) => `/accounts/${p.id}?action=reconcile`} /> },
  { path: 'accounts/:id/investment-actions', element: <Redirect to={(p) => `/accounts/${p.id}?action=corporate`} /> },
  { path: 'accounts/:id/instruments/new', element: <Navigate to="/settings/instruments?new=1" replace /> },
  { path: 'accounts/:id/positions/new', element: <Redirect to={(p, q) => `/accounts/${p.id}?action=trade&trade=${q.get('type') ?? 'buy'}${q.get('instrumentId') ? `&instrument=${q.get('instrumentId')}` : ''}`} /> },
  { path: 'accounts/:id/positions/:eventId/edit', element: <Redirect to={(p) => `/accounts/${p.id}?editTrade=${p.eventId}`} /> },
  { path: 'accounts/:id/prices/new', element: <Redirect to={(p, q) => `/accounts/${p.id}?record=price${q.get('instrumentId') ? `&instrumentId=${q.get('instrumentId')}` : ''}`} /> },
  { path: 'goals/new', element: <Navigate to="/goals?record=goal" replace /> },
  { path: 'goals/:id/edit', element: <Redirect to={(p) => `/goals/${p.id}?edit=1`} /> },
  { path: 'labs/estate', element: <Navigate to="/estate" replace /> },
  { path: 'labs/ai-review', element: <Navigate to="/" replace /> },
  { path: 'settings/ai', element: <Navigate to="/settings/connected-apps" replace /> },
  { path: 'review', element: <Navigate to="/" replace /> },
  { path: 'offline', element: <Navigate to="/" replace /> },
]

const devRoutes = import.meta.env.DEV ? [{ path: 'dev/style-guide', element: page(() => import('@/features/styleguide/StyleGuidePage')) }] : []

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: 'sign-in', element: page(() => import('@/features/auth/SignInPage')) },
          { path: 'sign-up', element: page(() => import('@/features/auth/SignUpPage')) },
          { path: 'login', element: <Redirect to={(_p, q) => withSearch('/sign-in', q)} /> },
          { path: 'signup', element: <Navigate to="/sign-up" replace /> },
        ],
      },
      {
        element: <RequireSession />,
        children: [
          // An AI assistant sends the browser here to approve its connection; it stands apart from the app shell.
          { path: 'oauth/consent', element: page(() => import('@/features/oauth/ConsentPage')) },
          {
            element: <AppShell />,
            errorElement: <RouteError />,
            children: [
              { index: true, element: page(() => import('@/features/home/HomePage')) },
              { path: 'accounts', element: page(() => import('@/features/accounts/AccountsPage')) },
              { path: 'accounts/new', element: page(() => import('@/features/recording/NewAccountPage')) },
              { path: 'accounts/:accountId', element: page(() => import('@/features/account-detail/AccountDetailPage')) },
              { path: 'accounts/:accountId/import', element: page(() => import('@/features/imports/ImportPage')) },
              { path: 'instruments/:instrumentId', element: page(() => import('@/features/instruments/InstrumentPage')) },
              { path: 'activity', element: page(() => import('@/features/activity/ActivityPage')) },
              { path: 'goals', element: page(() => import('@/features/goals/GoalsPage')) },
              { path: 'goals/:goalId', element: page(() => import('@/features/goals/GoalDetailPage')) },
              {
                path: 'insights',
                element: page(() => import('@/features/insights/InsightsLayout')),
                children: [
                  { index: true, element: <Navigate to="net-worth" replace /> },
                  { path: 'net-worth', element: page(() => import('@/features/insights/NetWorthPage'), true) },
                  { path: 'allocation', element: page(() => import('@/features/insights/AllocationPage'), true) },
                  { path: 'income', element: page(() => import('@/features/insights/IncomePage'), true) },
                  { path: 'compare', element: page(() => import('@/features/insights/ComparePage'), true) },
                ],
              },
              {
                path: 'settings',
                element: page(() => import('@/features/settings/SettingsLayout')),
                children: [
                  // The server returns OIDC link/re-auth results to /settings?auth=…; send them to Security.
                  { index: true, element: <Redirect to={(_p, q) => (q.has('auth') || q.has('reauthenticated') ? withSearch('/settings/security', q) : '/settings/profile')} /> },
                  { path: 'profile', element: page(() => import('@/features/settings/ProfileSettings'), true) },
                  { path: 'currencies', element: page(() => import('@/features/settings/CurrencySettings'), true) },
                  { path: 'preferences', element: page(() => import('@/features/settings/PreferenceSettings'), true) },
                  { path: 'categories', element: page(() => import('@/features/settings/CategorySettings'), true) },
                  { path: 'institutions', element: page(() => import('@/features/settings/InstitutionSettings'), true) },
                  { path: 'instruments', element: page(() => import('@/features/settings/InstrumentSettings'), true) },
                  { path: 'security', element: page(() => import('@/features/settings/SecuritySettings'), true) },
                  { path: 'api-keys', element: page(() => import('@/features/settings/ApiKeysSettings'), true) },
                  { path: 'connected-apps', element: page(() => import('@/features/settings/ConnectedAppsSettings'), true) },
                  { path: 'data', element: page(() => import('@/features/settings/DataSettings'), true) },
                ],
              },
              {
                path: 'estate',
                element: page(() => import('@/features/estate/EstateLayout')),
                children: [
                  { index: true, element: page(() => import('@/features/estate/EstateOverviewPage'), true) },
                  { path: 'beneficiaries', element: page(() => import('@/features/estate/BeneficiariesPage'), true) },
                  { path: 'distribution', element: page(() => import('@/features/estate/DistributionPage'), true) },
                  { path: 'summary', element: page(() => import('@/features/estate/SummaryPage'), true) },
                ],
              },
              { path: 'estate/snapshots/:snapshotId', element: page(() => import('@/features/estate/SnapshotPage')) },
              ...legacyRedirects,
              ...devRoutes,
              { path: '*', element: page(() => import('@/features/system/NotFoundPage')) },
            ],
          },
        ],
      },
    ],
  },
])
