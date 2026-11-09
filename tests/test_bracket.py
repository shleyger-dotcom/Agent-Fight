"""Tests for skills/agent-fight/bracket.py. Standard library only.

    python3 -m unittest discover -s tests -v

The headline test drives a full 8-agent tournament through the real command
line with random winners and checks it ends with exactly one survivor.
"""
import collections
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SKILL = os.path.join(REPO, "skills", "agent-fight")
BRACKET = os.path.join(SKILL, "bracket.py")
sys.path.insert(0, SKILL)

import bracket as B  # noqa: E402

EM_DASH, EN_DASH = chr(0x2014), chr(0x2013)   # spelled as code points so this file stays clean


def cli(*args):
    return subprocess.run([sys.executable, BRACKET] + [str(a) for a in args],
                          capture_output=True, text=True)


def size_flags(n):
    return {4: ["--quick"], 6: ["--medium"], 8: []}[n]


def write(path, text):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def load(d):
    with open(os.path.join(d, "fight.json"), encoding="utf-8") as fh:
        return json.load(fh)


class TempDir(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="fight-test-")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def ok(self, *args):
        r = cli(*args)
        self.assertEqual(r.returncode, 0, "bracket.py %s failed:\n%s%s" % (" ".join(map(str, args)), r.stdout, r.stderr))
        return r.stdout


class SimulatedTournament(TempDir):
    """Random winners, driven only through the CLI: init, pairings, record, advance, status, winner."""

    def run_tournament(self, n, seed):
        d = os.path.join(self.tmp, "run-%d" % n)
        self.ok("init", *size_flags(n), "--seed", seed, "--task", "Simulated task.", "--dir", d)
        rng = random.Random(seed)
        alive_at_start = []
        while True:
            state = load(d)
            if state["champion"]:
                break
            rd = state["rounds"][-1]
            alive_at_start.append(len(rd["alive"]))
            out = self.ok("pairings", "--dir", d)
            self.assertIn("round %d:" % rd["n"], out)
            in_round = [x for m in rd["matches"] for x in (m["a"], m["b"])] + ([rd["bye"]] if rd["bye"] else [])
            self.assertEqual(sorted(in_round), sorted(rd["alive"]), "everyone alive plays once or gets the bye")
            self.assertEqual(len(in_round), len(set(in_round)))
            for m in rd["matches"]:
                self.ok("record", m["id"], rng.choice([m["a"], m["b"]]), "--reason", "simulated", "--dir", d)
            self.ok("advance", "--dir", d)
        alive_at_start.append(1)
        return d, load(d), alive_at_start

    def test_8_agents_reach_exactly_one_survivor(self):
        d, state, sizes = self.run_tournament(8, 7)
        self.assertEqual(sizes, [8, 4, 2, 1])
        self.assertEqual(len(state["rounds"]), 3)
        alive = [a for a, v in state["agents"].items() if v["alive"]]
        self.assertEqual(alive, [state["champion"]])
        dead = [v for v in state["agents"].values() if not v["alive"]]
        self.assertEqual(len(dead), 7)
        self.assertTrue(all(v["eliminated_in"] and v["eliminated_by"] for v in dead))
        self.assertEqual(sum(len(rd["matches"]) for rd in state["rounds"]), 7)
        self.assertTrue(all(rd["bye"] is None for rd in state["rounds"]))
        status = self.ok("status", "--dir", d)
        self.assertIn("now: 1 alive, 7 eliminated, champion %s" % state["champion"], status)
        won = self.ok("winner", "--dir", d)
        self.assertIn("CHAMPION  %s" % state["champion"], won)
        self.assertIn("3 played, 8 agents in, 1 left", won)
        self.assertIn("last one standing", self.ok("pairings", "--dir", d))

    def test_6_agents_with_a_bye_in_round_2(self):
        _, state, sizes = self.run_tournament(6, 2)
        self.assertEqual(sizes, [6, 3, 2, 1])
        self.assertEqual([rd["bye"] is not None for rd in state["rounds"]], [False, True, False])
        self.assertTrue(all(v["byes"] <= 1 for v in state["agents"].values()), "no agent gets two byes")
        self.assertEqual(sum(v["alive"] for v in state["agents"].values()), 1)

    def test_4_agents(self):
        _, state, sizes = self.run_tournament(4, 11)
        self.assertEqual(sizes, [4, 2, 1])
        self.assertEqual(len(state["rounds"]), 2)
        self.assertEqual(sum(v["alive"] for v in state["agents"].values()), 1)

    def test_many_sizes_and_seeds_always_end_with_one(self):
        data = B.load_strategies()
        for n in tuple(B.PROFILES):
            for seed in range(3):
                st = B.new_state(n, seed, data, os.path.join(self.tmp, "api"))
                rng = random.Random(seed)
                sizes = []
                while not st["champion"]:
                    rd = B.current_round(st)
                    sizes.append(len(rd["alive"]))
                    for m in rd["matches"]:
                        B.record(st, m["id"], rng.choice([m["a"], m["b"]]))
                    B.advance(st)
                self.assertEqual(sizes + [1], B.bracket_sizes(n))
                self.assertEqual(len(B.alive_ids(st)), 1)


class Dealer(unittest.TestCase):
    def setUp(self):
        self.data = B.load_strategies()

    def test_card_count(self):
        self.assertEqual(len(self.data["reasoning"]), 8)
        self.assertEqual(len(self.data["workflows"]), 5)
        self.assertEqual(len(self.data["strategies"]), 10)
        self.assertEqual(B.combo_count(self.data), 400)

    def check(self, n, seed):
        cards = B.deal(n, seed, self.data)
        self.assertEqual(len(cards), n)
        self.assertEqual(len(set(cards)), n, "no card is dealt twice")
        for dim, size in enumerate((8, 5, 10)):
            count = collections.Counter(c[dim] for c in cards)
            per = [count.get(i, 0) for i in range(size)]
            self.assertLessEqual(max(per) - min(per), 1, "balanced: n=%d seed=%d dim=%d %s" % (n, seed, dim, per))
        for a, b in ((0, 1), (0, 2), (1, 2)):
            pairs = collections.Counter((c[a], c[b]) for c in cards)
            self.assertEqual(max(pairs.values()), 1, "two agents share two parts: n=%d seed=%d" % (n, seed))
        return cards

    def test_8_agents_unique_balanced(self):
        cards = self.check(8, 7)
        self.assertEqual(len({c[2] for c in cards}), 8)

    def test_guarantees_hold_across_sizes_and_seeds(self):
        for n in (4, 5, 6, 7, 8):
            for seed in range(25):
                self.check(n, seed)

    def test_deterministic_for_a_seed(self):
        self.assertEqual(B.deal(8, 42, self.data), B.deal(8, 42, self.data))
        self.assertNotEqual(B.deal(8, 42, self.data), B.deal(8, 43, self.data))

    def test_out_of_range(self):
        with self.assertRaises(B.FightError):
            B.deal(0, 1, self.data)
        with self.assertRaises(B.FightError):
            B.deal(401, 1, self.data)

    def test_pairing_prefers_different_reasoning_modes(self):
        for seed in range(50):
            st = B.new_state(8, seed, self.data, "/tmp/unused")
            same = 0
            for m in st["rounds"][0]["matches"]:
                a, b = st["agents"][m["a"]], st["agents"][m["b"]]
                same += a["card"]["reasoning"]["id"] == b["card"]["reasoning"]["id"]
            self.assertLessEqual(same, 1, "at most one forced same-mode match in a 4-match round")


class Plan(unittest.TestCase):
    def test_numbers(self):
        # calls = agents + per-round calls + scout + source check (+ cold read and its fix for 6 and 8)
        self.assertEqual(B.bracket_sizes(8), [8, 4, 2, 1])
        t = B.plan_totals(8)
        self.assertEqual((t["rounds"], t["calls"], t["waves"], t["third_judge_max"]), (3, 54, 14, 7))
        t = B.plan_totals(6)
        self.assertEqual((t["rounds"], t["calls"], t["third_judge_max"]), (3, 38, 1))
        t = B.plan_totals(4)
        self.assertEqual((t["rounds"], t["calls"], t["waves"], t["third_judge_max"]), (2, 21, 9, 0))

    def test_judges_by_size_and_round(self):
        data = B.load_strategies()
        st = {n: B.new_state(n, 1, data, "/tmp/unused") for n in tuple(B.PROFILES)}
        self.assertEqual([B.judges_in(st[4], r) for r in (1, 2)], [1, 1])
        self.assertEqual([B.judges_in(st[6], r) for r in (1, 2, 3)], [1, 1, 2])
        self.assertEqual([B.judges_in(st[8], r) for r in (1, 2, 3)], [2, 2, 2])

    def test_attack_focus_follows_the_round(self):
        self.assertEqual(B.focus_for(3, 1), B.FOCUS["coverage"])
        self.assertEqual(B.focus_for(3, 2), B.FOCUS["sources"])
        self.assertEqual(B.focus_for(3, 3), B.FOCUS["robustness"])
        self.assertEqual(B.focus_for(2, 1), B.FOCUS["both"])
        self.assertEqual(B.focus_for(2, 2), B.FOCUS["robustness"])


class Judges(TempDir):
    """Two judges per match in 8-agent runs. A third one decides when they disagree."""

    def verdict(self, a, b, a_score, b_score):
        s = lambda v: {k: v for k, _ in B.WEIGHTS}
        return json.dumps({"scores": {a: s(a_score), b: s(b_score)}, "winner": a if a_score > b_score else b,
                           "reason": "fake", "survived": ["x"], "standing": {a: [], b: []}})

    def setup_match(self):
        st = B.new_state(8, 1, B.load_strategies(), self.tmp)
        m = st["rounds"][0]["matches"][0]
        return st, m, [B.verdict_out(self.tmp, 1, m["id"], k) for k in (1, 2, 3)]

    def put(self, path, text):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write(path, text)

    def test_agreeing_judges_average_their_scores(self):
        st, m, p = self.setup_match()
        a, b = m["a"], m["b"]
        self.put(p[0], self.verdict(a, b, 8, 4))
        self.put(p[1], self.verdict(a, b, 6, 4))
        res = [r for r in B.collect(st) if r[0] == m["id"]][0]
        self.assertEqual(res[1], "recorded")
        self.assertEqual((m["winner"], m["scores"][a], m["scores"][b]), (a, 70.0, 40.0))
        self.assertIn("2 of 2 judges", res[2])

    def test_one_judge_missing_is_not_decided(self):
        st, m, p = self.setup_match()
        self.put(p[0], self.verdict(m["a"], m["b"], 8, 4))
        self.assertEqual([r[1] for r in B.collect(st) if r[0] == m["id"]], ["missing"])
        self.assertIsNone(m["winner"])

    def test_split_asks_for_a_third_judge_and_majority_wins(self):
        st, m, p = self.setup_match()
        a, b = m["a"], m["b"]
        self.put(p[0], self.verdict(a, b, 8, 4))
        self.put(p[1], self.verdict(a, b, 3, 7))
        res = [r for r in B.collect(st) if r[0] == m["id"]][0]
        self.assertEqual(res[1], "split")
        self.assertIsNone(m["winner"])
        ids = [j["id"] for j in B.phase_jobs(st, "judge") if j["match"] == m["id"]]
        self.assertEqual(ids, [m["id"] + ".judge", m["id"] + ".judge2", m["id"] + ".judge3"])
        left = [j["id"] for j in B.missing_jobs(B.phase_jobs(st, "judge")) if j["match"] == m["id"]]
        self.assertEqual(left, [m["id"] + ".judge3"], "only the third judge is still to run")
        self.put(p[2], self.verdict(a, b, 9, 2))
        res = [r for r in B.collect(st) if r[0] == m["id"]][0]
        self.assertEqual(res[1], "recorded")
        self.assertEqual(m["winner"], a)
        self.assertIn("2 of 3 judges", res[2])

    def test_unreadable_second_verdict_is_set_aside(self):
        st, m, p = self.setup_match()
        self.put(p[0], self.verdict(m["a"], m["b"], 8, 4))
        self.put(p[1], "no json")
        self.assertEqual([r[1] for r in B.collect(st) if r[0] == m["id"]], ["unreadable"])
        self.assertTrue(os.path.exists(p[1] + ".unreadable"))
        self.assertFalse(os.path.exists(p[1]))


class ByeAudit(TempDir):
    """In a 6-agent run the agent with the bye gets a neutral review and keeps its revised answer."""

    def play_to_the_bye(self):
        st = B.new_state(6, 3, B.load_strategies(), self.tmp)
        for m in st["rounds"][0]["matches"]:
            B.record(st, m["id"], m["a"])
        B.advance(st)
        rd = st["rounds"][1]
        self.assertIsNotNone(rd["bye"])
        for m in rd["matches"]:
            B.record(st, m["id"], m["a"])
        return st, rd

    def test_audit_jobs_exist_only_for_the_bye(self):
        st, rd = self.play_to_the_bye()
        kinds = {p: [j["kind"] for j in B.phase_jobs(st, p)] for p in ("attack", "defend", "judge")}
        self.assertEqual(kinds["attack"], ["reviewer"], "matches are recorded, only the audit is left")
        self.assertEqual(kinds["defend"], ["defender"])
        self.assertEqual(kinds["judge"], [])

    def test_revised_answer_replaces_the_byes_answer(self):
        st, rd = self.play_to_the_bye()
        path = B.revised_out(self.tmp, rd["n"], "bye", rd["bye"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write(path, "revised after the audit")
        B.advance(st)
        self.assertEqual(st["agents"][rd["bye"]]["solution"], path)

    def test_a_failed_audit_keeps_the_original_answer(self):
        st, rd = self.play_to_the_bye()
        original = st["agents"][rd["bye"]]["solution"]
        path = B.revised_out(self.tmp, rd["n"], "bye", rd["bye"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write(path, "NO OUTPUT")
        B.advance(st)
        self.assertEqual(st["agents"][rd["bye"]]["solution"], original)


class Verdicts(unittest.TestCase):
    def scores(self, c, m, s, r, cl, fatal=False):
        return {"correctness": c, "completeness": m, "specificity": s, "robustness": r, "clarity": cl, "fatal": fatal}

    def test_weights_match_the_rubric(self):
        with open(os.path.join(SKILL, "rubric.md"), encoding="utf-8") as fh:
            rows = re.findall(r"^\| (\w+) \| (\d+) \|", fh.read(), re.M)
        self.assertEqual([(k.lower(), int(w)) for k, w in rows], list(B.WEIGHTS))
        self.assertEqual(sum(w for _, w in B.WEIGHTS), 100)

    def test_total(self):
        self.assertEqual(B.weighted_total(self.scores(10, 10, 10, 10, 10)), 100.0)
        self.assertEqual(B.weighted_total(self.scores(8, 6, 7, 5, 9)), 68.5)   # (240 + 150 + 105 + 100 + 90) / 10
        self.assertIsNone(B.weighted_total({"correctness": 8}))

    def test_scores_beat_the_judges_pick(self):
        v = {"scores": {"a001": self.scores(5, 5, 5, 5, 5), "a002": self.scores(8, 8, 8, 8, 8)}, "winner": "a001"}
        w, totals, note = B.decide(v, "a001", "a002")
        self.assertEqual(w, "a002")
        self.assertIn("scores win", note)

    def test_fatal_rule(self):
        v = {"scores": {"a001": self.scores(9, 9, 9, 9, 9, fatal=True), "a002": self.scores(4, 4, 4, 4, 4)}}
        self.assertEqual(B.decide(v, "a001", "a002")[0], "a002")

    def test_tie_goes_to_fewer_standing_attacks(self):
        v = {"scores": {"a001": self.scores(7, 7, 7, 7, 7), "a002": self.scores(7, 7, 7, 7, 7)},
             "standing": {"a001": ["x", "y"], "a002": ["z"]}}
        self.assertEqual(B.decide(v, "a001", "a002")[0], "a002")

    def test_incomplete_scores_fall_back_to_the_pick(self):
        v = {"scores": {"a001": {"correctness": 3}}, "winner": "a001"}
        self.assertEqual(B.decide(v, "a001", "a002")[0], "a001")
        with self.assertRaises(B.FightError):
            B.decide({"scores": {}}, "a001", "a002")

    def test_json_inside_a_code_fence(self):
        self.assertEqual(B.extract_json('```json\n{"winner": "a001"}\n```'), {"winner": "a001"})
        self.assertIsNone(B.extract_json("no json here"))


class FullPipelineWithFakeAgents(TempDir):
    """Every phase, through the CLI, with fake sub-agents writing the files real ones would."""

    TASK = "Write a haiku about the sea.\nIt must mention salt.\nLiteral braces stay: {{name}} and {not_a_placeholder}."

    def fake_outputs(self, state, phase, jobs, rng):
        for j in jobs:
            for path in j["outputs"]:
                os.makedirs(os.path.dirname(path), exist_ok=True)
            if phase == "scout":
                write(j["outputs"][0], "Starting point, not complete.\n- salt: a mineral\n")
            elif phase == "spawn":
                body = "Salt on the wind, from %s." % j["agent"]
                write(j["outputs"][0], body)
            elif phase in ("attack", "cold"):
                write(j["outputs"][0], "ATTACK 1 [MINOR] too short\nWhere: line 1\nProblem: it is short.\n")
            elif phase == "verify":
                write(j["outputs"][0], "OK | http://x | salt | fine\nSUMMARY ok 1 mismatch 0 unreachable 0 outdated 0\n")
            elif phase in ("defend", "fix"):
                write(j["outputs"][0], "ATTACK 1: CONCEDE. Made it longer.\n")
                write(j["outputs"][1], "Salt on the long wind, revised by %s." % j["agent"])
            elif phase == "judge":
                a, b = j["a"], j["b"]
                s = lambda: {k: rng.randint(3, 10) for k, _ in B.WEIGHTS}
                v = {"match": j["match"], "scores": {a: s(), b: s()}, "winner": a, "reason": "fake",
                     "survived": ["too short"], "standing": {a: [], b: []}}
                write(j["outputs"][0], json.dumps(v))
            elif phase == "final":
                v = {"scores": {"X": {k: 8 for k, _ in B.WEIGHTS}, "Y": {k: 4 for k, _ in B.WEIGHTS}},
                     "winner": "X", "reason": "fake", "fixed": ["salt"]}
                write(j["outputs"][0], json.dumps(v))

    def test_every_phase_to_done(self):
        d = os.path.join(self.tmp, "run")
        task_file = os.path.join(self.tmp, "task.md")
        base_file = os.path.join(self.tmp, "baseline.md")
        write(task_file, self.TASK)
        write(base_file, "The sea is big.")
        self.ok("init", "--medium", "--seed", 9, "--task-file", task_file, "--baseline-file", base_file, "--dir", d)
        self.assertTrue(os.path.isfile(os.path.join(d, "rubric.md")), "the run has its own rubric copy")
        rng = random.Random(9)
        seen, kinds = [], set()
        for _ in range(200):
            out = self.ok("next", "--dir", d)
            phase = re.search(r"^(NEXT: (\w+)|DONE)", out, re.M)
            phase = "done" if phase.group(0) == "DONE" else phase.group(2)
            seen.append(phase)
            if phase == "done":
                break
            if phase in ("collect", "advance"):
                self.ok(phase, "--dir", d)
                continue
            listing = self.ok("prompts", phase, "--dir", d)
            state = load(d)
            jobs = B.phase_jobs(state, phase)
            todo = [j["id"] for j in B.missing_jobs(jobs)]
            for j in jobs:
                if j["id"] in todo:
                    self.assertIn(j["prompt"], listing)
                    line = next(l for l in listing.splitlines() if l.split()[:1] == [j["id"]])
                    self.assertIn(B.MODEL_OF[j["kind"]], line.split(), "the listing names the model")
                with open(j["prompt"], encoding="utf-8") as fh:
                    brief = fh.read()
                self.assertNotIn("{{agent", brief)
                self.assertNotIn("{{out", brief)
                self.assertNotRegex(brief.replace("{{name}}", ""), r"\{\{\w+\}\}", "unfilled placeholder")
                kinds.add(j["kind"])
                if j["kind"] == "reviewer":
                    self.assertIn("neutral reviewer", brief)
                if j["kind"] == "attacker":
                    self.assertIn("This round, ", brief)
                    self.assertIn("At most 6 attacks", brief)
                if phase == "spawn":
                    self.assertIn(B.scout_out(d), brief, "competitors are pointed at the scout list")
                    task_block = brief.split("=== THE TASK (identical for every competitor) ===\n")[1]
                    task_block = task_block.split("\n=== END OF THE TASK ===")[0]
                    self.assertEqual(task_block, self.TASK)
                    card = state["agents"][j["agent"]]["card"]
                    self.assertIn("Reasoning mode: %s." % card["reasoning"]["name"], brief)
                    self.assertIn("NOT satisfied", brief)
                if phase == "judge":
                    self.assertNotIn("Reasoning mode", brief, "judges never see the cards")
            self.fake_outputs(state, phase, jobs, rng)
            self.ok("check", phase, "--dir", d)
        self.assertEqual(seen[-1], "done")
        order = [p for i, p in enumerate(seen) if p in ("scout", "spawn", "cold", "fix", "verify", "final")
                 and p not in seen[:i]]
        self.assertEqual(order, ["scout", "spawn", "cold", "fix", "verify", "final"])
        self.assertEqual(seen.count("advance"), 3, "6 agents take 3 rounds")
        self.assertEqual(kinds, {"scout", "competitor", "attacker", "defender", "reviewer", "judge", "verifier", "final"})
        state = load(d)
        champ = state["agents"][state["champion"]]
        self.assertIn(".solution.md", champ["solution"], "the champion carries its revised solution")
        self.assertIn("revised by %s" % state["champion"], read(champ["solution"]))
        bye_round = next(rd for rd in state["rounds"] if rd["bye"])
        self.assertTrue(os.path.isfile(B.revised_out(d, bye_round["n"], "bye", bye_round["bye"])), "the bye was audited")
        pair = {read(os.path.join(d, "final", "X.md")).strip(), read(os.path.join(d, "final", "Y.md")).strip()}
        self.assertTrue(pair & {read(B.cold_solution_out(d)).strip(), "The sea is big."},
                        "the final check compares the cold-read version of the champion")
        self.assertIn("The sea is big.", pair)
        rep = json.loads(self.ok("winner", "--json", "--dir", d))
        self.assertEqual(rep["solution"], B.cold_solution_out(d))
        self.assertEqual(rep["source_check"], B.verify_out(d))
        self.assertEqual(rep["rounds"], 3)
        self.assertEqual(rep["final"]["better"], state["final"]["X"])
        self.assertTrue(rep["attacks_survived"])

    def test_spawn_briefs_share_one_task_and_differ_in_card(self):
        d = os.path.join(self.tmp, "run8")
        self.ok("init", "--seed", 4, "--task", self.TASK, "--dir", d)
        self.ok("prompts", "spawn", "--dir", d)
        blocks, cards = set(), set()
        for name in sorted(os.listdir(os.path.join(d, "prompts", "r0"))):
            brief = read(os.path.join(d, "prompts", "r0", name))
            blocks.add(brief.split("=== THE TASK (identical for every competitor) ===\n")[1].split("\n=== END")[0])
            cards.add(brief.split("=== YOUR STRATEGY CARD ===")[1].split("=== END OF THE CARD ===")[0])
        self.assertEqual(len(os.listdir(os.path.join(d, "prompts", "r0"))), 8)
        self.assertEqual(blocks, {self.TASK}, "every competitor gets the exact same task text")
        self.assertEqual(len(cards), 8, "every competitor gets a different card")

    def test_unreadable_verdict_is_set_aside_and_rerun(self):
        d = os.path.join(self.tmp, "bad")
        self.ok("init", "--quick", "--seed", 1, "--task", "t", "--dir", d)
        state = load(d)
        m = state["rounds"][0]["matches"][0]
        path = B.verdict_out(d, 1, m["id"])
        os.makedirs(os.path.dirname(path), exist_ok=True)
        write(path, "the judge rambled and wrote no json")
        r = cli("collect", "--dir", d)
        self.assertEqual(r.returncode, 1)
        self.assertIn("unreadable", r.stdout)
        self.assertFalse(os.path.exists(path))
        self.assertTrue(os.path.exists(path + ".unreadable"))


class Guards(TempDir):
    def test_init_refuses_to_overwrite_and_bad_sizes(self):
        d = os.path.join(self.tmp, "run")
        self.ok("init", "--quick", "--task", "t", "--dir", d)
        self.assertEqual(cli("init", "--quick", "--task", "t", "--dir", d).returncode, 2)
        self.assertEqual(cli("init", "--quick", "--task", "   ", "--dir", d + "2").returncode, 2)
        for n in (3, 5, 7, 10):
            self.assertEqual(cli("plan", "--agents", n).returncode, 2, "--agents is gone: sizes are fixed")
        for flags in ([], ["--quick"], ["--medium"]):
            self.assertEqual(cli("plan", *flags).returncode, 0, flags)

    def test_defaults_are_8_quick_is_4_medium_is_6(self):
        d = os.path.join(self.tmp, "default")
        self.ok("init", "--task", "t", "--dir", d)
        self.assertEqual(load(d)["agents_n"], 8)
        d = os.path.join(self.tmp, "quick")
        self.ok("init", "--quick", "--task", "t", "--dir", d)
        self.assertEqual(load(d)["agents_n"], 4)
        d = os.path.join(self.tmp, "medium")
        self.ok("init", "--medium", "--task", "t", "--dir", d)
        self.assertEqual(load(d)["agents_n"], 6)
        self.assertIn("6 agents, 3 rounds", self.ok("plan", "--medium"))

    def test_size_flags_exclude_each_other(self):
        self.assertEqual(cli("plan", "--quick", "--medium").returncode, 2)
        self.assertEqual(cli("init", "--quick", "--medium", "--task", "t", "--dir", self.tmp + "x").returncode, 2)

    def test_record_rejects_an_outsider(self):
        d = os.path.join(self.tmp, "rec")
        self.ok("init", "--quick", "--seed", 2, "--task", "t", "--dir", d)
        m = load(d)["rounds"][0]["matches"][0]
        outsider = next(a for a in load(d)["agents"] if a not in (m["a"], m["b"]))
        self.assertEqual(cli("record", m["id"], outsider, "--dir", d).returncode, 2)
        self.assertEqual(cli("advance", "--dir", d).returncode, 2, "cannot advance with open matches")

    def test_templates_are_all_in_skill_md(self):
        self.assertEqual(sorted(B.load_templates()), sorted(B.TEMPLATES))

    def test_no_em_dashes_anywhere(self):
        for root, dirs, files in os.walk(REPO):
            dirs[:] = [x for x in dirs if x not in (".git", "__pycache__")]
            for name in files:
                path = os.path.join(root, name)
                with open(path, encoding="utf-8", errors="ignore") as fh:
                    text = fh.read()
                self.assertNotIn(EM_DASH, text, "em dash in %s" % os.path.relpath(path, REPO))
                self.assertNotIn(EN_DASH, text, "en dash in %s" % os.path.relpath(path, REPO))


class Models(unittest.TestCase):
    def test_judging_roles_use_opus_and_the_rest_sonnet(self):
        self.assertEqual({k for k, m in B.MODEL_OF.items() if m == "opus"}, {"judge", "final", "reviewer"})
        self.assertEqual({k for k, m in B.MODEL_OF.items() if m == "sonnet"},
                         {"scout", "competitor", "attacker", "defender", "verifier"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
