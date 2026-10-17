/**
 * Dexie database schema definition for Quorum.
 *
 * Exports a singleton `db` instance. All data access functions import from here.
 */

import Dexie, { type Table } from 'dexie'
import type { CouncilRun, CouncilConfig } from '@/lib/council/types'

import type { Conversation, Message, Settings } from '@/lib/db/types'

class QuorumDatabase extends Dexie {
  conversations!: Table<Conversation, number>
  messages!: Table<Message, number>
  settings!: Table<Settings, number>

  councilRuns!: Table<CouncilRun, string>
  councilPreferences!: Table<{ id: string; config: CouncilConfig }, string>

  constructor() {
    super('quorum')

    this.version(1).stores({
      // Auto-increment `id` (++), index `createdAt` and `updatedAt` for sorting
      conversations: '++id, createdAt, updatedAt',

      // Auto-increment `id` (++), compound index for per-thread queries,
      // plus individual indexes for common lookups
      messages:
        '++id, conversationId, [conversationId+provider+timestamp], timestamp',

      // Fixed id (not auto-increment) — singleton record with id=1
      settings: 'id',
    })
    this.version(2).stores({
      councilRuns: 'id, createdAt',
      councilPreferences: 'id',
    })
  }
}

/** Singleton database instance. */
export const db = new QuorumDatabase()
