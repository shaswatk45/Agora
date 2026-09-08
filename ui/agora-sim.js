/* AGORA — in-browser simulation twin.
   A faithful JavaScript port of the Python cognitive engine's *behaviour* and
   data shapes, so the site can run with no backend at all (e.g. on Vercel).
   It produces the same /api/world, /api/state, /api/agent and /api/eval shapes,
   with a real memory stream + recency/importance/relevance retrieval, mock
   planning, grounded dialogue that diffuses the party invitation, reflection,
   and day/night. The real engine lives in Python (src/agora); this is its twin
   for a zero-backend public demo. */
(function () {
  "use strict";

  const MIN_PER_TICK = 10, DAY_START = 480, STEP_TILES = 5;
  const CONVO_COOLDOWN = 6, MAX_CONVOS = 5, REFLECT_TRIGGER = 100;
  const REC_DECAY = 0.99, TOPK = 8;

  // ---- text helpers ----
  const TOK = /[a-z0-9']+/g;
  const tok = (s) => (s.toLowerCase().match(TOK) || []);
  const EVENT_WORDS = ["party", "gathering", "celebration", "get-together", "meetup", "event", "festival"];
  const HIGH = ["party", "invite", "invitation", "love", "confess", "fight", "wedding", "celebration", "engaged", "married", "moving", "promotion"];
  const MID = ["plan", "decide", "meeting", "date", "project", "worried", "excited", "hope", "friend", "neighbor", "conversation", "asked"];
  const LOW = ["wake", "woke", "breakfast", "lunch", "dinner", "coffee", "walk", "arrived", "sat", "sleep", "idle"];
  function parseTime(text) {
    let m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(text);
    if (m) { let h = (+m[1]) % 12; if (m[3] === "pm") h += 12; return h * 60 + (+(m[2] || 0)); }
    m = /\b(\d{1,2}):(\d{2})\b/.exec(text);
    if (m) { const h = +m[1], mm = +m[2]; if (h < 24 && mm < 60) return h * 60 + mm; }
    return null;
  }
  function parseEvent(text, locNames) {
    const low = text.toLowerCase();
    if (!EVENT_WORDS.some(w => low.includes(w))) return null;
    let loc = null, pos = 1e9;
    for (const n of locNames) { const i = low.indexOf(n.toLowerCase()); if (i !== -1 && i < pos) { loc = n; pos = i; } }
    if (!loc) return null;
    const t = parseTime(low); if (t == null) return null;
    return { location: loc, time_min: t, text: text.trim() };
  }
  const hhmm = (m) => { m = ((m % 1440) + 1440) % 1440; return String((m / 60) | 0).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  function rng(seed) { let s = seed >>> 0; return () => { s += 0x6D2B79F5; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---- world data (mirrors src/agora/world/maps.py) ----
  const GW = 40, GH = 30;
  const LOC_SPEC = [
    ["Public Library", 3, 2, 6, 4, "study", "#6b8fb5", true, ["reading desks", "research stacks", "quiet corner"]],
    ["Willow School", 12, 2, 6, 4, "civic", "#c98b52", true, ["classroom", "chalkboard", "art supplies"]],
    ["Art Studio", 21, 2, 6, 4, "art", "#b57eb5", true, ["easels", "half-finished paintings", "clay wheel"]],
    ["General Store", 30, 2, 6, 4, "shop", "#5aa06e", true, ["shelves of goods", "cash register", "fresh produce"]],
    ["Hobbs Cafe", 6, 11, 7, 4, "cafe", "#d98b5f", true, ["espresso machine", "pastry counter", "cozy tables", "corner table"]],
    ["Town Plaza", 16, 11, 8, 5, "plaza", "#c9c19b", false, ["fountain", "benches", "street stage"]],
    ["The Park", 27, 11, 9, 6, "park", "#7fb069", false, ["oak tree", "flower beds", "yoga lawn", "pond"]],
    ["Rose Cottage", 2, 21, 4, 4, "home", "#a56a8a", true, ["kitchen", "sofa", "bookshelf"]],
    ["Cedar House", 8, 21, 4, 4, "home", "#8a6a56", true, ["shared kitchen", "study desks", "couch"]],
    ["Oak House", 14, 21, 4, 4, "home", "#6a7a56", true, ["family table", "fireplace", "garden tools"]],
    ["Birch House", 20, 21, 4, 4, "home", "#56767a", true, ["record player", "yoga mats", "kitchen"]],
    ["Willow Flat", 26, 21, 4, 4, "home", "#7a5676", true, ["bookstacks", "small kitchen", "balcony"]],
    ["Maple Flat", 32, 21, 4, 4, "home", "#566a7a", true, ["dual monitors", "art prints", "coffee maker"]],
  ];

  // ---- personas (mirrors src/agora/agent/persona.py) ----
  const PALETTE = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324", "#800000", "#aaffc3", "#808000"];
  const PERSONAS = [
    { name: "Isabella Rodriguez", age: 34, traits: ["warm", "organized", "sociable"], occupation: "cafe owner", home: "Rose Cottage", workplace: "Hobbs Cafe", backstory: "She runs Hobbs Cafe and treats it as the town's living room; she has been wanting to do something to bring everyone together.", goals: ["make the cafe the heart of the community"], relationships: { "Lena Novak": "roommate and close friend", "Maria Lopez": "her barista", "Tom Moreno": "fellow shop owner" } },
    { name: "Lena Novak", age: 24, traits: ["adventurous", "blunt", "curious"], occupation: "journalist", home: "Rose Cottage", workplace: "Town Plaza", backstory: "A local journalist who knows everyone's business and can't keep exciting news to herself.", goals: ["find a good story worth telling"], relationships: { "Isabella Rodriguez": "roommate and close friend", "Carlos Gomez": "drinking buddy" } },
    { name: "Maria Lopez", age: 21, traits: ["curious", "studious", "energetic"], occupation: "student and barista", home: "Cedar House", workplace: "Hobbs Cafe", backstory: "A university student working part-time at Hobbs Cafe while studying; she has a quiet crush on Klaus.", goals: ["pass her exams", "spend more time with Klaus"], relationships: { "Klaus Mueller": "housemate she has a crush on", "Isabella Rodriguez": "her boss" } },
    { name: "Klaus Mueller", age: 23, traits: ["introverted", "diligent", "kind"], occupation: "researcher", home: "Cedar House", workplace: "Public Library", backstory: "A graduate researcher writing a paper on urban gentrification; he spends most of his time at the library.", goals: ["finish his research paper"], relationships: { "Maria Lopez": "housemate and friend", "Wolfgang Schulz": "the librarian who helps him" } },
    { name: "Hana Sato", age: 19, traits: ["shy", "creative", "observant"], occupation: "art student", home: "Cedar House", workplace: "Willow School", backstory: "A first-year art student, shy but bursting with ideas she rarely shares out loud.", goals: ["build the courage to show her art"], relationships: { "Grace Kim": "her art mentor" } },
    { name: "Tom Moreno", age: 42, traits: ["practical", "gruff", "loyal"], occupation: "shopkeeper", home: "Oak House", workplace: "General Store", backstory: "He runs the General Store with his wife Jennifer and has known everyone in town for decades.", goals: ["keep the store running", "look out for his neighbors"], relationships: { "Jennifer Moreno": "his wife", "Isabella Rodriguez": "fellow shop owner", "Diego Fernandez": "old friend" } },
    { name: "Jennifer Moreno", age: 40, traits: ["caring", "artistic", "patient"], occupation: "painter", home: "Oak House", workplace: "Art Studio", backstory: "A painter who sells work at the Art Studio and mothers half the town whether they like it or not.", goals: ["finish her new painting series"], relationships: { "Tom Moreno": "her husband", "Grace Kim": "her studio partner" } },
    { name: "Diego Fernandez", age: 50, traits: ["jovial", "talkative", "generous"], occupation: "gardener", home: "Oak House", workplace: "The Park", backstory: "The town gardener and unofficial storyteller; he tends the Park and greets everyone who passes.", goals: ["keep the Park beautiful"], relationships: { "Tom Moreno": "old friend", "Carlos Gomez": "chess rival" } },
    { name: "Ayesha Khan", age: 29, traits: ["cheerful", "talkative", "encouraging"], occupation: "schoolteacher", home: "Birch House", workplace: "Willow School", backstory: "A schoolteacher who believes any occasion is an excuse to gather people together.", goals: ["inspire her students"], relationships: { "Carlos Gomez": "housemate", "Hana Sato": "a former student" } },
    { name: "Carlos Gomez", age: 37, traits: ["easygoing", "musical", "warm"], occupation: "musician", home: "Birch House", workplace: "Town Plaza", backstory: "A street musician who plays in the Town Plaza and knows every regular by their song request.", goals: ["write a song people remember"], relationships: { "Sofia Rossi": "girlfriend", "Ayesha Khan": "housemate", "Lena Novak": "drinking buddy" } },
    { name: "Sofia Rossi", age: 26, traits: ["bubbly", "stylish", "sociable"], occupation: "shop assistant", home: "Willow Flat", workplace: "General Store", backstory: "Works the counter at the General Store; she loves parties more than almost anything.", goals: ["plan the perfect night out"], relationships: { "Carlos Gomez": "boyfriend", "Tom Moreno": "her boss" } },
    { name: "Wolfgang Schulz", age: 45, traits: ["contemplative", "wise", "reserved"], occupation: "librarian", home: "Willow Flat", workplace: "Public Library", backstory: "The town librarian who has read more than he has spoken and quietly helps the researchers who visit.", goals: ["preserve the town's records"], relationships: { "Klaus Mueller": "a researcher he mentors" } },
    { name: "Ravi Patel", age: 33, traits: ["analytical", "quiet", "dry-humored"], occupation: "software freelancer", home: "Maple Flat", workplace: "Hobbs Cafe", backstory: "A freelance developer who treats the corner table at Hobbs Cafe as his office.", goals: ["ship his side project"], relationships: { "Isabella Rodriguez": "his favorite barista-owner", "Grace Kim": "housemate" } },
    { name: "Grace Kim", age: 28, traits: ["empathetic", "driven", "creative"], occupation: "art studio owner", home: "Maple Flat", workplace: "Art Studio", backstory: "She runs the Art Studio and mentors young artists, always on the lookout for new talent.", goals: ["give local artists a stage"], relationships: { "Jennifer Moreno": "studio partner", "Hana Sato": "a promising student", "Ravi Patel": "housemate" } },
    { name: "Mei Lin", age: 31, traits: ["ambitious", "meticulous", "calm"], occupation: "yoga instructor", home: "Birch House", workplace: "The Park", backstory: "She leads morning yoga in the Park and keeps a calm head when everyone else is flustered.", goals: ["grow her class", "stay balanced"], relationships: { "Diego Fernandez": "shares the Park with him", "Ayesha Khan": "housemate" } },
  ];

  const KW_LOC = [
    [["sleep", "wind down", "bed", "go home", "dinner", "wake", "breakfast", "get ready"], "home"],
    [["lunch", "coffee", "cafe"], "Hobbs Cafe"],
    [["work", "job", "shift", "tasks", "teach", "class", "focus"], "workplace"],
    [["errand", "shop", "groceries", "store"], "General Store"],
    [["read", "study", "research", "library"], "Public Library"],
    [["walk", "park", "garden", "yoga", "relax"], "The Park"],
    [["music", "plaza", "perform", "play"], "Town Plaza"],
    [["paint", "art", "studio"], "Art Studio"],
  ];

  function createAgoraSim() {
    // build grid
    const blocked = new Uint8Array(GW * GH);
    const locs = LOC_SPEC.map(s => {
      const [name, x, y, w, h, kind, color, blk, objects] = s;
      const anchor = blk ? [x + (w >> 1), y + h] : [x + (w >> 1), y + (h >> 1)];
      if (blk) for (let gx = x; gx < x + w; gx++) for (let gy = y; gy < y + h; gy++) blocked[gy * GW + gx] = 1;
      return { name, x, y, w, h, kind, color, blocking: blk, objects, anchor };
    });
    const byName = {}; locs.forEach(l => byName[l.name] = l);
    const locNames = locs.map(l => l.name);
    const walkable = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && !blocked[y * GW + x];
    function bfs(sx, sy, gx, gy) {
      if (sx === gx && sy === gy) return [];
      if (!walkable(gx, gy)) return [];
      const prev = new Int32Array(GW * GH).fill(-1), seen = new Uint8Array(GW * GH), q = [sy * GW + sx];
      seen[q[0]] = 1; let head = 0, found = false;
      while (head < q.length) { const cur = q[head++], cx = cur % GW, cy = (cur / GW) | 0; if (cx === gx && cy === gy) { found = true; break; } for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) { if (!walkable(nx, ny)) continue; const ni = ny * GW + nx; if (seen[ni]) continue; seen[ni] = 1; prev[ni] = cur; q.push(ni); } }
      if (!found) return [];
      const path = []; let n = gy * GW + gx; while (n !== sy * GW + sx) { path.push([n % GW, (n / GW) | 0]); n = prev[n]; } return path.reverse();
    }
    function locationAt(x, y) { let best = null, bd = 2; for (const l of locs) { if (x >= l.x && x < l.x + l.w && y >= l.y && y < l.y + l.h) return l.name; const d = Math.abs(l.anchor[0] - x) + Math.abs(l.anchor[1] - y); if (d < bd) { best = l.name; bd = d; } } return best; }

    let memId = 1, tick = 0;
    const cache = new Map(); let llmCalls = 0, cacheHits = 0;
    function llm(key) { if (cache.has(key)) { cacheHits++; return; } cache.set(key, 1); llmCalls++; }
    function importance(text) { const low = text.toLowerCase(); let s = 2; if (MID.some(w => low.includes(w))) s = 4; if (HIGH.some(w => low.includes(w))) s = 8; if (LOW.some(w => low.includes(w)) && !HIGH.some(w => low.includes(w))) s = Math.min(s, 2); llm("imp:" + text); return Math.max(1, Math.min(10, s)); }

    // agents
    const agents = PERSONAS.map((p, i) => {
      const a = byName[p.home].anchor;
      return {
        p, color: PALETTE[i], pos: [a[0], a[1]], mems: [], impSince: 0,
        plan: [], planDay: -1, action: "waking up", target: p.home, thought: "", lastLoc: null,
        lastTalked: {}, met: new Set(), scheduled: new Set(), path: [], firstName: p.name.split(" ")[0],
      };
    });
    const byId = {}; agents.forEach(a => byId[a.p.name] = a);
    const roster = agents.map(a => a.firstName);

    // seed memories
    for (const a of agents) {
      addMem(a, `${a.p.name}, age ${a.p.age}, is a ${a.p.occupation}. Traits: ${a.p.traits.join(", ")}. ${a.p.backstory}`, "reflection", 6);
      a.p.goals.forEach(g => addMem(a, `${a.firstName} wants to ${g}.`, "reflection", 6));
      Object.entries(a.p.relationships).forEach(([n, r]) => addMem(a, `${n} is ${a.firstName}'s ${r}.`, "observation", 5));
      a.impSince = 0;
    }

    function addMem(a, text, kind, imp, tickAt) { const m = { id: memId++, kind, text: text.trim(), importance: imp, created: tickAt == null ? tick : tickAt, access: tickAt == null ? tick : tickAt, embedding: tok(text) }; a.mems.push(m); a.impSince += imp; return m; }

    function retrieve(a, query, k, touch) {
      k = k || TOPK; const q = tok(query), qset = new Set(q);
      if (!a.mems.length) return [];
      const rows = a.mems.map(m => {
        const hours = Math.max(0, (tick - m.access) * MIN_PER_TICK / 60);
        const rec = Math.pow(REC_DECAY, hours);
        let inter = 0; const mset = new Set(m.embedding); for (const t of qset) if (mset.has(t)) inter++;
        const rel = qset.size && mset.size ? inter / Math.sqrt(qset.size * mset.size) : 0;
        return { m, rec, imp: m.importance, rel };
      });
      const mm = (key) => { let lo = Infinity, hi = -Infinity; for (const r of rows) { lo = Math.min(lo, r[key]); hi = Math.max(hi, r[key]); } return (v) => hi - lo < 1e-9 ? 0 : (v - lo) / (hi - lo); };
      const nr = mm("rec"), ni = mm("imp"), nl = mm("rel");
      rows.forEach(r => { r.recN = nr(r.rec); r.impN = ni(r.imp); r.relN = nl(r.rel); r.score = r.recN + r.impN + r.relN; });
      rows.sort((x, y) => y.score - x.score);
      const top = rows.slice(0, k);
      if (touch !== false) top.forEach(r => r.m.access = tick);
      return top;
    }

    // planning
    const rrng = rng(7);
    function workLine(occ) { return `head to work and focus on ${occ} tasks`; }
    function afternoonLine(occ, r) { return ["run errands at the Store", "spend time at the Park", "read at the Library", `continue ${occ} work`, "visit a neighbor"][(r() * 5) | 0]; }
    function makePlan(a) {
      const r = rng(hash(a.p.name + ":" + clock().day));
      const base = [[480, `wake up and have breakfast at ${a.p.home}`], [540, workLine(a.p.occupation)], [720, "have lunch at Hobbs Cafe"], [840, afternoonLine(a.p.occupation, r)], [1080, `have dinner at ${a.p.home}`], [1320, `wind down and sleep at ${a.p.home}`]];
      a.plan = base; a.planDay = clock().day; llm("plan:" + a.p.name + clock().day);
      addMem(a, "Made a plan for today: " + base.map(s => s[1]).join("; "), "plan", 3);
    }
    function ensurePlan(a) { if (a.planDay !== clock().day || !a.plan.length) makePlan(a); }
    function currentStep(a, minOfDay) { let cur = a.plan[0]; for (const s of a.plan) if (s[0] <= minOfDay) cur = s; return cur; }
    function resolveTarget(a, desc) { const low = desc.toLowerCase(); for (const n of locNames) if (low.includes(n.toLowerCase())) return n; for (const [kws, t] of KW_LOC) if (kws.some(k => low.includes(k))) return t === "home" ? a.p.home : t === "workplace" ? a.p.workplace : t; return a.p.workplace; }
    function eventSteps(a) {
      const now = clock().minute_of_day, out = [];
      for (const r of retrieve(a, "upcoming party event invitation gathering", TOPK, false)) { const ev = parseEvent(r.m.text, locNames); if (ev && ev.time_min > now) out.push(ev); }
      return out;
    }
    function integrateEvents(a) {
      const now = clock().minute_of_day; let added = false;
      for (const ev of eventSteps(a)) {
        if (a.scheduled.has(ev.time_min)) continue; a.scheduled.add(ev.time_min);
        const end = ev.time_min + 120, lead = Math.max(now + 1, ev.time_min - 40); if (lead >= end) continue;
        a.plan = a.plan.filter(([t]) => !(t >= lead && t < end));
        a.plan.push([lead, `go to ${ev.location} at ${hhmm(ev.time_min)} for the event`]);
        a.plan.push([end, `head home to ${a.p.home} after the event`]);
        a.plan.sort((x, y) => x[0] - y[0]); added = true;
      }
      return added;
    }

    function decide(a) { const st = currentStep(a, clock().minute_of_day); if (!st) { a.action = "idling"; a.target = a.p.home; return; } a.action = st[1]; a.target = resolveTarget(a, st[1]); a.thought = st[1]; }
    function act(a) { const tp = byName[a.target].anchor; if (a.pos[0] === tp[0] && a.pos[1] === tp[1]) return; const path = bfs(a.pos[0], a.pos[1], tp[0], tp[1]); if (path.length) a.pos = path[Math.min(STEP_TILES, path.length) - 1]; }

    function perceive(a) {
      const loc = locationAt(a.pos[0], a.pos[1]);
      if (loc && loc !== a.lastLoc) { const L = byName[loc]; addMem(a, `${a.firstName} arrived at ${loc} and noticed ${(L.objects.slice(0, 2)).join(", ")}.`, "observation", 2); a.lastLoc = loc; }
      for (const b of agents) { if (b === a) continue; if (Math.max(Math.abs(a.pos[0] - b.pos[0]), Math.abs(a.pos[1] - b.pos[1])) <= 1) { const first = !a.met.has(b.p.name); a.met.add(b.p.name); addMem(a, `${a.firstName} saw ${b.firstName} at ${loc || "town"}.`, "observation", first ? 4 : 2.5); } }
    }

    function converse(a, b) {
      const turns = [];
      const pair = [a, b];
      for (let i = 0; i < 4; i++) {
        const sp = pair[i % 2], ls = pair[(i + 1) % 2];
        const top = retrieve(sp, `catching up with ${ls.firstName}: news, plans, invitations to share, and our relationship`, 5)[0];
        let text;
        const ev = top ? parseEvent(top.m.text, locNames) : null;
        if (ev && /party/i.test(top.m.text)) text = `By the way, ${ev.text} You should come to ${ev.location} at ${hhmm(ev.time_min)}!`;
        else if (top && i < 2) text = paraphrase(top.m.text);
        else text = ["Right.", "I see.", "Makes sense.", "Oh nice."][i % 4];
        if (i === 0) text = `Hi ${ls.firstName}! ` + text;
        turns.push(text); llm("dlg:" + sp.p.name + ls.p.name + i);
      }
      const all = turns.join(" ");
      const ev = parseEvent(all, locNames), learned = !!ev;
      let summary;
      if (ev && /party/i.test(all)) summary = `${a.firstName} told ${b.firstName} about a party at ${ev.location} at ${hhmm(ev.time_min)}. ${b.firstName} was invited.`;
      else summary = `${a.firstName} and ${b.firstName} talked about ${topic(all)}.`;
      llm("sum:" + summary);
      for (const [me, other] of [[a, b], [b, a]]) { const text = `Talked with ${other.p.name}. ${summary}`; addMem(me, text, "dialogue", importance(text)); me.lastTalked[other.p.name] = tick; }
      integrateEvents(a); integrateEvents(b);
      return { a: a.firstName, b: b.firstName, summary, learned };
    }
    function paraphrase(m) { return `I was just thinking, ${m.replace(/\.$/, "")}.`; }
    function topic(all) { const low = all.toLowerCase(); for (const k of ["party", "work", "art", "music", "family", "plans"]) if (low.includes(k)) return k; return "how things are going"; }

    function reflect(a) {
      const recent = a.mems.slice(-25);
      const counts = {}; for (const m of recent) for (const w of m.text.replace(/[.,]/g, " ").split(" ")) if (roster.includes(w) && w !== a.firstName) counts[w] = (counts[w] || 0) + 1;
      const subjects = Object.entries(counts).sort((x, y) => y[1] - x[1]).map(x => x[0]);
      const r = rng(hash(a.p.name + tick)); const out = [];
      const qs = subjects.slice(0, 2).map(s => `relationship with ${s}`); qs.push("cares about most");
      for (const q of qs.slice(0, 3)) {
        llm("reflq:" + a.p.name + q); const ev = retrieve(a, q, 5, false);
        let insight;
        if (q.includes("with")) { const subj = q.split("with")[1].trim(); insight = `${a.p.name} ${["values", "is growing closer to", "is intrigued by", "feels a connection with"][(r() * 4) | 0]} ${subj}.`; }
        else { const joined = ev.map(e => e.m.text).join(" ").toLowerCase(); const theme = joined.includes("party") ? "community and celebration" : joined.includes("art") ? "art" : joined.includes("music") ? "music" : "the people around them"; insight = `${a.p.name} seems to care most about ${theme} lately.`; }
        llm("refli:" + insight); addMem(a, insight, "reflection", 7); out.push(insight);
      }
      a.impSince = 0; return out;
    }

    // clock + events
    const _clock = { tick: 0 };
    function clock() { const total = DAY_START + _clock.tick * MIN_PER_TICK; return { tick: _clock.tick, day: (total / 1440) | 0, minute_of_day: total % 1440, hhmm: hhmm(total % 1440), total_minutes: total }; }
    const events = []; const diffusion = [];
    let party = null; const convoRng = rng(99);
    function log(kind, text, hl) { const c = clock(); events.push({ tick: c.tick, hhmm: c.hhmm, day: c.day, kind, text, highlight: !!hl }); if (events.length > 400) events.shift(); }

    function party_knowers() { if (!party) return []; const out = []; for (const a of agents) { for (const m of a.mems) { const ev = parseEvent(m.text, locNames); if (ev && ev.location === party.location && Math.abs(ev.time_min - party.time_min) <= 1) { out.push(a.p.name); break; } } } return out; }

    function step() {
      tick = _clock.tick;
      for (const a of agents) { ensurePlan(a); decide(a); act(a); }
      for (const a of agents) perceive(a);
      // conversations
      const pairs = []; for (let i = 0; i < agents.length; i++) for (let j = i + 1; j < agents.length; j++) { const a = agents[i], b = agents[j]; if (Math.max(Math.abs(a.pos[0] - b.pos[0]), Math.abs(a.pos[1] - b.pos[1])) <= 1) pairs.push([a, b]); }
      for (let i = pairs.length - 1; i > 0; i--) { const j = (convoRng() * (i + 1)) | 0; [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
      const busy = new Set(); let n = 0;
      for (const [a, b] of pairs) { if (n >= MAX_CONVOS) break; if (busy.has(a.p.name) || busy.has(b.p.name)) continue; if (tick - (a.lastTalked[b.p.name] ?? -1e9) < CONVO_COOLDOWN || tick - (b.lastTalked[a.p.name] ?? -1e9) < CONVO_COOLDOWN) continue; const rec = converse(a, b); busy.add(a.p.name); busy.add(b.p.name); n++; log("dialogue", `${rec.a} & ${rec.b}: ${rec.summary}`, rec.learned); }
      // reflection
      for (const a of agents) if (a.impSince >= REFLECT_TRIGGER) for (const ins of reflect(a)) log("reflection", `${a.firstName}: ${ins}`);
      _clock.tick++; tick = _clock.tick;
      const c = clock(), known = party_knowers(); const knownSet = new Set(known);
      const atP = party ? agents.filter(a => locationAt(a.pos[0], a.pos[1]) === party.location && knownSet.has(a.p.name)).map(a => a.p.name) : [];
      diffusion.push({ tick: c.tick, day: c.day, hhmm: c.hhmm, knowers: known.length, at_party: atP.length });
      if (diffusion.length > 400) diffusion.shift();
      return snapshot();
    }

    function seedParty(host_name, location, time_min) {
      host_name = host_name || "Isabella Rodriguez"; location = location || "Hobbs Cafe"; time_min = time_min || 1020;
      const host = byId[host_name] || agents[0]; const t = hhmm(time_min);
      addMem(host, `${host.firstName} is planning a Valentine's Day party at ${location} today at ${t}, and wants to invite everyone in town.`, "plan", 9);
      addMem(host, `${host.firstName} should tell everyone she meets about the party at ${location}.`, "plan", 8);
      party = { host: host_name, location, time_min, text: `${host.firstName} is throwing a party at ${location} at ${t}.` };
      log("party_seed", `${host.firstName} decided to throw a Valentine's party at ${location} at ${t}.`);
      return party;
    }

    function snapshot() {
      const c = clock(), known = party_knowers(), knownSet = new Set(known);
      const atP = party ? agents.filter(a => locationAt(a.pos[0], a.pos[1]) === party.location && knownSet.has(a.p.name)).map(a => a.p.name) : [];
      const days = Math.max(c.total_minutes / 1440, 1e-6);
      return {
        running: RUN.running, speed: RUN.speed, clock: c,
        agents: agents.map(a => { const tp = byName[a.target] ? byName[a.target].anchor : null; return { id: a.p.name, name: a.firstName, full_name: a.p.name, pos: a.pos.slice(), color: a.color, action: a.action, location: locationAt(a.pos[0], a.pos[1]), occupation: a.p.occupation, target: a.target, target_pos: tp ? tp.slice() : null, moving: tp ? (a.pos[0] !== tp[0] || a.pos[1] !== tp[1]) : false }; }),
        party, n_knowers: known.length, at_party: atP,
        events: events.slice(-30),
        metrics: { cost: { backend: "browser-sim", calls_per_sim_day: Math.round(llmCalls / days * 10) / 10, cache_hit_rate: Math.round((cacheHits / Math.max(1, llmCalls + cacheHits)) * 1000) / 1000 }, diffusion: { knowers: known.length, total_agents: agents.length, seeded: !!party, series: diffusion.slice(-200) }, world: { tick: c.tick, day: c.day, embedder: "lexical" } },
      };
    }

    function world() { return { w: GW, h: GH, locations: locs.map(l => ({ ...l, anchor: l.anchor.slice() })) }; }

    function inspect(id) {
      const a = byId[id]; if (!a) return null;
      const query = a.action || "what is happening now";
      const retrieved = retrieve(a, query, 6, false);
      const recent = a.mems.slice(-8).reverse();
      const mem2d = (m) => ({ id: m.id, kind: m.kind, text: m.text, importance: Math.round(m.importance * 10) / 10, created_tick: m.created, last_access_tick: m.access, evidence: [] });
      return {
        persona: { name: a.p.name, age: a.p.age, traits: a.p.traits, occupation: a.p.occupation, home: a.p.home, workplace: a.p.workplace, backstory: a.p.backstory, goals: a.p.goals, relationships: a.p.relationships },
        color: a.color, pos: a.pos.slice(), location: locationAt(a.pos[0], a.pos[1]), current_action: a.action, current_thought: a.thought,
        plan: a.plan.map(([t, d]) => ({ time: hhmm(t), desc: d })),
        top_retrieved: retrieved.map(r => ({ ...mem2d(r.m), score: Math.round(r.score * 1000) / 1000, components: { recency: Math.round(r.recN * 1000) / 1000, importance: Math.round(r.impN * 1000) / 1000, relevance: Math.round(r.relN * 1000) / 1000 } })),
        recent_memories: recent.map(mem2d),
        reflections: a.mems.filter(m => m.kind === "reflection").slice(-6).map(mem2d),
        memory_count: a.mems.length, relationships: a.p.relationships,
      };
    }

    function evaluate() {
      const first = roster; const all = [];
      let contradictions = 0, items = 0; const per = [];
      const Q = [["places", "What did you do today and where did you go?"], ["people", "Who did you talk to today?"], ["evening", "Do you have any plans for this evening?"]];
      const knownSet = new Set(party_knowers());
      for (const a of agents) {
        const visited = new Set(), talked = new Set();
        for (const m of a.mems) { let mt = /arrived at ([A-Z][\w ]+?) and/.exec(m.text); if (mt) visited.add(mt[1].trim()); mt = /Talked with ([A-Z][\w ]+?)\./.exec(m.text); if (mt) talked.add(mt[1].trim()); }
        const knows = knownSet.has(a.p.name); const qa = []; const scores = [];
        for (const [kind, q] of Q) {
          const answer = retrieve(a, q, 6, false).slice(0, 3).map(r => r.m.text.replace(/\.$/, "") + ".").join(" ") || "I don't recall much.";
          const low = answer.toLowerCase(); let s = 0.5, contra = false;
          if (kind === "places") { const men = locNames.filter(L => low.includes(L.toLowerCase())); if (men.length) { const ok = men.filter(x => visited.has(x)); s = ok.length / men.length; contra = men.some(x => !visited.has(x)); } }
          else if (kind === "people") { const men = first.filter(nn => nn !== a.firstName && new RegExp(`\\b${nn}\\b`).test(answer)); if (men.length) { const gt = new Set([...talked].map(t => t.split(" ")[0])); const ok = men.filter(x => gt.has(x)); s = ok.length / men.length; contra = men.some(x => !gt.has(x)); } else s = talked.size ? 0.5 : 1; }
          else { const sp = low.includes("party"); s = knows ? (sp ? 1 : 0) : (sp ? 0 : 1); contra = !knows && sp; }
          all.push(s); scores.push(s); items++; if (contra) contradictions++;
          qa.push({ question: q, answer, score: Math.round(s * 100) / 100, contradiction: contra });
        }
        per.push({ agent: a.p.name, score: Math.round(scores.reduce((x, y) => x + y, 0) / scores.length * 1000) / 1000, qa, ground_truth: { visited: [...visited].sort(), talked: [...talked].sort(), knows_party: knows } });
      }
      return { believability_score: all.length ? Math.round(all.reduce((x, y) => x + y, 0) / all.length * 1000) / 10 : 0, contradiction_rate: items ? Math.round(contradictions / items * 1000) / 1000 : 0, items_scored: items, n_agents: agents.length, per_agent: per };
    }

    function reset() { location.reload ? null : null; } // handled by shim (fresh sim)

    const RUN = { running: false, speed: 4 };
    function control(action, value) {
      if (action === "play") RUN.running = true;
      else if (action === "pause") RUN.running = false;
      else if (action === "step") step();
      else if (action === "speed") RUN.speed = +value || 4;
      else if (action === "seed_party") seedParty();
      else if (action === "reset") return "reset";
      return snapshot();
    }

    return { world, snapshot, inspect, evaluate, control, step, seedParty,
      get running() { return RUN.running; }, get speed() { return RUN.speed; } };
  }

  window.createAgoraSim = createAgoraSim;
})();
