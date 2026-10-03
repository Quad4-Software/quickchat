// SPDX-License-Identifier: 0BSD
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import MessageRow from './MessageRow'
import type { ChatMessage } from '../lib/types'

const base: ChatMessage = {
  id: 'm1',
  peer: { id: 'p1', name: 'nova' },
  ts: Date.parse('2026-10-02T21:00:00Z'),
}

describe('MessageRow', () => {
  it('renders author, body, and timestamp', () => {
    render(<MessageRow msg={{ ...base, body: 'hello room' }} />)
    expect(screen.getByText('nova')).toBeTruthy()
    expect(screen.getByText('hello room')).toBeTruthy()
  })

  it('renders presence events as quiet system lines', () => {
    render(<MessageRow msg={{ ...base, sys: 'join', body: 'joined' }} />)
    expect(screen.getByText(/nova joined/)).toBeTruthy()
  })

  it('marks pending outgoing messages', () => {
    render(<MessageRow msg={{ ...base, body: 'hi', pending: true }} />)
    expect(screen.getByText('sending...')).toBeTruthy()
  })

  it('shows transfer progress for in-flight files', () => {
    render(
      <MessageRow
        msg={{
          ...base,
          file: {
            id: 'f1',
            name: 'note.txt',
            size: 2048,
            mime: 'text/plain',
            progress: 0.5,
          },
        }}
      />,
    )
    expect(screen.getByText('note.txt')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
  })

  it('shows the failure reason on dead transfers', () => {
    render(
      <MessageRow
        msg={{
          ...base,
          file: {
            id: 'f1',
            name: 'big.bin',
            size: 4096,
            mime: 'application/octet-stream',
            failed: 'peer left',
          },
        }}
      />,
    )
    expect(screen.getByText('peer left')).toBeTruthy()
  })

  it('renders completed images inline', () => {
    render(
      <MessageRow
        msg={{
          ...base,
          file: {
            id: 'f1',
            name: 'shot.png',
            size: 100,
            mime: 'image/png',
            url: 'blob:fake',
          },
        }}
      />,
    )
    expect(screen.getByAltText('shot.png')).toBeTruthy()
  })

  it('renders completed files as download links', () => {
    render(
      <MessageRow
        msg={{
          ...base,
          file: {
            id: 'f1',
            name: 'report.pdf',
            size: 1024,
            mime: 'application/pdf',
            url: 'blob:fake',
          },
        }}
      />,
    )
    const link = screen.getByRole('link', { name: /report\.pdf/ })
    expect(link.getAttribute('download')).toBe('report.pdf')
    expect(link.getAttribute('href')).toBe('blob:fake')
  })
})
