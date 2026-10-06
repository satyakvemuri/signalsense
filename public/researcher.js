// Researcher view: shows clusters of independent family reports as hypotheses, with verbatim quotes and a drafted question.
(function () {
  let body = null; // container that holds the loading / empty / error / cards content
  let latestRequest = 0; // counter so only the newest fetch is allowed to render

  // Creates an element with an optional class name and optional text (text is always set via textContent).
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Uppercases only the first character of a string, for display only.
  function capitalise(text) {
    const s = String(text == null ? "" : text);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Turns a family id like "fam_a" into a label like "FAMILY A" (falls back to the raw id uppercased).
  function familyLabel(id) {
    const raw = String(id == null ? "" : id);
    const match = /^fam_(.+)$/i.exec(raw);
    return match ? "FAMILY " + match[1].toUpperCase() : raw.toUpperCase();
  }

  // Turns a family count into "1 FAMILY" / "3 FAMILIES".
  function familyCountLabel(count) {
    const n = Number(count) || 0;
    return n + (n === 1 ? " FAMILY" : " FAMILIES");
  }

  // Replaces the body content with a single quiet mono "LOADING…" line.
  function renderLoading() {
    body.replaceChildren(el("p", "res-loading", "LOADING…"));
  }

  // Replaces the body content with the quiet "nothing converging yet" empty state.
  function renderEmpty() {
    const wrap = el("div", "res-empty");
    wrap.append(
      el("p", "res-empty-line", "Nothing is converging yet."),
      el("p", "microlabel res-empty-label", "Reports will group here once independent families describe the same thing.")
    );
    body.replaceChildren(wrap);
  }

  // Replaces the body content with a quiet soft-ink error line (no alert).
  function renderError(text) {
    body.replaceChildren(el("p", "res-error", text));
  }

  // Picks a plain-English error line for a failed response status.
  function errorTextFor(status) {
    if (status === 503) return "The memory service isn't set up yet, so there is nothing to show here.";
    if (status === 502) return "The memory service didn't answer just now. Try this tab again in a moment.";
    return "Something went wrong loading these. Try this tab again in a moment.";
  }

  // Builds one verbatim quote block: the quote in curly quotes plus its family label (score is never shown).
  function buildQuote(quote) {
    const item = el("blockquote", "res-quote");
    item.append(
      el("p", "res-quote-text", "“" + String(quote && quote.text != null ? quote.text : "") + "”"),
      el("p", "res-quote-family", familyLabel(quote && quote.familyId))
    );
    return item;
  }

  // Builds the inset box holding the drafted question exactly as received.
  function buildQuestion(question) {
    const box = el("div", "res-question");
    box.append(
      el("p", "res-question-label", "DRAFT QUESTION"),
      el("p", "res-question-text", String(question == null ? "" : question))
    );
    return box;
  }

  // Builds one cluster card: theme headline, family count, verbatim quotes, drafted question, hypothesis stamp.
  function buildCard(cluster) {
    const card = el("article", "card res-card");
    const quotes = Array.isArray(cluster && cluster.quotes) ? cluster.quotes : [];

    const head = el("header", "res-head");
    head.append(
      el("p", "microlabel res-count", familyCountLabel(cluster && cluster.familyCount)),
      el("h2", "res-theme", capitalise(cluster && cluster.theme))
    );

    const list = el("div", "res-quotes");
    quotes.forEach((q) => list.append(buildQuote(q)));

    card.append(head, list, buildQuestion(cluster && cluster.question), el("p", "res-stamp", "HYPOTHESIS, NOT FINDING · AI KNOWLEDGE"));
    return card;
  }

  // Replaces the body content with one card per cluster, in the order given.
  function renderClusters(clusters) {
    const stack = el("div", "res-stack");
    clusters.forEach((c) => stack.append(buildCard(c)));
    body.replaceChildren(stack);
  }

  // Fetches /api/clusters and renders the result, ignoring any response that is no longer the latest request.
  async function load() {
    const myRequest = ++latestRequest;
    if (!body.firstChild || body.querySelector(".res-error, .res-empty")) renderLoading();
    try {
      const res = await fetch("/api/clusters", { headers: { Accept: "application/json" } });
      let data = null;
      try { data = await res.json(); } catch (e) { data = null; }
      if (myRequest !== latestRequest) return;
      if (!res.ok) return renderError(errorTextFor(res.status));
      const clusters = data && Array.isArray(data.clusters) ? data.clusters : [];
      if (clusters.length === 0) return renderEmpty();
      renderClusters(clusters);
    } catch (e) {
      if (myRequest !== latestRequest) return;
      renderError("Couldn't reach the server. Check your connection and try this tab again.");
    }
  }

  // Builds the static skeleton (eyebrow + content container) inside the researcher panel, once.
  function mount(root) {
    root.append(el("p", "eyebrow", "WHAT’S CONVERGING"));
    body = el("div", "res-body");
    body.setAttribute("aria-live", "polite");
    root.append(body);
  }

  // Called every time the RESEARCHER tab is selected: re-fetches so new posts show up.
  function onShow() {
    load();
  }

  window.SignalSense.registerView("researcher", { mount, onShow });
})();
