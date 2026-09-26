/** A knob: the arc of its range and its pointer. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className={className} aria-hidden="true">
      <path d="M 5.6 18.4 A 9 9 0 1 1 18.4 18.4" opacity={0.35} />
      <path d="M 5.6 18.4 A 9 9 0 0 1 12 3" className="text-orange-500" stroke="currentColor" />
      <path d="M 12 12 L 12 6.5" />
    </svg>
  );
}
