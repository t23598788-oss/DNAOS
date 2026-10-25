/**
 * DNA OS — WORKSPACE APPEARANCE STANDARD (owner lock 2026-10-18)
 *
 * ONE central token set for: Workspace, Sidebar, Tab Bar, QAI Composer, menus,
 * tables, forms, and same-origin tool pages opened inside #toolFrame.
 *
 * Five standard themes + custom:
 *   clear  — Clear Glass (default)
 *   light  — Light Glass
 *   dark   — Dark Glass
 *   tinted — Tinted Glass (soft colored surface)
 *   auto   — follows the OS via prefers-color-scheme (Light Glass / Dark Glass)
 *   custom — the user's own tone with the same central surfaces
 *
 * Only six custom controls remain: tone, transparency, blur, font size,
 * icon size, corner radius. Sidebar / Tab Bar / Composer colors are derived
 * from the single tone, never set separately.
 *
 * Persistence uses the existing settings store through
 * GET/PUT /api/workspace/ui-preferences (app_configs key per user id).
 * No new table, no new writer, no new database.
 */
(function () {
  const STORAGE_KEY = "dnaos.workspace.ui.v1";
  const SYSTEM_DARK = "(prefers-color-scheme: dark)";

  const PRESETS = {
    clear: { tone: "#e6e0d6", mode: "light", opacity: 78, blur: 8, radius: 14, fontSize: 14, iconSize: 20 },
    light: { tone: "#c9b08c", mode: "light", opacity: 74, blur: 12, radius: 16, fontSize: 14, iconSize: 20 },
    dark: { tone: "#5a5045", mode: "dark", opacity: 82, blur: 16, radius: 18, fontSize: 14, iconSize: 20 },
    tinted: { tone: "#9fb8aa", mode: "light", opacity: 76, blur: 12, radius: 16, fontSize: 14, iconSize: 20 },
    auto: { tone: "#e6e0d6", mode: "auto", opacity: 78, blur: 10, radius: 14, fontSize: 14, iconSize: 20 },
  };

  const PRESET_NAMES = ["clear", "light", "dark", "tinted", "auto", "custom"];
  const ICON_NAMES = [
    "apps",
    "chat",
    "stock",
    "finance",
    "document",
    "jobs",
    "partners",
    "debt",
    "gear",
    "company",
    "expense",
    "camera",
    "globe",
    "map",
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultTheme() {
    return { preset: "clear", ...clone(PRESETS.clear) };
  }

  function defaultPrefs() {
    return { theme: defaultTheme(), shortcuts: [] };
  }

  function hexToRgb(hex) {
    const value = /^#[0-9a-f]{6}$/i.test(String(hex || "")) ? hex.slice(1) : "e6e0d6";
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function rgbToHex({ r, g, b }) {
    return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
  }

  /** ratio = portion of `to` (0..1) */
  function mix(from, to, ratio) {
    const a = hexToRgb(from);
    const b = hexToRgb(to);
    return rgbToHex({
      r: a.r + (b.r - a.r) * ratio,
      g: a.g + (b.g - a.g) * ratio,
      b: a.b + (b.b - a.b) * ratio,
    });
  }

  function rgba(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
  }

  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lin = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function systemMode() {
    try {
      return window.matchMedia(SYSTEM_DARK).matches ? "dark" : "light";
    } catch {
      return "light";
    }
  }

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  }

  function normalizeTheme(input) {
    const raw = input && typeof input === "object" ? input : {};
    const named = PRESETS[raw.preset] ? raw.preset : null;
    const base = named ? PRESETS[named] : PRESETS.clear;
    const legacyTone = /^#[0-9a-f]{6}$/i.test(String(raw.tone || ""))
      ? String(raw.tone).toLowerCase()
      : base.tone;
    let mode = ["light", "dark", "auto"].includes(raw.mode) ? raw.mode : null;
    if (!mode) {
      if (raw.preset === "dark") mode = "dark";
      else if (raw.preset === "auto") mode = "auto";
      else if (raw.preset === "custom") mode = luminance(legacyTone) < 0.36 ? "dark" : "light";
      else mode = "light";
    }
    const preset = PRESET_NAMES.includes(raw.preset) ? raw.preset : "clear";
    return {
      preset,
      mode,
      tone: legacyTone,
      opacity: clamp(raw.opacity, 30, 100, base.opacity),
      blur: clamp(raw.blur, 0, 24, base.blur),
      radius: clamp(raw.radius, 0, 28, base.radius),
      fontSize: clamp(raw.fontSize, 14, 18, base.fontSize),
      iconSize: clamp(raw.iconSize, 14, 28, base.iconSize),
    };
  }

  function normalizeShortcuts(input) {
    if (!Array.isArray(input)) return [];
    const out = [];
    const seen = new Set();
    for (const entry of input) {
      if (!entry || typeof entry !== "object") continue;
      const id = String(entry.id || "");
      if (!/^[a-z0-9-]+$/i.test(id) || seen.has(id)) continue;
      const kind = entry.kind === "external" ? "external" : entry.kind === "route" ? "route" : null;
      if (!kind) continue;
      const value = String(entry.value || "").trim();
      if (!value) continue;
      if (kind === "route" && (!value.startsWith("/") || value.startsWith("//"))) continue;
      if (kind === "external" && !/^https?:\/\//i.test(value)) continue;
      const provider = entry.provider === true;
      const logo = provider && String(entry.logo || "").startsWith("/brand/providers/") ? String(entry.logo) : undefined;
      const icon = ICON_NAMES.includes(entry.icon) ? entry.icon : "globe";
      const label = String(entry.label || value).slice(0, 60);
      out.push({ id, label, kind, value, icon, ...(logo ? { logo } : {}), ...(provider ? { provider: true } : {}) });
      seen.add(id);
      if (out.length >= 20) break;
    }
    return out;
  }

  function normalizePrefs(input) {
    const raw = input && typeof input === "object" ? input : {};
    return {
      theme: normalizeTheme(raw.theme),
      shortcuts: normalizeShortcuts(raw.shortcuts),
    };
  }

  function loadLocal(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? normalizePrefs(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  function saveLocal(prefs, key) {
    try {
      localStorage.setItem(key, JSON.stringify(prefs));
      if (key !== STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage disabled — in-memory state still works this session */
    }
  }

  function effectiveMode(theme) {
    if (theme.mode === "auto") return systemMode();
    return theme.mode === "dark" ? "dark" : "light";
  }

  /** Auto resolves to the standard Light Glass / Dark Glass values. */
  function resolvedTheme(theme) {
    if (theme.preset === "auto") {
      const standard = PRESETS[systemMode() === "dark" ? "dark" : "light"];
      return { preset: "auto", mode: "auto", ...standard };
    }
    return theme;
  }

  function paletteFor(tone, mode) {
    if (mode === "dark") {
      return {
        bg: mix(tone, "#12100e", 0.82),
        surface: mix(tone, "#1b1815", 0.76),
        surface2: mix(tone, "#24201c", 0.70),
        surface3: mix(tone, "#2b2723", 0.66),
        sidebar: mix(tone, "#141210", 0.80),
        tabbar: mix(tone, "#24201c", 0.74),
        ink: "#f2ede6",
        ink2: "#ded7cd",
        muted: "#b9b0a5",
        muted2: "#948b81",
        border: mix(tone, "#3a352e", 0.55),
        borderStrong: mix(tone, "#4a443c", 0.48),
        button: "#4a443c",
        buttonHover: "#5a5045",
        onButton: "#ffffff",
      };
    }
    return {
      bg: mix(tone, "#ffffff", 0.88),
      surface: mix(tone, "#ffffff", 0.94),
      surface2: mix(tone, "#ffffff", 0.84),
      surface3: mix(tone, "#ffffff", 0.78),
      sidebar: mix(tone, "#ffffff", 0.90),
      tabbar: mix(tone, "#ffffff", 0.86),
      ink: "#26231f",
      ink2: "#3c3833",
      muted: "#625e58",
      muted2: "#8a8178",
      border: mix(tone, "#ffffff", 0.70),
      borderStrong: mix(tone, "#ffffff", 0.58),
      button: "#2d2a26",
      buttonHover: "#3f3a34",
      onButton: "#ffffff",
    };
  }

  function fontScaleOf(fontSize) {
    return Math.max(0.88, Math.min(1.45, fontSize / 14));
  }

  /**
   * One token object feeds the shell, the embedded QAI Composer, and same-origin
   * tool pages. Tailwind's own variables are remapped here so existing components
   * follow the theme without being edited one by one.
   */
  function themeVars(theme) {
    const resolved = resolvedTheme(theme);
    const mode = effectiveMode(theme);
    const palette = paletteFor(resolved.tone, mode);
    const alpha = resolved.opacity / 100;
    const hoverAlpha = Math.min(1, alpha + 0.12);
    const focusAlpha = Math.min(1, alpha + 0.2);
    const borderAlpha = mode === "dark" ? 0.22 : 0.14;
    const scale = fontScaleOf(resolved.fontSize);
    const radius = resolved.radius;
    const lineHeight = (rem) => `${(rem * scale).toFixed(3)}rem`;
    const r = (offset) => `${Math.max(0, radius + offset)}px`;

    return {
      // ── shell ────────────────────────────────────────────────────────────
      // Legacy shell variables still read by existing CSS are mapped to the same
      // palette, so no component needs a second per-component theme value.
      "--ink": palette.ink,
      "--muted": palette.muted,
      "--paper": palette.surface,
      "--chrome": palette.sidebar,
      "--ws-bg": palette.bg,
      "--ws-sidebar-bg": rgba(palette.sidebar, alpha),
      "--ws-tabbar-bg": rgba(palette.tabbar, alpha),
      "--ws-sidebar": palette.sidebar,
      "--ws-tabbar": palette.tabbar,
      "--ws-ink": palette.ink,
      "--ws-muted": palette.muted,
      "--ws-line": rgba(palette.ink, mode === "dark" ? 0.14 : 0.10),
      "--ws-border": rgba(palette.ink, borderAlpha),
      "--ws-soft": palette.surface2,
      "--ws-soft-strong": palette.surface3,
      "--ws-panel-bg": palette.surface,
      "--ws-panel-border": palette.border,
      "--ws-input-bg": palette.surface,
      "--ws-input-border": palette.borderStrong,
      "--ws-tab-bg": mode === "dark" ? "rgba(255, 255, 255, 0.06)" : "rgba(41, 39, 36, 0.07)",
      "--ws-tab-hover": mode === "dark" ? "rgba(255, 255, 255, 0.11)" : "rgba(41, 39, 36, 0.11)",
      "--ws-tab-active": palette.surface,
      "--ws-radius": `${radius}px`,
      "--ws-icon-size": `${resolved.iconSize}px`,
      "--ws-font-size": `${resolved.fontSize}px`,
      "--ws-blur": `${resolved.blur}px`,

      // ── QAI Composer (same component, same tokens) ───────────────────────
      "--qai-bg": palette.bg,
      "--qai-ink": palette.ink,
      "--qai-muted": palette.muted,
      "--qai-line": palette.border,
      "--qai-soft": palette.surface2,
      "--qai-compose-bg": rgba(palette.surface, alpha),
      "--qai-compose-hover": rgba(palette.surface, hoverAlpha),
      "--qai-compose-focus": rgba(palette.surface, focusAlpha),
      "--qai-compose-border": rgba(palette.ink, mode === "dark" ? 0.24 : 0.16),
      "--qai-compose-border-strong": rgba(palette.ink, mode === "dark" ? 0.4 : 0.32),
      "--qai-blur": `${resolved.blur}px`,
      "--qai-radius": `${radius}px`,
      "--qai-font-size": `${resolved.fontSize + 1}px`,

      // ── central admin/tool token bridge ──────────────────────────────────
      "--dna-bg": palette.bg,
      "--dna-surface": palette.surface,
      "--dna-surface-2": palette.surface2,
      "--dna-surface-3": palette.surface3,
      "--dna-ink": palette.ink,
      "--dna-ink-2": palette.ink2,
      "--dna-muted": palette.muted,
      "--dna-muted-2": palette.muted2,
      "--dna-border": palette.border,
      "--dna-border-strong": palette.borderStrong,
      "--dna-button": palette.button,
      "--dna-button-hover": palette.buttonHover,
      "--dna-on-button": palette.onButton,
      "--dna-radius": `${radius}px`,
      "--dna-font": "'Sarabun', Tahoma, system-ui, sans-serif",
      "--dna-font-scale": `${scale.toFixed(3)}`,

      // Tailwind v4 token remap — every existing utility follows the theme.
      "--font-geist-sans": "'Sarabun', Tahoma, system-ui, sans-serif",
      "--font-sans": "'Sarabun', Tahoma, system-ui, sans-serif",
      "--text-xs": `${(0.75 * scale).toFixed(3)}rem`,
      "--text-sm": `${(0.875 * scale).toFixed(3)}rem`,
      "--text-base": `${(1 * scale).toFixed(3)}rem`,
      "--text-lg": `${(1.125 * scale).toFixed(3)}rem`,
      "--text-xl": `${(1.25 * scale).toFixed(3)}rem`,
      "--text-2xl": `${(1.5 * scale).toFixed(3)}rem`,
      "--text-xs--line-height": lineHeight(1),
      "--text-sm--line-height": lineHeight(1.25),
      "--text-base--line-height": lineHeight(1.5),
      "--text-lg--line-height": lineHeight(1.75),
      "--text-xl--line-height": lineHeight(1.75),
      "--text-2xl--line-height": lineHeight(2),
      "--radius-sm": r(-8),
      "--radius-md": r(-6),
      "--radius-lg": r(0),
      "--radius-xl": r(4),
      "--radius-2xl": r(8),
      "--radius-3xl": r(14),
    };
  }

  const state = {
    prefs: loadLocal(STORAGE_KEY) || defaultPrefs(),
    userId: null,
    remote: false,
    listeners: new Set(),
    saveTimer: null,
    loadPromise: null,
  };

  function emit() {
    const snapshot = clone(state.prefs);
    for (const listener of state.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* listener must not break the workspace */
      }
    }
  }

  function userKey(userId) {
    return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
  }

  function applyTheme(theme) {
    if (typeof document === "undefined") return;
    const vars = themeVars(theme);
    const mode = effectiveMode(theme);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    root.dataset.wsTheme = mode;
    root.dataset.wsPreset = theme.preset;
    root.style.colorScheme = mode;

    const frame = document.getElementById("chatFrame");
    try {
      frame?.contentWindow?.postMessage({ type: "dna-workspace-theme", theme, vars, mode }, location.origin);
    } catch {
      /* frame not ready yet — sent again on load */
    }
    // Custom event for the shell script (tool-pages bridge, open panels, etc.).
    try {
      window.dispatchEvent(new CustomEvent("dna-workspace-theme", { detail: { theme, vars, mode } }));
    } catch {
      /* no CustomEvent */
    }
  }

  function broadcastToChat() {
    const frame = document.getElementById("chatFrame");
    try {
      frame?.contentWindow?.postMessage(
        {
          type: "dna-workspace-theme",
          theme: clone(state.prefs.theme),
          vars: themeVars(state.prefs.theme),
          mode: effectiveMode(state.prefs.theme),
        },
        location.origin,
      );
    } catch {
      /* frame not ready */
    }
  }

  function scheduleRemoteSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => {
      void fetch("/api/workspace/ui-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ preferences: state.prefs }),
      }).catch(() => {
        /* no session/network — localStorage copy remains the source for this device */
      });
    }, 350);
  }

  function commit({ save = true } = {}) {
    saveLocal(state.prefs, userKey(state.userId));
    applyTheme(state.prefs.theme);
    emit();
    if (save) scheduleRemoteSave();
  }

  async function loadRemote() {
    try {
      const res = await fetch("/api/workspace/ui-preferences", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json().catch(() => null);
      if (!body?.preferences) return;
      state.userId = body.userId || null;
      state.remote = true;
      const accountLocal = loadLocal(userKey(state.userId));
      if (accountLocal) state.prefs = accountLocal;
      else if (body.stored) state.prefs = normalizePrefs(body.preferences);
      if (accountLocal || body.stored) commit({ save: false });
      else saveLocal(state.prefs, userKey(state.userId));
    } catch {
      /* dev review without a session: localStorage only */
    }
  }

  const api = {
    DEFAULT_THEME: clone(defaultTheme()),
    PRESETS: clone(PRESETS),
    PRESET_NAMES: PRESET_NAMES.slice(),
    ICON_NAMES: ICON_NAMES.slice(),
    get() {
      return clone(state.prefs);
    },
    getResolved() {
      return clone(resolvedTheme(state.prefs.theme));
    },
    getUserId() {
      return state.userId;
    },
    systemMode,
    effectiveMode,
    subscribe(listener) {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    updateTheme(patch) {
      const next = normalizeTheme({
        ...state.prefs.theme,
        ...patch,
        // Changing any control means "custom", but keep the light/dark/auto mode
        // that the user was already looking at.
        preset: "custom",
        mode: state.prefs.theme.mode,
      });
      state.prefs.theme = next;
      commit();
    },
    setPreset(name) {
      if (name === "custom") {
        state.prefs.theme = normalizeTheme({ ...state.prefs.theme, preset: "custom" });
        commit();
        return;
      }
      const preset = PRESETS[name];
      if (!preset) return;
      state.prefs.theme = normalizeTheme({ ...preset, preset: name });
      commit();
    },
    resetTheme() {
      state.prefs.theme = defaultTheme();
      commit();
    },
    setShortcuts(shortcuts) {
      state.prefs.shortcuts = normalizeShortcuts(shortcuts);
      commit();
    },
    apply() {
      applyTheme(state.prefs.theme);
    },
    applyToDocument(doc, theme) {
      if (!doc) return;
      const resolved = resolvedTheme(theme || state.prefs.theme);
      const mode = effectiveMode(theme || state.prefs.theme);
      const vars = themeVars(theme || state.prefs.theme);
      const root = doc.documentElement;
      if (!root) return;
      for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
      root.dataset.dnaWsTheme = mode;
      root.dataset.dnaWsPreset = resolved.preset;
      root.style.colorScheme = mode;
    },
    broadcastToChat,
    themeVars,
    ready() {
      return state.loadPromise || Promise.resolve();
    },
    init() {
      applyTheme(state.prefs.theme);
      state.loadPromise = loadRemote();
      return state.loadPromise;
    },
  };

  // Auto/Custom follow the OS without a new detector: the browser API is the
  // only source. Changing OS appearance re-applies the resolved standard.
  try {
    const query = window.matchMedia(SYSTEM_DARK);
    const onChange = () => {
      if (state.prefs.theme.preset === "auto" || state.prefs.theme.mode === "auto") {
        applyTheme(state.prefs.theme);
        emit();
      }
    };
    if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
    else if (typeof query.addListener === "function") query.addListener(onChange);
  } catch {
    /* matchMedia unavailable — keep the last resolved mode */
  }

  window.WorkspaceCustomization = api;
  api.init();
})();
