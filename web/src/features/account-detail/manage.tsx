/** Edit, archive, and delete for an account. */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { api } from '@/api'
import { ApiProblem, problemMessage } from '@/api/problem'
import type { Account } from '@/api/types'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog'
import { SelectField, SwitchField, TextareaField, TextField } from '@/components/ui/Field'
import { Notice } from '@/components/ui/Notice'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useCategories, useInstitutions } from '@/lib/queries'

export function EditAccountSheet({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange(o: boolean): void }) {
  const online = useOnline()
  const categories = useCategories()
  const institutions = useInstitutions()
  const [name, setName] = useState(account.name)
  const [description, setDescription] = useState(account.description ?? '')
  const [categoryId, setCategoryId] = useState(account.categoryId)
  const [institutionId, setInstitutionId] = useState(account.institutionId ?? '')
  const [reference, setReference] = useState(account.accountReference ?? '')
  const [notes, setNotes] = useState(account.notes ?? '')
  const [included, setIncluded] = useState(account.isIncludedInNetWorth)
  const [nameError, setNameError] = useState<string | undefined>()

  const save = useApiMutation({
    mutationFn: () =>
      api.accounts.update(account.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        categoryId,
        institutionId: institutionId || null,
        accountReference: reference.trim() || undefined,
        notes: notes.trim() || undefined,
        isIncludedInNetWorth: included,
        currency: account.currency,
      }),
    success: 'Account updated',
    toastError: false,
    onSuccess: () => onOpenChange(false),
  })
  const fe = ApiProblem.is(save.error) ? (save.error.fieldErrors ?? {}) : {}

  const kind = account.isLiability ? 'liability' : 'asset'
  const categoryOptions = (categories.data ?? [])
    .filter((c) => (!c.isArchived || c.id === account.categoryId) && c.assetOrLiability === kind)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((c) => ({ value: c.id, label: c.name }))
  if (!categoryOptions.some((o) => o.value === account.categoryId)) categoryOptions.unshift({ value: account.categoryId, label: account.categoryName })
  const institutionOptions = [
    { value: '', label: 'No institution' },
    ...(institutions.data ?? []).filter((i) => !i.archivedAt || i.id === account.institutionId).map((i) => ({ value: i.id, label: i.name })),
  ]

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setNameError('Give the account a name')
      return
    }
    setNameError(undefined)
    save.mutate(undefined)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Edit account"
      description="Names, grouping, and notes. Values change through recorded activity, not here."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="edit-account" loading={save.isPending} disabled={!online} title={online ? undefined : OFFLINE_REASON}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="edit-account" onSubmit={onSubmit} className="space-y-5" noValidate>
        {save.isError && Object.keys(fe).length === 0 ? (
          <Notice tone="negative" role="alert" title={ApiProblem.is(save.error) ? save.error.title : 'Could not save'}>
            {problemMessage(save.error)}
          </Notice>
        ) : null}
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} error={nameError ?? fe.name} autoComplete="off" required />
        <TextField label="Description" optional value={description} onChange={(e) => setDescription(e.target.value)} error={fe.description} hint="A short line shown under the name, such as “⅛ acre plot, Kajiado North”." />
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectField label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} options={categoryOptions} error={fe.categoryId} />
          <SelectField label="Institution" optional value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} options={institutionOptions} error={fe.institutionId} />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField label="Reference" optional value={reference} onChange={(e) => setReference(e.target.value)} error={fe.accountReference} hint="Account or policy number. Keep it partial if you prefer." />
          <TextField label="Currency" value={account.currency} disabled readOnly hint="Fixed once the account exists, so its history stays consistent." />
        </div>
        <TextareaField label="Notes" optional value={notes} onChange={(e) => setNotes(e.target.value)} error={fe.notes} rows={4} />
        <div className="rounded-md border border-line px-3.5 py-2.5">
          <SwitchField
            label="Include in net worth"
            description={included ? 'Counted in your totals and allocation.' : 'Kept for reference only. Left out of totals and allocation.'}
            checked={included}
            onCheckedChange={setIncluded}
          />
        </div>
      </form>
    </Sheet>
  )
}

export function ArchiveDialog({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange(o: boolean): void }) {
  const navigate = useNavigate()
  const online = useOnline()
  const archive = useApiMutation({
    mutationFn: () => api.accounts.setArchived(account.id, true),
    success: `${account.name} archived`,
    onSuccess: () => {
      onOpenChange(false)
      navigate('/accounts?show=archived')
    },
  })
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Archive ${account.name}?`}
      description="Its history is kept, but it leaves your totals, goals, and lists. You can restore it from archived accounts any time."
      confirmLabel="Archive account"
      tone="primary"
      pending={archive.isPending}
      confirmDisabled={!online}
      onConfirm={() => archive.mutate(undefined)}
    />
  )
}

export function DeleteDialog({ account, open, onOpenChange }: { account: Account; open: boolean; onOpenChange(o: boolean): void }) {
  const navigate = useNavigate()
  const online = useOnline()
  const [typed, setTyped] = useState('')
  const remove = useApiMutation({
    mutationFn: () => api.accounts.remove(account.id, typed),
    success: `${account.name} deleted`,
    toastError: false,
    onSuccess: () => {
      onOpenChange(false)
      navigate('/accounts', { replace: true })
    },
  })
  const matches = typed === account.name
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setTyped('')
        onOpenChange(o)
      }}
      title={`Delete ${account.name}?`}
      description="This permanently removes the account and every transaction, valuation, and trade recorded in it. It can't be undone."
      confirmLabel="Delete permanently"
      pending={remove.isPending}
      confirmDisabled={!matches || !online}
      onConfirm={() => matches && remove.mutate(undefined)}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">If you only want it out of your totals, archive it instead.</p>
        <TextField
          label={
            <>
              Type <span className="font-semibold">{account.name}</span> to confirm
            </>
          }
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          error={remove.isError ? problemMessage(remove.error) : undefined}
        />
      </div>
    </ConfirmDialog>
  )
}
