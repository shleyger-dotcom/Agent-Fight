export type Stage =
  | 'scout' | 'spawn' | 'attack' | 'defend' | 'judge' | 'collect' | 'advance' | 'cold' | 'fix' | 'verify' | 'final' | 'done'

export type Scores = {
  correctness: number; completeness: number; specificity: number; robustness: number; clarity: number
  fatal: boolean
}
// Agent id -> its scores in one match
export type Verdict = Record<string, Scores>

export type Match = {
  id: string; a: string; b: string
  winner: string | null; loser: string | null; reason: string | null
  survived: string[]
  scores: Record<string, number | null> | null
  // set by bracket.py when the first two judges disagree: a third verdict file is expected
  split?: boolean
}
export type Round = { n: number; alive: string[]; matches: Match[]; bye: string | null; closed: boolean }
export type Card = { reasoning: { name: string }; workflow: { name: string }; strategy: { name: string } }
export type FightAgent = {
  card: Card; alive: boolean; eliminated_in: number | null; eliminated_by: string | null
}
export type FinalResult = {
  better: 'champion' | 'baseline'; champion_total: number | null; baseline_total: number | null
  reason: string; fixed: string[]
}
// What the size adds to the plain bracket. Absent in runs from before profiles existed.
export type Profile = {
  scout?: boolean; judges?: number; final_judges?: number; audit?: boolean; cold?: boolean; verify?: boolean
}
// The part of fight.json (written by bracket.py) that the panel reads
export type FightState = {
  profile?: Profile
  created: string
  agents_n: number
  dir: string
  has_baseline: boolean
  agents: Record<string, FightAgent>
  rounds: Round[]
  champion: string | null
  final: { X: string; Y: string; result: FinalResult | null } | null
}

// What one poll saw on disk
export type Snapshot = {
  state: FightState
  // run-dir-relative paths of stage files that exist
  present: string[]
  // match id -> per-criterion scores, read once the match has a winner
  verdicts: Record<string, Verdict>
}

declare module 'claude-code' {
  interface PluginState {
    'agent-fight': {
      snapshot: Shaped<Snapshot | null>
      isBandHidden: boolean
    }
  }
}
