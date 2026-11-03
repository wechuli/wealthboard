import { zodResolver } from '@hookform/resolvers/zod'
import { useId } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { EstatePlan, EstatePlanInput } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { DateField, TextField } from '@/components/ui/Field'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation } from '@/lib/queries'
import { fieldError, ProblemNotice } from './kit'
import { calendarDate } from './model'

const DATE = /^\d{4}-\d{2}-\d{2}$/

const schema = z
  .object({
    title: z.string().trim().min(1, 'Give the plan a title').max(120, 'Use 120 characters or fewer'),
    jurisdiction: z.string().trim().max(120, 'Use 120 characters or fewer'),
    lastReviewedDate: z.string().refine((v) => v === '' || DATE.test(v), 'Enter a valid date'),
    reviewReminderDate: z.string().refine((v) => v === '' || DATE.test(v), 'Enter a valid date'),
  })
  .refine((v) => !v.lastReviewedDate || !v.reviewReminderDate || v.reviewReminderDate >= v.lastReviewedDate, {
    path: ['reviewReminderDate'],
    message: 'Choose a date on or after the last review',
  })
type Values = z.infer<typeof schema>

/** Plan title, jurisdiction reference, and review dates (PUT /estate/plan). */
export function PlanDetailsForm({ plan, submitLabel = 'Save plan details', onSaved }: { plan: EstatePlan | null; submitLabel?: string; onSaved?(): void }) {
  const formId = useId()
  const online = useOnline()
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      title: plan?.title ?? '',
      jurisdiction: plan?.jurisdiction ?? '',
      lastReviewedDate: calendarDate(plan?.lastReviewedDate),
      reviewReminderDate: calendarDate(plan?.reviewReminderDate),
    },
  })
  const save = useApiMutation({
    mutationFn: (body: EstatePlanInput) => api.estate.updatePlan(body),
    success: 'Plan details saved',
    toastError: false,
    onSuccess: () => onSaved?.(),
  })
  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    save.mutate({
      title: v.title,
      jurisdiction: v.jurisdiction || undefined,
      lastReviewedDate: v.lastReviewedDate || null,
      reviewReminderDate: v.reviewReminderDate || null,
    })
  })
  const err = (name: keyof Values) => formState.errors[name]?.message ?? fieldError(save.error, name)

  return (
    <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-5" aria-label="Plan details">
      <ProblemNotice error={save.error} title="Plan details were not saved" />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField label="Plan title" placeholder="For example, Family estate plan" maxLength={120} error={err('title')} {...register('title')} />
        <TextField
          label="Jurisdiction or residence"
          optional
          maxLength={120}
          placeholder="For example, Kenya"
          hint="A reference for you and your adviser. Wealthboard does not apply local law."
          error={err('jurisdiction')}
          {...register('jurisdiction')}
        />
        <DateField label="Last reviewed" optional error={err('lastReviewedDate')} {...register('lastReviewedDate')} />
        <DateField label="Review again on" optional hint="We'll flag the plan for review from this date." error={err('reviewReminderDate')} {...register('reviewReminderDate')} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!online}>
          {submitLabel}
        </Button>
        {!online ? <p className="text-xs text-warning">{OFFLINE_REASON}</p> : null}
      </div>
    </form>
  )
}
