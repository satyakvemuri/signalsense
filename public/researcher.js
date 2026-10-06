// Researcher dashboard: sidebar, stat strip, signal pipeline, signal graph, selected-signal detail, other signals.
(function () {
  const RECENT_MS = 15 * 60 * 1000; // an observation this fresh counts as "just now"
  const SVG_NS = "http://www.w3.org/2000/svg";
  const STAGE_NAME = { single: "Single note", echo: "Echo", converging: "Converging" };

  const state = { signals: [], observations: [], pane: "converging", selected: null, loadedAt: null, status: "loading" };
  let root = null;
  let latestRequest = 0; // so only the newest fetch may render

  // Creates an element with an optional class and text (text always goes in via textContent).
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Creates an SVG element with the given attributes.
  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
    return node;
  }

  // Turns "fam_a" into "A" (falls back to the first character, uppercased).
  function letter(id) {
    const m = /^fam_(.+)$/i.exec(String(id));
    return (m ? m[1] : String(id).charAt(0)).toUpperCase();
  }

  // Turns "fam_a" into "Family A".
  function familyName(id) {
    return "Family " + letter(id);
  }

  // Formats an ISO timestamp as a short month + day, e.g. "Sep 12".
  function fmtDate(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // True when an ISO timestamp is within the "just now" window.
  function isRecent(iso) {
    return Date.now() - Date.parse(iso) < RECENT_MS;
  }

  // Singular/plural helper: plural(3, "family", "families") -> "3 families".
  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  // Maps a family count to its stage name (mirrors the server rule).
  function stageFor(n) {
    return n >= 3 ? "converging" : n === 2 ? "echo" : "single";
  }

  // Returns the currently selected signal, defaulting to the top-ranked one.
  function selectedSignal() {
    return state.signals.find((s) => s.category === state.selected) || state.signals[0] || null;
  }

  // Returns the families whose FIRST report in this signal arrived just now.
  function newArrivals(sig) {
    return sig.families.filter((f) => isRecent(f.firstAt));
  }

  // Describes a stage change caused by a just-arrived family, e.g. "Echo → Converging · just now" (or null).
  function transitionLabel(sig) {
    const fresh = newArrivals(sig).length;
    if (!fresh) return null;
    const before = stageFor(sig.familyCount - fresh);
    return before === sig.stage ? null : `${STAGE_NAME[before]} → ${STAGE_NAME[sig.stage]} · just now`;
  }

  // Renders a small uppercase mono label.
  function mono(text, className) {
    return el("div", "res-mono" + (className ? " " + className : ""), text);
  }

  // Builds one stat card for the strip.
  function statCard(label, value, note) {
    const c = el("div", "card res-stat");
    c.append(mono(label), el("div", "res-stat-value", String(value)), el("div", "res-note", note));
    return c;
  }

  // Builds the four-up stat strip from live data.
  function renderStats() {
    const today = new Date().toDateString();
    const addedToday = state.observations.filter((o) => new Date(o.createdAt).toDateString() === today).length;
    const families = new Set(state.observations.map((o) => o.familyId)).size;
    const active = state.signals.filter((s) => s.familyCount >= 2).length;
    const drafted = state.signals.filter((s) => s.draft).length;
    const strip = el("div", "res-stats");
    strip.append(
      statCard("Observations", state.observations.length, addedToday ? `+${addedToday} today` : "none yet today"),
      statCard("Families", families, "none ever see each other"),
      statCard("Active signals", active, "2+ independent families"),
      statCard("Questions drafted", drafted, "awaiting your review"),
    );
    return strip;
  }

  // Builds one pipeline step tile.
  function pipeStep(title, count, note, mode) {
    const li = el("li", "res-step" + (mode ? " res-step--" + mode : ""));
    li.append(mono(title), el("div", "res-step-count", String(count)), el("div", "res-note", note));
    return li;
  }

  // Builds the five-step pipeline showing where each signal is heading.
  function renderPipeline() {
    const count = (stage) => state.signals.filter((s) => s.stage === stage).length;
    const fresh = state.signals.some((s) => newArrivals(s).length > 0);
    const converging = count("converging");
    const sec = el("section", "card res-pipeline");
    sec.setAttribute("aria-label", "Signal pipeline");
    sec.append(mono("Where each signal is heading", "res-pipeline-title"));
    const list = el("ol", "res-steps");
    list.append(
      pipeStep("01 · Single note", count("single"), "1 family"),
      pipeStep("02 · Echo", count("echo"), "2 families"),
      pipeStep("03 · Converging", converging, fresh ? "3+ families · new arrival" : "3+ families", converging ? "hot" : ""),
      pipeStep("04 · Question drafted", state.signals.filter((s) => s.draft).length, "AI drafts an item"),
      pipeStep("05 · Ready for survey", 0, "you approve → registry", "dashed"),
    );
    sec.append(list);
    return sec;
  }

  // Splits a label into two roughly balanced lines for the hub text.
  function twoLines(label) {
    const words = label.split(" ");
    if (words.length < 2) return [label, ""];
    const mid = Math.ceil(words.length / 2);
    return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }

  // Builds the families ↔ themes SVG graph; each family–theme pair is one line.
  function renderGraph() {
    const W = 760, H = 440, FX = 70;
    const sigs = state.signals;
    const famIds = [...new Set(sigs.flatMap((s) => s.families.map((f) => f.familyId)))].sort();
    const famY = new Map(famIds.map((id, i) => [id, (H * (i + 1)) / (famIds.length + 1)]));
    const radius = (s) => (s === sigs[0] ? 62 : 20 + 9 * s.familyCount); // hero is largest; others scale with family count
    const pos = new Map();
    sigs.forEach((s, i) => {
      if (i === 0) pos.set(s.category, { x: 330, y: H / 2 });
      else pos.set(s.category, { x: 630, y: (H * i) / sigs.length });
    });

    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "res-graph-svg", role: "img", "aria-label": "Graph of families and the themes they reported" });
    for (const s of sigs) {
      const p = pos.get(s.category);
      for (const f of s.families) {
        const y1 = famY.get(f.familyId);
        const recent = s.quotes.some((q) => q.familyId === f.familyId && isRecent(q.createdAt));
        const mx = FX + (p.x - FX) / 2;
        const path = svg("path", { d: `M ${FX} ${y1} C ${mx} ${y1}, ${mx} ${p.y}, ${p.x} ${p.y}`, fill: "none" });
        path.setAttribute("class", "res-edge" + (recent ? " res-edge--new" : s.stage === "converging" ? " res-edge--hot" : ""));
        g.append(path);
      }
    }
    for (const s of sigs) g.append(hubNode(s, pos.get(s.category), radius(s)));
    for (const id of famIds) g.append(familyNode(id, FX, famY.get(id), sigs));
    return g;
  }

  // Builds one clickable theme hub (size = family count, style = stage).
  function hubNode(sig, p, r) {
    const node = svg("g", { class: `res-hub res-hub--${sig.stage}` + (sig.category === selectedSignal()?.category ? " is-selected" : ""), tabindex: 0, role: "button" });
    node.setAttribute("aria-label", `${sig.label}: ${plural(sig.familyCount, "family", "families")}`);
    if (sig.stage === "converging") node.append(svg("circle", { cx: p.x, cy: p.y, r: r + 14, class: "res-halo" }));
    node.append(svg("circle", { cx: p.x, cy: p.y, r, class: "res-hub-circle" }));
    const [a, b] = twoLines(sig.label);
    const small = r < 44;
    const t1 = svg("text", { x: p.x, y: p.y - (b ? 4 : -2), class: "res-hub-label", "text-anchor": "middle", "font-size": small ? 13 : 17 });
    t1.textContent = a;
    node.append(t1);
    if (b) {
      const t2 = svg("text", { x: p.x, y: p.y + (small ? 10 : 14), class: "res-hub-label", "text-anchor": "middle", "font-size": small ? 13 : 17 });
      t2.textContent = b;
      node.append(t2);
    }
    const c = svg("text", { x: p.x, y: p.y + r - (small ? 12 : 16), class: "res-hub-count", "text-anchor": "middle" });
    c.textContent = `${sig.familyCount} fam.`;
    node.append(c);
    node.addEventListener("click", () => selectSignal(sig.category));
    node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSignal(sig.category); } });
    return node;
  }

  // Builds one family node; highlighted with a "+1 · just now" pill if it just reported.
  function familyNode(id, x, y, sigs) {
    const recent = sigs.some((s) => s.quotes.some((q) => q.familyId === id && isRecent(q.createdAt)));
    const node = svg("g", { class: "res-fam" + (recent ? " res-fam--new" : "") });
    if (recent) node.append(svg("circle", { cx: x, cy: y, r: 24, class: "res-fam-halo" }));
    node.append(svg("circle", { cx: x, cy: y, r: 17, class: "res-fam-circle" }));
    const t = svg("text", { x, y: y + 4, "text-anchor": "middle", class: "res-fam-letter" });
    t.textContent = letter(id);
    node.append(t);
    if (recent) {
      node.append(svg("rect", { x: x + 28, y: y - 11, width: 78, height: 22, rx: 11, class: "res-pill" }));
      const pt = svg("text", { x: x + 67, y: y + 4, "text-anchor": "middle", class: "res-pill-text" });
      pt.textContent = "+1 · just now";
      node.append(pt);
    }
    return node;
  }

  // Wraps the graph with its title, legend and explanatory footnote.
  function renderGraphCard() {
    const card = el("section", "card res-graph-card");
    card.setAttribute("aria-label", "Signal graph");
    const head = el("div", "res-graph-head");
    const title = el("div");
    title.append(mono("Signal graph"), el("div", "res-h3", "Families ↔ what they noticed"));
    const legend = el("div", "res-legend");
    for (const [cls, text] of [["res-key-family", "Family"], ["res-key-theme", "Theme"], ["res-key-new", "Just now"]]) {
      const k = el("span", "res-key");
      k.append(el("span", cls), document.createTextNode(text));
      legend.append(k);
    }
    head.append(title, legend);
    const stage = el("div", "res-graph-stage");
    stage.append(renderGraph());
    const foot = el("div", "res-note");
    foot.append(document.createTextNode("Each line is a family that reported a theme. A theme grows when "), el("em", null, "independent"), document.createTextNode(" families describe the same change — a family never counts twice."));
    card.append(head, stage, foot);
    return card;
  }

  // Builds the "when each family noticed" timeline, one dot per family at its first report.
  function renderTimeline(sig) {
    const wrap = el("div");
    const track = el("div", "res-timeline");
    track.append(el("div", "res-timeline-line"));
    const t0 = Date.parse(sig.firstAt), span = Math.max(1, Date.parse(sig.lastAt) - t0);
    let prev = -100, row = 0;
    for (const f of sig.families.slice().sort((a, b) => a.firstAt.localeCompare(b.firstAt))) {
      const pct = sig.families.length === 1 || span === 1 ? 50 : 4 + ((Date.parse(f.firstAt) - t0) / span) * 92;
      row = pct - prev < 16 ? 1 - row : 0; // stagger labels that would collide
      prev = pct;
      const fresh = isRecent(f.firstAt);
      const pt = el("div", "res-tl-point" + (fresh ? " is-new" : ""));
      pt.style.left = pct + "%";
      pt.append(el("span", "res-tl-dot"), el("span", "res-tl-label", `${letter(f.familyId)} · ${fresh ? "Today" : fmtDate(f.firstAt)}`));
      if (row) pt.classList.add("is-low");
      track.append(pt);
    }
    wrap.append(track);
    return wrap;
  }

  // Builds the verbatim quote list, newest first.
  function renderQuotes(sig) {
    const wrap = el("div", "res-quotes");
    for (const q of sig.quotes.slice(0, 6)) {
      const fresh = isRecent(q.createdAt);
      const b = el("blockquote", "res-quote" + (fresh ? " is-new" : ""));
      b.append(el("span", "res-quote-text", `“${q.text}”`), el("span", "res-quote-from", `${familyName(q.familyId)}${fresh ? " · new" : ""}`));
      wrap.append(b);
    }
    if (sig.quotes.length > 6) wrap.append(el("div", "res-note", `+ ${sig.quotes.length - 6} more`));
    return wrap;
  }

  // Builds the draft-questionnaire box (or a quiet explanation when nothing is drafted), with the add button when a draft exists.
  function renderDraft(sig) {
    const box = el("div", "res-draft");
    if (sig.draft) {
      box.append(el("div", "res-draft-item", `“${sig.draft.item}”`), el("div", "res-note", sig.draft.question));
      const row = el("div", "res-draft-row");
      const btn = el("button", "res-gold", "Add to next questionnaire");
      btn.type = "button";
      btn.addEventListener("click", () => window.SignalSense.toast("QUESTIONNAIRE REGISTRY — COMING SOON"));
      row.append(btn);
      box.append(row);
    } else {
      box.append(el("div", "res-note", sig.watched ? "No research question yet — one appears once 2+ independent families report this theme." : "No research question — this theme isn't on the watch list."));
    }
    return box;
  }

  // Builds the progression rail: independent observations → emerging pattern → suggested research question (reached steps highlighted).
  function renderRail(sig) {
    const reached = [true, sig.familyCount >= 2, Boolean(sig.draft)];
    const rail = el("ol", "res-rail");
    ["Independent observations", "Emerging pattern", "Suggested research question"].forEach((text, i) => {
      const li = el("li", "res-rail-step" + (reached[i] ? " is-reached" : ""));
      li.append(el("span", "res-rail-n res-mono", String(i + 1)), el("span", "res-rail-text", text));
      rail.append(li);
    });
    return rail;
  }

  // Wraps one numbered section of the detail panel with its heading.
  function section(n, title, ...children) {
    const sec = el("div", "res-sec");
    sec.append(mono(`${n} · ${title}`, "res-sec-title"), ...children);
    return sec;
  }

  // Builds the pattern section: the independent-family statement, or a quiet "not yet" for a single family.
  function renderPattern(sig) {
    const days = Math.max(1, Math.round((Date.parse(sig.lastAt) - Date.parse(sig.firstAt)) / 86400000));
    const box = el("div", "res-pattern");
    if (sig.familyCount < 2) {
      box.append(el("div", "res-note", "One family so far — not a pattern yet."));
      return box;
    }
    box.append(
      el("div", "res-pattern-line", `${plural(sig.familyCount, "independent family", "independent families")} · ${plural(sig.reportCount, "report", "reports")} · ${plural(days, "day", "days")}`),
      el("div", "res-note", `Different words, same area: ${sig.area}`),
    );
    return box;
  }

  // Builds the selected-signal detail panel: prominent hypothesis stamp, progression rail, then the three numbered steps.
  function renderDetail(sig) {
    const card = el("section", "card res-detail" + (sig.stage === "converging" ? " is-hot" : ""));
    card.id = "res-detail";
    card.setAttribute("aria-label", "Selected signal");
    const chips = el("div", "res-chips");
    chips.append(el("span", `res-chip res-chip--${sig.stage} res-mono`, STAGE_NAME[sig.stage]));
    const tr = transitionLabel(sig);
    if (tr) chips.append(el("span", "res-chip res-chip--transition res-mono", tr));
    const head = el("div");
    head.append(mono(sig.area), el("h2", "res-h2", sig.label));
    card.append(
      el("div", "res-banner res-mono", "Hypothesis, not finding · AI knowledge"),
      chips,
      head,
      renderRail(sig),
      section(1, "Independent observations", renderTimeline(sig), renderQuotes(sig)),
      section(2, "Emerging pattern", renderPattern(sig)),
      section(3, "Suggested research question", renderDraft(sig)),
    );
    return card;
  }

  // Builds one node of the "Where this goes" flow.
  function goesNode(caption, title, state) {
    const li = el("li", "res-node res-node--" + state);
    li.append(mono(caption), el("div", "res-node-title", title));
    return li;
  }

  // Builds the final "Where this goes" flow: observation → signal → question → study → evidence → three contexts. Partners appear only downstream.
  function renderGoes(sel) {
    const sec = el("section", "card res-goes");
    sec.setAttribute("aria-label", "Where this goes");
    sec.append(mono("Where this goes"));
    const hasPattern = sel.familyCount >= 2, hasQuestion = Boolean(sel.draft);
    const flow = el("ol", "res-flow");
    flow.append(
      goesNode("Observe · Remember", "Lived observation", hasPattern ? "done" : "now"),
      goesNode("Converge", "Emerging signal", hasQuestion ? "done" : hasPattern ? "now" : "next"),
      goesNode("Investigate", "Research question", hasQuestion ? "now" : "next"),
      goesNode("Study", "Registry / Natural-history study", "next"),
      goesNode("Evidence", "Evidence", "next"),
    );
    const ctx = el("div", "res-contexts");
    ctx.append(mono("Evidence can inform", "res-contexts-title"));
    const grid = el("div", "res-contexts-grid");
    for (const [when, what] of [["No treatment yet", "Understand disease"], ["Clinical trial", "Investigate what endpoints may miss"], ["Approved treatment", "Real-world research"]]) {
      const c = el("div", "res-context");
      c.append(mono(when), el("div", "res-context-what", what));
      grid.append(c);
    }
    ctx.append(grid);
    sec.append(flow, ctx, el("div", "res-note", "Research partners appear only downstream, with evidence — never with raw observations."));
    return sec;
  }

  // Selects a signal, re-renders the dashboard, and brings the detail panel into view.
  function selectSignal(category) {
    state.selected = category;
    render();
    document.getElementById("res-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // Builds the "other signals" grid (every signal except the selected one).
  function renderOthers(sel) {
    const others = state.signals.filter((s) => s !== sel);
    if (!others.length) return null;
    const sec = el("section", "res-others");
    sec.append(mono("Other signals"));
    const grid = el("div", "res-others-grid");
    for (const s of others) {
      const card = el("button", "card res-other");
      card.type = "button";
      card.append(
        el("span", `res-chip res-chip--${s.stage} res-mono`, STAGE_NAME[s.stage]),
        el("div", "res-other-title", s.label),
        el("div", "res-other-quote", `“${s.quotes[0].text}”`),
        mono(s.familyCount === 1 ? `${familyName(s.families[0].familyId)} · watching` : "Families " + s.families.map((f) => letter(f.familyId)).join(" · ")),
      );
      card.addEventListener("click", () => selectSignal(s.category));
      grid.append(card);
    }
    sec.append(grid);
    return sec;
  }

  // Builds the "What's converging" pane.
  function renderConverging() {
    const pane = el("div", "res-pane");
    const head = el("div", "res-head");
    const left = el("div");
    left.append(mono("What's converging", "res-accent"));
    const h1 = el("h1", "res-h1");
    h1.append(document.createTextNode("Different families, "), el("em", null, "different words,"), document.createTextNode(" one pattern."));
    left.append(h1);
    head.append(left, mono(`Updated ${updatedText()} · Mem0 memory`));
    pane.append(head);
    if (!state.signals.length) {
      pane.append(el("p", "res-empty", "Nothing is converging yet."));
      return pane;
    }
    const sel = selectedSignal();
    const split = el("div", "res-split");
    split.append(renderGraphCard(), renderDetail(sel));
    pane.append(renderStats(), renderPipeline(), split);
    const others = renderOthers(sel);
    if (others) pane.append(others);
    pane.append(renderGoes(sel));
    return pane;
  }

  // Returns "just now" / "N min ago" for the last successful load.
  function updatedText() {
    const mins = Math.floor((Date.now() - state.loadedAt) / 60000);
    return mins < 1 ? "just now" : plural(mins, "min", "min") + " ago";
  }

  // Builds the "Observations" pane: every observation, newest first, tagged with its theme.
  function renderObservations() {
    const pane = el("div", "res-pane");
    pane.append(mono("Observations", "res-accent"), el("h1", "res-h1 res-h1--sm", `${state.observations.length} reports, in their own words.`));
    const label = new Map();
    for (const s of state.signals) for (const q of s.quotes) label.set(q.observationId, s.label);
    const list = el("div", "res-list");
    for (const o of state.observations.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      const row = el("div", "card res-row");
      row.append(el("div", "res-row-text", `“${o.text}”`));
      const meta = el("div", "res-row-meta");
      meta.append(mono(`${familyName(o.familyId)} · ${fmtDate(o.createdAt)}`), mono(label.get(o.id) || "Not categorized yet"));
      row.append(meta);
      list.append(row);
    }
    pane.append(list);
    return pane;
  }

  // Builds the "Draft questions" pane: every drafted item with its stamp.
  function renderDrafts() {
    const pane = el("div", "res-pane");
    const drafted = state.signals.filter((s) => s.draft);
    pane.append(mono("Draft questions", "res-accent"), el("h1", "res-h1 res-h1--sm", drafted.length ? "Awaiting your review." : "No questions drafted yet."));
    for (const s of drafted) {
      const card = el("div", "card res-row res-draft-card");
      card.append(mono(s.label), el("div", "res-draft-item", `“${s.draft.item}”`), el("div", "res-note", s.draft.question), el("span", "res-stamp res-mono", "Hypothesis, not finding · AI knowledge"));
      pane.append(card);
    }
    return pane;
  }

  // Builds the left sidebar: view navigation and the community card.
  function renderSidebar() {
    const side = el("aside", "res-side");
    const nav = el("nav", "card res-nav");
    nav.setAttribute("aria-label", "Researcher sections");
    nav.append(mono("Researcher view", "res-nav-title"));
    const items = [
      ["converging", "What's converging", state.signals.filter((s) => s.familyCount >= 2).length],
      ["observations", "Observations", state.observations.length],
      ["drafts", "Draft questions", state.signals.filter((s) => s.draft).length],
      ["insights", "Community insights", null],
    ];
    for (const [key, text, n] of items) {
      const b = el("button", "res-navitem" + (state.pane === key ? " is-active" : ""));
      b.type = "button";
      if (state.pane === key) b.setAttribute("aria-current", "page");
      b.append(el("span", null, text));
      if (n != null) b.append(el("span", "res-mono res-navcount", String(n)));
      b.addEventListener("click", () => {
        if (key === "insights") return window.SignalSense.toast("COMMUNITY INSIGHTS — COMING SOON");
        state.pane = key;
        render();
      });
      nav.append(b);
    }
    const families = new Set(state.observations.map((o) => o.familyId)).size;
    const community = el("div", "card res-community");
    community.append(mono("Community"), el("div", "res-community-name", "Demo community"), el("div", "res-note", `${plural(families, "family", "families")} · anonymous IDs · demo data`));
    side.append(nav, community);
    return side;
  }

  // Redraws the whole dashboard from the current state.
  function render() {
    const layout = el("div", "res-layout");
    layout.append(renderSidebar());
    const main = el("main", "res-main");
    if (state.status === "loading") main.append(el("p", "res-empty", "LOADING…"));
    else if (state.status === "error") main.append(el("p", "res-empty", state.error));
    else {
      main.append(state.pane === "observations" ? renderObservations() : state.pane === "drafts" ? renderDrafts() : renderConverging());
      main.append(el("div", "res-footnote res-mono", "No diagnoses · no medical advice · families never see each other's identity"));
    }
    layout.append(main);
    root.replaceChildren(layout);
  }

  // Fetches signals and observations together and renders; only the newest request may render.
  async function load() {
    const mine = ++latestRequest;
    if (!state.loadedAt) { state.status = "loading"; render(); }
    try {
      const [sRes, oRes] = await Promise.all([fetch("/api/signals"), fetch("/api/observations")]);
      if (mine !== latestRequest) return;
      if (!sRes.ok) {
        state.status = "error";
        state.error = sRes.status === 503 ? "The memory service isn't connected, so there is nothing to show yet." : "Couldn't load signals just now. Try again in a moment.";
        return render();
      }
      const data = await sRes.json();
      state.signals = data.signals;
      state.observations = await oRes.json();
      state.loadedAt = Date.now();
      state.status = "ready";
      if (!state.signals.some((s) => s.category === state.selected)) state.selected = state.signals[0]?.category ?? null;
      render();
    } catch {
      if (mine !== latestRequest) return;
      state.status = "error";
      state.error = "Couldn't reach the server. Check your connection and try again.";
      render();
    }
  }

  window.SignalSense.registerView("researcher", {
    mount(r) { root = r; render(); },
    onShow() { load(); },
  });
})();
