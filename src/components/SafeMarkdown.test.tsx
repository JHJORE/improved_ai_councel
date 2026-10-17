import { render, screen } from '@testing-library/react'
import { SafeMarkdown } from '@/components/SafeMarkdown'
it('renders useful markdown while blocking remote image beacons and raw HTML', () => {
  const { container } = render(
    <SafeMarkdown>
      {
        '**Important**\n\n![tracking](https://example.com/secret)\n\n<img src="https://example.com/private" />'
      }
    </SafeMarkdown>,
  )
  expect(screen.getByText('Important').tagName).toBe('STRONG')
  expect(screen.getByText('[Image omitted: tracking]')).toBeInTheDocument()
  expect(container.querySelector('img')).toBeNull()
})
