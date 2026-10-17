import { db } from '@/lib/db'
import type { CouncilRun, CouncilConfig } from '@/lib/council/types'
import { DEFAULT_COUNCIL_CONFIG } from '@/lib/council/config'
export async function saveRun(run: CouncilRun) {
  await db.councilRuns.put(run)
}
export async function loadRuns() {
  return db.councilRuns.orderBy('createdAt').reverse().toArray()
}
export async function loadConfig(): Promise<CouncilConfig> {
  return (
    (await db.councilPreferences.get('config'))?.config ??
    structuredClone(DEFAULT_COUNCIL_CONFIG)
  )
}
export async function saveConfig(config: CouncilConfig) {
  await db.councilPreferences.put({ id: 'config', config })
}
