# Agent Fight

A Claude Code skill for hard questions that need the right answer, not a quick one. Agents debate,
check each other's facts and claims, drop weak arguments and converge on the most accurate answer.
Example: "Should a 5-person
startup rewrite its 200k-line Django code monolith as microservices in the next 12 months, or keep
the code as a monolith?"

`/agent-fight` starts 8 sub-agents. Every one gets the same question and a different research card.
Each one searches the web and writes an answer with sources. Then the answers fight in a
single-elimination bracket: attack, defend, judge. 8 becomes 4, then 2, then 1.

You get one answer: a recommendation with sources, the attacks it survived, and the number of
rounds. It gives ideas, not code. It never touches your files: all sub-agents write inside
`.agent-fight/`.

![Agent Fight live panel: progress bar, round 1, matches with attack, defend and judge status](docs/panel.png)

The live panel shows the progress of every match while the tournament runs.

## Install

Requirements: Claude Code, Python 3.8 or newer (`python3` must work in your terminal), and web
search for sub-agents. Nothing to pip install.

Run these in a Claude Code session, one at a time:

```
/plugin marketplace add shleyger-dotcom/Agent-Fight
/plugin install agent-fight@agent-fight
/reload-plugins
```

Type `/agent-fight` to check. The command may also appear as `/agent-fight:agent-fight`.

To update: `/plugin marketplace update agent-fight`.
To remove: `/plugin uninstall agent-fight@agent-fight`.

No plugin? Copy the `skills/agent-fight` folder into `~/.claude/skills/` (all projects) or into
`.claude/skills/` of one project, then restart Claude Code.

## Use it

```
/agent-fight which platform is best for a small 2D mobile game, solo developer, no budget
/agent-fight --quick should I use Postgres or SQLite for this app
/agent-fight --agents 10 --seed 7 which engine for a multiplayer browser game
```

Without text, `/agent-fight` takes your last request as the question. If the question has no
criteria (budget, skills, audience, deadline), Claude asks for them once.

| flag | what it does |
| --- | --- |
| `--agents N` | N competitors. Default 8, maximum 10. |
| `--quick` | 4 competitors. Use for two obvious options. |
| `--seed S` | Same seed, same cards and same bracket. Default random, and recorded. |
| `--wave W` | Sub-agents per wave. Default 10. |

Use 8 (default) for a normal choice. Use 10 when a wrong answer costs a lot.

Run it in accept-edits mode (Shift+Tab). Every sub-agent writes a file, and the default mode asks
for each one.

## How it works

1. **Spawn.** Every agent gets the same task text plus one card: a reasoning mode, a workflow and a
   research angle. 400 cards, no repeats.
2. **Attack.** Paired agents check each other's sources and list up to 7 attacks (FATAL, MAJOR,
   MINOR).
3. **Defend.** Each side concedes or rebuts every attack, then rewrites its answer.
4. **Judge.** A separate judge scores both on [the rubric](skills/agent-fight/rubric.md):
   correctness 30, completeness 25, robustness 20, specificity 15, clarity 10. `bracket.py` adds
   the points. An answer with a verified fatal flaw cannot beat one without.
5. **Repeat** until one answer is left.

If you started from an answer you rejected, a last judge compares the winner with it, blind. You
see the score even when the old answer wins.

## What it costs

The skill is free. The tokens are yours.

| agents | rounds | sub-agent calls |
| --- | --- | --- |
| 10 | 4 | 55 |
| 8, default | 3 | 43 |
| 4, `--quick` | 2 | 19 |

The skill prints the size before it starts. `python3 skills/agent-fight/bracket.py plan --agents N`
prints it any time and writes nothing.

## Limits

- **8 agents are 8 sub-agents of your current model**, not 8 models. Only the cards differ.
- **The winner is the answer that survived every match.** The judges are Claude too. It is the
  strongest answer the tournament found, not proof. That is why you see the attacks it survived.
- **Sub-agents cannot see your chat.** They only know `.agent-fight/<run>/task.md`. Check that file
  if a criterion is missing from the answers.
- **The same seed gives the same cards and bracket**, not the same answers.
- **A vague question gives vague answers.**

## Troubleshooting

| problem | fix |
| --- | --- |
| `/agent-fight` not found | Run `/reload-plugins` or restart Claude Code. Check that `/plugin` shows `agent-fight` as enabled. |
| `python3: command not found` | Install Python 3.8+ and add `python3` to PATH. |
| Windows: `Python was not found; run without arguments to install from the Microsoft Store` | `python3` is the Store stub. The skill falls back to `python` or `py -3`. To fix it for good, turn off the `python3.exe` alias in Settings > Apps > Advanced app settings > App execution aliases. |
| Many permission prompts | Switch to accept-edits mode (Shift+Tab). |
| Plugin does not update | Run `/plugin marketplace update agent-fight`, then restart Claude Code. |

## For developers

`bracket.py` is the tournament state machine, standard-library Python. The main session only runs
the loop. If the conversation is compacted, `python3 skills/agent-fight/bracket.py next` resumes
from the state file.

Run the tests (any terminal, no admin rights):

```
python3 -m unittest discover -s tests -v
```

```
skills/agent-fight/SKILL.md          orchestration steps and the brief every sub-agent gets
skills/agent-fight/bracket.py        the tournament state machine
skills/agent-fight/strategies.json   reasoning modes, workflows, research angles. Edit freely
skills/agent-fight/rubric.md         the five judging criteria
hooks/                               the live panel
tests/test_bracket.py                the tests
```

## License

MIT. See [LICENSE](LICENSE).
