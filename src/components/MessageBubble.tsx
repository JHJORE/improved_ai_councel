/**
 * Message bubble component for rendering chat messages.
 *
 * Supports:
 * - Distinct styling for user vs. assistant messages
 * - Markdown rendering for assistant responses (react-markdown + remark-gfm)
 * - Copy-to-clipboard button on assistant messages
 * - Timestamp display
 */

import { memo, useCallback, useState } from 'react'
import { SafeMarkdown } from '@/components/SafeMarkdown'
import { ArrowLeftRightIcon, CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { TokenCount } from '@/lib/db/types'
import { formatTokenCount } from '@/lib/pricing'
import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
  /** Whether this message is currently being streamed (shows pulsing cursor). */
  isStreaming?: boolean
  /** Whether this message is part of a cross-feed round. */
  isCrossFeed?: boolean
  /** Token usage for this message (only for assistant messages). */
  tokenCount?: TokenCount | null
}

export const MessageBubble = memo(function MessageBubble({
  role,
  content,
  timestamp,
  isStreaming = false,
  isCrossFeed = false,
  tokenCount,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }, [content])

  const isUser = role === 'user'

  return (
    <div
      className={cn(
        'group relative max-w-[85%] rounded-lg px-3 py-2 text-sm',
        isUser
          ? 'bg-primary text-primary-foreground self-end'
          : 'bg-card text-card-foreground self-start',
        isCrossFeed && 'border-muted-foreground/30 border border-dashed',
      )}
    >
      {/* Cross-feed indicator */}
      {isCrossFeed && (
        <div className="text-muted-foreground mb-1 flex items-center gap-1 text-[10px]">
          <ArrowLeftRightIcon className="h-3 w-3" aria-hidden="true" />
          <span>Cross-feed</span>
        </div>
      )}

      {/* Message content */}
      {isUser ? (
        <p className="whitespace-pre-wrap">{content}</p>
      ) : (
        <div className="markdown-prose max-w-none text-sm">
          <SafeMarkdown>{content}</SafeMarkdown>
          {isStreaming && (
            <span
              className="bg-foreground ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm"
              aria-label="Streaming"
            />
          )}
        </div>
      )}

      {/* Footer: timestamp + token count + copy button */}
      <div
        className={cn(
          'mt-1 flex items-center gap-1',
          isUser ? 'justify-end' : 'justify-between',
        )}
      >
        <div className="flex items-center gap-1.5">
          {timestamp && (
            <time
              className="text-muted-foreground text-[10px]"
              dateTime={timestamp}
            >
              {formatTime(timestamp)}
            </time>
          )}

          {!isUser && tokenCount && (
            <span
              className="text-muted-foreground text-[10px]"
              title={`Input: ${tokenCount.input.toLocaleString()} | Output: ${tokenCount.output.toLocaleString()}`}
            >
              {formatTokenCount(tokenCount.input + tokenCount.output)} tokens
            </span>
          )}
        </div>

        {!isUser && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            onClick={handleCopy}
            aria-label={copied ? 'Copied' : 'Copy message'}
          >
            {copied ? (
              <CheckIcon className="h-3 w-3" />
            ) : (
              <CopyIcon className="h-3 w-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
})

/** Format an ISO timestamp to a short time string (e.g., "2:30 PM"). */
function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}
