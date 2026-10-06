// OBSERVER view: log an observation as a named observer (patient, parent, spouse or caregiver), see it echoed back, and see the converge moment when other families describe something similar.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const REQUEST_TIMEOUT_MS = 45000; // the server can wait ~20s on the memory service; leave generous headroom
  const REVEAL_MIN_COUNT = 2; // the reveal only appears when at least this many other families converge
  const GATHER_MS = 1700; // how long the "observations coming together" moment lasts before the reveal
  const MAX_GHOSTS = 4; // at most this many other-family chips are drawn in the converge moment

  // The observers one can post as: the anonymous family id sent to the server, plus who is speaking and about whom.
  const PERSONAS = [
    { id: "fam_a", label: "Maya\u2019s dad", about: "Maya" },
    { id: "fam_b", label: "Elena\u2019s husband", about: "Elena" },
    { id: "fam_c", label: "Sam\u2019s caregiver", about: "Sam" },
  ];
  let gatherTimer = null; // pending reveal timer, cleared if a new post arrives first

  // The one optional capture attachment the submit path reads; null until voice/image capture is wired up.
  let attachment = null;

  // Calls the shared toast if the shell provided it (it always should); a no-op otherwise.
  function say(text) {
    if (window.SignalSense && typeof window.SignalSense.toast === "function") window.SignalSense.toast(text);
  }

  // STUB: voice capture. Eventually returns Promise<attachment | null> where attachment is {kind: "voice", ...}. This is where wiring a recorder happens (swap this body only).
  function captureVoice() {
    say("VOICE CAPTURE — COMING THIS WEEK");
    return Promise.resolve(null);
  }

  // STUB: image capture. Eventually returns Promise<attachment | null> where attachment is {kind: "image", ...}. This is where wiring a camera/file picker happens (swap this body only).
  function captureImage() {
    say("PHOTO CAPTURE — COMING THIS WEEK");
    return Promise.resolve(null);
  }

  // Runs a capture function and stores a non-null result as the pending attachment (today the stubs resolve null, so nothing changes).
  function runCapture(captureFn) {
    Promise.resolve(captureFn())
      .then((result) => { if (result) attachment = result; })
      .catch(() => { /* a failed capture must never disturb what the person has typed */ });
  }

  // Creates a plain element with an optional class and text (text always via textContent, never innerHTML).
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // Builds a 20px outlined inline SVG icon from a list of [tag, attrs] shapes, stroked with currentColor.
  function icon(shapes) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "20");
    svg.setAttribute("height", "20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const [tag, attrs] of shapes) {
      const shape = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) shape.setAttribute(k, v);
      svg.append(shape);
    }
    return svg;
  }

  // Builds a 40x40 ghost capture button (type=button, never `disabled`, so it still receives taps) that runs the given handler.
  function captureButton(label, svg, handler) {
    const btn = el("button", "fam-capture");
    btn.type = "button";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.append(svg);
    btn.addEventListener("click", handler);
    return btn;
  }

  // Builds the microphone icon.
  function micIcon() {
    return icon([
      ["rect", { x: "9", y: "3", width: "6", height: "11", rx: "3" }],
      ["path", { d: "M5.5 11.5a6.5 6.5 0 0 0 13 0" }],
      ["path", { d: "M12 18v3" }],
    ]);
  }

  // Builds the camera icon.
  function cameraIcon() {
    return icon([
      ["path", { d: "M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.2-2h5.6L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" }],
      ["circle", { cx: "12", cy: "13", r: "3.5" }],
    ]);
  }

  // Builds the quiet echo card: the posted text reflected back in soft, small type.
  function buildEcho(text) {
    const card = el("div", "card fam-echo");
    card.append(el("div", "microlabel fam-echo-label", "What we heard"));
    card.append(el("p", "fam-echo-text", text));
    return card;
  }

  // Builds the reveal card (the visual peak): one emphasised phrase, no matched quotes listed.
  function buildReveal(count) {
    const card = el("div", "card fam-reveal");
    const p = el("p", "fam-reveal-text");
    p.append(document.createTextNode(count + " other families have described "));
    p.append(el("em", null, "something similar"));
    p.append(document.createTextNode("."));
    card.append(p);
    return card;
  }

  // Builds the brief "observations coming together" stage: abstract chips (no other family's words) glide into the poster's own chip and merge into a terracotta dot.
  function buildGather(count) {
    const stage = el("div", "fam-gather");
    stage.setAttribute("aria-hidden", "true");
    const ghosts = Math.min(count, MAX_GHOSTS);
    for (let i = 0; i < ghosts; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const reach = 96 + 44 * Math.floor(i / 2);
      const chip = el("span", "fam-chip");
      chip.style.setProperty("--fx", side * reach + "px");
      chip.style.setProperty("--fy", (i % 2 === 0 ? -14 : 14) + "px");
      chip.style.setProperty("--delay", i * 0.12 + "s");
      chip.append(el("i"), el("i"));
      stage.append(chip);
    }
    const own = el("span", "fam-chip fam-chip--own");
    own.append(el("i"), el("i"));
    stage.append(own, el("span", "fam-knot"));
    return stage;
  }

  // Decides from the server's convergence object whether the reveal should show (needs availability and enough families).
  function shouldReveal(convergence) {
    return Boolean(convergence && convergence.available === true && Number(convergence.count) >= REVEAL_MIN_COUNT);
  }

  // Sends the observation to the server (with the optional attachment) and resolves to {ok, status, body} or rejects on network/timeout.
  async function postObservation(familyId, text) {
    const payload = { familyId, text };
    if (attachment !== null) payload.attachment = attachment;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/observations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let body = null;
      try { body = await res.json(); } catch (_) { body = null; }
      return { ok: res.ok, status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  // Builds the whole OBSERVER view inside the given root element and wires up its behaviour.
  function mount(root) {
    root.textContent = "";

    const eyebrow = el("p", "eyebrow", "Log an observation");

    // Persona: who is posting right now, made explicit ("Posting as Maya's dad")
    const selectWrap = el("div", "fam-persona");
    selectWrap.append(el("span", "microlabel", "Posting as"));
    const select = el("select", "fam-select");
    select.id = "fam-family";
    select.setAttribute("aria-label", "Posting as");
    PERSONAS.forEach((p) => {
      const opt = el("option", null, p.label);
      opt.value = p.id;
      select.append(opt);
    });
    selectWrap.append(select);

    // Capture card (inside a form so Cmd/Ctrl+Enter submits)
    const form = el("form", "fam-form");
    form.noValidate = true;
    const card = el("div", "card fam-capture-card");

    const textarea = el("textarea", "fam-textarea");
    textarea.id = "fam-text";
    textarea.name = "text";
    textarea.rows = 4;
    // Personalises the prompt to the person being observed ("What did you notice about Maya?").
    function syncPersona() {
      const persona = PERSONAS.find((p) => p.id === select.value) || PERSONAS[0];
      textarea.placeholder = "What did you notice about " + persona.about + "?";
      textarea.setAttribute("aria-label", textarea.placeholder);
    }
    syncPersona();
    select.addEventListener("change", syncPersona);

    const bar = el("div", "fam-bar");
    const modes = el("div", "fam-modes");
    modes.append(
      captureButton("Voice capture", micIcon(), () => runCapture(captureVoice)),
      captureButton("Photo capture", cameraIcon(), () => runCapture(captureImage))
    );
    const submit = el("button", "fam-submit", "Log it");
    submit.type = "submit";
    bar.append(modes, submit);

    card.append(textarea, bar);
    form.append(card);

    // Quiet message line (errors / gentle nudges) and results area
    const note = el("p", "fam-note");
    note.setAttribute("role", "status");
    const results = el("div", "fam-results");
    results.setAttribute("aria-live", "polite");

    root.append(eyebrow, selectWrap, form, note, results);

    let busy = false;

    // Shows a quiet one-line message under the card (empty string clears it).
    function setNote(text) {
      note.textContent = text || "";
    }

    // Toggles the in-flight state: disables the button and swaps its label, or restores both.
    function setBusy(isBusy) {
      busy = isBusy;
      submit.disabled = isBusy;
      submit.classList.toggle("is-busy", isBusy);
      submit.textContent = isBusy ? "Listening…" : "Log it";
      form.setAttribute("aria-busy", String(isBusy));
    }

    // Replaces the results area with the echo card; on convergence, plays the gather moment and then fades in the reveal.
    function showResult(observation, convergence, fallbackText) {
      clearTimeout(gatherTimer);
      results.textContent = "";
      const heard = observation && typeof observation.text === "string" ? observation.text : fallbackText;
      results.append(buildEcho(heard));
      if (!shouldReveal(convergence)) return;
      const count = Number(convergence.count);
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        results.append(buildReveal(count));
        return;
      }
      const stage = buildGather(count);
      results.append(stage);
      gatherTimer = setTimeout(() => {
        stage.remove();
        results.append(buildReveal(count));
      }, GATHER_MS);
    }

    // Handles a form submit: validates, posts, then clears and shows the echo (and reveal) or a quiet error.
    async function onSubmit(event) {
      event.preventDefault();
      if (busy) return;
      const text = textarea.value.trim();
      if (!text) {
        setNote("Write a few words about what you noticed first.");
        textarea.focus();
        return;
      }
      setNote("");
      setBusy(true);
      try {
        const { ok, body } = await postObservation(select.value, text);
        if (ok && body && body.observation) {
          textarea.value = "";
          attachment = null;
          showResult(body.observation, body.convergence, text);
        } else {
          const msg = body && typeof body.error === "string" && body.error ? body.error : "Something went wrong. Please try again.";
          setNote(msg);
        }
      } catch (err) {
        setNote(err && err.name === "AbortError" ? "That took too long. Please try again." : "Couldn’t reach the server. Please try again.");
      } finally {
        setBusy(false);
      }
    }

    form.addEventListener("submit", onSubmit);

    // Lets Cmd/Ctrl+Enter inside the textarea submit the form.
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }

  window.SignalSense.registerView("family", { mount });
})();
