export type Stage =
  | 'independent'
  | 'critique'
  | 'revision'
  | 'evaluation'
  | 'synthesis'
export interface Member {
  id: string
  provider: string
  model: string
  label: string
}
export interface CouncilConfig {
  members: Member[]
  chairmanModel: string
  revisionRounds: number
}
export interface Candidate {
  id: string
  text: string
}
export interface AnonymousSet {
  responses: Candidate[]
  mapping: Record<string, string>
}
export interface Evaluation {
  evaluations: {
    responseId: string
    accuracy: number
    completeness: number
    reasoning: number
    usefulness: number
    flaws: string[]
  }[]
  ranking: string[]
}
export interface Usage {
  input: number
  output: number
  cost: number | null
}
export interface Job {
  memberId: string
  model: string
  prompt: string
  text: string
  status: 'pending' | 'running' | 'complete' | 'error' | 'skipped'
  error?: string
  evaluation?: Evaluation
  usage?: Usage
  durationMs?: number
  attempts: number
  history?: {
    text: string
    status: string
    usage?: Usage
    durationMs: number
    error?: string
  }[]
}
export interface Step {
  stage: Stage
  round: number
  jobs: Job[]
  anonymous?: AnonymousSet
  complete: boolean
}
export interface CouncilRun {
  id: string
  createdAt: string
  originalPrompt: string
  config: CouncilConfig
  steps: Step[]
  cursor: number
  status: 'paused' | 'running' | 'error' | 'complete'
  aggregateRanking: { responseId: string; memberId: string; meanRank: number }[]
  durationMs: number
  error?: string
}
export type ModelCall = (request: {
  model: string
  prompt: string
  evaluationIds?: string[]
  signal: AbortSignal
  onText: (text: string) => void
}) => Promise<{ text: string; usage?: Usage }>
