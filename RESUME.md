# AGORA — resume bullet & interview defense

## Resume bullet (fill in real-model numbers if you run one)

> Built **Agora**, a society of 15 generative AI agents on a cognitive
> architecture — a memory-stream retrieval engine scored by
> recency/importance/relevance, periodic reflection, and recursive daily
> planning with reactive re-planning. From a single seeded intention, agents
> produced **emergent coordinated behavior with no scripting** (an invitation
> diffused to 100% of the town and a self-organized gathering of up to 15
> agents), scored **~96% on an interview-based believability eval** (2%
> contradiction rate), and ran affordably (~2.5K LLM calls/sim-day, fully cached
> on re-run) behind a swappable LLM interface (mock / local Ollama / API).

Shorter variant:

> Built a 15-agent generative-agent society (memory-stream retrieval, reflection,
> planning); a single seed produced 100% information diffusion and a self-organized
> event with no scripting, at ~96% believability, on a swappable local/API LLM.

## Why it's a strong project

- **Explainable end-to-end.** You can point at *exactly* why an agent did
  something — the retrieved memories, with their recency/importance/relevance
  breakdown, are shown in the UI. This is the differentiator vs. "I called an
  API."
- **The impressive part is the architecture and the emergence, not the model.**
  It survives the "you just wrapped an LLM" question because the emergence works
  even on a deterministic mock — it comes from the memory/retrieval/planning
  loop, not model cleverness.
- **On-trend and legible.** "Multi-agent systems" is the phrase agentic-AI teams
  hire on; this is a compact, defensible demonstration of one with real metrics.

## Interview defense — likely questions

**"Isn't this just prompting in a loop?"**
No — the core is an information-retrieval engine over a per-agent memory stream.
Each memory carries an importance score and an embedding; retrieval ranks by a
per-query-normalized weighted sum of recency (exponential decay), importance, and
embedding relevance. That ranking is what keeps agents coherent over simulated
days, and it's ablatable — there's a test proving that zeroing the relevance
weight changes what gets retrieved.

**"How does the party emergence actually work? Did you script it?"**
No script. A party invitation is simply a high-importance memory. High importance
→ it's retrieved → it's surfaced in conversation → the listener stores a summary
of that conversation → that summary is parseable as an event → at planning time
the listener retrieves it and adds a step to attend. Coordination falls out of
the loop. I can show the exact plan step appearing in an agent's plan the moment
it hears the news.

**"What was the hardest bug?"**
A "telephone-game" mutation: the event parser picked the first known location in
list-order, so a stray mention of another place in a conversation could rewrite
the party's venue as it spread. Fixed by choosing the location that appears
*earliest in the text* (next to "party at …"), with a regression test.

**"How do you keep cost down?"**
An on-disk response cache keyed on (prompt, system, params); batched importance
scoring; heuristic importance for routine perceptions so the model is reserved
for dialogue/reflection/planning; and a swappable small/local backend. Calls are
bucketed by purpose so cost is legible (~2.5K calls/sim-day, dominated by
dialogue). An identical re-run is 100% cache hits.

**"How do you know the agents are believable, not just moving around?"**
An interview harness asks each agent about its day (where it went, who it talked
to, evening plans). The agent answers from its retrieved memories; answers are
scored against ground truth reconstructed from that agent's actual experience,
and hallucinated places/people count as contradictions. That turns "looks alive"
into a number (~96% consistency, 2% contradictions).

**"What would you do with more time?"**
Real semantic embeddings by default (the hashing embedder is the zero-dep
fallback), full-resimulation time-travel (currently the scrubber replays recorded
frames), richer interruptible planning, and a larger town with schools/workplaces
that impose their own schedules.
