/** Leaves the single-page app for another address, such as an OAuth client's redirect. */
export function leaveApp(url: string): void {
  window.location.assign(url)
}
