interface Props {
  size?: number
  className?: string
  decorative?: boolean
}

// The brand mark ships as an asset in public/. A css mask keeps
// currentColor theming without inlining svg markup.
export default function Mark({ size = 24, className, decorative }: Props) {
  return (
    <span
      role={decorative ? 'presentation' : 'img'}
      aria-label={decorative ? undefined : 'Quad4'}
      aria-hidden={decorative ? 'true' : undefined}
      className={className}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        backgroundColor: 'currentColor',
        WebkitMaskImage: 'url(/quad4-mark.svg)',
        maskImage: 'url(/quad4-mark.svg)',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  )
}
