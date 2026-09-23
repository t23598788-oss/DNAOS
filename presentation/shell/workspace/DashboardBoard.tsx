"use client";

import type { RenderModel } from "@/core/workspace/renderModel";

// Dashboard Board (Phase 4, Step 4) — a generic renderer of whatever
// RenderModel it's given. It has no idea what a widget's value represents,
// what a table's rows mean, or where any of it came from — that knowledge
// lives entirely in whichever Presenter produced the RenderModel. This is
// deliberate: the Board's job (widgets/status/overview/summary/alerts) is
// satisfied by rendering the model's shape faithfully, not by knowing real
// business content, which this file never imports and never guesses at.
//
// React's own mount/re-render/unmount cycle already IS initialize/mount/
// render/update/destroy from core/workspace/board.ts's Board interface —
// this component is that lifecycle expressed the React way rather than a
// second, parallel imperative system.
export function DashboardBoard({ model }: { model: RenderModel }) {
  return (
    <div className="p-4 space-y-6">
      <div>
        <h1 className="text-lg font-bold text-stone-900">{model.title || "Untitled Board"}</h1>
        {model.subtitle && <p className="text-xs text-stone-400 mt-0.5">{model.subtitle}</p>}
      </div>

      {model.widgets.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {model.widgets.map((w) => (
            <div key={w.id} className="border border-stone-200 rounded-xl p-3">
              <div className="text-[10px] text-stone-400 uppercase tracking-wide">{w.label}</div>
              <div className="text-lg font-semibold text-stone-900 flex items-center gap-1">
                {w.value}
                {w.trend && <span className={w.trend === "up" ? "text-emerald-500" : w.trend === "down" ? "text-red-500" : "text-stone-400"}>
                  {w.trend === "up" ? "↑" : w.trend === "down" ? "↓" : "→"}
                </span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {model.cards.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {model.cards.map((c) => (
            <div key={c.id} className="border border-stone-200 rounded-xl p-3">
              <div className="text-xs font-semibold text-stone-800">{c.title}</div>
              <div className="text-xs text-stone-500 mt-1">{c.body}</div>
              {c.footer && <div className="text-[10px] text-stone-400 mt-2">{c.footer}</div>}
            </div>
          ))}
        </div>
      )}

      {model.tables.map((t) => (
        <div key={t.id} className="border border-stone-200 rounded-xl overflow-hidden">
          {t.title && <div className="px-3 py-2 border-b border-stone-100 text-xs font-semibold text-stone-700">{t.title}</div>}
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-stone-50">
                {t.columns.map((c) => <th key={c} className="text-left px-3 py-1.5 text-stone-500 font-medium">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((row, i) => (
                <tr key={i} className="border-t border-stone-100">
                  {row.map((cell, j) => <td key={j} className="px-3 py-1.5 text-stone-700">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {model.charts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {model.charts.map((c) => (
            <div key={c.id} className="border border-stone-200 rounded-xl p-3">
              {c.title && <div className="text-xs font-semibold text-stone-700 mb-2">{c.title}</div>}
              <div className="text-[10px] text-stone-400">{c.kind} chart · {c.series.length} series (rendering deferred to a later phase)</div>
            </div>
          ))}
        </div>
      )}

      {model.panels.map((p) => (
        <div key={p.id} className="border border-stone-200 rounded-xl p-3">
          <div className="text-xs font-semibold text-stone-700 mb-1">{p.title}</div>
          <div className="text-xs text-stone-500">{p.content}</div>
        </div>
      ))}

      {model.actions.length > 0 && (
        <div className="flex gap-2">
          {model.actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={
                "text-xs px-3 py-1.5 rounded-md " +
                (a.intent === "primary" ? "bg-stone-900 text-white" :
                 a.intent === "danger" ? "bg-red-50 text-red-600 border border-red-200" :
                 "border border-stone-200 text-stone-600")
              }
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}