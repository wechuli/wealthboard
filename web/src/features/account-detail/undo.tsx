/** Undo a grouped corporate action: every event in the group is removed together and history replays. */
import { api } from '@/api'
import { DateText } from '@/components/format'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { useOnline } from '@/lib/online'
import { useApiMutation } from '@/lib/queries'
import { WorkflowProblem } from './workflow-kit'

export interface UndoTarget {
  /** Any event in the group. The server resolves the whole group from one member. */
  eventId: string
  label: string
  date: string
  detail?: string
}

export function UndoGroupDialog({ target, onClose }: { target: UndoTarget | null; onClose(): void }) {
  const online = useOnline()
  const undo = useApiMutation({
    mutationFn: (t: UndoTarget) => api.corporateActions.remove(t.eventId),
    success: (_r, t) => `${t.label.charAt(0).toUpperCase()}${t.label.slice(1)} undone`,
    toastError: false,
    onSuccess: () => onClose(),
  })
  return (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) {
          undo.reset()
          onClose()
        }
      }}
      title={target ? `Undo this ${target.label}?` : 'Undo'}
      description="Every event recorded with it is removed together, then quantities, cash, and values replay from that date."
      confirmLabel="Undo action"
      pending={undo.isPending}
      confirmDisabled={!online}
      onConfirm={() => target && undo.mutate(target)}
    >
      {target ? (
        <p className="text-sm text-muted">
          {target.detail ? `${target.detail} · ` : ''}
          <DateText value={target.date} />
        </p>
      ) : null}
      <WorkflowProblem error={undo.error} className="mt-3" causes={['A later sale, transfer, or corporate action uses units this action created. Remove or correct that first, then undo this one.']} />
    </ConfirmDialog>
  )
}
