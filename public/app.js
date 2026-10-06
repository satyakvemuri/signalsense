// Shell: tab switching, shared toast, and a tiny registry so each view mounts itself without touching the others.
(function () {
  const views = {}; // name -> { root, onShow }

  // Shows a short DM Mono toast at the bottom of the screen and removes it after 2 seconds.
  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    document.getElementById("toasts").append(el);
    setTimeout(() => el.classList.add("out"), 1800);
    setTimeout(() => el.remove(), 2000);
  }

  // Registers a view: calls mount(rootElement) once now, and onShow() each time its tab is selected.
  function registerView(name, { mount, onShow }) {
    const root = document.getElementById(`view-${name}`);
    views[name] = { root, onShow };
    mount(root);
  }

  // Selects a tab: updates aria state, shows only that panel, and notifies the view.
  function selectView(name) {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.view === name)));
    for (const [n, v] of Object.entries(views)) v.root.hidden = n !== name;
    document.querySelector(".shell").classList.toggle("shell--wide", name === "researcher"); // dashboard needs the room
    views[name]?.onShow?.();
  }

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => selectView(t.dataset.view)));

  window.SignalSense = { toast, registerView, selectView };
})();
