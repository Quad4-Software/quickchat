// SPDX-License-Identifier: 0BSD
// fixed badge tucked into the top edge so it reads as attached chrome.
// role=status gives it a landmark so it is not floating content.
export default function DemoBadge() {
  return (
    <div
      role="status"
      className="pointer-events-none fixed left-1/2 top-0 z-40 -translate-x-1/2 rounded-b-md bg-inverted px-3 py-1 text-[0.65rem] font-bold uppercase tracking-widest text-inverted-foreground"
    >
      demo
    </div>
  )
}
