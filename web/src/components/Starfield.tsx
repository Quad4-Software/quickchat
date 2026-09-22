const DOTS: Array<[number, number, number]> = [
  [8, 12, 0.45], [15, 78, 0.3], [22, 34, 0.5], [31, 8, 0.35],
  [38, 61, 0.4], [44, 22, 0.3], [52, 88, 0.45], [58, 44, 0.35],
  [63, 15, 0.5], [69, 70, 0.3], [74, 30, 0.4], [80, 55, 0.35],
  [85, 10, 0.45], [90, 82, 0.3], [94, 40, 0.5], [12, 50, 0.35],
  [27, 90, 0.4], [47, 5, 0.3], [66, 92, 0.45], [88, 62, 0.35],
]

export default function Starfield() {
  const layers = DOTS.map(
    ([x, y, a]) =>
      `radial-gradient(1px 1px at ${x}% ${y}%, rgb(255 255 255 / ${a}) 50%, transparent 51%)`,
  ).join(', ')
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 dark:opacity-100 opacity-0"
      style={{ backgroundImage: layers }}
    />
  )
}
