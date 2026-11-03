import { useEffect } from 'react'
import { usePrefs } from './prefs'

/** Sets document.title ("Accounts · Wealthboard"); the shell announces it after navigation. */
export function usePageTitle(title: string | undefined): void {
  const { appName } = usePrefs()
  useEffect(() => {
    document.title = title ? `${title} · ${appName}` : appName
  }, [title, appName])
}
