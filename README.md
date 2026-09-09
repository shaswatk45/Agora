# AGORA — a society of generative agents

**▶ Live demo:** [the town](https://agora-six-mu.vercel.app/) · [walk it in 3D](https://agora-six-mu.vercel.app/town3d)
&nbsp;— runs entirely in your browser (an in-browser twin of the engine). The full
Python cognitive engine below runs locally with swappable local/LLM backends.

> **Agora** *(the public square of a Greek city)* is a small simulated town where
> 15 AI agents live out their days. Each has a persona, a **memory stream**, and
> goals. They perceive, remember, reflect, plan, and act — and out of those
> individual minds, **collective behavior emerges that nobody scripted**: news
> spreads mouth-to-mouth, relationships form, and a party organizes itself.

It is a watchable, **explainable** multi-agent system built on a real cognitive
architecture (in the spirit of Park et al., *"Generative Agents: Interactive
Simulacra of Human Behavior"*, 2023) — not a chatbot wrapper. Click any agent and
read the exact memories, scored by recency/importance/relevance, that explain
what it is doing right now.

---

## The money shot

Seed **one** agent (Isabella, the café owner) with a single intention — *"throw a
Valentine's party at Hobbs Café at 5pm and invite people."* Tell no one else.
Then just run the day:

```
10:00  Isabella tells her roommate Lena about the party.
12:00  Over lunch at the café, word spreads to Maria, Ravi, Tom…
15:00  Klaus hears it from Maria; Sofia from Wolfgang; Carlos from Mei…
17:00  A crowd has gathered at Hobbs Café — for a party no line of code told them to attend.
19:00  The gathering breaks up; everyone heads home.
```

Nothing in the code says "everyone goes to the party." Attendance is a
*consequence of the architecture*: a party invitation is a high-importance
memory → so it is **retrieved** → so it is **spoken** in conversation → so the
listener **stores** it → so it surfaces during the listener's **planning** → so
they attend. That chain is the whole point.

### Measured results (default mock backend, reproducible)

| Metric | Result |
| --- | --- |
| **Information diffusion** | **15 / 15 agents (100%)** learned of the party from a single seed |
| **Emergent gathering** | **up to 15 agents** self-organized at the venue during the party window |
| **Believability** (interview eval) | **95.9%** consistency of agents' self-reports with what actually happened |
| **Contradiction rate** | **2.2%** |
| **Cost** | **~2,492 LLM calls / simulated day**, **100% served from cache** on an identical re-run |

Run `py -3.12 eval/run_eval.py` to regenerate these numbers into
`data/eval_report.json`.

---

## Run it (zero setup)

The default LLM backend is a deterministic **mock** — no model download, no API
key — so the whole simulation *and the emergence demo* run out of the box.

```bash
pip install -r requirements.txt      # fastapi + uvicorn + websockets
py -3.12 run.py                      # opens http://localhost:8000
```

In the browser: press **Play**, then **✦ Seed party**, and watch the invitation
spread through the town. Click any agent to open its mind. Press **Run
believability eval** to interview every agent and score them live.

### The town view

The frontend is a living 2.5D town rendered with plain Canvas — no build step,
no external art. Everything is drawn procedurally: buildings with roofs, awnings
and signs per kind; lanes, trees, a pond and a plaza fountain; and a cast of
distinct villager avatars (hair, skin, outfit, accessories derived from each
agent's id, with its signature colour as the shirt).

- **Walking, not teleporting** — server ticks are tweened along real walkable
  paths (client-side BFS on the same grid), with facing and a walk cycle.
- **See where everyone is going** — each moving villager shows a dotted trail
  and a bouncing destination pin; select one and its target building pulses.
- **Day → night** — the sim clock drives sky, ambient light, glowing windows,
  lamplight and doorway spill.
- **The party is an event** — a banner over the venue, string lights, floating
  hearts and confetti as the crowd converges.
- **Camera** — drag to pan, scroll to zoom, `F` to follow the selected villager,
  `Space` to play/pause, `0` to refit.
- **Inspector** — portrait, current thought, plan timeline (with the emergent
  party step), retrieved memories with recency/importance/relevance bars,
  reflections, relationships.
- Live gazette feed, scrubbable timeline, and the believability eval modal.

### Walk it in 3D

Click **Enter 3D** (or open `/3d`) for a first/third-person **walkable town**
rendered with three.js — same simulation, same live data, in 3D. Everything is
procedural (no external assets, no bundler): painted-to-canvas textures (grass,
cobblestone, shingles, plaster, wood), gabled buildings with framed windows,
signs and per-place details (café umbrellas, library columns, school bell tower,
market stall, picket fences), instanced trees/grass/flowers, a plaza fountain
and park pond, and 15 villagers with hair, hats and props who walk their
routines — and glance at you when you're close.

- **Cinematic lighting** — a shader sky dome with sun glow and drifting clouds,
  ACES tone-mapping and soft bloom, a full day/night cycle with stars, glowing
  windows, porch lights and real lamplight, dust motes by day and fireflies at night.
- **Game feel** — velocity-based movement with head-bob and run FOV, smooth
  third-person follow, a **minimap**, an **"E · Talk to …"** prompt, location
  toasts as you enter places, and an adaptive High/Low quality toggle.
- **The party** — string lights, bunting, lanterns, hearts and confetti as the
  crowd converges on the glowing café at dusk; villagers who know about it wear
  a gold ring.

**WASD** move · **mouse** look · **Shift** run · **V** first/third person ·
**E** read a villager's mind · **Space** play/pause · optional ambient sound (🔊).

### Use a real model (swappable behind one interface)

```bash
py -3.12 run.py --llm ollama --model llama3.2:3b     # local, via Ollama
py -3.12 run.py --llm openai --model gpt-4o-mini     # needs OPENAI_API_KEY
```

The mock produces the emergence and the structure; a real model produces richer,
more natural dialogue and reflections. The cognitive architecture is identical
either way — that is the point of the LLM interface.

---

## What's actually hard here (and interesting)

Anyone can call an LLM once. The hard problem is giving *many* agents **persistent
identity and memory over long simulated time** without them going incoherent —
and doing it cheaply. That is a cognitive-architecture + information-retrieval +
systems problem. The impressive parts:

1. **The memory stream + retrieval function** — the technical heart. Every
   experience is a memory with `(timestamp, importance, embedding)`. Retrieval
   ranks candidates by a per-query-normalized weighted sum:

   ```
   score = w_recency·recency + w_importance·importance + w_relevance·relevance
   ```

   Getting this right is what keeps 15 agents coherent. It is a real IR engine,
   and the weights are ablatable — see `tests/test_memory.py`, which proves that
   zeroing the relevance weight changes the ranking.

2. **Reflection** — agents periodically synthesize recent memories into
   higher-level beliefs ("*Tom feels a connection with Diego*", "*Grace cares most
   about community and celebration lately*") stored as high-importance memories.
   This is what makes personalities *develop* instead of staying static.

3. **Recursive planning + re-planning** — a daily plan is decomposed into timed
   actions; a newly learned event is folded into the plan on the fly (you can
   watch the step *"16:20 → go to Hobbs Café for the event"* appear in an agent's
   plan the moment it hears about the party).

4. **Emergence** — coordinated behavior (information diffusion, relationships, a
   self-organized event) that no line of code specifies.

5. **Cost/latency engineering** — naively this is a huge number of LLM calls.
   An on-disk response cache, batched importance scoring, heuristic importance
   for routine perceptions (reserving the model for what matters), and a
   swappable small/local backend keep a full simulated day affordable. Calls are
   bucketed by purpose so the cost is legible (see below).

---

## Architecture

```
World         grid map + locations + objects + a simulated clock / tick loop
Agent
  persona       name, traits, relationships, occupation, home, workplace
  memory        append-only stream; each memory: text, tick, importance, embedding
  retrieval     recency ⊕ importance ⊕ relevance  →  top-k  (per-query normalized)
  reflection    periodic synthesis → new high-level beliefs
  planning      daily → timed actions; reactive re-planning on new events
  action        move toward target location; perceive; converse when co-located
Perception    what each agent sees this tick → observations → memories
Dialogue      grounded conversations; the channel along which news diffuses
LLM interface swappable: mock (default) | ollama | openai — with cache + batching
Embeddings    sentence-transformers if available, else a dependency-free hashing embedder
Sim engine    steps the world, resolves conversations, triggers reflection, records frames
UI            browser town view (Canvas) + scrubbable timeline + per-agent mind inspector
Eval          interview harness → believability score + contradiction rate
```

Data flow each tick: **perceive → retrieve → (plan / re-plan) → act →
converse → reflect**, closing the loop as new actions become new observations.

### Cost breakdown (per simulated day, mock backend)

| Purpose | Calls / sim-day |
| --- | --- |
| dialogue | 1140 |
| dialogue summary | 570 |
| importance scoring | 570 |
| reflection (insight) | 507 |
| reflection (questions) | 169 |
| daily planning | 15 |

An identical re-run is served **100% from the on-disk cache** — the caching win,
made concrete.

---

## Repo layout

```
agora/
  run.py                     # one-command entrypoint (server + browser)
  run_tests.py               # runs the suite without pytest
  src/agora/
    config.py                # every tunable (retrieval weights, cadence, backends)
    world/                   # map, locations, objects, clock, pathfinding
    agent/                   # persona, memory stream + retrieval, reflection, planning, dialogue
    llm/                     # swappable LLM interface + cache + mock/ollama/openai backends
    embed/                   # embeddings (sentence-transformers | hashing) + cosine
    sim/                     # engine (tick loop, conversations, metrics)
    evaluation/              # interview-based believability scoring
    scenarios/               # the party-emergence seed
    server/                  # FastAPI: REST + WebSocket, serves the UI
  ui/                        # browser town view + agent inspector (vanilla JS + Canvas)
  eval/run_eval.py           # headless: emergence + believability + cost numbers
  tests/                     # retrieval scoring/ablation, pathfinding, planning, reflection, emergence
```

## Tests

```bash
py -3.12 run_tests.py        # 16 tests, no dependencies (or: py -3.12 -m pytest)
```

Coverage includes the retrieval scoring function and a **weight-ablation** test,
map connectivity and pathfinding, plan parsing/target resolution, reflection, the
event-parser (including the "telephone-game" location-mutation fix), and an
end-to-end **emergence** test asserting that a single seed reaches the majority
of the town.

---

## Notes on the numbers

The headline figures above are produced with the **mock** backend so they are
fully reproducible on any machine with no model. The mock is deterministic and
grounds every answer in retrieved memory, which is *why* the believability score
is high — grounded retrieval yields consistent self-reports, which is exactly the
claim being tested. The **emergence** results (diffusion, attendance) come from
the architecture and hold regardless of backend. Swap in Ollama or an API model
for qualitatively richer dialogue; the same eval harness scores it.
