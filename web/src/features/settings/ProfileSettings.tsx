import { zodResolver } from '@hookform/resolvers/zod'
import { AtSign, Lock } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import type { SettingsRead } from '@/api/types'
import { TextField } from '@/components/ui/Field'
import { APP_NAME } from '@/config'
import { useSession } from '@/lib/session'
import { usePageTitle } from '@/lib/usePageTitle'
import { BrandMark } from '@/features/shell/Brand'
import { applyFieldErrors, ProblemNotice, ReadOnlyRow, SaveFooter, SettingsPanel, SettingsStack, useSaveSettings, WithSettings } from './settings-kit'

const schema = z.object({
  displayName: z.string().trim().min(1, 'Enter the name you want to see in the app').max(80, 'Use 80 characters or fewer'),
  appName: z.string().trim().max(40, 'Use 40 characters or fewer'),
})
type Values = z.infer<typeof schema>

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts.at(-1)![0] ?? '') : '')).toUpperCase()
}

function ProfileForm({ data }: { data: SettingsRead }) {
  const { user } = useSession()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { displayName: data.settings.displayName, appName: data.settings.appName },
  })
  const { register, handleSubmit, formState, setError, reset, control } = form
  const save = useSaveSettings('Profile saved', (patch) => reset({ displayName: patch.displayName ?? '', appName: patch.appName ?? '' }))
  const [displayName, appName] = useWatch({ control, name: ['displayName', 'appName'] })
  const shownName = appName.trim() || APP_NAME
  const shownPerson = displayName.trim() || user?.username || ''

  const onSubmit = handleSubmit((v) => {
    if (save.isPending) return
    save.mutate(
      { displayName: v.displayName.trim(), appName: v.appName.trim() },
      { onError: (err) => applyFieldErrors(err, setError, ['displayName', 'appName']) },
    )
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsPanel
        title="Profile"
        description="How you appear in the app. Your profile is private to you; nobody else on this server can see it."
        footer={<SaveFooter pending={save.isPending} dirty={formState.isDirty} />}
      >
        <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="flex flex-col gap-5">
            <ProblemNotice error={save.error} />
            <ReadOnlyRow
              label="Username"
              value={user?.username ?? ''}
              icon={<AtSign size={15} aria-hidden className="shrink-0 text-subtle" />}
              hint={
                <span className="inline-flex items-center gap-1">
                  <Lock size={12} aria-hidden /> You sign in with this. It can't be changed.
                </span>
              }
            />
            <TextField label="Display name" autoComplete="name" error={formState.errors.displayName?.message} hint="Shown in the profile menu and greetings." {...register('displayName')} />
            <TextField
              label="App name"
              optional
              placeholder={APP_NAME}
              error={formState.errors.appName?.message}
              hint={`Shown in the sidebar and browser tab. Leave blank to use ${APP_NAME}.`}
              {...register('appName')}
            />
          </div>
          <div aria-hidden className="hidden md:block">
            <p className="mb-1.5 text-sm font-medium text-ink">Preview</p>
            <div className="rounded-lg border border-line bg-sunken/60 p-4">
              <div className="flex items-center gap-2.5">
                <BrandMark size={26} />
                <span className="display min-w-0 truncate text-[1.0625rem] font-medium text-ink">{shownName}</span>
              </div>
              <div className="mt-5 flex items-center gap-3 rounded-md bg-surface p-3 shadow-e1">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent ring-1 ring-accent/20">{initialsOf(shownPerson)}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{shownPerson}</span>
                  <span className="block truncate text-xs text-muted">@{user?.username}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </SettingsPanel>
    </form>
  )
}

export default function ProfileSettings() {
  usePageTitle('Profile')
  return (
    <SettingsStack>
      <WithSettings>{(data) => <ProfileForm data={data} />}</WithSettings>
    </SettingsStack>
  )
}
