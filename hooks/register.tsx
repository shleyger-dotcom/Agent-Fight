import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Card, FightState, Match, Snapshot, Verdict } from '../types'
import type { AgentStatus } from './fight.ts'
import {
  CRITERIA, STAGE_LABEL, agentStatus, ago, bar, currentRound, fmt, isLaunchCommand, parseVerdict, progressOf, stageOf, totalRounds, verdictPath, wantedPaths,
} from './fight.ts'

// Read-only view of an /agent-fight run (author: Shleyger Ram). The skill and bracket.py write; this mod only reads.
const snapshot = atom({ plugin: 'agent-fight', key: 'snapshot' } as const, null as Snapshot | null, { shape: 'snapshot-1' })
const isBandHidden = atom({ plugin: 'agent-fight', key: 'isBandHidden' } as const, false)

const PANE = 'agent-fight'
const POLL_MS = 2000
const CRITERIA_LABEL: Record<(typeof CRITERIA)[number], string> = {
  correctness: 'correctness', completeness: 'completeness', specificity: 'specificity', robustness: 'robustness', clarity: 'clarity',
}

// status -> [mark, text, color]
const AGENT_LOOK: Record<AgentStatus, [string, string, string]> = {
  working: ['●', 'working', 'cyan'],
  waiting: ['○', 'finished this step', 'yellow'],
  won: ['✓', 'won the match', 'green'],
  lost: ['✗', 'lost, out', 'red'],
  champion: ['★', 'champion', 'green'],
}

let cwd = ''
let stopPoll: (() => void) | undefined
let polling = false

const cardLine = (c: Card) => `${c.reasoning.name} + ${c.workflow.name} + ${c.strategy.name}`
const label = (s: FightState, id: string) => `${id} (${s.agents[id]?.card.reasoning.name ?? '?'})`

// Reads the run on disk. Returns null when there is no run or fight.json cannot be parsed.
async function readSnapshot($: any, prev: Snapshot | null): Promise<Snapshot | null> {
  const latest = String((await $.fs.read(`${cwd}/.agent-fight/LATEST`).catch(() => '')) ?? '').trim()
  if (!latest) return null
  let state: FightState
  try {
    state = JSON.parse(await $.fs.read(`${latest}/fight.json`))
  } catch {
    return prev
  }
  const checks = await Promise.all(wantedPaths(state).map(async p =>
    (await $.fs.exists(`${latest}/${p}`).catch(() => false)) ? p : null))
  const verdicts: Record<string, Verdict> = prev?.state.dir === state.dir ? { ...prev.verdicts } : {}
  for (const rd of state.rounds) {
    for (const m of rd.matches) {
      if (!m.winner || verdicts[m.id]) continue
      const text = String((await $.fs.read(`${latest}/${verdictPath(rd.n, m.id)}`).catch(() => '')) ?? '')
      const v = parseVerdict(text, m.a, m.b)
      if (v) verdicts[m.id] = v
    }
  }
  return { state, present: checks.filter((p): p is string => p !== null), verdicts }
}

async function tick($: any) {
  if (polling || !cwd) return
  polling = true
  try {
    const prev = await read($, snapshot)
    const next = await readSnapshot($, prev)
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      await update($, snapshot, () => next)
      // The pane opens only via /fight-panel or the skill launch command, never from polling.
      if (next && prev?.state.dir !== next.state.dir) await update($, isBandHidden, () => false)
    }
  } finally {
    polling = false
  }
}

async function openPane($: any) {
  await $.ui.open({ id: PANE, title: 'Agent Fight' })
}

function mark(done: boolean[]) {
  return `${done.filter(Boolean).length}/${done.length}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({
      name: 'fight-panel',
      description: 'Open the Agent Fight panel: bracket, matches, judges, winner',
    })
    // The module may be reloaded while the session lives: variables reset, the poll must restart.
    polling = false
    stopPoll?.()
    stopPoll = $.clock.every(POLL_MS, () => void tick($))
    void tick($)
    return next(e)
  })

  on('command.run', { command: 'fight-panel' }, async $ => {
    await update($, isBandHidden, () => false)
    void openPane($)
    return { text: 'Agent Fight panel opened.' }
  })

  // Open the pane at the first skill command, before fight.json exists
  on('tool.call', async ($, e, next) => {
    const command = (e as { command?: string }).command ?? ''
    if (!e.agentId && (e.tool === 'Bash' || e.tool === 'PowerShell') && isLaunchCommand(command)) void openPane($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const snap = await read($, snapshot)
    if (!snap || e.props.hasSurvey) return below
    const stage = stageOf(snap.state, new Set(snap.present))
    if (stage === 'done' && (await read($, isBandHidden))) return below
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = snap.state
    const rd = currentRound(s)
    const alive = Object.values(s.agents).filter(a => a.alive).length
    const parts = ['Agent Fight']
    if (rd) parts.push(`round ${rd.n}/${totalRounds(s.agents_n)}`)
    parts.push(STAGE_LABEL[stage], `${alive} of ${s.agents_n}`)
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Box flexShrink={1}><Text color="cyan" wrap="truncate-end">{parts.join(' · ')}</Text></Box>
          <Button key="pane" label="Panel" onPress={() => void openPane($)} />
          {stage === 'done' && <Button key="hide" label="✕" onPress={() => update($, isBandHidden, () => true)} />}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    if (!snap) {
      return (
        <Box flexDirection="column" paddingX={2}>
          <Text dimColor>No fight yet, or it is just starting.</Text>
          <Text dimColor>Type /agent-fight:agent-fight and a question: the panel shows the fight as it runs.</Text>
        </Box>
      )
    }
    const s = snap.state
    const has = new Set(snap.present)
    const stage = stageOf(s, has)
    const rounds = totalRounds(s.agents_n)
    const created = Date.parse(s.created.replace(' ', 'T'))
    const alive = Object.values(s.agents).filter(a => a.alive).length
    const spawned = Object.keys(s.agents).filter(a => has.has(`r0/${a}.md`)).length
    const openRound = currentRound(s)

    const matchBox = (rdN: number, m: Match, closed: boolean) => {
      const v = snap.verdicts[m.id]
      const sc = m.scores ?? {}
      const p = progressOf(rdN, m, has)
      const side = (id: string) => (
        <Text bold={m.winner === id} color={m.winner === id ? 'green' : m.loser === id ? 'red' : undefined} wrap="truncate-end">
          {m.winner === id ? '✓ ' : m.loser === id ? '✗ ' : '○ '}{label(s, id)}{m.winner ? ` · ${fmt(sc[id])}` : ''}
        </Text>
      )
      return (
        <Box key={m.id} flexDirection="column" borderStyle="round" borderColor={m.winner ? 'gray' : 'cyan'} paddingX={1}>
          <Text dimColor>{m.id}</Text>
          {side(m.a)}
          {side(m.b)}
          {!m.winner && (
            <Text color="cyan">
              attack {mark(p.attacks)} → defense {mark(p.defenses)} → judge {p.judged ? 'verdict in' : 'waiting'}
            </Text>
          )}
          {closed && v && [m.a, m.b].map(id => (
            <Text key={id} dimColor wrap="wrap">
              {id}: {CRITERIA.map(k => `${CRITERIA_LABEL[k]} ${v[id][k]}`).join(' · ')}{v[id].fatal ? ' · FATAL' : ''}
            </Text>
          ))}
          {m.winner && m.reason && <Text wrap="wrap">Reason: {m.reason}</Text>}
          {m.survived.length > 0 && <Text dimColor wrap="wrap">Survived: {m.survived.join('; ')}</Text>}
        </Box>
      )
    }

    const champ = s.champion ? s.agents[s.champion] : undefined
    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="column">
          <Text bold>Agent Fight · {STAGE_LABEL[stage]} · {alive} of {s.agents_n} still in{Number.isFinite(created) ? ` · ⏱ ${ago(Date.now() - created)}` : ''}</Text>
          {stage === 'spawn' && <Text color="cyan">{bar(spawned, s.agents_n)} {spawned}/{s.agents_n} answers written</Text>}
          {openRound && <Text dimColor>Round {openRound.n} of {rounds}{openRound.bye ? ` · bye: ${openRound.bye}` : ''}</Text>}
        </Box>
        <Box flexDirection="column">
          {Object.keys(s.agents).sort().map(id => {
            const st = agentStatus(s, has, id)
            const [mark, text, color] = AGENT_LOOK[st]
            return (
              <Text key={id} color={color} wrap="truncate-end">
                {mark} {label(s, id)} · {st === 'working' ? `${text}: ${STAGE_LABEL[stage]}` : text}
              </Text>
            )
          })}
        </Box>
        {s.rounds.map(rd => (
          <Box key={rd.n} flexDirection="column" gap={1}>
            <Text bold color={rd.closed ? 'gray' : 'cyan'}>Round {rd.n}{rd.closed ? ' · closed' : ''}</Text>
            {rd.matches.map(m => matchBox(rd.n, m, true))}
            {rd.closed && rd.bye && <Text dimColor>{label(s, rd.bye)} went through without a match</Text>}
          </Box>
        ))}
        {champ && s.champion && (
          <Box flexDirection="column" borderStyle="double" borderColor="green" paddingX={1}>
            <Text bold color="green">Winner: {s.champion}</Text>
            <Text wrap="wrap">Card: {cardLine(champ.card)}</Text>
            {s.final?.result ? (
              <Text wrap="wrap" color={s.final.result.better === 'champion' ? 'green' : 'yellow'}>
                Against the rejected answer: {s.final.result.better === 'champion' ? 'the winner is better' : 'the rejected answer scored higher'}
                {' '}({fmt(s.final.result.champion_total)} vs {fmt(s.final.result.baseline_total)}). {s.final.result.reason}
              </Text>
            ) : s.final ? <Text color="cyan">Final check against the rejected answer…</Text> : null}
          </Box>
        )}
        <Text dimColor>The answer comes in the chat when the fight ends. Run folder: {s.dir}</Text>
      </Box>
    )
  })
}
