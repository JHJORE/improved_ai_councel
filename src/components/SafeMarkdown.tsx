import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
/** Model-provided images must not make unsolicited third-party requests. */
export function SafeMarkdown({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ alt }) => (
          <span className="text-muted-foreground">
            [Image omitted{alt ? `: ${alt}` : ''}]
          </span>
        ),
      }}
    >
      {children}
    </Markdown>
  )
}
