import { zodResolver } from '@hookform/resolvers/zod'
import { Building2, Landmark, User } from 'lucide-react'
import { useId } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Beneficiary, BeneficiaryInput } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Dialog'
import { ChoiceCards, TextareaField, TextField } from '@/components/ui/Field'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation } from '@/lib/queries'
import { fieldError, ProblemNotice } from './kit'

const schema = z.object({
  kind: z.enum(['person', 'organization', 'trust']),
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Use 120 characters or fewer'),
  relationship: z.string().trim().max(80, 'Use 80 characters or fewer'),
  contactSummary: z.string().trim().max(300, 'Use 300 characters or fewer'),
  notes: z.string().trim().max(2000, 'Use 2,000 characters or fewer'),
})
type Values = z.infer<typeof schema>

const KIND_OPTIONS = [
  { value: 'person' as const, title: 'Person', description: 'Family, friends, or anyone else', icon: <User size={18} aria-hidden /> },
  { value: 'organization' as const, title: 'Organization', description: 'A charity, school, or church', icon: <Building2 size={18} aria-hidden /> },
  { value: 'trust' as const, title: 'Trust', description: 'An existing or planned trust', icon: <Landmark size={18} aria-hidden /> },
]

/** Add or edit one beneficiary. Mount with a fresh `key` per opening so defaults reset. */
export function BeneficiarySheet({ open, onOpenChange, beneficiary }: { open: boolean; onOpenChange(open: boolean): void; beneficiary: Beneficiary | null }) {
  const formId = useId()
  const online = useOnline()
  const { register, handleSubmit, formState, control } = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      kind: beneficiary?.kind ?? 'person',
      name: beneficiary?.name ?? '',
      relationship: beneficiary?.relationship ?? '',
      contactSummary: beneficiary?.contactSummary ?? '',
      notes: beneficiary?.notes ?? '',
    },
  })
  const save = useApiMutation({
    mutationFn: (body: BeneficiaryInput) => (beneficiary ? api.estate.updateBeneficiary(beneficiary.id, body) : api.estate.createBeneficiary(body).then(() => undefined)),
    success: (_r, body) => (beneficiary ? `${body.name} saved` : `${body.name} added`),
    toastError: false,
    onSuccess: () => onOpenChange(false),
  })
  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    save.mutate({
      kind: v.kind,
      name: v.name,
      relationship: v.relationship || undefined,
      contactSummary: v.contactSummary || undefined,
      notes: v.notes || undefined,
    })
  })
  const err = (name: keyof Values) => formState.errors[name]?.message ?? fieldError(save.error, name)

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={beneficiary ? `Edit ${beneficiary.name}` : 'Add beneficiary'}
      description="A private planning record. It never becomes a Wealthboard login and can't see your portfolio."
      footer={
        <>
          {!online ? <p className="mr-auto self-center text-xs text-warning">{OFFLINE_REASON}</p> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!online}>
            {beneficiary ? 'Save beneficiary' : 'Add beneficiary'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ProblemNotice error={save.error} title="The beneficiary was not saved" />
        <Controller control={control} name="kind" render={({ field }) => <ChoiceCards legend="Type" name={`${formId}-kind`} columns={3} value={field.value} onChange={field.onChange} options={KIND_OPTIONS} />} />
        <TextField label="Name" autoComplete="off" maxLength={120} error={err('name')} {...register('name')} />
        <TextField label="Relationship" optional maxLength={80} placeholder="For example, daughter, sibling, or charity" error={err('relationship')} {...register('relationship')} />
        <TextField
          label="Contact summary"
          optional
          maxLength={300}
          placeholder="Phone, email, or adviser reference"
          hint="Excluded from printed summaries unless you include it."
          error={err('contactSummary')}
          {...register('contactSummary')}
        />
        <TextareaField
          label="Private notes"
          optional
          maxLength={2000}
          hint="Don't store national ID numbers, identity documents, medical details, or bank instructions."
          error={err('notes')}
          {...register('notes')}
        />
      </form>
    </Sheet>
  )
}
