import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { problemMessage } from '@/api/problem'
import { useSession } from '@/lib/session'

/** Signs out and leaves for the sign-in page, or explains why the server session is still active. */
export function useSignOut(): () => Promise<void> {
  const { signOut } = useSession()
  const navigate = useNavigate()
  return useCallback(async () => {
    try {
      await signOut()
    } catch (error) {
      toast.error('Couldn’t sign out', {
        id: 'sign-out-failed',
        description: `${problemMessage(error)} You’re still signed in on this device.`,
      })
      return
    }
    navigate('/sign-in', { replace: true })
  }, [signOut, navigate])
}
