import { useEffect } from 'react'
import { ApiReferenceReact } from '@scalar/api-reference-react'
import { SITE } from '../lib/site'

// the live spec is served by the go server; the static demo bundle ships a
// copy at the deploy base so /docs works on github pages too
const SPEC_URL =
  import.meta.env.VITE_DEMO === '1'
    ? `${import.meta.env.BASE_URL}openapi.yaml`
    : '/api/openapi.yaml'

export default function DocsPage() {
  useEffect(() => {
    document.title = `api docs - ${SITE.name}`
    return () => {
      document.title = SITE.name
    }
  }, [])

  return (
    <main id="main" className="h-full overflow-y-auto">
      <ApiReferenceReact
        configuration={{
          url: SPEC_URL,
          theme: 'kepler',
          darkMode: true,
          hideClientButton: true,
          metaData: { title: `${SITE.name} api` },
        }}
      />
    </main>
  )
}
