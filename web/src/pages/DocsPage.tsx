import { useEffect } from 'react'
import { ApiReferenceReact } from '@scalar/api-reference-react'
import { SITE } from '../lib/site'

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
          url: '/api/openapi.yaml',
          theme: 'kepler',
          darkMode: true,
          hideClientButton: true,
          metaData: { title: `${SITE.name} api` },
        }}
      />
    </main>
  )
}
