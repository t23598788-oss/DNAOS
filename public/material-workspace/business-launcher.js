/**
 * BUSINESS TOOL LAUNCHER — owner baseline 2026-10-18
 *
 * ONE entry point: the existing square button #toolsMain in the shell rail.
 *   hover  → open temporarily (not pinned)
 *   click  → open/pin, click again → close
 *
 * Data:
 *   - business-tools.json = groups 01–06, existing DNA OS routes, and real
 *     provider logo files under /brand/providers (sourced brand assets).
 *   - provider status is read ONLY from the existing Connect Registry:
 *       GET /api/admin/connectors           (real connector rows)
 *       GET /api/admin/connectors/providers (real normalized provider registry)
 *     A logo never implies a connection. No status/account/credential is invented.
 *
 * Company profile:
 *   - existing GET/PUT /api/admin/settings (company profile values)
 *   - existing POST/GET /api/admin/upload (private `attachments` bucket, admin guard)
 *   - the avatar is a button in the existing rail; no second navigation.
 *
 * No new workspace, connector, database table, AI/MCP path, or finance writer.
 */
(function () {
  const $l = (id) => document.getElementById(id);
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Existing icon shapes used by the shell + the lucide icons already used in
  // app/workspace/DNAOSChatEngine.tsx. This is a reuse map, not new artwork.
  const ICONS = {
    stock: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8"/>',
    jobs: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    partners: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    finance: '<path d="M20 12V8H6a2 2 0 0 1 0-4h12v4"/><path d="M4 6v12a2 2 0 0 0 2 2h14v-4"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
    debt: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    document: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    company: '<path d="M3 21h18M6 21V7l6-4 6 4v14M9 9h.01M15 9h.01M9 13h.01M15 13h.01M9 17h.01M15 17h.01"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
    expense: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3Z"/><circle cx="12" cy="13" r="3"/>',
  };
  const svg = (name) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.company}</svg>`;

  const STATUS_LABEL = {
    CONNECTED: "เชื่อมต่อแล้ว",
    "NOT CONNECTED": "ยังไม่เชื่อมต่อ",
    "NOT CONFIGURED": "ยังไม่ตั้งค่า",
    UNAVAILABLE: "ใช้งานไม่ได้",
  };
  const STATUS_CLASS = {
    CONNECTED: "st-connected",
    "NOT CONNECTED": "st-not-connected",
    "NOT CONFIGURED": "st-not-configured",
    UNAVAILABLE: "st-unavailable",
  };

  const state = {
    data: null,
    status: new Map(), // provider id -> { code, source }
    statusState: "loading", // loading | ok | unavailable
    open: false,
    pinned: false,
    hoverTimer: null,
    closeTimer: null,
    profileOpen: false,
    company: null,
    logoUrl: null,
  };

  function toastMsg(message) {
    if (typeof window.toast === "function") window.toast(message);
  }

  function openTool(route, label, visual) {
    if (typeof window.openToolRoute === "function") {
      window.openToolRoute(route, label, visual);
      return;
    }
    window.location.href = route;
  }

  /** แพลตฟอร์มภายนอก → เปิด Official URL ในเบราว์เซอร์ของผู้ใช้เท่านั้น (logic อยู่ใน app.js) */
  function openExternalTool(url, label, visual) {
    if (typeof window.openExternalTool === "function") {
      window.openExternalTool(url, label, visual);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // ── Connect Registry status (read-only, real sources only) ────────────────
  function normalizedProviderId(connector) {
    const declared = typeof connector?.config?.provider === "string" ? connector.config.provider.trim().toLowerCase() : "";
    if (declared) return declared;
    const slug = String(connector?.slug || connector?.name || "").toLowerCase();
    return slug.replace(/-?connector$/i, "").replace(/[^a-z0-9_]+/g, "_");
  }

  function statusFromConnector(c) {
    if (c.status === "connected") return c.enabled === false ? "NOT CONNECTED" : "CONNECTED";
    if (c.status === "error") return "UNAVAILABLE";
    return "NOT CONNECTED";
  }

  function statusFromProvider(p) {
    const s = String(p.connection_status || "").toUpperCase();
    if (s === "CONNECTED") return "CONNECTED";
    if (s === "UNAVAILABLE" || s === "OFFLINE" || s === "ERROR") return "UNAVAILABLE";
    if (s === "WAITING_FOR_CREDENTIAL" || s === "PENDING_RECONCILIATION" || s === "UNKNOWN") return "NOT CONFIGURED";
    if (s === "DISCOVERED_NOT_CONNECTED" || s === "NOT_YET_VERIFIED") return "NOT CONNECTED";
    return "NOT CONFIGURED";
  }

  function setStatus(map, id, code, source, overwrite) {
    if (!id) return;
    const key = String(id).toLowerCase();
    if (!overwrite && map.has(key)) return;
    map.set(key, { code, source });
  }

  async function loadRegistry() {
    const note = $l("launcherRegistryNote");
    try {
      const [connRes, providerRes] = await Promise.all([
        fetch("/api/admin/connectors", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/admin/connectors/providers", { credentials: "same-origin", cache: "no-store" }),
      ]);
      const map = new Map();
      let sourceCount = 0;
      let connectionRows = 0;

      if (connRes.ok) {
        const body = await connRes.json().catch(() => null);
        const connectors = Array.isArray(body?.connectors) ? body.connectors : [];
        connectionRows = connectors.length;
        for (const c of connectors) {
          const id = normalizedProviderId(c);
          const code = statusFromConnector(c);
          // A real connected+enabled row is the strongest evidence; keep it.
          const current = map.get(id);
          if (!current || code === "CONNECTED") setStatus(map, id, code, "connector", true);
        }
        sourceCount += 1;
      }
      if (providerRes.ok) {
        const body = await providerRes.json().catch(() => null);
        const providers = Array.isArray(body?.providers) ? body.providers : [];
        for (const p of providers) {
          setStatus(map, p.provider_id, statusFromProvider(p), "provider-registry", false);
        }
        sourceCount += 1;
      }

      if (sourceCount === 0) {
        state.statusState = "unavailable";
        state.status = map;
        if (note) {
          note.className = "launcher-status warn";
          note.textContent = "อ่าน Connect Registry ไม่ได้ (ต้องเข้าสู่ระบบ) — แสดง UNAVAILABLE เท่านั้น ไม่มีการสร้างสถานะเชื่อมต่อ";
        }
        return;
      }

      state.statusState = "ok";
      state.status = map;
      if (note) {
        note.className = "launcher-status";
        note.textContent =
          `สถานะจาก Connect Registry เดิม · connector ${connectionRows} รายการ · provider ${map.size} รายการ` +
          " · โลโก้ไม่ได้หมายความว่าเชื่อมต่อแล้ว";
      }
    } catch {
      state.statusState = "unavailable";
      if (note) {
        note.className = "launcher-status warn";
        note.textContent = "อ่าน Connect Registry ไม่ได้ — แสดง UNAVAILABLE เท่านั้น ไม่มีการสร้างสถานะเชื่อมต่อ";
      }
    }
  }

  function itemStatus(item) {
    if (!item.providerIds || item.providerIds.length === 0) return null;
    if (state.statusState === "unavailable") return "UNAVAILABLE";
    for (const id of item.providerIds) {
      const hit = state.status.get(String(id).toLowerCase());
      if (hit) return hit.code;
    }
    return "NOT CONFIGURED";
  }

  // ── Launcher rendering ───────────────────────────────────────────────────
  async function loadTools() {
    if (state.data) return state.data;
    const res = await fetch("business-tools.json", { cache: "no-store" });
    if (!res.ok) throw new Error("business-tools.json");
    state.data = await res.json();
    return state.data;
  }

  function renderItem(item) {
    const code = itemStatus(item);
    const badge = code
      ? `<span class="status ${STATUS_CLASS[code]}" data-status-code="${esc(code)}" title="สถานะจาก Connect Registry"><i></i>${esc(STATUS_LABEL[code])}</span>`
      : "";
    const visual = item.logo
      ? `<span class="tool-logo"><img src="${esc(item.logo)}" alt="${esc(item.label)}" loading="lazy" referrerpolicy="no-referrer"></span>`
      : `<span class="tool-icon">${svg(item.icon || "company")}</span>`;
    const attrs = [
      `class="launcher-item"`,
      `type="button"`,
      `data-tool-id="${esc(item.id)}"`,
      code ? `data-status="${esc(code)}"` : "",
      item.route ? `data-route="${esc(item.route)}"` : "",
      item.external ? `data-external="${esc(item.external)}"` : "",
      item.action ? `data-action="${esc(item.action)}"` : "",
      item.logo ? `data-logo="${esc(item.logo)}"` : "",
      item.icon ? `data-icon="${esc(item.icon)}"` : "",
      `title="${esc(item.route || item.external || item.label)}"`,
    ]
      .filter(Boolean)
      .join(" ");
    return `<button ${attrs}>${visual}<span class="tool-copy"><span class="tool-name">${esc(item.label)}</span><span class="tool-detail">${esc(item.detail || "")}</span></span>${badge}</button>`;
  }

  function renderGroups() {
    const host = $l("launcherGroups");
    if (!host) return;
    if (!state.data) {
      host.innerHTML = '<p class="bank-note">กำลังโหลดรายการเครื่องมือ…</p>';
      return;
    }
    host.innerHTML = state.data.groups
      .map(
        (group) => `<section class="launcher-group" data-group="${esc(group.id)}">
          <div class="launcher-group-head"><b>${esc(group.id)}</b><strong>${esc(group.label)}</strong><span>${esc(group.labelEn || "")}</span></div>
          <div class="launcher-grid">${group.items.map(renderItem).join("")}</div>
        </section>`,
      )
      .join("");
  }

  function positionLauncher() {
    // The panel is anchored to the existing rail button. Keep it inside the
    // viewport on narrow screens without moving the locked sidebar/header.
    const panel = $l("businessLauncher");
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    if (rect.right > window.innerWidth - 4) {
      panel.style.left = "auto";
      panel.style.right = "6px";
    } else {
      panel.style.left = "54px";
      panel.style.right = "auto";
    }
  }

  async function openLauncher(pin) {
    const panel = $l("businessLauncher");
    const button = $l("toolsMain");
    if (!panel || !button) return;
    if (!state.open) {
      state.open = true;
      panel.hidden = false;
      button.setAttribute("aria-expanded", "true");
      renderGroups();
      positionLauncher();
    }
    state.pinned = state.pinned || !!pin;
    try {
      const [data] = await Promise.all([loadTools(), state.statusState === "loading" ? loadRegistry() : null]);
      state.data = data;
      renderGroups();
      positionLauncher();
    } catch {
      const host = $l("launcherGroups");
      if (host) host.innerHTML = '<p class="bank-note">โหลดรายการเครื่องมือไม่สำเร็จ — ไม่แสดงรายการปลอม</p>';
    }
  }

  function closeLauncher() {
    const panel = $l("businessLauncher");
    const button = $l("toolsMain");
    if (!panel || !button) return;
    state.open = false;
    state.pinned = false;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function toggleLauncher() {
    if (!state.open) {
      void openLauncher(true);
      return;
    }
    if (!state.pinned) {
      state.pinned = true;
      return;
    }
    closeLauncher();
  }

  function scheduleClose() {
    if (state.pinned) return;
    clearTimeout(state.closeTimer);
    state.closeTimer = setTimeout(() => {
      if (!state.pinned && state.open) closeLauncher();
    }, 220);
  }

  function cancelClose() {
    clearTimeout(state.closeTimer);
  }

  // ── Company profile (existing settings + storage APIs) ────────────────────
  function applyCompany(settings) {
    if (!settings) return;
    state.company = settings;
    const name = $l("profileCompanyName");
    const tax = $l("profileCompanyTax");
    const fallback = $l("companyLogoFallback");
    if (name) name.textContent = settings.companyName || "ยังไม่มีข้อมูลบริษัท";
    if (tax) tax.textContent = settings.companyTaxId ? `เลขผู้เสียภาษี ${settings.companyTaxId}` : "—";
    if (fallback && !state.logoUrl) fallback.textContent = (settings.companyName || "DNA").trim().slice(0, 3).toUpperCase();
  }

  function setLogo(url) {
    state.logoUrl = url || null;
    const img = $l("companyLogo");
    const profileImg = $l("profileLogo");
    const fallback = $l("companyLogoFallback");
    if (img) {
      img.hidden = !url;
      if (url) img.src = url;
      else img.removeAttribute("src");
    }
    if (profileImg) {
      profileImg.hidden = !url;
      if (url) profileImg.src = url;
      else profileImg.removeAttribute("src");
    }
    if (fallback) fallback.hidden = !!url;
  }

  async function resolveLogo(path) {
    if (!path) return null;
    try {
      const res = await fetch(`/api/admin/upload?path=${encodeURIComponent(path)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      return typeof body?.url === "string" ? body.url : null;
    } catch {
      return null;
    }
  }

  async function loadCompany() {
    try {
      const res = await fetch("/api/admin/settings", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      const settings = body?.settings;
      if (!settings) return;
      applyCompany(settings);
      const url = await resolveLogo(settings.companyLogoPath);
      if (url) setLogo(url);
    } catch {
      // no session / no data — the avatar stays an initials placeholder
    }
  }

  async function uploadCompanyLogo(file) {
    if (!file) return;
    if (!state.company) {
      toastMsg("ต้องเข้าสู่ระบบก่อนเปลี่ยนโลโก้บริษัท");
      return;
    }
    toastMsg("กำลังอัปโหลดโลโก้บริษัท…");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("documentId", "company-profile");
      const up = await fetch("/api/admin/upload", { method: "POST", body: form, credentials: "same-origin" });
      const upBody = await up.json().catch(() => null);
      if (!up.ok || !upBody?.path) {
        toastMsg(`อัปโหลดไม่สำเร็จ: ${upBody?.error || `HTTP ${up.status}`}`);
        return;
      }
      const save = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...state.company, companyLogoPath: upBody.path }),
      });
      const saveBody = await save.json().catch(() => null);
      if (!save.ok) {
        toastMsg(`บันทึกโลโก้ไม่สำเร็จ: ${saveBody?.error || `HTTP ${save.status}`}`);
        return;
      }
      const url = await resolveLogo(upBody.path);
      if (url) setLogo(url);
      state.company.companyLogoPath = upBody.path;
      toastMsg("บันทึกโลโก้บริษัทแล้ว");
    } catch {
      toastMsg("เปลี่ยนโลโก้ไม่สำเร็จ — ลองใหม่อีกครั้ง");
    }
  }

  function toggleProfile() {
    const menu = $l("profileMenu");
    const button = $l("companyProfile");
    if (!menu || !button) return;
    state.profileOpen = !state.profileOpen;
    menu.hidden = !state.profileOpen;
    button.setAttribute("aria-expanded", state.profileOpen ? "true" : "false");
    if (state.profileOpen) {
      const rect = menu.getBoundingClientRect();
      if (rect.left < 4) menu.style.left = "6px";
    }
  }

  function closeProfile() {
    const menu = $l("profileMenu");
    const button = $l("companyProfile");
    if (menu) menu.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
    state.profileOpen = false;
  }

  // ── Wiring ───────────────────────────────────────────────────────────────
  function wire() {
    const button = $l("toolsMain");
    const panel = $l("businessLauncher");
    const profile = $l("companyProfile");
    const profileMenu = $l("profileMenu");
    const fileInput = $l("profileLogoInput");

    if (button) {
      button.addEventListener("pointerenter", () => {
        clearTimeout(state.hoverTimer);
        state.hoverTimer = setTimeout(() => {
          if (!state.open) void openLauncher(false);
          else cancelClose();
        }, 120);
      });
      button.addEventListener("pointerleave", () => {
        clearTimeout(state.hoverTimer);
        scheduleClose();
      });
    }

    if (panel) {
      panel.addEventListener("pointerenter", cancelClose);
      panel.addEventListener("pointerleave", scheduleClose);
      panel.addEventListener("click", (event) => {
        const close = event.target.closest("#closeLauncher");
        if (close) {
          closeLauncher();
          return;
        }
        const item = event.target.closest("[data-tool-id]");
        if (!item) return;
        const action = item.getAttribute("data-action");
        const route = item.getAttribute("data-route");
        const external = item.getAttribute("data-external");
        if (action === "pick-company-logo") {
          closeLauncher();
          void loadCompany();
          if (!state.profileOpen) toggleProfile();
          fileInput?.click();
          return;
        }
        const label = item.querySelector(".tool-name")?.textContent || "เครื่องมือ";
        const visual = {
          logo: item.getAttribute("data-logo") || undefined,
          icon: item.getAttribute("data-icon") || undefined,
        };
        if (external) {
          openExternalTool(external, label, visual);
          closeLauncher();
          return;
        }
        if (route) {
          openTool(route, label, visual);
          closeLauncher();
        }
      });
    }

    if (profile) {
      profile.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleProfile();
        if (state.profileOpen && !state.company) void loadCompany();
      });
    }

    if (profileMenu) {
      profileMenu.addEventListener("click", (event) => {
        const routeButton = event.target.closest("[data-profile-route]");
        if (routeButton) {
          event.preventDefault();
          const route = routeButton.getAttribute("data-profile-route");
          closeProfile();
          if (route) openTool(route, routeButton.textContent?.trim() || "โปรไฟล์บริษัท", { icon: "company" });
          return;
        }
        if (event.target.closest("#profileLogoPick")) {
          fileInput?.click();
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        fileInput.value = "";
        if (file) void uploadCompanyLogo(file);
      });
    }

    document.addEventListener("click", (event) => {
      if (state.profileOpen && !event.target.closest("#profileMenu") && !event.target.closest("#companyProfile")) {
        closeProfile();
      }
      // TAB BAR ENTRY (owner 2026-10-18): ปุ่ม ＋ และเมนู ⋯ บน Tab Bar เปิด launcher เดียวกัน
      // ⇒ ต้องไม่ถูกมองว่าเป็น "คลิกนอก" แล้วปิดทันทีที่เพิ่งเปิด (ไม่มี launcher/menu ชุดใหม่)
      const opensLauncher = event.target.closest("#toolsMain, #newTab, #tabMenuNew");
      if (state.open && state.pinned && !event.target.closest("#businessLauncher") && !opensLauncher) {
        closeLauncher();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (state.profileOpen) closeProfile();
        if (state.open) closeLauncher();
      }
    });

    window.addEventListener("resize", () => {
      if (state.open) positionLauncher();
    });
  }

  window.toggleBusinessLauncher = toggleLauncher;
  window.openBusinessLauncher = () => openLauncher(true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      wire();
      void loadCompany();
      void loadRegistry().then(renderGroups);
    });
  } else {
    wire();
    void loadCompany();
    void loadRegistry().then(renderGroups);
  }
})();
