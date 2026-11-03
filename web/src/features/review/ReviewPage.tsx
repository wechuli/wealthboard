import { Settings2, Sparkles } from 'lucide-react'
import { Link } from 'react-router'
import { buttonClass } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { PageHeader } from '@/components/ui/PageHeader'
import { Skeleton } from '@/components/ui/Skeleton'
import { useAI } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { AdviceNotice } from './parts'
import { ReviewWorkspace } from './ReviewWorkspace'

function ReviewSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="card space-y-5 px-5 py-6 md:px-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-64 max-w-full" />
        <div className="grid gap-2.5 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-24" />
      </div>
      <div className="card space-y-3 px-5 py-6 md:px-6">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    </div>
  )
}

export default function ReviewPage() {
  usePageTitle('Portfolio review')
  const ai = useAI()

  let content
  if (ai.isPending) content = <ReviewSkeleton />
  else if (ai.isError)
    content = (
      <div className="card">
        <ErrorState error={ai.error} onRetry={() => void ai.refetch()} title="Portfolio review could not be loaded" />
      </div>
    )
  else if (!ai.data.settings || !ai.data.reviewAvailability.providerConfigured)
    content = (
      <div className="card">
        <EmptyState
          icon={<Sparkles size={22} aria-hidden />}
          title="Connect an AI provider to request a review"
          action={
            <Link to="/settings/ai" className={buttonClass({ variant: 'primary' })}>
              Set up AI provider
            </Link>
          }
        >
          Choose OpenAI, Anthropic, or DeepSeek and a model, using your own API key. Nothing is sent until you ask for a review, and you choose what’s shared each time.
        </EmptyState>
      </div>
    )
  else content = <ReviewWorkspace ai={ai.data} settings={ai.data.settings} />

  return (
    <div className="page">
      <PageHeader
        title="Portfolio review"
        description="An on-demand read of your portfolio by the AI provider you connect, grounded in figures Wealthboard has already calculated."
        actions={
          <Link to="/settings/ai" className={buttonClass({ variant: 'secondary' })}>
            <Settings2 size={16} aria-hidden />
            AI settings
          </Link>
        }
      />
      <AdviceNotice className="mb-6" />
      {content}
    </div>
  )
}
