import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { FightState, Match } from '../types'
import {
  COLD_ATTACK, COLD_SOLUTION, FINAL_VERDICT, SCOUT, VERIFY, agentStatus, auditPaths, judgePaths, judgesIn, attackPath, defensePath, isLaunchCommand, parseVerdict, revisedPath, spawnPath, stageOf, totalRounds, verdictPath, wantedPaths,
} from './fight.ts'

const card = { reasoning: { name: 'r' }, workflow: { name: 'w' }, strategy: { name: 's' } }
const agent = { card, alive: true, eliminated_in: null, eliminated_by: null }
const match = (id: string, a: string, b: string, winner: string | null = null): Match => ({
  id, a, b, winner, loser: winner ? (winner === a ? b : a) : null, reason: null, survived: [], scores: null,
})
const fight = (extra: Partial<FightState> = {}): FightState => ({
  created: '2026-01-01 00:00:00', agents_n: 4, dir: '/d', has_baseline: false,
  agents: { a1: agent, a2: agent, a3: agent, a4: agent },
  rounds: [{ n: 1, alive: ['a1', 'a2', 'a3', 'a4'], matches: [match('r1-m1', 'a1', 'a2'), match('r1-m2', 'a3', 'a4')], bye: null, closed: false }],
  champion: null, final: null, ...extra,
})
const spawned = ['a1', 'a2', 'a3', 'a4'].map(spawnPath)
const attacked = ['r1-m1.a1', 'r1-m1.a2', 'r1-m2.a3', 'r1-m2.a4'].map(k => {
  const [mid, id] = k.split('.')
  return attackPath(1, mid, id)
})
const defended = ['r1-m1.a1', 'r1-m1.a2', 'r1-m2.a3', 'r1-m2.a4'].flatMap(k => {
  const [mid, id] = k.split('.')
  return [defensePath(1, mid, id), revisedPath(1, mid, id)]
})

test('isLaunchCommand matches plan and init, not other commands', () => {
  assert.equal(isLaunchCommand('python3 "/x/skills/agent-fight/bracket.py" plan --quick'), true)
  assert.equal(isLaunchCommand('python "$B" init --agents 8 --task-file t.md'), false)
  assert.equal(isLaunchCommand('python bracket.py init --quick'), true)
  assert.equal(isLaunchCommand('python3 "/x/bracket.py" next'), false)
  assert.equal(isLaunchCommand(''), false)
})

test('totalRounds: 8 -> 3, 10 -> 4, 1 -> 0', () => {
  assert.equal(totalRounds(8), 3)
  assert.equal(totalRounds(10), 4)
  assert.equal(totalRounds(1), 0)
})

test('stageOf walks spawn, attack, defend, judge, collect', () => {
  const s = fight()
  assert.equal(stageOf(s, new Set(spawned.slice(0, 3))), 'spawn')
  assert.equal(stageOf(s, new Set(spawned)), 'attack')
  assert.equal(stageOf(s, new Set([...spawned, ...attacked.slice(0, 3)])), 'attack')
  assert.equal(stageOf(s, new Set([...spawned, ...attacked])), 'defend')
  assert.equal(stageOf(s, new Set([...spawned, ...attacked, ...defended.slice(1)])), 'defend')
  assert.equal(stageOf(s, new Set([...spawned, ...attacked, ...defended])), 'judge')
  const all = [...spawned, ...attacked, ...defended, verdictPath(1, 'r1-m1'), verdictPath(1, 'r1-m2')]
  assert.equal(stageOf(s, new Set(all)), 'collect')
})

test('stageOf ignores spawn files once round 1 is closed, and reports advance', () => {
  const s = fight()
  s.rounds[0].matches = [match('r1-m1', 'a1', 'a2', 'a1'), match('r1-m2', 'a3', 'a4', 'a3')]
  assert.equal(stageOf(s, new Set(spawned)), 'advance')
  s.rounds[0].closed = true
  s.rounds.push({ n: 2, alive: ['a1', 'a3'], matches: [match('r2-m1', 'a1', 'a3')], bye: null, closed: false })
  assert.equal(stageOf(s, new Set()), 'attack')
})

test('stageOf with a champion: final pending, final verdict present, done', () => {
  const closed = fight({ champion: 'a1' })
  closed.rounds[0].closed = true
  assert.equal(stageOf(closed, new Set()), 'done')
  const withFinal = fight({ champion: 'a1', final: { X: 'champion', Y: 'baseline', result: null } })
  withFinal.rounds[0].closed = true
  assert.equal(stageOf(withFinal, new Set()), 'final')
  assert.equal(stageOf(withFinal, new Set([FINAL_VERDICT])), 'collect')
})

test('stageOf: one agent, no rounds, champion at once', () => {
  const s = fight({ agents_n: 1, agents: { a1: agent }, rounds: [], champion: 'a1' })
  assert.equal(stageOf(s, new Set()), 'spawn')
  assert.equal(stageOf(s, new Set([spawnPath('a1')])), 'done')
})

test('wantedPaths skips recorded matches and spawn files after round 1', () => {
  const s = fight()
  s.rounds[0].matches[0] = match('r1-m1', 'a1', 'a2', 'a1')
  const paths = wantedPaths(s)
  assert.ok(paths.includes(spawnPath('a1')))
  assert.ok(!paths.includes(verdictPath(1, 'r1-m1')))
  assert.ok(paths.includes(verdictPath(1, 'r1-m2')))
  s.rounds[0].closed = true
  s.rounds.push({ n: 2, alive: ['a1', 'a3'], matches: [match('r2-m1', 'a1', 'a3')], bye: null, closed: false })
  assert.ok(!wantedPaths(s).includes(spawnPath('a1')))
})

test('agentStatus: working until its stage file exists, then waiting', () => {
  const s = fight()
  assert.equal(agentStatus(s, new Set(spawned.slice(1)), 'a1'), 'working')
  assert.equal(agentStatus(s, new Set(spawned), 'a1'), 'working')
  assert.equal(agentStatus(s, new Set(spawned.slice(1)), 'a2'), 'waiting')
  assert.equal(agentStatus(s, new Set([...spawned, attackPath(1, 'r1-m1', 'a1')]), 'a1'), 'waiting')
  assert.equal(agentStatus(s, new Set([...spawned, attackPath(1, 'r1-m1', 'a1')]), 'a2'), 'working')
  assert.equal(agentStatus(s, new Set([...spawned, ...attacked]), 'a1'), 'working')
  assert.equal(agentStatus(s, new Set([...spawned, ...attacked, ...defended]), 'a1'), 'waiting')
})

test('agentStatus: won, lost, eliminated and champion', () => {
  const s = fight()
  s.rounds[0].matches[0] = match('r1-m1', 'a1', 'a2', 'a1')
  assert.equal(agentStatus(s, new Set(spawned), 'a1'), 'won')
  assert.equal(agentStatus(s, new Set(spawned), 'a2'), 'lost')
  s.agents.a2 = { ...agent, alive: false }
  s.champion = 'a1'
  assert.equal(agentStatus(s, new Set(), 'a2'), 'lost')
  assert.equal(agentStatus(s, new Set(), 'a1'), 'champion')
})

test('parseVerdict reads scores, lowercases ids, tolerates text around the JSON', () => {
  const sc = { correctness: 8, completeness: 7, specificity: 6, robustness: 5, clarity: 9, fatal: false }
  const text = `Here: ${JSON.stringify({ scores: { A1: sc, a2: { ...sc, fatal: 'true' } } })} done`
  const v = parseVerdict(text, 'a1', 'a2')
  assert.equal(v?.a1.correctness, 8)
  assert.equal(v?.a2.fatal, true)
})

test('parseVerdict returns null for empty text, broken JSON, missing side', () => {
  assert.equal(parseVerdict('', 'a1', 'a2'), null)
  assert.equal(parseVerdict('{ not json }', 'a1', 'a2'), null)
  assert.equal(parseVerdict('{"scores":{"a1":{"correctness":1}}}', 'a1', 'a2'), null)
})

const profile8 = { scout: true, judges: 2, final_judges: 2, audit: true, cold: true, verify: true }

test('stageOf: scout comes before spawn when the run has a scout', () => {
  const s = fight({ profile: profile8 })
  assert.equal(stageOf(s, new Set()), 'scout')
  assert.equal(stageOf(s, new Set([SCOUT])), 'spawn')
  assert.equal(stageOf(s, new Set([SCOUT, ...spawned])), 'attack')
})

test('judges: 2 per match with profile 8, 3rd file only after a split, 1 without a profile', () => {
  const s = fight({ agents_n: 8, profile: profile8 })
  const m = s.rounds[0].matches[0]
  assert.equal(judgesIn(s, 1), 2)
  assert.deepEqual(judgePaths(s, 1, m), [verdictPath(1, m.id), verdictPath(1, m.id, 2)])
  assert.equal(verdictPath(1, m.id, 2), 'r1/r1-m1.verdict2.json')
  assert.equal(judgePaths(s, 1, { ...m, split: true }).length, 3)
  assert.equal(judgesIn(fight(), 1), 1)
})

test('stageOf stays in judge until every judge of every open match has written', () => {
  const s = fight({ agents_n: 4, profile: { scout: true, judges: 2, final_judges: 2 } })
  const base = [SCOUT, ...spawned, ...attacked, ...defended]
  const first = [verdictPath(1, 'r1-m1'), verdictPath(1, 'r1-m2')]
  assert.equal(stageOf(s, new Set([...base, ...first])), 'judge')
  const second = [verdictPath(1, 'r1-m1', 2), verdictPath(1, 'r1-m2', 2)]
  assert.equal(stageOf(s, new Set([...base, ...first, ...second])), 'collect')
})

test('stageOf waits for the bye audit in attack and defend', () => {
  const s = fight({ agents_n: 6, profile: profile8 })
  s.rounds[0].bye = 'a5'
  const audit = auditPaths(1, 'a5')
  const base = [SCOUT, ...spawned, ...attacked]
  assert.equal(stageOf(s, new Set(base)), 'attack')
  assert.equal(stageOf(s, new Set([...base, audit.attack])), 'defend')
  assert.equal(stageOf(s, new Set([...base, audit.attack, ...defended, audit.defense])), 'defend')
  assert.equal(stageOf(s, new Set([...base, audit.attack, ...defended, audit.defense, audit.revised])), 'judge')
})

test('stageOf after the champion: cold, fix, verify, final, done', () => {
  const s = fight({ champion: 'a1', profile: profile8, final: { X: 'champion', Y: 'baseline', result: null } })
  s.rounds[0].closed = true
  const done = [SCOUT, ...spawned]
  assert.equal(stageOf(s, new Set(done)), 'cold')
  assert.equal(stageOf(s, new Set([...done, COLD_ATTACK])), 'fix')
  assert.equal(stageOf(s, new Set([...done, COLD_ATTACK, COLD_SOLUTION])), 'verify')
  assert.equal(stageOf(s, new Set([...done, COLD_ATTACK, COLD_SOLUTION, VERIFY])), 'final')
  const quick = fight({ champion: 'a1', profile: { scout: true, verify: true } })
  quick.rounds[0].closed = true
  assert.equal(stageOf(quick, new Set([SCOUT, ...spawned])), 'verify')
  assert.equal(stageOf(quick, new Set([SCOUT, ...spawned, VERIFY])), 'done')
})
