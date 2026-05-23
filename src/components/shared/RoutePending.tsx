/** Shown while a route loader is resolving (cold cache / first navigation). */
export function RoutePending() {
  return (
    <div className="py-24 text-center text-sm text-stone-500" aria-live="polite">
      Loading…
    </div>
  );
}
