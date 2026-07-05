"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import * as THREE from "three";

// ── Types ────────────────────────────────────────────────────────────────

interface ImpactCard {
  id: string;
  dimension: string;
  title: string;
  detail: string;
  severity: "low" | "medium" | "high";
}

interface Exchange {
  id: string;
  question: string;
  answer?: string;
  cards?: ImpactCard[];
  matched: boolean;
}

const SUGGESTIONS = [
  "สรุปการเงินทั้งหมด",
  "มีหนี้ค้างเท่าไหร่",
  "งานที่ยังไม่ปิดมีกี่งาน",
  "ใบแจ้งหนี้ล่าสุด 5 ใบ",
  "พาร์ตเนอร์ทั้งหมดในระบบ",
  "เหตุการณ์ล่าสุดในระบบ",
  "งานประเภทขายทั้งหมด",
  "summary of all finances",
];

// ── Three.js hologram face — procedural wireframe head, no external model ──

function HologramFace({ thinking, speaking, alert }: { thinking: boolean; speaking: boolean; alert: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef({ thinking, speaking, alert });
  stateRef.current = { thinking, speaking, alert };

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth;
    const height = mount.clientHeight;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.05, 5.4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const head = new THREE.Group();
    scene.add(head);

    // ── Head shape: solid-of-revolution profile (chin → jaw → cheek → temple → crown) ──
    // proportioned like an actual head (~1.6:1 height:width), not an elongated egg
    const profile = [
      [0.0, -0.95], [0.3, -0.85], [0.45, -0.65], [0.54, -0.4],
      [0.58, -0.1], [0.59, 0.15], [0.55, 0.4], [0.46, 0.62],
      [0.32, 0.8], [0.15, 0.9], [0.0, 0.95],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const headGeo = new THREE.LatheGeometry(profile, 28);
    const headMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, wireframe: true, transparent: true, opacity: 0.55 });
    const headMesh = new THREE.Mesh(headGeo, headMat);
    head.add(headMesh);

    // Faint solid fill behind the wireframe so it reads as a volume, not just lines
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x0b2530, transparent: true, opacity: 0.35, side: THREE.BackSide });
    const fillMesh = new THREE.Mesh(headGeo, fillMat);
    head.add(fillMesh);

    // ── Eyes — placed at cheekbone height, just proud of the wireframe surface ──
    const eyeGeo = new THREE.SphereGeometry(0.07, 12, 12);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x99f6ff });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.22, 0.18, 0.52);
    eyeR.position.set(0.22, 0.18, 0.52);
    head.add(eyeL, eyeR);

    // Eye glow rings (read as "cybernetic" eyes, and pulse while thinking)
    const eyeRingGeo = new THREE.RingGeometry(0.085, 0.11, 24);
    const eyeRingMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const eyeRingMatR = eyeRingMat.clone();
    const eyeRingL = new THREE.Mesh(eyeRingGeo, eyeRingMat);
    const eyeRingR = new THREE.Mesh(eyeRingGeo, eyeRingMatR);
    eyeRingL.position.copy(eyeL.position);
    eyeRingR.position.copy(eyeR.position);
    head.add(eyeRingL, eyeRingR);

    // ── Mouth: a small glowing bar (not a thin WebGL line, so it's always visible),
    // scales vertically to fake talking while "speaking" ──
    const mouthGeo = new THREE.BoxGeometry(0.26, 0.03, 0.02);
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.position.set(0, -0.5, 0.55);
    head.add(mouth);

    const updateMouth = (openness: number) => {
      mouth.scale.y = 1 + openness * 4;
    };
    updateMouth(0);

    // ── Orbiting HUD particle rings around the head ──
    const ringGroup = new THREE.Group();
    const rings: THREE.Points[] = [];
    for (let r = 0; r < 2; r++) {
      const particleCount = 80;
      const positions = new Float32Array(particleCount * 3);
      const radius = 2.1 + r * 0.5;
      for (let i = 0; i < particleCount; i++) {
        const a = (i / particleCount) * Math.PI * 2;
        positions[i * 3] = Math.cos(a) * radius;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 0.25;
        positions[i * 3 + 2] = Math.sin(a) * radius;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({ color: r === 0 ? 0x22d3ee : 0x60a5fa, size: 0.04, transparent: true, opacity: 0.7 });
      const points = new THREE.Points(geo, mat);
      points.rotation.x = Math.PI / 2.3 + r * 0.15;
      rings.push(points);
      ringGroup.add(points);
    }
    scene.add(ringGroup);

    const NORMAL_COLOR = new THREE.Color(0x22d3ee);
    const ALERT_COLOR = new THREE.Color(0xf87171);
    let lastAlert: boolean | null = null;

    let frame = 0;
    let rafId: number;
    const animate = () => {
      frame += 1;
      const { thinking: isThinking, speaking: isSpeaking, alert: isAlert } = stateRef.current;

      if (isAlert !== lastAlert) {
        const c = isAlert ? ALERT_COLOR : NORMAL_COLOR;
        headMat.color.copy(c);
        eyeRingMat.color.copy(c);
        eyeRingMatR.color.copy(c);
        mouthMat.color.copy(c);
        lastAlert = isAlert;
      }

      // Gentle idle sway — never fully rotates away, keeps the face facing camera
      head.rotation.y = Math.sin(frame * 0.006) * 0.35;
      head.rotation.x = Math.sin(frame * 0.004) * 0.05;

      ringGroup.rotation.y += isThinking ? 0.012 : 0.003;

      const eyePulse = (isThinking || isAlert) ? 0.5 + Math.sin(frame * 0.3) * 0.5 : 0.75 + Math.sin(frame * 0.04) * 0.2;
      eyeRingMat.opacity = Math.max(0.3, eyePulse);
      (eyeRingR.material as THREE.MeshBasicMaterial).opacity = Math.max(0.3, eyePulse);

      const mouthOpen = isSpeaking ? Math.abs(Math.sin(frame * 0.5)) : 0.02;
      updateMouth(mouthOpen);

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      mount.removeChild(renderer.domElement);
      headGeo.dispose(); headMat.dispose(); fillMat.dispose();
      eyeGeo.dispose(); eyeMat.dispose();
      eyeRingGeo.dispose(); eyeRingMat.dispose(); (eyeRingR.material as THREE.Material).dispose();
      mouthGeo.dispose(); mouthMat.dispose();
      for (const p of rings) { p.geometry.dispose(); (p.material as THREE.Material).dispose(); }
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} className="w-full h-full" />;
}

// ── Impact card — floats beside the face, always backed by real DB data ────

const SEVERITY_STYLE: Record<ImpactCard["severity"], string> = {
  high: "border-red-500/40 bg-red-950/30 text-red-200",
  medium: "border-amber-500/30 bg-amber-950/20 text-amber-200",
  low: "border-cyan-500/20 bg-slate-900/60 text-slate-200",
};

function ImpactCardView({ card }: { card: ImpactCard }) {
  return (
    <div className={`rounded-xl border px-4 py-3 text-xs backdrop-blur-sm shadow-[0_0_20px_-10px_rgba(34,211,238,0.25)] animate-[fadeIn_0.4s_ease-out] ${SEVERITY_STYLE[card.severity]}`}>
      <span className="inline-block text-[10px] font-semibold uppercase tracking-wider bg-black/20 px-1.5 py-0.5 rounded mb-1.5">
        {card.dimension}
      </span>
      <div className="font-semibold mb-1">{card.title}</div>
      <p className="opacity-80 whitespace-pre-line leading-relaxed">{card.detail}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function BrainPage() {
  const [current, setCurrent] = useState<Exchange | null>(null);
  const [history, setHistory] = useState<Exchange[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [alert, setAlert] = useState(false);

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || thinking) return;
    setInput("");
    setThinking(true);
    setSpeaking(false);
    try {
      const res = await fetch("/api/brain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history: history.slice(0, 6) }),
      });
      const data = await res.json();
      const exchange: Exchange = {
        id: crypto.randomUUID(),
        question: q,
        answer: data.answer,
        cards: data.cards,
        matched: data.matched,
      };
      if (current) setHistory((h) => [current, ...h].slice(0, 8));
      setCurrent(exchange);
      setAlert(Boolean(data.hasAlert));
      setSpeaking(true);
      const speakLength = exchange.answer?.length ?? exchange.cards?.reduce((n, c) => n + c.detail.length, 0) ?? 40;
      window.setTimeout(() => setSpeaking(false), Math.min(6000, 1200 + speakLength * 18));
    } catch (e: any) {
      setCurrent({ id: crypto.randomUUID(), question: q, answer: `เชื่อมต่อไม่ได้: ${e.message}`, matched: false });
      setAlert(false);
    } finally {
      setThinking(false);
    }
  }, [thinking, current]);

  return (
    <div className="min-h-screen bg-[#050b14] text-slate-300 flex flex-col relative overflow-hidden">
      {/* ── Ambient hologram backdrop ── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(34,211,238,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.6) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }} />
        <div className="absolute -top-40 -left-40 w-[36rem] h-[36rem] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-[36rem] h-[36rem] rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      {/* ── Top bar ── */}
      <header className="relative z-10 bg-slate-900/70 backdrop-blur-md border-b border-cyan-500/20 shadow-[0_0_25px_-8px_rgba(34,211,238,0.35)] px-5 py-3 flex items-center gap-4 shrink-0">
        <Link href="/admin/dbd" className="text-[11px] text-slate-500 hover:text-cyan-300 transition">← DBD Center</Link>
        <h1 className="text-sm font-bold tracking-[0.15em] text-cyan-300 uppercase flex-1"
          style={{ textShadow: "0 0 12px rgba(34,211,238,0.55)" }}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle ${thinking ? "bg-blue-400 animate-ping" : "bg-cyan-400 animate-pulse"}`}
            style={{ boxShadow: "0 0 8px 2px rgba(34,211,238,0.8)" }} />
          DNA Brain — คุยกับสมองระบบ
        </h1>
        <span className="text-[10px] text-slate-500">{thinking ? "กำลังคิด…" : speaking ? "กำลังตอบ…" : "พร้อมตอบ"}</span>
      </header>

      {/* ── Body: face centered, caption/cards underneath, one exchange at a time ── */}
      <div className="relative z-10 flex-1 flex flex-col items-center min-h-0 overflow-y-auto">
        <div className="relative w-full max-w-5xl">
          <div className="w-full max-w-2xl mx-auto h-[46vh] min-h-[280px] shrink-0">
            <HologramFace thinking={thinking} speaking={speaking} alert={alert} />
          </div>

          {/* Impact cards — float beside the face, split left/right, real DB data only */}
          {current?.cards && current.cards.length > 0 && (
            <div className="hidden md:flex absolute inset-y-0 left-0 right-0 items-center justify-between px-4 pointer-events-none">
              <div className="w-64 space-y-3 pointer-events-auto">
                {current.cards.filter((_, i) => i % 2 === 0).map((c) => <ImpactCardView key={c.id} card={c} />)}
              </div>
              <div className="w-64 space-y-3 pointer-events-auto">
                {current.cards.filter((_, i) => i % 2 !== 0).map((c) => <ImpactCardView key={c.id} card={c} />)}
              </div>
            </div>
          )}
        </div>

        {/* Caption — current question/answer, or cards on mobile where they can't float beside the face */}
        <div className="w-full max-w-2xl px-5 -mt-2">
          {current ? (
            <div key={current.id} className="animate-[fadeIn_0.4s_ease-out]">
              <div className="text-center text-cyan-300 text-sm font-medium mb-2" style={{ textShadow: "0 0 10px rgba(34,211,238,0.5)" }}>
                &ldquo;{current.question}&rdquo;
              </div>
              {current.cards && current.cards.length > 0 ? (
                <div className="md:hidden space-y-3">
                  {current.cards.map((c) => <ImpactCardView key={c.id} card={c} />)}
                </div>
              ) : (
                <div className={`rounded-xl px-5 py-4 text-xs leading-relaxed whitespace-pre-wrap text-center backdrop-blur-sm ${
                  current.matched === false
                    ? "bg-amber-500/10 border border-amber-500/30 text-amber-200"
                    : "bg-slate-900/60 border border-cyan-500/10 text-slate-200 shadow-[0_0_25px_-10px_rgba(34,211,238,0.3)]"
                }`}>
                  {thinking ? "กำลังอ่าน registry…" : current.answer}
                </div>
              )}
            </div>
          ) : (
            <p className="text-center text-xs text-slate-500">ถามอะไรก็ได้เกี่ยวกับระบบหรือธุรกิจครับ — ผมตอบจากข้อมูลจริงในระบบเท่านั้น ไม่เดา</p>
          )}
        </div>

        {/* Recent question chips (history) — click to see it again */}
        {history.length > 0 && (
          <div className="w-full max-w-2xl px-5 mt-3 flex flex-wrap justify-center gap-1.5">
            {history.map((h) => (
              <button key={h.id} onClick={() => {
                setHistory((hs) => {
                  const rest = hs.filter((x) => x.id !== h.id);
                  return current ? [current, ...rest] : rest;
                });
                setCurrent(h);
              }}
                className="text-[10px] text-slate-500 border border-slate-700/50 hover:border-cyan-500/30 hover:text-cyan-400 px-2 py-1 rounded-lg transition">
                {h.question}
              </button>
            ))}
          </div>
        )}

        {/* Suggestions */}
        <div className="w-full max-w-2xl px-5 mt-4 flex flex-wrap justify-center gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={thinking}
              className="text-[10px] text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/10 px-2 py-1 rounded-lg transition disabled:opacity-40">
              {s}
            </button>
          ))}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); ask(input); }}
          className="w-full max-w-2xl px-5 py-5 flex gap-2 shrink-0"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ถามอะไรก็ได้เกี่ยวกับระบบ…"
            disabled={thinking}
            className="flex-1 px-3 py-2 text-xs border border-cyan-500/10 rounded-lg outline-none focus:border-cyan-400 bg-slate-900/60 text-slate-200 placeholder:text-slate-500"
          />
          <button type="submit" disabled={thinking || !input.trim()}
            className="text-xs text-cyan-300 border border-cyan-500/30 hover:bg-cyan-500/10 px-4 py-2 rounded-lg transition disabled:opacity-40">
            ส่ง
          </button>
        </form>
      </div>
    </div>
  );
}
