'use client';

import { useState, useRef, useEffect } from 'react';

function fmt(n: any) { const v = Number(n); return isNaN(v) ? "-" : v.toLocaleString("th-TH", { minimumFractionDigits: 2 }); }

function DeleteBtn({ table, id, onDone }: { table: string; id: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!id) return null;
  if (confirming) return (
    <div className="flex gap-2 mt-2">
      <button onClick={async () => { await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `DELETE:${table}:${id}` }) }); setConfirming(false); onDone(); }} className="px-3 py-1.5 bg-red-500 text-white text-xs rounded-lg">ยืนยันลบ</button>
      <button onClick={() => setConfirming(false)} className="px-3 py-1.5 bg-stone-200 text-stone-700 text-xs rounded-lg">ยกเลิก</button>
    </div>
  );
  return <button onClick={() => setConfirming(true)} className="mt-2 text-xs text-stone-400 hover:text-red-500 transition">ลบออกจากระบบ</button>;
}

function UIComponent({ uiData, onCommand }: { uiData: any; onCommand: (cmd: string) => void }) {
  const t = uiData.componentType;

  if (t === 'INFO_CARD') return (
    <div className="mt-3 bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
      {uiData.title && <div className="text-lg font-semibold text-stone-800 mb-4 pb-3 border-b border-stone-100">{uiData.title}</div>}
      <div className="space-y-3">
        {uiData.items?.map((item: any, i: number) => (
          <div key={i} className="flex justify-between items-start">
            <span className="text-stone-500 text-sm">{item.label}</span>
            <span className="text-stone-900 text-sm font-medium text-right ml-4">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (t === 'DOCUMENT_RENDERER') return (
    <div className="mt-3 bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
      <div className="font-semibold text-lg text-stone-800 border-b border-stone-100 pb-2 mb-4">{uiData.title}</div>
      <div className="space-y-2 text-sm">
        <p><span className="text-stone-500">ลูกค้า:</span> <span className="font-medium">{uiData.customerName}</span></p>
        {uiData.phone && <p><span className="text-stone-500">โทร:</span> {uiData.phone}</p>}
        {uiData.address && <p><span className="text-stone-500">ที่อยู่:</span> {uiData.address}</p>}
        <p className="text-emerald-600 font-medium mt-3">สร้างสำเร็จ</p>
      </div>
    </div>
  );

  if (t === 'CUSTOMER_CARD') return (
    <div className="mt-3 bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
      <div className="font-semibold text-lg text-stone-800 mb-4">{uiData.name}</div>
      <div className="space-y-3 text-sm">
        {uiData.code && <div className="flex justify-between"><span className="text-stone-500">รหัส</span><span className="text-stone-900">{uiData.code}</span></div>}
        {uiData.type && <div className="flex justify-between"><span className="text-stone-500">ประเภท</span><span className="text-stone-900">{uiData.type}</span></div>}
        {uiData.source && <div className="flex justify-between"><span className="text-stone-500">แหล่ง</span><span className="text-stone-900">{uiData.source}</span></div>}
        {uiData.phone && <div className="flex justify-between"><span className="text-stone-500">โทร</span><span className="text-stone-900">{uiData.phone}</span></div>}
        {uiData.address && <div className="flex justify-between"><span className="text-stone-500">ที่อยู่</span><span className="text-stone-900 text-right max-w-[60%]">{uiData.address}</span></div>}
      </div>
    </div>
  );

  if (t === 'PICKER') return (
    <div className="mt-3 space-y-2">
      {uiData.items?.map((item: any, i: number) => (
        <button key={i} onClick={() => onCommand(`${uiData.command_prefix}${item.label}`)}
          className="w-full text-left px-5 py-4 rounded-xl bg-white border border-stone-200 hover:border-stone-400 hover:shadow-sm active:bg-stone-50 transition">
          <div className="text-stone-900 text-sm font-medium">{item.label}</div>
          {item.detail && <div className="text-stone-500 text-xs mt-0.5">{item.detail}</div>}
        </button>
      ))}
    </div>
  );

  if (t === 'PARTNER_LIST') return (
    <div className="mt-3 space-y-1">
      {uiData.items?.map((p: any, i: number) => (
        <button key={i} onClick={() => onCommand(`ลูกค้า ${p.name}`)}
          className="w-full text-left px-5 py-3 rounded-xl hover:bg-stone-100 active:bg-stone-200 transition flex justify-between items-center">
          <span className="text-stone-900 text-sm">{p.name}</span>
          <span className="text-stone-400 text-xs">{p.phone ?? ""}</span>
        </button>
      ))}
    </div>
  );

  if (t === 'DEBT_LIST') return (
    <div className="mt-3 space-y-2">
      {uiData.items?.map((d: any, i: number) => (
        <div key={i} className="px-5 py-4 rounded-xl bg-white border border-stone-200 shadow-sm">
          <div className="flex justify-between items-start">
            <div><div className="text-stone-900 text-sm font-medium">{d.customer_name ?? "ไม่ทราบชื่อ"}</div><div className="text-stone-400 text-xs mt-0.5">{d.invoice_status}</div></div>
            <div className="text-right"><div className="text-red-600 text-sm font-semibold">{fmt(d.outstanding_amount ?? d.principal_amount)}</div><div className="text-stone-400 text-xs">เงินต้น {fmt(d.principal_amount)}</div></div>
          </div>
          <DeleteBtn table={d.customer_name ? "debt_trackings" : "invoice_debts"} id={d.id} onDone={() => onCommand("หนี้")} />
        </div>
      ))}
    </div>
  );

  if (t === 'JOB_CARD') return (
    <div className="mt-3 bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
      <div className="font-semibold text-lg text-stone-800 mb-4">{uiData.project}</div>
      <div className="space-y-3 text-sm">
        <div className="flex justify-between"><span className="text-stone-500">ผู้ติดต่อ</span><span className="text-stone-900">{uiData.contact ?? "-"}</span></div>
        <div className="flex justify-between"><span className="text-stone-500">ระยะทาง</span><span className="text-stone-900">{uiData.distance ?? "-"} km</span></div>
        <div className="flex justify-between"><span className="text-stone-500">ต้องการ</span><span className="text-stone-900">{uiData.required ?? "-"} คิว</span></div>
        <div className="flex justify-between"><span className="text-stone-500">ส่งแล้ว</span><span className="text-stone-900">{uiData.delivered ?? 0} คิว</span></div>
        <div className="flex justify-between"><span className="text-stone-500">สถานะ</span><span className="text-stone-900">{uiData.status ?? "-"}</span></div>
      </div>
    </div>
  );

  if (t === 'JOB_LIST') return (
    <div className="mt-3 space-y-2">
      {uiData.items?.map((j: any, i: number) => (
        <div key={i} className="px-5 py-4 rounded-xl bg-white border border-stone-200 shadow-sm">
          <div className="flex justify-between cursor-pointer" onClick={() => onCommand(`งาน ${j.project_name}`)}>
            <div><div className="text-stone-900 text-sm font-medium">{j.project_name}</div><div className="text-stone-400 text-xs mt-0.5">{j.contact_name}</div></div>
            <div className="text-stone-500 text-xs text-right">{j.job_status}</div>
          </div>
          <DeleteBtn table="jobs" id={j.id} onDone={() => onCommand("งาน")} />
        </div>
      ))}
    </div>
  );

  if (t === 'DOC_LIST') return (
    <div className="mt-3 space-y-2">
      {uiData.items?.map((doc: any, i: number) => (
        <div key={i} className="px-5 py-4 rounded-xl bg-white border border-stone-200 shadow-sm">
          <div className="flex justify-between">
            <div><div className="text-stone-900 text-sm font-medium">{doc.party_name}</div><div className="text-stone-400 text-xs mt-0.5">{doc.document_type} {doc.document_number}</div></div>
            <div className="text-right"><div className="text-stone-900 text-sm font-medium">{fmt(doc.net_amount)}</div><div className="text-stone-400 text-xs">{doc.status}</div></div>
          </div>
          <DeleteBtn table="documents" id={doc.id} onDone={() => onCommand("เอกสาร")} />
        </div>
      ))}
    </div>
  );

  if (t === 'MATERIAL_LIST') return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
      {uiData.items?.map((m: any, i: number) => (
        <div key={i} className="px-4 py-3 rounded-xl bg-white border border-stone-200 text-center text-stone-800 text-sm shadow-sm">{m.name}</div>
      ))}
    </div>
  );

  if (t === 'HTML_DOCUMENT') return (
    <div className="mt-3 rounded-xl overflow-hidden border border-stone-200 bg-white shadow-sm">
      <iframe srcDoc={uiData.html} className="w-full border-0" style={{ minHeight: '500px' }} title="เอกสาร" />
    </div>
  );

  return null;
}

export default function AIChatCockpit() {
  const [messages, setMessages] = useState<any[]>([{ sender: 'ai', type: 'text', text: 'DNA OS พร้อมทำงานครับ' }]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg) return;
    setMessages(prev => [...prev, { sender: 'owner', type: 'text', text: msg }]);
    setInput('');
    setSending(true);
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) });
    const data = await res.json();
    if (data.command === 'CLEAR_SCREEN') {
      setMessages([{ sender: 'ai', type: 'text', text: 'พร้อมทำงานครับ' }]);
    } else {
      setMessages(prev => [...prev, data]);
    }
    setSending(false);
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col h-screen bg-stone-50 text-stone-900 touch-manipulation">

      <div className="px-6 py-3 bg-white border-b border-stone-200 text-sm font-medium text-stone-800 flex justify-between items-center shadow-sm">
        <span>DNA OS</span>
        <span className="text-xs text-emerald-600 flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />พร้อมทำงาน</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.sender === 'owner' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-2xl w-full ${msg.sender === 'owner'
              ? 'px-5 py-3 bg-blue-600 text-white rounded-2xl rounded-br-sm text-sm shadow-sm ml-auto max-w-md'
              : 'px-5 py-3 bg-white border border-stone-200 rounded-2xl rounded-bl-sm text-sm shadow-sm text-stone-700'}`}>
              <p className="whitespace-pre-line leading-relaxed">{msg.text}</p>
              {msg.type === 'ui_component' && msg.uiData && (
                <UIComponent uiData={msg.uiData} onCommand={send} />
              )}
              {msg.type === 'workspace' && msg.workspace?.sections && (
                <div className="mt-3 space-y-4">
                  {msg.workspace.sections.map((sec: any, si: number) => (
                    <div key={si}>
                      <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">{sec.section} ({sec.items?.length ?? 0})</div>
                      {sec.type === 'pick' ? (
                        <div className="space-y-2">
                          {sec.items?.map((item: any, ii: number) => (
                            <button key={ii} onClick={() => send(`${sec.prefix}${item.title}`)} className="w-full text-left px-5 py-4 rounded-xl bg-white border border-stone-200 hover:border-stone-400 hover:shadow-sm active:bg-stone-50 transition">
                              <div className="text-stone-900 text-sm font-medium">{item.title}</div>
                              {item.subtitle && <div className="text-stone-500 text-xs mt-0.5">{item.subtitle}</div>}
                            </button>
                          ))}
                        </div>
                      ) : sec.type === 'info' ? (
                        <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm space-y-3">
                          {sec.items?.map((item: any, ii: number) => (
                            <div key={ii} className="flex justify-between"><span className="text-stone-500 text-sm">{item.title}</span><span className="text-stone-900 text-sm font-medium">{item.subtitle}</span></div>
                          ))}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {sec.items?.map((item: any, ii: number) => (
                            <div key={ii} className="px-5 py-3 rounded-xl bg-white border border-stone-200 shadow-sm">
                              <div className="flex justify-between items-start">
                                <div className="text-stone-900 text-sm font-medium">{item.title}</div>
                              </div>
                              {item.subtitle && <div className="text-stone-500 text-xs mt-1">{item.subtitle}</div>}
                              {item._table && item.id && <DeleteBtn table={item._table} id={item.id} onDone={() => send(sec.section)} />}
                            </div>
                          ))}
                          {(!sec.items || sec.items.length === 0) && <div className="text-stone-400 text-sm py-3">ไม่มีข้อมูล</div>}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="px-5 py-3 bg-white border border-stone-200 rounded-2xl rounded-bl-sm text-sm text-stone-400 animate-pulse shadow-sm">
              กำลังดึงข้อมูล...
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="bg-white border-t border-stone-200 px-4 py-2 flex gap-2 justify-center">
        {messages.length > 1 && <button onClick={() => setMessages(msgs => msgs.length > 1 ? msgs.slice(0, -2) : msgs)} className="text-xs text-stone-400 hover:text-stone-700 px-3 py-1.5 rounded-lg bg-stone-100">ย้อนกลับ</button>}
        <button onClick={() => setMessages([{ sender: 'ai', type: 'text', text: 'พร้อมทำงานครับ' }])} className="text-xs text-stone-400 hover:text-stone-700 px-3 py-1.5 rounded-lg bg-stone-100">ล้างหน้าจอ</button>
      </div>

      <form onSubmit={e => { e.preventDefault(); send(); }} className="bg-white px-4 sm:px-6 py-3 border-t border-stone-200">
        <div className="max-w-3xl mx-auto flex gap-2">
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder="ถามอะไรก็ได้..."
            className="flex-1 bg-stone-100 border border-stone-200 rounded-xl px-4 py-3 text-sm text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 focus:ring-1 focus:ring-stone-300" autoComplete="off" enterKeyHint="send" />
          <button type="submit" disabled={sending || !input.trim()} className="px-6 py-3 bg-blue-600 text-white text-sm rounded-xl font-medium hover:bg-blue-700 active:bg-blue-800 disabled:opacity-30 shadow-sm">สั่งการ</button>
        </div>
      </form>
    </div>
  );
}
