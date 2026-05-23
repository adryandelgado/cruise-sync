/** True only when there is no cached data yet (loader + persist may already have filled cache). */
export function isInitialQueryLoad(isPending: boolean, data: unknown) {
  return isPending && data == null;
}
