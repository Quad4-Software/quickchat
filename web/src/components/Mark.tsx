interface Props {
  size?: number
  className?: string
  decorative?: boolean
}

// The brand mark ships as an asset in public/. A css mask keeps
// currentColor theming without inlining svg markup. BASE_URL keeps the
// url correct when the app is hosted under a subpath like gh pages.
const MARK_URL = `${import.meta.env.BASE_URL}quad4-mark.svg`

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
        WebkitMaskImage: `url(${MARK_URL})`,
        maskImage: `url(${MARK_URL})`,
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
