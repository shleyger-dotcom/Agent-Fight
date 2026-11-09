import type { FightState, Match, Scores, Stage, Verdict } from '../types'

export type Present = ReadonlySet<string>

export const CRITERIA = ['correctness', 'completeness', 'specificity', 'robustness', 'clarity'] as const

// Paths below mirror spawn_out, attack_out, defense_out, revised_out, verdict_out and final_out in bracket.py.
export const spawnPath = (aid: string) => `r0/${aid}.md`
export const attackPath = (rnd: number, mid: string, aid: string) => `r${rnd}/${mid}.${aid}.attack.md`
export const defensePath = (rnd: number, mid: string, aid: string) => `r${rnd}/${mid}.${aid}.defense.md`
export const revisedPath = (rnd: number, mid: string, aid: string) => `r${rnd}/${mid}.${aid}.solution.md`
// Judge k of a match. Judge 1 keeps the old name. Judge 3 only runs when judges 1 and 2 disagree.
export const verdictPath = (rnd: number, mid: string, k = 1) => `r${rnd}/${mid}.verdict${k === 1 ? '' : k}.json`
export const FINAL_VERDICT = 'final.verdict.json'
export const SCOUT = 'scout.md'
export const COLD_ATTACK = 'cold.attack.md'
export const COLD_SOLUTION = 'cold.solution.md'
export const VERIFY = 'verify.md'
// The review of the agent with a bye: bye.auditor.attack.md, then its defense and revised answer.
export const auditPaths = (rnd: number, aid: string) => ({
  attack: `r${rnd}/bye.auditor.attack.md`, defense: `r${rnd}/bye.${aid}.defense.md`, revised: `r${rnd}/bye.${aid}.solution.md`,
})

// The skill's first command is `bracket.py plan`, then `init`: either one means a fight is starting.
export const isLaunchCommand = (command: string): boolean => /bracket\.py"?\s+(plan|init)\b/.test(command)

export function totalRounds(agents: number): number {
  let rounds = 0
  for (let alive = agents; alive > 1; alive = Math.ceil(alive / 2)) rounds++
  return rounds
}

export function judgesIn(s: FightState, rnd: number): number {
  const p = s.profile ?? {}
  return rnd === totalRounds(s.agents_n) ? (p.final_judges ?? 1) : (p.judges ?? 1)
}

// Every verdict file a match needs, judge 3 included once the first two split.
export function judgePaths(s: FightState, rnd: number, m: Match): string[] {
  const ks = Array.from({ length: judgesIn(s, rnd) }, (_, i) => i + 1)
  if (m.split) ks.push(3)
  return ks.map(k => verdictPath(rnd, m.id, k))
}

// The spawn files matter only until round 1 is closed.
function isSpawnPending(s: FightState): boolean {
  return s.rounds.length <= 1 && !s.rounds[0]?.closed
}

export function currentRound(s: FightState) {
  const last = s.rounds[s.rounds.length - 1]
  return s.champion || !last || last.closed ? undefined : last
}

// Relative paths the poller must check on disk to know the stage.
export function wantedPaths(s: FightState): string[] {
  const out: string[] = []
  if (isSpawnPending(s)) out.push(...Object.keys(s.agents).map(spawnPath))
  if (s.profile?.scout && isSpawnPending(s)) out.push(SCOUT)
  const rd = currentRound(s)
  if (rd?.bye && s.profile?.audit) out.push(...Object.values(auditPaths(rd.n, rd.bye)))
  for (const m of rd?.matches ?? []) {
    if (m.winner) continue
    for (const id of [m.a, m.b]) {
      out.push(attackPath(rd!.n, m.id, id), defensePath(rd!.n, m.id, id), revisedPath(rd!.n, m.id, id))
    }
    out.push(...judgePaths(s, rd!.n, m))
  }
  if (s.champion) out.push(COLD_ATTACK, COLD_SOLUTION, VERIFY)
  if (s.champion && s.final && !s.final.result) out.push(FINAL_VERDICT)
  return out
}

export type MatchProgress = { attacks: [boolean, boolean]; defenses: [boolean, boolean]; judged: boolean }

export function progressOf(rnd: number, m: Match, has: Present, judges = 1): MatchProgress {
  const sides: [string, string] = [m.a, m.b]
  return {
    attacks: [has.has(attackPath(rnd, m.id, sides[0])), has.has(attackPath(rnd, m.id, sides[1]))],
    defenses: [0, 1].map(i => has.has(defensePath(rnd, m.id, sides[i])) && has.has(revisedPath(rnd, m.id, sides[i]))) as [boolean, boolean],
    judged: Array.from({ length: judges }, (_, i) => i + 1).concat(m.split ? [3] : []).every(k => has.has(verdictPath(rnd, m.id, k))),
  }
}

// Same order as next_action in bracket.py.
export function stageOf(s: FightState, has: Present): Stage {
  if (s.profile?.scout && isSpawnPending(s) && !has.has(SCOUT)) return 'scout'
  if (isSpawnPending(s) && Object.keys(s.agents).some(a => !has.has(spawnPath(a)))) return 'spawn'
  if (s.champion) {
    if (s.profile?.cold && !has.has(COLD_ATTACK)) return 'cold'
    if (s.profile?.cold && !has.has(COLD_SOLUTION)) return 'fix'
    if (s.profile?.verify && !has.has(VERIFY)) return 'verify'
    return s.final && !s.final.result ? (has.has(FINAL_VERDICT) ? 'collect' : 'final') : 'done'
  }
  const rd = currentRound(s)
  if (!rd) return 'done'
  const open = rd.matches.filter(m => !m.winner)
  const all = (pick: (p: MatchProgress) => boolean) => open.every(m => pick(progressOf(rd.n, m, has)))
  const audit = rd.bye && s.profile?.audit ? auditPaths(rd.n, rd.bye) : null
  if (!all(p => p.attacks[0] && p.attacks[1]) || (audit && !has.has(audit.attack))) return 'attack'
  if (!all(p => p.defenses[0] && p.defenses[1]) || (audit && !(has.has(audit.defense) && has.has(audit.revised)))) return 'defend'
  if (!open.every(m => progressOf(rd.n, m, has, judgesIn(s, rd.n)).judged)) return 'judge'
  return open.length ? 'collect' : 'advance'
}

export type AgentStatus = 'working' | 'waiting' | 'won' | 'lost' | 'champion'

// shortcut: "working" means the stage file is not written yet, so an agent whose wave has not started
// also shows as working. Exact live state needs tool.call tracking.
export function agentStatus(s: FightState, has: Present, id: string): AgentStatus {
  if (s.champion === id) return 'champion'
  if (s.agents[id] && !s.agents[id].alive) return 'lost'
  const stage = stageOf(s, has)
  if (stage === 'scout') return 'waiting'
  if (stage === 'spawn') return has.has(spawnPath(id)) ? 'waiting' : 'working'
  const rd = currentRound(s)
  const m = rd?.matches.find(x => x.a === id || x.b === id)
  if (!rd || !m) return 'waiting'
  if (m.winner) return m.winner === id ? 'won' : 'lost'
  if (stage === 'attack') return has.has(attackPath(rd.n, m.id, id)) ? 'waiting' : 'working'
  if (stage === 'defend') return has.has(defensePath(rd.n, m.id, id)) && has.has(revisedPath(rd.n, m.id, id)) ? 'waiting' : 'working'
  return 'waiting'
}

export function parseVerdict(text: string, a: string, b: string): Verdict | null {
  const i = text.indexOf('{')
  const j = text.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(i, j + 1))
  } catch {
    return null
  }
  const scores = (raw as { scores?: Record<string, Record<string, unknown>> }).scores
  if (!scores || typeof scores !== 'object') return null
  const lowered = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k.trim().toLowerCase(), v]))
  const pick = (id: string): Scores | null => {
    const v = lowered[id]
    if (!v || typeof v !== 'object') return null
    const num = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : 0)
    return {
      correctness: num('correctness'), completeness: num('completeness'), specificity: num('specificity'),
      robustness: num('robustness'), clarity: num('clarity'),
      fatal: v.fatal === true || String(v.fatal).toLowerCase() === 'true',
    }
  }
  const first = pick(a)
  const second = pick(b)
  return first && second ? { [a]: first, [b]: second } : null
}

export function fmt(x: number | null | undefined): string {
  return x === null || x === undefined ? '?' : String(x)
}

export function bar(done: number, total: number, width = 10): string {
  const n = total ? Math.round((done / total) * width) : 0
  return '▓'.repeat(n) + '░'.repeat(width - n)
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export const STAGE_LABEL: Record<Stage, string> = {
  scout: 'scouting', spawn: 'research', attack: 'attack', defend: 'defense', judge: 'judging',
  collect: 'scoring', advance: 'next round', cold: 'cold read', fix: 'revision', verify: 'source check',
  final: 'final check', done: 'done',
}
