# The Agent Fight rubric

Every match is scored against this page. The judge scores both answers, `bracket.py` does the
arithmetic, and the higher weighted total goes through. The loser is out.

## The five criteria

Each criterion is scored 0 to 10. The weight is how much of the 100-point total it is worth.

| criterion | weight | the question |
| --- | --- | --- |
| Correctness | 30 | Are the claims true and backed by sources? Links work, sources say what the answer says, dates are current. No invented facts. |
| Completeness | 25 | Does it cover every realistic option and every criterion the question states? Judged against the question, not against what the judge would have liked. |
| Specificity | 15 | Does it give a concrete recommendation with numbers, names and conditions, not "it depends"? |
| Robustness | 20 | Does it hold up against the attacks raised in this match? Fixed, correctly rebutted, or still standing. |
| Clarity | 10 | Is it easy to read and act on, at a length that fits the question? |

Weighted total = (correctness x 30 + completeness x 25 + specificity x 15 + robustness x 20 + clarity x 10) / 10.
That gives a number from 0 to 100.

## Anchors

Use the whole scale. A 7 is not a polite default.

**Correctness**
- 10: every key claim has a source you checked, and it says what the answer says.
- 7: minor slips, or one key claim has a weak source.
- 4: at least one claim is wrong, outdated, or has no source and matters to the choice.
- 0 to 2: a central claim is false or a source is invented.

**Completeness**
- 10: every realistic option and every stated criterion is covered.
- 7: all covered, one is thin.
- 4: a realistic option or a stated criterion is missing.
- 0 to 2: it answers a different question from the one asked.

**Specificity**
- 10: a clear pick, with the numbers and the conditions that decide it.
- 7: a clear pick, with one or two vague places.
- 4: a lot of "consider" and "it depends" without a pick.
- 0 to 2: generic advice that would fit any question.

**Robustness**
- 10: every attack in this match is fixed or correctly rebutted, and nothing new is broken.
- 7: one MINOR attack still standing.
- 4: a MAJOR attack still standing, or a fix that broke something else.
- 0 to 2: a FATAL attack still standing.

A missing attack file means the opponent raised nothing. Score robustness on the flaws you found yourself.

**Clarity**
- 10: the pick and the reasons are obvious. No padding.
- 7: fine, with some padding or one confusing section.
- 4: the user has to dig for the answer.
- 0 to 2: hard to follow at all.

## The fatal rule

Mark an answer `fatal` only when you have verified a flaw that makes it wrong or unusable for the
question: a false central claim, an invented source, a hard constraint of the user broken, the wrong
question answered. A fatal answer cannot beat an answer that is not fatal, whatever the totals say.
If both are fatal, the totals decide.

## Ties

There are no draws. On an exact tie, the answer with fewer attacks still standing wins. If that is
also level, the higher correctness score wins. If that is also level, pick the one you would hand to
the user, and say why in the reason.

## What the judge does not reward

- **Length.** Longer is not better. A tight answer that covers every criterion beats a long one
  that covers the same criteria.
- **Confidence.** A defense that says "fixed" is not proof. Check the revised answer. When a claim
  decides the match, open its source.
- **The approach.** The judge never sees the strategy cards and does not guess at them. It scores
  the work, not the method that produced it.
- **Talking about quality.** "This thorough, well-researched answer" earns nothing.
- **Agreement with the judge's own taste** where the question does not ask for it.
