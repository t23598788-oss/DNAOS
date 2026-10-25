/**
 * WORKSPACE APPEARANCE STANDARD — shell wiring (owner lock 2026-10-18)
 *
 * ONE settings point: the existing #settings gear. Appearance only.
 *   · 5 standard themes + custom
 *   · one tone, transparency, blur, font size, icon size, corner radius
 *   · Auto follows prefers-color-scheme through the existing browser API
 *   · the same tokens are pushed to the existing QAI Composer and to same-origin
 *     tool pages opened in #toolFrame (no per-component theme edits)
 *   · no profile editor, no organization editor, no connection manager
 *
 * Shortcuts stay in the separate (+) manager and still open through the existing
 * openToolRoute/openExternalTool → Tab Bar. No new navigation, no fake tools.
 */
(function () {
  const $l = (id) => document.getElementById(id);

  const ICONS = {
    apps: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    chat: '<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 10h9M7 14h6"/>',
    stock: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8"/>',
    finance: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    jobs: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    partners: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    debt: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
    company: '<path d="M3 21h18M6 21V7l6-4 6 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01"/>',
    expense: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    map: '<path d="m9 4-6 3v13l6-3 6 3 6-3V4l-6 3-6-3Z"/><path d="M9 4v13M15 7v13"/>',
  };

  const ICON_LABEL = {
    apps: "แอป / เครื่องมือ",
    chat: "แชท",
    stock: "ทรัพยากร",
    finance: "การเงิน",
    document: "เอกสาร",
    jobs: "งาน",
    partners: "คู่ค้า",
    debt: "ลูกหนี้",
    gear: "ตั้งค่า",
    company: "บริษัท",
    expense: "ค่าใช้จ่าย",
    camera: "กล้อง",
    globe: "เว็บไซต์",
    map: "แผนที่",
  };

  const svg = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.globe}</svg>`;

  const state = {
    data: null,
    toolOptions: [],
    serviceOptions: [],
    loadedSources: false,
  };

  function prefs() {
    return window.WorkspaceCustomization?.get() || { theme: {}, shortcuts: [] };
  }

  function toastMsg(message) {
    if (typeof window.toast === "function") window.toast(message);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function visualFor(shortcut) {
    return shortcut.logo
      ? `<img src="${escapeHtml(shortcut.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
      : svg(shortcut.icon || "globe");
  }

  function openShortcut(shortcut) {
    if (!shortcut) return;
    const visual = { icon: shortcut.icon || "globe", logo: shortcut.logo };
    if (shortcut.kind === "route") {
      if (typeof window.openToolRoute === "function") window.openToolRoute(shortcut.value, shortcut.label, visual);
    } else if (typeof window.openExternalTool === "function") {
      void window.openExternalTool(shortcut.value, shortcut.label, visual);
    }
  }

  // ── Shortcut rail ─────────────────────────────────────────────────────────
  function renderRail() {
    const rail = $l("shortcutRail");
    if (!rail) return;
    const shortcuts = prefs().shortcuts || [];
    rail.innerHTML = shortcuts
      .map(
        (shortcut) =>
          `<button type="button" class="shortcut" data-shortcut-id="${escapeHtml(shortcut.id)}" title="${escapeHtml(
            shortcut.label,
          )}" aria-label="เปิดทางลัด ${escapeHtml(shortcut.label)}">${visualFor(shortcut)}</button>`,
      )
      .join("");
  }

  function wireRail() {
    const rail = $l("shortcutRail");
    if (!rail) return;
    rail.addEventListener("click", (event) => {
      const button = event.target.closest("[data-shortcut-id]");
      if (!button) return;
      const shortcut = (prefs().shortcuts || []).find((s) => s.id === button.dataset.shortcutId);
      openShortcut(shortcut);
    });
  }

  // ── Data sources (existing tools only) ────────────────────────────────────
  async function loadSources() {
    if (state.loadedSources) return;
    state.loadedSources = true;
    // BUSINESS ONLY (owner 2026-10-20): ไม่โหลด tools.json / รายการเครื่องมือผู้พัฒนาในผิวธุรกิจ
    const business = await fetch("business-tools.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    state.data = business;

    const routeMap = new Map();
    for (const group of business?.groups || []) {
      for (const item of group.items || []) {
        if (item.route && item.route.startsWith("/") && !routeMap.has(item.route)) {
          routeMap.set(item.route, {
            label: item.label,
            route: item.route,
            icon: item.icon || "apps",
            group: group.label,
          });
        }
      }
    }
    state.toolOptions = [...routeMap.values()].sort((a, b) => a.label.localeCompare(b.label, "th"));

    const services = [];
    for (const group of business?.groups || []) {
      for (const item of group.items || []) {
        if (item.external && item.logo) {
          services.push({ label: item.label, value: item.external, logo: item.logo, group: group.label });
        }
      }
    }
    state.serviceOptions = services;

    const routeSelect = $l("shortcutRoute");
    if (routeSelect) {
      routeSelect.innerHTML = state.toolOptions
        .map((option) => `<option value="${escapeHtml(option.route)}" data-label="${escapeHtml(option.label)}">${escapeHtml(option.label)} — ${escapeHtml(option.group)}</option>`)
        .join("");
    }
    const serviceSelect = $l("shortcutService");
    if (serviceSelect) {
      serviceSelect.innerHTML = state.serviceOptions
        .map((option) => `<option value="${escapeHtml(option.value)}" data-label="${escapeHtml(option.label)}" data-logo="${escapeHtml(option.logo)}">${escapeHtml(option.label)} — ${escapeHtml(option.group)}</option>`)
        .join("");
    }
    const iconSelect = $l("shortcutIcon");
    if (iconSelect) {
      iconSelect.innerHTML = Object.keys(ICONS)
        .map((name) => `<option value="${name}">${escapeHtml(ICON_LABEL[name] || name)}</option>`)
        .join("");
    }
  }

  // ── Shortcut manager ──────────────────────────────────────────────────────
  function renderShortcutList() {
    const host = $l("shortcutList");
    if (!host) return;
    const shortcuts = prefs().shortcuts || [];
    if (shortcuts.length === 0) {
      host.innerHTML = '<p class="ws-shortcut-empty">ยังไม่มีทางลัด — เพิ่มจากเครื่องมือหรือเว็บไซต์ด้านล่าง</p>';
      return;
    }
    host.innerHTML = shortcuts
      .map(
        (shortcut) =>
          `<div class="ws-shortcut-row" data-row-shortcut="${escapeHtml(shortcut.id)}">
            <span class="shortcut-visual">${visualFor(shortcut)}</span>
            <span class="shortcut-copy"><strong>${escapeHtml(shortcut.label)}</strong><small>${escapeHtml(shortcut.value)}</small></span>
            ${
              shortcut.provider
                ? '<span class="ws-note" style="margin:0">โลโก้ผู้ให้บริการ</span>'
                : `<select data-shortcut-icon="${escapeHtml(shortcut.id)}" aria-label="ไอคอนของ ${escapeHtml(shortcut.label)}">${Object.keys(ICONS)
                    .map((name) => `<option value="${name}" ${shortcut.icon === name ? "selected" : ""}>${escapeHtml(ICON_LABEL[name] || name)}</option>`)
                    .join("")}</select>`
            }
            <button type="button" class="shortcut-remove" data-shortcut-remove="${escapeHtml(shortcut.id)}" aria-label="ลบทางลัด ${escapeHtml(shortcut.label)}" title="ลบทางลัด">×</button>
          </div>`,
      )
      .join("");
  }

  function syncShortcutKindFields() {
    const kind = $l("shortcutKind")?.value || "route";
    const routeField = $l("shortcutRouteField");
    const serviceField = $l("shortcutServiceField");
    const externalFields = $l("shortcutExternalFields");
    const iconField = $l("shortcutIconField");
    const providerNote = $l("shortcutProviderNote");
    if (routeField) routeField.hidden = kind !== "route";
    if (serviceField) serviceField.hidden = kind !== "service";
    if (externalFields) externalFields.hidden = kind !== "external";
    if (iconField) iconField.hidden = kind === "service";
    if (providerNote) providerNote.hidden = kind !== "service";
  }

  function addShortcut() {
    const kind = $l("shortcutKind")?.value || "route";
    let label = "";
    let value = "";
    let icon = $l("shortcutIcon")?.value || "globe";
    let logo = "";
    let provider = false;

    if (kind === "route") {
      const select = $l("shortcutRoute");
      const option = select?.selectedOptions?.[0];
      value = select?.value || "";
      label = option?.dataset.label || option?.textContent || value;
      icon = $l("shortcutIcon")?.value || "apps";
    } else if (kind === "service") {
      const select = $l("shortcutService");
      const option = select?.selectedOptions?.[0];
      value = select?.value || "";
      label = option?.dataset.label || value;
      logo = option?.dataset.logo || "";
      provider = true;
      icon = "globe";
    } else {
      value = String($l("shortcutUrl")?.value || "").trim();
      label = String($l("shortcutLabel")?.value || "").trim() || value;
      icon = $l("shortcutIcon")?.value || "globe";
      if (!/^https?:\/\//i.test(value)) {
        toastMsg("URL ต้องเริ่มต้นด้วย http:// หรือ https://");
        return;
      }
    }

    if (!value) {
      toastMsg("เลือกเครื่องมือ/บริการ หรือกรอก URL ก่อนเพิ่มทางลัด");
      return;
    }

    const shortcuts = prefs().shortcuts || [];
    if (shortcuts.some((shortcut) => shortcut.value === value)) {
      toastMsg("ทางลัดนี้มีอยู่แล้ว");
      return;
    }
    if (shortcuts.length >= 20) {
      toastMsg("เพิ่มทางลัดได้สูงสุด 20 รายการ");
      return;
    }

    const id = `s-${Date.now().toString(36)}`;
    const storedKind = kind === "route" ? "route" : "external";
    const next = [...shortcuts, { id, label: label.slice(0, 60), kind: storedKind, value, icon, ...(logo ? { logo } : {}), ...(provider ? { provider: true } : {}) }];
    window.WorkspaceCustomization?.setShortcuts(next);
    renderShortcutList();
    if ($l("shortcutUrl")) $l("shortcutUrl").value = "";
    if ($l("shortcutLabel")) $l("shortcutLabel").value = "";
    toastMsg("เพิ่มทางลัดแล้ว — เปิดได้จากไอคอนในแถบซ้าย");
  }

  function wireShortcutManager() {
    const add = $l("shortcutAdd");
    const dialog = $l("shortcutDialog");
    if (!add || !dialog) return;

    add.addEventListener("click", async () => {
      await loadSources();
      syncShortcutKindFields();
      renderShortcutList();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      add.setAttribute("aria-expanded", "true");
      $l("shortcutKind")?.focus();
    });

    $l("shortcutClose")?.addEventListener("click", () => {
      dialog.close();
      add.setAttribute("aria-expanded", "false");
    });
    dialog.addEventListener("close", () => add.setAttribute("aria-expanded", "false"));
    $l("shortcutKind")?.addEventListener("change", syncShortcutKindFields);

    $l("shortcutForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      addShortcut();
    });

    $l("shortcutList")?.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-shortcut-remove]");
      if (!remove) return;
      const next = (prefs().shortcuts || []).filter((shortcut) => shortcut.id !== remove.dataset.shortcutRemove);
      window.WorkspaceCustomization?.setShortcuts(next);
      renderShortcutList();
    });

    $l("shortcutList")?.addEventListener("change", (event) => {
      const select = event.target.closest("[data-shortcut-icon]");
      if (!select) return;
      const id = select.dataset.shortcutIcon;
      const next = (prefs().shortcuts || []).map((shortcut) => (shortcut.id === id ? { ...shortcut, icon: select.value } : shortcut));
      window.WorkspaceCustomization?.setShortcuts(next);
      renderShortcutList();
    });

    $l("shortcutIconSize")?.addEventListener("input", () => {
      const value = Number($l("shortcutIconSize").value);
      window.WorkspaceCustomization?.updateTheme({ iconSize: value });
    });
  }

  // ── Appearance panel (six controls only) ─────────────────────────────────
  const sliders = ["opacity", "blur", "fontSize", "iconSize", "radius"];

  function outputFor(key, value) {
    if (key === "opacity") return `${value}%`;
    if (key === "blur") return `${value}px`;
    if (key === "fontSize") return `${value}px`;
    if (key === "iconSize") return `${value}px`;
    return `${value}px`;
  }

  function syncAppearanceControls() {
    const api = window.WorkspaceCustomization;
    if (!api) return;
    const actual = api.get().theme;
    const shown = api.getResolved();
    const tone = $l("wsTone");
    if (tone) tone.value = shown.tone;
    for (const key of sliders) {
      const el = $l(`ws${key[0].toUpperCase()}${key.slice(1)}`);
      const out = $l(`ws${key[0].toUpperCase()}${key.slice(1)}Value`);
      if (el) el.value = shown[key];
      if (out) out.textContent = outputFor(key, shown[key]);
    }
    document.querySelectorAll("#workspaceSettings [data-ws-preset]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.wsPreset === actual.preset));
    });
    const autoNote = $l("wsAutoNote");
    if (autoNote) {
      autoNote.hidden = actual.preset !== "auto";
      autoNote.textContent = `อัตโนมัติ: ระบบขณะนี้เป็น ${api.systemMode() === "dark" ? "มืด" : "สว่าง"} → ใช้ ${
        api.systemMode() === "dark" ? "Dark Glass" : "Light Glass"
      } ตาม Appearance ของ OS`;
    }
    const size = $l("shortcutIconSize");
    const sizeOut = $l("shortcutIconSizeValue");
    if (size) size.value = shown.iconSize;
    if (sizeOut) sizeOut.textContent = `${shown.iconSize}px`;
  }

  // ── Same-origin tool pages: apply the same tokens once, centrally ────────
  function applyToToolFrame() {
    const frame = $l("toolFrame");
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (doc?.documentElement) window.WorkspaceCustomization?.applyToDocument(doc);
    } catch {
      /* cross-origin embedded site — leave it untouched (no fake restyle) */
    }
  }

  function wireAppearance() {
    const gear = $l("settings");
    const panel = $l("workspaceSettings");
    if (!gear || !panel) return;

    const setOpen = (open) => {
      panel.hidden = !open;
      gear.setAttribute("aria-expanded", String(open));
      if (open) {
        syncAppearanceControls();
        toastMsg("เปิดตั้งค่าหน้าตา Workspace — การเชื่อมต่อใช้ Connections & Credentials เดิม");
      }
    };

    gear.onclick = () => setOpen(panel.hidden);
    $l("wsSettingsClose")?.addEventListener("click", () => setOpen(false));

    $l("wsTone")?.addEventListener("input", (event) => window.WorkspaceCustomization?.updateTheme({ tone: event.target.value }));
    for (const key of sliders) {
      const el = $l(`ws${key[0].toUpperCase()}${key.slice(1)}`);
      el?.addEventListener("input", () => window.WorkspaceCustomization?.updateTheme({ [key]: Number(el.value) }));
    }

    document.querySelectorAll("#workspaceSettings [data-ws-preset]").forEach((button) => {
      button.addEventListener("click", () => window.WorkspaceCustomization?.setPreset(button.dataset.wsPreset));
    });
    $l("wsReset")?.addEventListener("click", () => {
      window.WorkspaceCustomization?.resetTheme();
      toastMsg("คืนค่าเริ่มต้นหน้าตา Workspace แล้ว");
    });

    document.addEventListener("click", (event) => {
      if (panel.hidden) return;
      if (event.target.closest("#workspaceSettings, #settings")) return;
      setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) setOpen(false);
    });
  }

  // ── Wiring / lifecycle ────────────────────────────────────────────────────
  function wire() {
    wireAppearance();
    wireShortcutManager();
    wireRail();
    void loadSources().then(() => {
      syncShortcutKindFields();
      renderShortcutList();
    });
    syncAppearanceControls();
    renderRail();
    renderShortcutList();
    applyToToolFrame();

    $l("chatFrame")?.addEventListener("load", () => window.WorkspaceCustomization?.broadcastToChat());
    $l("toolFrame")?.addEventListener("load", applyToToolFrame);
    window.addEventListener("dna-workspace-theme", applyToToolFrame);
  }

  const customization = window.WorkspaceCustomization;
  if (customization) {
    customization.subscribe(() => {
      syncAppearanceControls();
      renderRail();
      renderShortcutList();
      applyToToolFrame();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
})();
