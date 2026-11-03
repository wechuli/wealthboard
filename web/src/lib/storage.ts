/**
 * Browser storage that never throws. Reading `window.localStorage` itself raises SecurityError
 * when the browser blocks site data, so every access goes through these helpers.
 */
export function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

export function readStored(key: string): string | null {
  try {
    return browserStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    browserStorage()?.setItem(key, value)
  } catch {
    /* storage unavailable or full */
  }
}
