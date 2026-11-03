import { zodResolver } from '@hookform/resolvers/zod'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, GripVertical, Lock, Pencil, Plus, Tags } from 'lucide-react'
import { useId, useMemo, useRef, useState, type DragEvent } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'
import { api } from '@/api'
import type { Category, CategoryMutationRequest } from '@/api/types'
import { canonicalIconName, CategoryIcon, ICON_NAMES, ICONS } from '@/components/CategoryIcon'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ChoiceCards, SwitchField, TextareaField, TextField } from '@/components/ui/Field'
import { cn } from '@/lib/cn'
import { OFFLINE_REASON, useOnline } from '@/lib/online'
import { useApiMutation, useCategories } from '@/lib/queries'
import { usePageTitle } from '@/lib/usePageTitle'
import { applyFieldErrors, Disclosure, ListSkeleton, ProblemNotice, SettingsPanel } from './settings-kit'

/** "PiggyBank" → "Piggy bank" (icons are stored as PascalCase Lucide names). */
const iconLabel = (name: string) => {
  const t = canonicalIconName(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ---- add / edit sheet ----------------------------------------------------------

const schema = z.object({
  name: z.string().trim().min(1, 'Name the category').max(100, 'Use 100 characters or fewer'),
  icon: z.string().min(1, 'Choose an icon'),
  assetOrLiability: z.enum(['asset', 'liability']),
  isLiquid: z.boolean(),
  isInvestible: z.boolean(),
  description: z.string().trim().max(2000, 'Use 2,000 characters or fewer'),
})
type Values = z.infer<typeof schema>

function IconPicker({ value, onChange, error }: { value: string; onChange(v: string): void; error?: string }) {
  const name = useId()
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">Icon</legend>
      {value && !ICONS[value] ? (
        <p className="mb-2 text-xs text-muted">
          The current icon (<code className="font-mono">{value}</code>) isn’t in this set. It’s kept unless you choose another.
        </p>
      ) : null}
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-7">
        {ICON_NAMES.map((n) => {
          const selected = value === n
          return (
            <label
              key={n}
              title={iconLabel(n)}
              className={cn(
                'grid aspect-square min-h-11 cursor-pointer place-items-center rounded-md border transition-[background-color,border-color,color] duration-[var(--dur-1)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]',
                selected ? 'border-accent bg-accent-soft text-accent shadow-[inset_0_0_0_1px_var(--accent)]' : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink',
              )}
            >
              <input type="radio" name={name} value={n} checked={selected} onChange={() => onChange(n)} className="sr-only" />
              <CategoryIcon name={n} size={20} />
              <span className="sr-only">{iconLabel(n)}</span>
            </label>
          )
        })}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-negative" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

function CategorySheet({ open, onOpenChange, category }: { open: boolean; onOpenChange(o: boolean): void; category: Category | null }) {
  const formId = useId()
  const online = useOnline()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: category
      ? {
          name: category.name,
          icon: canonicalIconName(category.icon),
          assetOrLiability: category.assetOrLiability === 'liability' ? 'liability' : 'asset',
          isLiquid: category.isLiquid,
          isInvestible: category.isInvestible,
          description: category.description ?? '',
        }
      : { name: '', icon: 'Wallet', assetOrLiability: 'asset', isLiquid: false, isInvestible: false, description: '' },
  })
  const { register, control, handleSubmit, formState, setError } = form
  const save = useApiMutation({
    mutationFn: (body: CategoryMutationRequest) => (category ? api.categories.update(category.id, body) : api.categories.create(body).then(() => undefined)),
    success: (_r, body) => (category ? `${body.name} saved` : `${body.name} added`),
    toastError: false,
    onSuccess: () => onOpenChange(false),
  })

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    const body: CategoryMutationRequest = { name: v.name, icon: v.icon, assetOrLiability: v.assetOrLiability, isLiquid: v.isLiquid, isInvestible: v.isInvestible, description: v.description || undefined }
    save.mutate(body, { onError: (err) => applyFieldErrors(err, setError, ['name', 'icon', 'assetOrLiability', 'description']) })
  })

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={category ? `Edit ${category.name}` : 'New category'}
      description="Categories group your accounts. Their flags decide liquid versus illiquid and investible versus lifestyle views."
      footer={
        <>
          {!online ? <p className="mr-auto self-center text-xs text-warning">{OFFLINE_REASON}</p> : null}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending} disabled={!online}>
            {category ? 'Save category' : 'Add category'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <ProblemNotice error={save.error} />
        <TextField label="Name" autoComplete="off" placeholder="For example, Unit trusts" error={formState.errors.name?.message} {...register('name')} />
        <Controller control={control} name="icon" render={({ field, fieldState }) => <IconPicker value={field.value} onChange={field.onChange} error={fieldState.error?.message} />} />
        <Controller
          control={control}
          name="assetOrLiability"
          render={({ field }) => (
            <ChoiceCards<'asset' | 'liability'>
              name="assetOrLiability"
              legend="Kind"
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: 'asset', title: 'Asset', description: 'Adds to net worth' },
                { value: 'liability', title: 'Liability', description: 'A balance you owe; reduces net worth' },
              ]}
            />
          )}
        />
        <div className="flex flex-col gap-3 rounded-lg border border-line px-4 py-3">
          <Controller
            control={control}
            name="isLiquid"
            render={({ field }) => <SwitchField label="Liquid" description="You could turn it into cash within a few days without a big loss." checked={field.value} onCheckedChange={field.onChange} />}
          />
          <div className="border-t border-line" />
          <Controller
            control={control}
            name="isInvestible"
            render={({ field }) => (
              <SwitchField label="Investible" description="Money working for you, as opposed to lifestyle assets like a car or home." checked={field.value} onCheckedChange={field.onChange} />
            )}
          />
        </div>
        <TextareaField label="Description" optional error={formState.errors.description?.message} {...register('description')} />
      </form>
    </Sheet>
  )
}

// ---- list ------------------------------------------------------------------------

function Flags({ c }: { c: Category }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {c.assetOrLiability === 'liability' ? <Badge tone="negative">Liability</Badge> : <Badge tone="neutral">Asset</Badge>}
      {c.isLiquid ? <Badge tone="info">Liquid</Badge> : null}
      {c.isInvestible ? <Badge tone="accent">Investible</Badge> : null}
      {c.isSystem ? (
        <Badge tone="neutral" icon={<Lock size={11} aria-hidden />} title="Created with your portfolio. You can rename or archive it.">
          Default
        </Badge>
      ) : null}
    </div>
  )
}

type MoveVars = { id: string; direction: 'up' | 'down'; steps: number; name: string; toIndex: number; total: number; focus?: 'up' | 'down' }

function CategoryList({ categories: unsorted }: { categories: Category[] }) {
  const online = useOnline()
  const categories = useMemo(() => [...unsorted].sort((a, b) => a.displayOrder - b.displayOrder), [unsorted])
  const active = useMemo(() => categories.filter((c) => !c.isArchived), [categories])
  const archived = useMemo(() => categories.filter((c) => c.isArchived), [categories])
  const fullOrder = useMemo(() => categories.map((c) => c.id), [categories])
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null)
  const [editing, setEditing] = useState<Category | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetKey, setSheetKey] = useState(0)
  const [archiving, setArchiving] = useState<Category | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())

  const shown = useMemo(() => {
    if (!pendingOrder) return active
    const byId = new Map(active.map((c) => [c.id, c]))
    return pendingOrder.flatMap((id) => byId.get(id) ?? [])
  }, [pendingOrder, active])

  const move = useApiMutation({
    mutationFn: async (v: MoveVars) => {
      for (let i = 0; i < v.steps; i++) await api.categories.reorder(v.id, v.direction)
    },
    onSuccess: (_r, v) => {
      setAnnouncement(`${v.name} moved to position ${v.toIndex + 1} of ${v.total}.`)
      if (v.focus) {
        const target = v.toIndex === 0 ? 'down' : v.toIndex === v.total - 1 ? 'up' : v.focus
        window.requestAnimationFrame(() => buttons.current.get(`${v.id}:${target}`)?.focus())
      }
    },
  })

  const archive = useApiMutation({
    mutationFn: (c: Category) => api.categories.setArchived(c.id, true),
    success: (_r, c) => `${c.name} archived`,
    toastError: false,
    onSuccess: () => setArchiving(null),
  })
  const restore = useApiMutation({
    mutationFn: (c: Category) => api.categories.setArchived(c.id, false),
    success: (_r, c) => `${c.name} restored`,
  })

  /** Moves a visible item to a new visible index; the API moves one step at a time through the full order. */
  const moveTo = (from: number, to: number, focus?: 'up' | 'down') => {
    const item = shown[from]
    const target = shown[to]
    if (!item || !target || from === to || move.isPending || !online) return
    const steps = Math.abs(fullOrder.indexOf(target.id) - fullOrder.indexOf(item.id))
    const next = shown.map((c) => c.id)
    next.splice(from, 1)
    next.splice(to, 0, item.id)
    setPendingOrder(next)
    move.mutate({ id: item.id, direction: to < from ? 'up' : 'down', steps, name: item.name, toIndex: to, total: shown.length, focus }, { onSettled: () => setPendingOrder(null) })
  }

  const onDragStart = (e: DragEvent, id: string) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const onDragOver = (e: DragEvent<HTMLLIElement>, id: string) => {
    if (!dragId) return
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > rect.top + rect.height / 2
    if (over?.id !== id || over.after !== after) setOver({ id, after })
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    if (dragId && over) {
      const from = shown.findIndex((c) => c.id === dragId)
      let to = shown.findIndex((c) => c.id === over.id)
      if (over.after) to += 1
      if (to > from) to -= 1
      moveTo(from, to)
    }
    setDragId(null)
    setOver(null)
  }

  const openSheet = (c: Category | null) => {
    setEditing(c)
    setSheetKey((k) => k + 1)
    setSheetOpen(true)
  }

  return (
    <SettingsPanel
      title="Categories"
      description="Drag to reorder, or use the arrow buttons. The order is used in lists, allocation charts, and forms."
      action={
        <Button variant="secondary" icon={<Plus size={16} aria-hidden />} onClick={() => openSheet(null)} disabled={!online} title={!online ? OFFLINE_REASON : undefined}>
          New category
        </Button>
      }
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {shown.length === 0 ? (
        <EmptyState compact icon={<Tags size={20} aria-hidden />} title="No active categories">
          Add a category to start grouping your accounts.
        </EmptyState>
      ) : (
        <ul aria-label="Categories in display order" className="-mx-2 flex flex-col" onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}>
          {shown.map((c, i) => {
            const showLineBefore = over?.id === c.id && !over.after && dragId !== c.id
            const showLineAfter = over?.id === c.id && over.after && dragId !== c.id
            return (
              <li
                key={c.id}
                draggable={online && !move.isPending}
                onDragStart={(e) => onDragStart(e, c.id)}
                onDragOver={(e) => onDragOver(e, c.id)}
                onDrop={onDrop}
                onDragEnd={() => {
                  setDragId(null)
                  setOver(null)
                }}
                className={cn(
                  'relative rounded-md border-t border-line px-2 py-3 transition-[opacity,background-color] duration-[var(--dur-1)] first:border-t-0',
                  dragId === c.id && 'opacity-45',
                  pendingOrder && pendingOrder.indexOf(c.id) !== active.findIndex((a) => a.id === c.id) && 'bg-accent-soft/40',
                )}
              >
                {showLineBefore ? <span aria-hidden className="absolute inset-x-2 -top-px h-0.5 rounded-full bg-accent" /> : null}
                {showLineAfter ? <span aria-hidden className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" /> : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="hidden cursor-grab text-subtle active:cursor-grabbing md:block" aria-hidden title="Drag to reorder">
                    <GripVertical size={16} />
                  </span>
                  <CategoryIcon name={c.icon} framed />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="flex items-baseline gap-2">
                      <span className="num w-5 shrink-0 text-right text-xs text-subtle">{i + 1}</span>
                      <span className="truncate text-[0.9375rem] font-medium text-ink">{c.name}</span>
                    </p>
                    {c.description ? <p className="ml-7 mt-0.5 truncate text-xs text-muted">{c.description}</p> : null}
                  </div>
                  <div className="order-last w-full pl-12 md:order-none md:w-auto md:pl-0">
                    <Flags c={c} />
                  </div>
                  <div className="ml-auto flex items-center gap-0.5">
                    <IconButton
                      ref={(el) => {
                        if (el) buttons.current.set(`${c.id}:up`, el)
                        else buttons.current.delete(`${c.id}:up`)
                      }}
                      label={`Move ${c.name} up`}
                      icon={<ArrowUp size={16} aria-hidden />}
                      disabled={i === 0 || move.isPending || !online}
                      onClick={() => moveTo(i, i - 1, 'up')}
                    />
                    <IconButton
                      ref={(el) => {
                        if (el) buttons.current.set(`${c.id}:down`, el)
                        else buttons.current.delete(`${c.id}:down`)
                      }}
                      label={`Move ${c.name} down`}
                      icon={<ArrowDown size={16} aria-hidden />}
                      disabled={i === shown.length - 1 || move.isPending || !online}
                      onClick={() => moveTo(i, i + 1, 'down')}
                    />
                    <IconButton label={`Edit ${c.name}`} icon={<Pencil size={16} aria-hidden />} onClick={() => openSheet(c)} />
                    <IconButton label={`Archive ${c.name}`} icon={<Archive size={16} aria-hidden />} disabled={!online} onClick={() => setArchiving(c)} />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {archived.length > 0 ? (
        <Disclosure label="Archived categories" count={archived.length} className="mt-4">
          <ul className="flex flex-col divide-y divide-line">
            {archived.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-2.5">
                <CategoryIcon name={c.icon} framed className="opacity-60" />
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{c.name}</span>
                <Button size="sm" variant="ghost" icon={<ArchiveRestore size={15} aria-hidden />} disabled={!online || restore.isPending} onClick={() => restore.mutate(c)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}

      <CategorySheet key={sheetKey} open={sheetOpen} onOpenChange={setSheetOpen} category={editing} />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => {
          if (!o) {
            setArchiving(null)
            archive.reset()
          }
        }}
        title={archiving ? `Archive ${archiving.name}?` : 'Archive category?'}
        description="Archived categories are hidden from forms and charts. You can restore them later."
        confirmLabel="Archive"
        pending={archive.isPending}
        confirmDisabled={!online}
        onConfirm={() => {
          if (archiving && !archive.isPending) archive.mutate(archiving)
        }}
      >
        <p className="text-sm text-muted">Only categories without active accounts can be archived. Move or archive those accounts first.</p>
        <ProblemNotice error={archive.error} className="mt-3" />
      </ConfirmDialog>
    </SettingsPanel>
  )
}

export default function CategorySettings() {
  usePageTitle('Categories')
  const { data, error, isPending, refetch } = useCategories()
  if (isPending) return <ListSkeleton rows={8} />
  if (error || !data)
    return (
      <div className="card">
        <ErrorState error={error} onRetry={() => void refetch()} title="Categories could not be loaded" />
      </div>
    )
  return <CategoryList categories={data} />
}
