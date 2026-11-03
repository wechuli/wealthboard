import { zodResolver } from '@hookform/resolvers/zod'
import { Archive, ArchiveRestore, ExternalLink, Landmark, Pencil, Plus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Institution, InstitutionMutationRequest, InstitutionType } from '@/api/types'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { SelectField, TextareaField, TextField } from '@/components/ui/Field'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useInstitutions } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { applyFieldErrors, Disclosure, ListSkeleton, ProblemNotice, SettingsPanel } from './settings-kit'

export const INSTITUTION_TYPES: { value: InstitutionType; label: string }[] = [
  { value: 'bank', label: 'Bank' },
  { value: 'credit_union', label: 'Sacco or credit union' },
  { value: 'brokerage', label: 'Brokerage' },
  { value: 'asset_manager', label: 'Fund or asset manager' },
  { value: 'pension_provider', label: 'Pension provider' },
  { value: 'insurer', label: 'Insurer' },
  { value: 'lender', label: 'Lender' },
  { value: 'digital_wallet', label: 'Mobile money or digital wallet' },
  { value: 'government', label: 'Government' },
  { value: 'employer', label: 'Employer' },
  { value: 'other', label: 'Other' },
]
const typeLabel = (t: string) => INSTITUTION_TYPES.find((x) => x.value === t)?.label ?? 'Other'
const TYPE_VALUES = INSTITUTION_TYPES.map((t) => t.value) as [InstitutionType, ...InstitutionType[]]

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null
function countryLabel(code?: string): string | null {
  if (!code) return null
  try {
    return regionNames?.of(code.toUpperCase()) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

function hostOf(url?: string): string | null {
  if (!url) return null
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name the institution').max(80, 'Use 80 characters or fewer'),
  type: z.enum(TYPE_VALUES),
  websiteUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v), 'Use a full address, for example https://www.kcbgroup.com'),
  countryCode: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[A-Za-z]{2}$/.test(v), 'Use the two-letter country code, for example KE'),
  notes: z.string().trim().max(500, 'Use 500 characters or fewer'),
})
type Values = z.infer<typeof schema>

function InstitutionSheet({ open, onOpenChange, institution }: { open: boolean; onOpenChange(o: boolean): void; institution: Institution | null }) {
  const formId = useId()
  const online = useOnline()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      name: institution?.name ?? '',
      type: (TYPE_VALUES as string[]).includes(institution?.type ?? '') ? (institution!.type as InstitutionType) : 'bank',
      websiteUrl: institution?.websiteUrl ?? '',
      countryCode: institution?.countryCode ?? 'KE',
      notes: institution?.notes ?? '',
    },
  })
  const { register, handleSubmit, formState, setError } = form
  const save = useApiMutation({
    mutationFn: (body: InstitutionMutationRequest) => (institution ? api.institutions.update(institution.id, body) : api.institutions.create(body).then(() => undefined)),
    success: (_r, body) => (institution ? `${body.name} saved` : `${body.name} added`),
    toastError: false,
    onSuccess: () => onOpenChange(false),
  })
  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    const body: InstitutionMutationRequest = {
      name: v.name,
      type: v.type,
      websiteUrl: v.websiteUrl || undefined,
      countryCode: v.countryCode ? v.countryCode.toUpperCase() : undefined,
      notes: v.notes || undefined,
      address: institution?.address,
    }
    save.mutate(body, { onError: (err) => applyFieldErrors(err, setError, ['name', 'type', 'websiteUrl', 'countryCode', 'notes']) })
  })

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={institution ? `Edit ${institution.name}` : 'New institution'}
      description="Banks, fund managers, brokers, and lenders that hold your accounts. Linking them is optional."
      footer={
        <>
          {!online ? <p className="mr-auto self-center text-xs text-warning">{OFFLINE_REASON}</p> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!online}>
            {institution ? 'Save institution' : 'Add institution'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
        <ProblemNotice error={save.error} />
        <TextField label="Name" autoComplete="organization" placeholder="For example, NCBA Bank" error={formState.errors.name?.message} {...register('name')} />
        <SelectField label="Type" options={INSTITUTION_TYPES} error={formState.errors.type?.message} {...register('type')} />
        <TextField label="Website" optional type="url" inputMode="url" autoComplete="url" placeholder="https://" error={formState.errors.websiteUrl?.message} {...register('websiteUrl')} />
        <div className="max-w-40">
          <TextField
            label="Country"
            optional
            maxLength={2}
            autoComplete="country"
            className="[&_input]:uppercase"
            hint="Two-letter code, such as KE or UG."
            error={formState.errors.countryCode?.message}
            {...register('countryCode')}
          />
        </div>
        <TextareaField label="Notes" optional placeholder="Branch, relationship manager, or anything you want to remember" error={formState.errors.notes?.message} {...register('notes')} />
      </form>
    </Sheet>
  )
}

function InstitutionList({ institutions }: { institutions: Institution[] }) {
  const online = useOnline()
  const active = useMemo(() => institutions.filter((i) => !i.archivedAt), [institutions])
  const archived = useMemo(() => institutions.filter((i) => !!i.archivedAt), [institutions])
  const [editing, setEditing] = useState<Institution | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetKey, setSheetKey] = useState(0)
  const [archiving, setArchiving] = useState<Institution | null>(null)

  const archive = useApiMutation({
    mutationFn: (i: Institution) => api.institutions.setArchived(i.id, true),
    success: (_r, i) => `${i.name} archived`,
    toastError: false,
    onSuccess: () => setArchiving(null),
  })
  const restore = useApiMutation({ mutationFn: (i: Institution) => api.institutions.setArchived(i.id, false), success: (_r, i) => `${i.name} restored` })

  const openSheet = (i: Institution | null) => {
    setEditing(i)
    setSheetKey((k) => k + 1)
    setSheetOpen(true)
  }

  const actions = (i: Institution) => (
    <div className="flex items-center justify-end gap-0.5">
      <IconButton label={`Edit ${i.name}`} icon={<Pencil size={16} aria-hidden />} onClick={() => openSheet(i)} />
      <IconButton label={`Archive ${i.name}`} icon={<Archive size={16} aria-hidden />} disabled={!online} onClick={() => setArchiving(i)} />
    </div>
  )

  return (
    <SettingsPanel
      title="Institutions"
      description="Where your accounts are held. Group and filter accounts by institution on the Accounts page."
      action={
        <Button variant="secondary" icon={<Plus size={16} aria-hidden />} onClick={() => openSheet(null)} disabled={!online} title={!online ? OFFLINE_REASON : undefined}>
          New institution
        </Button>
      }
    >
      {active.length === 0 ? (
        <EmptyState compact icon={<Landmark size={20} aria-hidden />} title="No institutions yet">
          Add the banks, funds, and brokers you use, then link them when you add or edit an account.
        </EmptyState>
      ) : (
        <>
          <table className="hidden w-full text-sm md:table">
            <caption className="sr-only">Institutions</caption>
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 pr-3 text-left font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Type
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Country
                </th>
                <th scope="col" className="px-3 py-2 text-left font-medium">
                  Website
                </th>
                <th scope="col" className="w-24 py-2 pl-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {active.map((i) => (
                <tr key={i.id} className="border-t border-line align-middle first:border-t-0">
                  <td className="max-w-0 py-2.5 pr-3">
                    <p className="truncate font-medium text-ink">{i.name}</p>
                    {i.notes ? <p className="truncate text-xs text-muted">{i.notes}</p> : null}
                  </td>
                  <td className="px-3 py-2.5 text-muted">{typeLabel(i.type)}</td>
                  <td className="px-3 py-2.5 text-muted">{countryLabel(i.countryCode) ?? <span className="text-subtle">—</span>}</td>
                  <td className="px-3 py-2.5">
                    {i.websiteUrl ? (
                      <a href={i.websiteUrl} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
                        {hostOf(i.websiteUrl)}
                        <ExternalLink size={12} aria-hidden />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="text-subtle">—</span>
                    )}
                  </td>
                  <td className="py-1.5 pl-3">{actions(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="flex flex-col divide-y divide-line md:hidden" aria-label="Institutions">
            {active.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{i.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{typeLabel(i.type)}</span>
                    {i.countryCode ? <Badge tone="neutral">{i.countryCode.toUpperCase()}</Badge> : null}
                  </p>
                </div>
                {actions(i)}
              </li>
            ))}
          </ul>
        </>
      )}
      {archived.length > 0 ? (
        <Disclosure label="Archived institutions" count={archived.length} className="mt-4">
          <ul className="flex flex-col divide-y divide-line">
            {archived.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{i.name}</span>
                <Button size="sm" variant="ghost" icon={<ArchiveRestore size={15} aria-hidden />} disabled={!online || restore.isPending} onClick={() => restore.mutate(i)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      <InstitutionSheet key={sheetKey} open={sheetOpen} onOpenChange={setSheetOpen} institution={editing} />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => {
          if (!o) {
            setArchiving(null)
            archive.reset()
          }
        }}
        title={archiving ? `Archive ${archiving.name}?` : 'Archive institution?'}
        description="It disappears from forms and filters. Accounts already linked to it keep the link, and you can restore it later."
        confirmLabel="Archive"
        pending={archive.isPending}
        confirmDisabled={!online}
        onConfirm={() => {
          if (archiving && !archive.isPending) archive.mutate(archiving)
        }}
      >
        <ProblemNotice error={archive.error} />
      </ConfirmDialog>
    </SettingsPanel>
  )
}

export default function InstitutionSettings() {
  usePageTitle('Institutions')
  const { data, error, isPending, refetch } = useInstitutions()
  if (isPending) return <ListSkeleton rows={6} />
  if (error || !data)
    return (
      <div className="card">
        <ErrorState error={error} onRetry={() => void refetch()} title="Institutions could not be loaded" />
      </div>
    )
  return <InstitutionList institutions={data} />
}
