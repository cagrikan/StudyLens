"use client";
import { useState, useRef, useEffect } from "react";
const MODEL = "claude-haiku-4-5";
const CYCLE = 10;
const MIN_ACTION = 3;
const P = "#6C63FF";
const P2 = "#8B83FF";
const DARK = "#0F0E17";
const CARD = "#1A1929";
const SURFACE = "#221F35";
const BORDER = "rgba(255,255,255,0.07)";
const TEXT = "#F4F3FF";
const MUTED = "rgba(244,243,255,0.45)";
const ACCENT = "#FF6584";

const SUBJ_STYLE: Record<string, { bg: string; tx: string }> = {
  "Matematik": { bg: "rgba(108,99,255,0.15)", tx: "#A89BFF" },
  "Fizik":     { bg: "rgba(255,101,132,0.15)", tx: "#FF8FA5" },
  "Kimya":     { bg: "rgba(52,211,153,0.15)",  tx: "#4EEDB3" },
  "Biyoloji":  { bg: "rgba(251,191,36,0.15)",  tx: "#FCD262" },
  "Türkçe":    { bg: "rgba(99,179,237,0.15)",  tx: "#7DC8F5" },
  "Tarih":     { bg: "rgba(167,139,250,0.15)", tx: "#C4B5FD" },
  "Coğrafya":  { bg: "rgba(251,146,60,0.15)",  tx: "#FCA86B" },
  "İngilizce": { bg: "rgba(45,212,191,0.15)",  tx: "#5EEAD4" },
};
const DIFF_STYLE: Record<string, { bg: string; tx: string }> = {
  "Kolay": { bg: "rgba(52,211,153,0.15)",  tx: "#4EEDB3" },
  "Orta":  { bg: "rgba(251,191,36,0.15)",  tx: "#FCD262" },
  "Zor":   { bg: "rgba(255,101,132,0.15)", tx: "#FF8FA5" },
};
const subS = (s: string) => SUBJ_STYLE[s] || { bg: "rgba(255,255,255,0.08)", tx: TEXT };
const difS = (d: string) => DIFF_STYLE[d]  || { bg: "rgba(255,255,255,0.08)", tx: TEXT };

// ── Storage (Vercel KV üzerinden) ──────────────────────────────
const sGet = async (key: string) => {
  const res = await fetch(`/api/storage?key=${encodeURIComponent(key)}`);
  const data = await res.json();
  return data.value !== null ? { value: data.value } : null;
};
const sSet = async (key: string, value: string) => {
  await fetch("/api/storage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
};

// ── Claude API (server route üzerinden) ────────────────────────
async function callClaude(messages: any[], maxTokens = 600): Promise<string> {
  const res = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, max_tokens: maxTokens }),
  });
  const data = await res.json();
  if (!res.ok || data.error)
    throw new Error("API " + res.status + ": " + JSON.stringify(data.error).slice(0, 200));
  return (data.content ?? []).map((b: any) => b.text ?? "").join("");
}

// ── Yardımcılar ────────────────────────────────────────────────
function readAsDataURL(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error("Dosya okunamadı"));
    r.readAsDataURL(file);
  });
}

async function compressDataUrl(srcDataUrl: string, maxB64 = 4_800_000) {
  const MAX = 900;
  return new Promise<{ dataUrl: string; b64: string } | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const sc = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * sc);
        c.height = Math.round(img.naturalHeight * sc);
        const ctx = c.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        const tryQ = (q: number) => {
          if (q < 0.05) { resolve(null); return; }
          try {
            const du = c.toDataURL("image/jpeg", q);
            const b64 = du.split(",")[1] || "";
            b64.length <= maxB64 ? resolve({ dataUrl: du, b64 }) : tryQ(Math.round((q - 0.1) * 10) / 10);
          } catch { resolve(null); }
        };
        tryQ(0.72);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = srcDataUrl;
  });
}

function extractJson(raw: string) {
let clean = raw
    .replace(/```json\n?|```\n?/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .trim();

  const start = clean.indexOf("{");
  if (start > 0) clean = clean.slice(start);

  // Parantez sayısını dengele
  let depth = 0;
  let endIdx = -1;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx !== -1) clean = clean.slice(0, endIdx + 1);

  clean = clean.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");

  // Eksik kapanışları tamamla
  const opens = (clean.match(/\[/g) || []).length;
  const closes = (clean.match(/\]/g) || []).length;
  for (let i = 0; i < opens - closes; i++) clean += "]";
  const opensBrace = (clean.match(/\{/g) || []).length;
  const closesBrace = (clean.match(/\}/g) || []).length;
  for (let i = 0; i < opensBrace - closesBrace; i++) clean += "}";

  try { return JSON.parse(clean); } catch (e) {
    throw new Error("JSON parse hatası: " + String(e).slice(0, 80));
  }
}

// ── CSS ────────────────────────────────────────────────────────
const css = `
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
  *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  ::-webkit-scrollbar{width:0;background:transparent}
  .fadeUp{animation:fadeUp .35s ease forwards}
  .card-hover{transition:transform .15s ease,box-shadow .15s ease}
  .card-hover:hover{transform:translateY(-1px);box-shadow:0 12px 32px rgba(0,0,0,0.35)!important}
`;

// ── Alt bileşenler ─────────────────────────────────────────────
function Chip({ label, style }: { label: string; style?: React.CSSProperties }) {
  return <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "3px 10px", whiteSpace: "nowrap", letterSpacing: .3, ...style }}>{label}</span>;
}
function Spinner({ color = P, size = 36 }: { color?: string; size?: number }) {
  return <div style={{ width: size, height: size, border: `2.5px solid rgba(255,255,255,0.1)`, borderTopColor: color, borderRadius: "50%", animation: "spin .8s linear infinite", margin: "0 auto" }} />;
}
function GlassCard({ children, style, onClick, className }: any) {
  return (
    <div onClick={onClick} className={className}
      style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 20, overflow: "hidden", ...style }}>
      {children}
    </div>
  );
}

function PinBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  return (
    <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
      {[0, 1, 2, 3].map(i => (
        <input key={i} ref={el => { refs.current[i] = el; }}
          type="password" inputMode="numeric" maxLength={1}
          value={value[i] || ""}
          onChange={e => {
            const v = e.target.value.replace(/\D/, "").slice(-1);
            const arr = [...value.padEnd(4, " ")]; arr[i] = v || " ";
            onChange(arr.join("").trimEnd().slice(0, 4));
            if (v && i < 3) refs.current[i + 1]?.focus();
          }}
          onKeyDown={e => {
            if (e.key === "Backspace") {
              if (value[i]?.trim()) { const arr = [...value.padEnd(4, " ")]; arr[i] = " "; onChange(arr.join("").trimEnd()); }
              else if (i > 0) refs.current[i - 1]?.focus();
            }
          }}
          style={{ width: 56, height: 60, textAlign: "center", fontSize: 26, fontWeight: 700, border: `1.5px solid ${value[i]?.trim() ? "rgba(108,99,255,0.8)" : BORDER}`, borderRadius: 16, outline: "none", background: value[i]?.trim() ? "rgba(108,99,255,0.15)" : SURFACE, color: TEXT, fontFamily: "inherit", transition: "all .2s", boxShadow: value[i]?.trim() ? `0 0 0 3px rgba(108,99,255,0.2)` : "none" }}
        />
      ))}
    </div>
  );
}

function AuthScreen({ onAuth }: { onAuth: (u: string) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [remember, setRemember] = useState(false);
  const sw = (m: "login" | "register") => { setMode(m); setErr(""); setPin(""); setPin2(""); };

  const submit = async () => {
    const u = username.trim().toLowerCase().replace(/\s+/g, "_");
    if (!u) return setErr("Kullanıcı adı girin");
    if (pin.replace(/\s/g, "").length !== 4) return setErr("4 haneli PIN girin");
    if (mode === "register" && pin !== pin2) return setErr("PINler eşleşmiyor");
    setLoading(true); setErr("");
    const ex = await sGet(`user:${u}`);
    if (mode === "login") {
      if (!ex) { setErr("Kullanıcı bulunamadı"); setLoading(false); return; }
      if (JSON.parse(ex.value).pin !== pin) { setErr("PIN hatalı"); setLoading(false); return; }
    } else {
      if (ex) { setErr("Bu kullanıcı adı alınmış"); setLoading(false); return; }
      await sSet(`user:${u}`, JSON.stringify({ username: u, pin, createdAt: Date.now() }));
    }
    if (remember) localStorage.setItem("sl_user", u);
    onAuth(u); setLoading(false);
  };

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", minHeight: "100vh", background: DARK, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", padding: "0 20px", position: "relative", overflow: "hidden" }}>
      <style>{css}</style>
      <div style={{ position: "absolute", width: 320, height: 320, borderRadius: "50%", background: "radial-gradient(circle,rgba(108,99,255,0.18) 0%,transparent 70%)", top: -80, left: -60, pointerEvents: "none" }} />
      <div style={{ position: "absolute", width: 280, height: 280, borderRadius: "50%", background: "radial-gradient(circle,rgba(255,101,132,0.12) 0%,transparent 70%)", bottom: -40, right: -60, pointerEvents: "none" }} />
      <div className="fadeUp" style={{ marginBottom: 36, textAlign: "center" }}>
        <div style={{ width: 80, height: 80, background: `linear-gradient(135deg,${P},${ACCENT})`, borderRadius: 28, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", boxShadow: `0 16px 40px rgba(108,99,255,0.4)` }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="15" rx="2" stroke="white" strokeWidth="1.5" /><circle cx="12" cy="13.5" r="3.5" stroke="white" strokeWidth="1.5" /><path d="M9 6L10.5 3.5H13.5L15 6" stroke="white" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="18.5" cy="9.5" r="1" fill="white" /></svg>
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, color: TEXT, letterSpacing: -1 }}>StudyLens</div>
        <div style={{ fontSize: 13, color: MUTED, marginTop: 5 }}>AI Destekli Öğrenme Asistanı</div>
      </div>
      <div className="fadeUp" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 28, padding: "28px 24px", width: "100%", boxShadow: "0 24px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", background: SURFACE, borderRadius: 16, padding: 4, marginBottom: 26 }}>
          {([["login", "Giriş Yap"], ["register", "Kayıt Ol"]] as const).map(([m, l]) => (
            <button key={m} onClick={() => sw(m)} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 12, background: mode === m ? `linear-gradient(135deg,${P},${P2})` : "transparent", color: mode === m ? "white" : MUTED, fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: mode === m ? "0 4px 12px rgba(108,99,255,0.3)" : "none", transition: "all .25s", letterSpacing: .2 }}>{l}</button>
          ))}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: .8 }}>Kullanıcı Adı</label>
          <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Kullanıcı adı"
            style={{ width: "100%", padding: "14px 18px", border: `1.5px solid ${BORDER}`, borderRadius: 14, fontSize: 14, outline: "none", fontFamily: "inherit", background: SURFACE, color: TEXT, transition: "all .2s" }}
            onFocus={e => { e.target.style.borderColor = "rgba(108,99,255,0.7)"; e.target.style.boxShadow = "0 0 0 3px rgba(108,99,255,0.15)"; }}
            onBlur={e => { e.target.style.borderColor = BORDER; e.target.style.boxShadow = "none"; }} />
        </div>
        <div style={{ marginBottom: mode === "register" ? 16 : 24 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, display: "block", marginBottom: 10, textTransform: "uppercase", letterSpacing: .8 }}>PIN <span style={{ color: "rgba(255,255,255,0.2)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>(4 hane)</span></label>
          <PinBoxes value={pin} onChange={setPin} />
        </div>
        {mode === "register" && (
          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: MUTED, display: "block", marginBottom: 10, textTransform: "uppercase", letterSpacing: .8 }}>PIN Tekrar</label>
            <PinBoxes value={pin2} onChange={setPin2} />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <input type="checkbox" id="remember" checked={remember} onChange={e => setRemember(e.target.checked)}
         style={{ width: 16, height: 16, accentColor: P, cursor: "pointer" }}/>
        <label htmlFor="remember" style={{ fontSize: 13, color: MUTED, cursor: "pointer" }}>Beni hatırla</label>
      </div>
        {err && <div style={{ background: "rgba(255,101,132,0.12)", border: "1px solid rgba(255,101,132,0.3)", borderRadius: 12, padding: "11px 14px", marginBottom: 18, color: "#FF8FA5", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}><span>⚠</span>{err}</div>}
        <button onClick={submit} disabled={loading} style={{ width: "100%", background: loading ? "rgba(255,255,255,0.05)" : `linear-gradient(135deg,${P} 0%,${P2} 100%)`, border: "none", borderRadius: 16, padding: "15px 0", color: loading ? MUTED : "white", fontSize: 15, fontWeight: 700, cursor: loading ? "wait" : "pointer", boxShadow: loading ? "none" : "0 8px 24px rgba(108,99,255,0.35)", transition: "all .2s", letterSpacing: .3 }}>
          {loading ? <Spinner color={P} size={22} /> : mode === "login" ? "Giriş Yap →" : "Hesap Oluştur →"}
        </button>
        {mode === "login" && <div style={{ textAlign: "center", marginTop: 18, fontSize: 12, color: MUTED }}>Hesabın yok mu? <span style={{ color: P2, cursor: "pointer", fontWeight: 700 }} onClick={() => sw("register")}>Kayıt ol</span></div>}
      </div>
    </div>
  );
}

function CropModal({ src, onConfirm, onCancel }: { src: string; onConfirm: (c: any) => void; onCancel: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<any>(null);
  const [box, setBox] = useState({ x: 5, y: 5, w: 90, h: 90 });
  const [ready, setReady] = useState(false);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const evPct = (e: any) => {
    const r = containerRef.current!.getBoundingClientRect();
    const s = e.touches ? e.touches[0] : e;
    return { x: clamp((s.clientX - r.left) / r.width * 100, 0, 100), y: clamp((s.clientY - r.top) / r.height * 100, 0, 100) };
  };
  const onDown = (e: any, handle: string) => { e.preventDefault(); e.stopPropagation(); setDrag({ handle, start: evPct(e), box: { ...box } }); };
  const onMove = (e: any) => {
    e.preventDefault(); if (!drag) return;
    const cur = evPct(e), dx = cur.x - drag.start.x, dy = cur.y - drag.start.y, b = drag.box, MIN = 8;
    let nb = { ...b };
    if (drag.handle === "move") { nb.x = clamp(b.x + dx, 0, 100 - b.w); nb.y = clamp(b.y + dy, 0, 100 - b.h); }
    if (drag.handle.includes("l")) { nb.x = clamp(b.x + dx, 0, b.x + b.w - MIN); nb.w = b.w - (nb.x - b.x); }
    if (drag.handle.includes("r")) { nb.w = clamp(b.w + dx, MIN, 100 - b.x); }
    if (drag.handle.includes("t")) { nb.y = clamp(b.y + dy, 0, b.y + b.h - MIN); nb.h = b.h - (nb.y - b.y); }
    if (drag.handle.includes("b")) { nb.h = clamp(b.h + dy, MIN, 100 - b.y); }
    setBox(nb);
  };
  const onUp = (e: any) => { e.preventDefault(); setDrag(null); };
  const confirm = () => onConfirm({ left: Math.round(box.x), top: Math.round(box.y), right: Math.round(box.x + box.w), bottom: Math.round(box.y + box.h) });
  const handles = [{ id: "tl", x: box.x, y: box.y }, { id: "tr", x: box.x + box.w, y: box.y }, { id: "bl", x: box.x, y: box.y + box.h }, { id: "br", x: box.x + box.w, y: box.y + box.h }];
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.92)", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backdropFilter: "blur(8px)" }}>
      <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 28, overflow: "hidden", maxWidth: 400, width: "calc(100% - 32px)", boxShadow: "0 32px 80px rgba(0,0,0,0.6)" }}>
        <div style={{ padding: "16px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${BORDER}` }}>
          <div><div style={{ color: TEXT, fontSize: 16, fontWeight: 700 }}>Alan Seç</div><div style={{ color: MUTED, fontSize: 12, marginTop: 2 }}>Köşelerden sürükleyerek ayarla</div></div>
          <button onClick={onCancel} style={{ background: "rgba(255,255,255,0.08)", border: `1px solid ${BORDER}`, borderRadius: 12, width: 34, height: 34, color: TEXT, cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>
        <div style={{ background: "#000", display: "flex", justifyContent: "center", alignItems: "center", minHeight: 180, position: "relative" }}>
          {!ready && <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><Spinner color={P} size={36} /></div>}
          <div ref={containerRef} style={{ position: "relative", display: "inline-block", lineHeight: 0, userSelect: "none", touchAction: "none", opacity: ready ? 1 : 0, transition: "opacity .2s" }}
            onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onTouchMove={onMove} onTouchEnd={onUp}>
            <img src={src} alt="" onLoad={() => setReady(true)} onError={() => setReady(true)} style={{ display: "block", maxWidth: "100%", maxHeight: "52vh", width: "auto", height: "auto", pointerEvents: "none" }} />
            {ready && <>
              {[{ left: 0, top: 0, width: `${box.x}%`, height: "100%" }, { left: `${box.x + box.w}%`, top: 0, width: `${100 - box.x - box.w}%`, height: "100%" }, { left: `${box.x}%`, top: 0, width: `${box.w}%`, height: `${box.y}%` }, { left: `${box.x}%`, top: `${box.y + box.h}%`, width: `${box.w}%`, height: `${100 - box.y - box.h}%` }].map((s, i) => (
                <div key={i} style={{ position: "absolute", background: "rgba(0,0,0,0.65)", pointerEvents: "none", ...s }} />
              ))}
              <div onMouseDown={e => onDown(e, "move")} onTouchStart={e => onDown(e, "move")} style={{ position: "absolute", left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`, border: `2px solid ${P}`, cursor: "move", boxSizing: "border-box", boxShadow: `0 0 0 1px rgba(108,99,255,0.3)` }}>
                {[1 / 3, 2 / 3].flatMap(f => [
                  <div key={`v${f}`} style={{ position: "absolute", left: `${f * 100}%`, top: 0, bottom: 0, width: 1, background: "rgba(108,99,255,0.3)", pointerEvents: "none" }} />,
                  <div key={`h${f}`} style={{ position: "absolute", top: `${f * 100}%`, left: 0, right: 0, height: 1, background: "rgba(108,99,255,0.3)", pointerEvents: "none" }} />,
                ])}
              </div>
              {handles.map(h => (
                <div key={h.id} onMouseDown={e => onDown(e, h.id)} onTouchStart={e => onDown(e, h.id)} style={{ position: "absolute", left: `${h.x}%`, top: `${h.y}%`, width: 18, height: 18, background: P, border: "2px solid white", borderRadius: 5, transform: "translate(-50%,-50%)", cursor: "pointer", zIndex: 2, boxShadow: "0 2px 8px rgba(108,99,255,0.5)" }} />
              ))}
            </>}
          </div>
        </div>
        <div style={{ padding: "14px 16px", display: "flex", gap: 10, borderTop: `1px solid ${BORDER}` }}>
          <button onClick={onCancel} style={{ flex: 1, background: "rgba(255,255,255,0.06)", border: `1px solid ${BORDER}`, borderRadius: 14, padding: 14, color: MUTED, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>İptal</button>
          <button onClick={confirm} style={{ flex: 2, background: `linear-gradient(135deg,${P},${P2})`, border: "none", borderRadius: 14, padding: 14, color: "white", fontSize: 14, fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 16px rgba(108,99,255,0.3)" }}>Seç & Analiz Et</button>
        </div>
      </div>
    </div>
  );
}

function ImagePreview({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.96)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, backdropFilter: "blur(12px)" }}>
      <button onClick={onClose} style={{ position: "absolute", top: 18, right: 18, background: "rgba(255,255,255,0.1)", border: `1px solid ${BORDER}`, borderRadius: 12, width: 38, height: 38, color: TEXT, fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
      <img src={url} alt="" onClick={e => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "88vh", borderRadius: 20, objectFit: "contain" }} />
    </div>
  );
}

function QuestionDetail({ q, onClose }: { q: any; onClose: () => void }) {
  const a = q.analysis;
  const [showAnswer, setShowAnswer] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center", backdropFilter: "blur(8px)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: "28px 28px 0 0", width: "100%", maxWidth: 420, maxHeight: "90vh", overflowY: "auto", paddingBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "14px 0 6px" }}><div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.15)", borderRadius: 2 }} /></div>
        {q.url && <div style={{ margin: "8px 16px 0", borderRadius: 18, overflow: "hidden", background: "#000", display: "flex", justifyContent: "center" }}><img src={q.url} alt="" style={{ maxWidth: "100%", maxHeight: 260, objectFit: "contain" }} /></div>}
        <div style={{ display: "flex", gap: 8, padding: "14px 16px 0", flexWrap: "wrap", alignItems: "center" }}>
          <Chip label={a.subject} style={{ background: subS(a.subject).bg, color: subS(a.subject).tx }} />
          <Chip label={a.difficulty} style={{ background: difS(a.difficulty).bg, color: difS(a.difficulty).tx }} />
          <span style={{ fontSize: 11, color: MUTED, marginLeft: "auto" }}>{q.time}</span>
        </div>
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: TEXT }}>{a.topic}</div>
          <div style={{ fontSize: 14, color: P2, fontWeight: 600, marginTop: 4 }}>{a.subtopic}</div>
        </div>
        <div style={{ margin: "12px 16px 0", padding: "14px 16px", background: SURFACE, borderRadius: 16, border: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: .8 }}>Soru</div>
          {a.question && (
          <div style={{ margin: "12px 16px 0", padding: "14px 16px", background: SURFACE, borderRadius: 16, border: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: .8 }}>Soru Metni</div>
          <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7 }}>{a.question}</div>
  </div>
)}
<div style={{ margin: "10px 16px 0", padding: "14px 16px", background: SURFACE, borderRadius: 16, border: `1px solid ${BORDER}` }}>
  <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, marginBottom: 6, textTransform: "uppercase", letterSpacing: .8 }}>Özet</div>
  <div style={{ fontSize: 14, color: TEXT, lineHeight: 1.7 }}>{a.summary}</div>
</div>
        </div>
        <div style={{ margin: "10px 16px 0", padding: "14px 16px", background: "rgba(108,99,255,0.1)", borderRadius: 16, borderLeft: `3px solid ${P}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: P2, marginBottom: 6, textTransform: "uppercase", letterSpacing: .8 }}>Nasıl Çalışmalısın?</div>
          <div style={{ fontSize: 14, color: "#C4B5FD", lineHeight: 1.7 }}>{a.advice}</div>
</div>
<button onClick={() => setShowAnswer(!showAnswer)}
  style={{ display: "block", margin: "10px 16px 0", width: "calc(100% - 32px)", background: showAnswer ? "rgba(255,101,132,0.1)" : "rgba(52,211,153,0.1)", border: `1px solid ${showAnswer ? "rgba(255,101,132,0.3)" : "rgba(52,211,153,0.3)"}`, borderRadius: 16, padding: 14, color: showAnswer ? "#FF8FA5" : "#4EEDB3", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
  {showAnswer ? "Cevabı Gizle" : "Cevabı Gör"}
</button>
{showAnswer && a.answer && (
  <div style={{ margin: "10px 16px 0", padding: "14px 16px", background: "rgba(52,211,153,0.08)", borderRadius: 16, borderLeft: "3px solid #34D399" }}>
    <div style={{ fontSize: 11, fontWeight: 700, color: "#4EEDB3", marginBottom: 6, textTransform: "uppercase", letterSpacing: .8 }}>Çözüm & Cevap</div>
    <div style={{ fontSize: 14, color: "#4EEDB3", lineHeight: 1.7 }}>{a.answer}</div>
  </div>
)}
        <button onClick={onClose} style={{ display: "block", margin: "16px 16px 0", width: "calc(100% - 32px)", background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`, borderRadius: 16, padding: 14, color: TEXT, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Kapat</button>
      </div>
    </div>
  );
}

// ── Ana bileşen ────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  useEffect(() => {
  const saved = localStorage.getItem("sl_user");
  if (saved) handleAuth(saved);
}, []);
  const [dataLoading, setDataLoading] = useState(false);
  const [qs, setQs] = useState<any[]>([]);
  const [tab, setTab] = useState("home");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [report, setReport] = useState<any>(null);
  const [test, setTest] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [genRep, setGenRep] = useState(false);
  const [genTest, setGenTest] = useState(false);
  const [repErr, setRepErr] = useState("");
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [detailQ, setDetailQ] = useState<any>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingDataUrl = useRef<string | null>(null);

  const total = qs.length;
  const inCycle = total % CYCLE;
  const pct = Math.round(((inCycle === 0 && total > 0 ? CYCLE : inCycle) / CYCLE) * 100);
  const canAct = total >= MIN_ACTION;

  const loadUserData = async (u: string) => {
    setDataLoading(true);
    try {
      const metaRes = await sGet(`qmeta:${u}`);
      if (metaRes) {
        const meta = JSON.parse(metaRes.value);
        const loaded = await Promise.all(meta.map(async (m: any) => {
          const imgRes = await sGet(`qimg:${u}:${m.id}`);
          return { ...m, url: imgRes?.value || "" };
        }));
        setQs(loaded);
      }
      const repRes = await sGet(`report:${u}`);
      if (repRes) setReport(JSON.parse(repRes.value));
    } catch (e) { console.error(e); }
    setDataLoading(false);
  };

  const handleAuth = async (u: string) => { setCurrentUser(u); setQs([]); setReport(null); setTest(null); setTab("home"); await loadUserData(u); };
const logout = () => { localStorage.removeItem("sl_user"); setCurrentUser(null); setQs([]); setReport(null); setTest(null); setAnswers({}); setSubmitted(false); setTab("home"); };   const saveQs = async (u: string, list: any[]) => { await sSet(`qmeta:${u}`, JSON.stringify(list.map(({ url, ...r }) => r))); };
const deleteSelected = async () => {
  if (!currentUser || selected.size === 0) return;
  const toDelete = qs.filter(q => selected.has(q.id));
  const updated = qs.filter(q => !selected.has(q.id));
  setQs(updated);
  await saveQs(currentUser, updated);
  for (const q of toDelete) {
    try { await fetch(`/api/storage?key=${encodeURIComponent(`qimg:${currentUser}:${q.id}`)}`, { method: "DELETE" }); } catch {}
  }
  setSelected(new Set());
  setSelectMode(false);
};

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (fileRef.current) fileRef.current.value = "";
    try { const dataUrl = await readAsDataURL(file); pendingDataUrl.current = dataUrl; setCropSrc(dataUrl); }
    catch (ex: any) { setErr("Dosya okunamadı: " + ex.message); }
  };

async function cropImage(dataUrl: string, cropPct: { left: number; top: number; right: number; bottom: number }): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const x = Math.round(img.width * cropPct.left / 100);
      const y = Math.round(img.height * cropPct.top / 100);
      const w = Math.round(img.width * (cropPct.right - cropPct.left) / 100);
      const h = Math.round(img.height * (cropPct.bottom - cropPct.top) / 100);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.src = dataUrl;
  });
}

const analyzeImage = async (cropPct: any) => {
    setCropSrc(null);
    const srcDataUrl = pendingDataUrl.current; if (!srcDataUrl) { setErr("Dosya bulunamadı"); return; }
    setLoading(true); setErr("");
    let raw = "";
    try {
      const croppedDataUrl = cropPct ? await cropImage(srcDataUrl, cropPct) : srcDataUrl;
      const compressed = await compressDataUrl(croppedDataUrl);
      let sendB64: string, thumbnail: string;
      if (compressed) { sendB64 = compressed.b64; thumbnail = compressed.dataUrl; }
      else { sendB64 = croppedDataUrl.split(",")[1] || ""; thumbnail = croppedDataUrl; if (sendB64.length > 4_800_000) { setErr("Fotoğraf çok büyük."); setLoading(false); return; } }
raw = await callClaude([{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: sendB64 } }, { type: "text", text: `Analyze ALL educational questions visible in this image. Return ONLY valid JSON, start with { end with }, no backticks: {"questions":[{"subject":"Matematik","topic":"topic in Turkish","subtopic":"subtopic in Turkish","difficulty":"Kolay or Orta or Zor","question":"full question text in Turkish","summary":"one sentence in Turkish","answer":"step by step detailed solution in Turkish","advice":"one sentence in Turkish","bbox":{"top":0,"left":0,"bottom":50,"right":50}}]}` }] }], 8000);      const parsed = extractJson(raw);
      const analyses = (parsed.questions || [parsed]).filter((a: any) => a?.topic);
      if (!analyses.length) throw new Error("Soru tespit edilemedi");
      const time = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
const newQs = await Promise.all(analyses.map(async (a: any, i: number) => {
  let qUrl = thumbnail;
  if (a.bbox) {
    try { 
      qUrl = await cropImage(croppedDataUrl, { 
        top: a.bbox.top, 
        left: a.bbox.left, 
        bottom: a.bbox.bottom, 
        right: a.bbox.right 
      }); 
    } catch(err) { 
      console.error("bbox crop hatası:", err); 
    }
  }
  return { id: Date.now() + i, url: qUrl, analysis: a, time };
}));
      const updated = [...qs, ...newQs]; setQs(updated);
if (currentUser) { for (const q of newQs) await sSet(`qimg:${currentUser}:${q.id}`, q.url || ""); await saveQs(currentUser, updated); }
      if (updated.length % CYCLE === 0) buildReport(updated.slice(-CYCLE), true);
} catch (e: any) { setErr("Hata: " + (e.message || String(e))); }
    setLoading(false);
  };

  const buildReport = async (data: any[], autoSwitch = false) => {
    setGenRep(true); setRepErr("");
    try {
      if (!data || data.length === 0) throw new Error("Analiz edilecek soru bulunamadı.");
      const list = data.map((q, i) => `${i + 1}. ${q.analysis.subject} - ${q.analysis.topic} - ${q.analysis.subtopic} (${q.analysis.difficulty})`).join("\n");
      const raw = await callClaude([{ role: "user", content: `Student weak areas:\n${list}\n\nReturn ONLY a raw JSON object, no markdown, no backticks:\n{"groups":[{"subject":"...","topic":"...","count":1,"subtopics":[]}],"weak":["..."],"plan":["..."],"advice":"..."}` }], 800);
      const rep = extractJson(raw); if (!rep || !rep.groups) throw new Error("Geçersiz rapor formatı.");
      setReport(rep); if (currentUser) await sSet(`report:${currentUser}`, JSON.stringify(rep));
      if (autoSwitch) setTab("rapor");
    } catch (e: any) { setRepErr("Rapor oluşturulamadı: " + (e.message || String(e))); if (autoSwitch) setTab("rapor"); }
    setGenRep(false);
  };

const buildTest = async () => {
    const data = qs.slice(-Math.min(total, CYCLE));
    setGenTest(true); setAnswers({}); setSubmitted(false);
    try {
      const list = data.map((q, i) => `${i + 1}. ${q.analysis.subject} - ${q.analysis.topic} - ${q.analysis.subtopic}`).join("\n");
      const raw = await callClaude([{ role: "user", content: `Student weak topics:\n${list}\n\nCreate 5 multiple-choice questions in Turkish. Return ONLY valid JSON, no markdown, no backticks, no extra text before or after. The response must start with { and end with }:\n{"qs":[{"subject":"string","topic":"string","q":"question text","opts":{"A":"option","B":"option","C":"option","D":"option"},"ans":"A","exp":"explanation"}]}` }], 3000);      
      console.log("RAW:", raw.slice(0, 500));
      const parsed = extractJson(raw);
      if (!parsed || !parsed.qs?.length) throw new Error("Geçersiz test formatı: " + raw.slice(0, 100));
      setTest(parsed); setTab("test");
    } catch (e: any) {
      alert("Test hatası: " + (e.message || String(e)));
      console.error(e);
    }
    setGenTest(false);
  };
  const score = submitted && test ? test.qs.filter((q: any, i: number) => answers[i] === q.ans).length : 0;

  if (!currentUser) return <AuthScreen onAuth={handleAuth} />;
  if (dataLoading) return (
    <div style={{ maxWidth: 420, margin: "0 auto", minHeight: "100vh", background: DARK, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>
      <style>{css}</style>
      <Spinner size={42} /><div style={{ color: MUTED, fontSize: 15, fontWeight: 600, marginTop: 18 }}>Yükleniyor...</div>
    </div>
  );

  const QCard = ({ q, small }: { q: any; small?: boolean }) => (
    <div onClick={() => setDetailQ(q)} className="card-hover" style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: small ? 16 : 18, padding: small ? 12 : 14, marginBottom: small ? 10 : 12, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.25)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {q.url && <img src={q.url} alt="" onClick={(e) => { e.stopPropagation(); setPreviewImg(q.url); }} style={{ width: small ? 52 : 64, height: small ? 52 : 64, borderRadius: small ? 12 : 14, objectFit: "cover", flexShrink: 0, cursor: "zoom-in", border: `1px solid ${BORDER}` }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap", alignItems: "center" }}>
            <Chip label={q.analysis.subject} style={{ background: subS(q.analysis.subject).bg, color: subS(q.analysis.subject).tx }} />
            <Chip label={q.analysis.difficulty} style={{ background: difS(q.analysis.difficulty).bg, color: difS(q.analysis.difficulty).tx }} />
            <span style={{ fontSize: 11, color: MUTED, marginLeft: "auto" }}>{q.time}</span>
          </div>
          <div style={{ fontSize: small ? 13 : 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.analysis.topic}</div>
          <div style={{ fontSize: 12, color: P2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{q.analysis.subtopic}</div>
          {!small && <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.5 }}>{q.analysis.summary}</div>}
        </div>
      </div>
    </div>
  );

  const NAV_ITEMS = [
    { id: "home", label: "Ana Sayfa", icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><polyline points="9 22 9 12 15 12 15 22" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg> },
    { id: "sorular", label: "Sorularım", badge: total > 0 ? total : null, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" /><path d="M7 8h10M7 12h7M7 16h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg> },
    { id: "rapor", label: "Rapor", dot: !!report, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg> },
    { id: "test", label: "Test", dot: !!test, icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M9 11l3 3L22 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> },
  ];

  return (
    <div style={{ maxWidth: 420, margin: "0 auto", minHeight: "100vh", background: DARK, display: "flex", flexDirection: "column", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", color: TEXT }}>
      <style>{css}</style>
      {detailQ && <QuestionDetail q={detailQ} onClose={() => setDetailQ(null)} />}
      {previewImg && <ImagePreview url={previewImg} onClose={() => setPreviewImg(null)} />}
      {cropSrc && <CropModal src={cropSrc} onConfirm={analyzeImage} onCancel={() => { setCropSrc(null); pendingDataUrl.current = null; }} />}

      {/* Header */}
      <div style={{ background: CARD, borderBottom: `1px solid ${BORDER}`, padding: "14px 20px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, background: `linear-gradient(135deg,${P},${ACCENT})`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 12px rgba(108,99,255,0.35)`, flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="15" rx="2" stroke="white" strokeWidth="1.6" /><circle cx="12" cy="13.5" r="3.5" stroke="white" strokeWidth="1.6" /></svg>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: TEXT, letterSpacing: -.5 }}>StudyLens</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
                <div style={{ width: 6, height: 6, background: "#4ADE80", borderRadius: "50%", boxShadow: "0 0 6px rgba(74,222,128,0.8)" }} />
                <div style={{ color: MUTED, fontSize: 11, fontWeight: 600 }}>{currentUser}</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "8px 16px", textAlign: "center" }}>
              <div style={{ color: TEXT, fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{total}</div>
              <div style={{ color: MUTED, fontSize: 10, marginTop: 2, fontWeight: 600 }}>SORU</div>
            </div>
            <button onClick={logout} style={{ background: "rgba(255,101,132,0.1)", border: "1px solid rgba(255,101,132,0.2)", borderRadius: 12, width: 38, height: 38, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="#FF8FA5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>

        {/* HOME */}
        {tab === "home" && (
          <div style={{ padding: 16 }}>
            <GlassCard style={{ padding: 18, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: .8 }}>Döngü İlerlemesi</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: P2 }}>{inCycle === 0 && total > 0 ? CYCLE : inCycle} / {CYCLE}</span>
              </div>
              <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, height: 8, overflow: "hidden" }}>
                <div style={{ background: `linear-gradient(90deg,${P},${P2})`, height: "100%", width: `${pct}%`, borderRadius: 8, transition: "width 0.6s ease", boxShadow: `0 0 8px rgba(108,99,255,0.4)` }} />
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 8 }}>{inCycle === 0 && total > 0 ? "✨ Bu döngü tamamlandı!" : `${CYCLE - (inCycle === 0 && total > 0 ? CYCLE : inCycle)} soru sonra rapor & test hazırlanır`}</div>
            </GlassCard>

            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} id="fu" />
            <label htmlFor="fu" style={{ cursor: loading ? "wait" : "pointer", display: "block" }}>
              <div style={{ background: loading ? SURFACE : `linear-gradient(135deg,${P} 0%,${ACCENT} 100%)`, borderRadius: 24, padding: "32px 20px", textAlign: "center", marginBottom: 14, boxShadow: loading ? "none" : `0 8px 28px rgba(108,99,255,0.35)`, transition: "all .2s", border: loading ? `1px dashed rgba(255,255,255,0.15)` : "none" }}>
                {loading ? <><Spinner size={40} /><div style={{ color: P2, fontSize: 16, fontWeight: 700, marginTop: 14, letterSpacing: -.3 }}>Analiz ediliyor...</div></> : <>
                  <div style={{ width: 56, height: 56, background: "rgba(255,255,255,0.2)", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"><rect x="2" y="6" width="20" height="15" rx="2" stroke="white" strokeWidth="1.6" /><circle cx="12" cy="13.5" r="3.5" stroke="white" strokeWidth="1.6" /><path d="M9 6L10.5 3.5H13.5L15 6" stroke="white" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="18.5" cy="9.5" r="1" fill="white" /></svg>
                  </div>
                  <div style={{ color: "white", fontSize: 20, fontWeight: 800, letterSpacing: -.5 }}>Fotoğraf Yükle</div>
                  <div style={{ color: "rgba(255,255,255,.75)", fontSize: 13, marginTop: 5 }}>Yükle → Alan seç → Analiz et</div>
                </>}
              </div>
            </label>

            {err && <div style={{ background: "rgba(255,101,132,0.1)", border: "1px solid rgba(255,101,132,0.25)", borderRadius: 14, padding: "12px 16px", marginBottom: 14, color: "#FF8FA5", fontSize: 12, display: "flex", gap: 8 }}><span>⚠</span><span style={{ wordBreak: "break-all" }}>{err}</span></div>}

            {canAct && (
              <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
                <button onClick={() => report ? setTab("rapor") : buildReport(qs.slice(-Math.min(total, CYCLE)), true)} disabled={genRep} style={{ flex: 1, background: genRep ? SURFACE : "rgba(108,99,255,0.12)", border: `1px solid ${genRep ? BORDER : "rgba(108,99,255,0.3)"}`, borderRadius: 16, padding: 14, color: genRep ? MUTED : P2, fontSize: 13, fontWeight: 700, cursor: genRep ? "wait" : "pointer" }}>
                  {genRep ? "Hazırlanıyor..." : "📊 Rapor"}
                </button>
                <button onClick={buildTest} disabled={genTest} style={{ flex: 1, background: genTest ? SURFACE : "rgba(255,101,132,0.12)", border: `1px solid ${genTest ? BORDER : "rgba(255,101,132,0.3)"}`, borderRadius: 16, padding: 14, color: genTest ? MUTED : "#FF8FA5", fontSize: 13, fontWeight: 700, cursor: genTest ? "wait" : "pointer" }}>
                  {genTest ? "Hazırlanıyor..." : "✏️ Test Çöz"}
                </button>
              </div>
            )}

            {total > 0 && <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: .8 }}>Son Eklenenler</div>
                {total > 5 && <button onClick={() => setTab("sorular")} style={{ fontSize: 12, color: P2, fontWeight: 700, background: "none", border: "none", cursor: "pointer" }}>Tümü ({total}) →</button>}
              </div>
              {[...qs].reverse().slice(0, 5).map(q => <QCard key={q.id} q={q} small />)}
            </>}

            {total === 0 && !loading && (
              <div style={{ textAlign: "center", padding: "56px 24px" }}>
                <div style={{ width: 72, height: 72, background: SURFACE, borderRadius: 24, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", border: `1px solid ${BORDER}` }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" /><path d="M7 8h10M7 12h7M7 16h5" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2" strokeLinecap="round" /></svg>
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, color: MUTED, marginBottom: 8 }}>Henüz soru eklenmedi</div>
                <div style={{ fontSize: 13, color: "rgba(255,255,255,0.25)", lineHeight: 1.6 }}>Fotoğraf yükle → Alan seç → AI analiz etsin.</div>
              </div>
            )}
          </div>
        )}

        {/* SORULAR */}
{tab === "sorular" && (
  <div style={{ padding: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: .8 }}>{total} soru kaydedildi</div>
      {total > 0 && (
        <button onClick={() => { setSelectMode(!selectMode); setSelected(new Set()); }}
          style={{ background: selectMode ? "rgba(255,101,132,0.1)" : "rgba(108,99,255,0.1)", border: `1px solid ${selectMode ? "rgba(255,101,132,0.3)" : "rgba(108,99,255,0.3)"}`, borderRadius: 10, padding: "6px 14px", color: selectMode ? "#FF8FA5" : P2, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
{selectMode
  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/></svg>
  : <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
}        </button>
      )}
    </div>

    {selectMode && selected.size > 0 && (
      <button onClick={deleteSelected}
        style={{ width: "100%", background: "rgba(255,101,132,0.12)", border: "1px solid rgba(255,101,132,0.3)", borderRadius: 14, padding: 14, color: "#FF8FA5", fontSize: 14, fontWeight: 700, cursor: "pointer", marginBottom: 14 }}>
        🗑 {selected.size} soruyu sil
      </button>
    )}

    {total === 0
      ? <div style={{ textAlign: "center", padding: 48, color: MUTED, fontSize: 14 }}>Henüz soru yok</div>
      : [...qs].reverse().map(q => (
        <div key={q.id} onClick={() => {
          if (selectMode) {
            const s = new Set(selected);
            s.has(q.id) ? s.delete(q.id) : s.add(q.id);
            setSelected(s);
          } else {
            setDetailQ(q);
          }
        }} className="card-hover"
          style={{ background: selected.has(q.id) ? "rgba(255,101,132,0.1)" : CARD, border: `1px solid ${selected.has(q.id) ? "rgba(255,101,132,0.4)" : BORDER}`, borderRadius: 18, padding: 14, marginBottom: 12, cursor: "pointer", boxShadow: "0 4px 16px rgba(0,0,0,0.25)", display: "flex", gap: 12, alignItems: "center" }}>
          {selectMode && (
            <div style={{ width: 22, height: 22, borderRadius: 8, border: `2px solid ${selected.has(q.id) ? "#FF8FA5" : BORDER}`, background: selected.has(q.id) ? "rgba(255,101,132,0.2)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {selected.has(q.id) && <span style={{ color: "#FF8FA5", fontSize: 13, fontWeight: 800 }}>✓</span>}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 12, alignItems: "center" }}>
            {q.url && <img src={q.url} alt="" style={{ width: 64, height: 64, borderRadius: 14, objectFit: "cover", flexShrink: 0, border: `1px solid ${BORDER}` }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                <Chip label={q.analysis.subject} style={{ background: subS(q.analysis.subject).bg, color: subS(q.analysis.subject).tx }} />
                <Chip label={q.analysis.difficulty} style={{ background: difS(q.analysis.difficulty).bg, color: difS(q.analysis.difficulty).tx }} />
                <span style={{ fontSize: 11, color: MUTED, marginLeft: "auto" }}>{q.time}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.analysis.topic}</div>
              <div style={{ fontSize: 12, color: P2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600 }}>{q.analysis.subtopic}</div>
            </div>
          </div>
        </div>
      ))
    }
  </div>
)}

        {/* RAPOR */}
        {tab === "rapor" && (
          <div style={{ padding: 16 }}>
            {genRep ? <div style={{ textAlign: "center", padding: 60 }}><Spinner size={40} /><div style={{ color: MUTED, fontSize: 14, marginTop: 16 }}>Rapor hazırlanıyor...</div></div>
              : repErr ? <div style={{ padding: "24px 0" }}>
                <div style={{ background: "rgba(255,101,132,0.1)", border: "1px solid rgba(255,101,132,0.25)", borderRadius: 16, padding: "14px 16px", marginBottom: 16, color: "#FF8FA5", fontSize: 13 }}>{repErr}</div>
                {canAct && <button onClick={() => buildReport(qs.slice(-Math.min(total, CYCLE)), false)} style={{ width: "100%", background: `linear-gradient(135deg,${P},${P2})`, color: "white", border: "none", borderRadius: 14, padding: "14px 0", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Tekrar Dene</button>}
              </div>
              : !report ? <div style={{ textAlign: "center", padding: "56px 24px" }}>
                <div style={{ fontSize: 14, color: MUTED, marginBottom: 20 }}>Henüz rapor yok.</div>
                {canAct && <button onClick={() => buildReport(qs.slice(-Math.min(total, CYCLE)), false)} style={{ background: `linear-gradient(135deg,${P},${P2})`, color: "white", border: "none", borderRadius: 14, padding: "13px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Rapor Oluştur</button>}
              </div>
              : <>
                <GlassCard style={{ padding: 20, marginBottom: 14, background: `linear-gradient(135deg,rgba(108,99,255,0.2),rgba(255,101,132,0.1))`, border: `1px solid rgba(108,99,255,0.2)` }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>Döngü Raporu</div>
                  <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>Son {Math.min(total, CYCLE)} sorunun analizi</div>
                </GlassCard>
                <GlassCard style={{ padding: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 14, textTransform: "uppercase", letterSpacing: .8 }}>Konu Dağılımı</div>
                  {(report.groups || []).map((g: any, i: number) => (
                    <div key={i} style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <Chip label={g.subject} style={{ background: subS(g.subject).bg, color: subS(g.subject).tx }} />
                          <span style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>{g.topic}</span>
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 800, color: P2 }}>{g.count}</span>
                      </div>
                      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6, height: 6, overflow: "hidden" }}>
                        <div style={{ background: `linear-gradient(90deg,${P},${P2})`, height: "100%", width: `${Math.min((g.count / Math.min(total, CYCLE)) * 100, 100)}%`, borderRadius: 6 }} />
                      </div>
                      {(g.subtopics || []).length > 0 && <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>{g.subtopics.join(" · ")}</div>}
                    </div>
                  ))}
                </GlassCard>
                <GlassCard style={{ padding: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 12, textTransform: "uppercase", letterSpacing: .8 }}>Zayıf Noktalar</div>
                  {(report.weak || []).map((w: string, i: number) => <div key={i} style={{ padding: "10px 14px", background: "rgba(255,101,132,0.08)", borderRadius: 12, marginBottom: 8, borderLeft: "3px solid #FF6584", fontSize: 13, color: "#FF8FA5", fontWeight: 500 }}>{w}</div>)}
                </GlassCard>
                <GlassCard style={{ padding: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 12, textTransform: "uppercase", letterSpacing: .8 }}>Çalışma Planı</div>
                  {(report.plan || []).map((p: string, i: number) => <div key={i} style={{ padding: "10px 14px", background: "rgba(52,211,153,0.08)", borderRadius: 12, marginBottom: 8, borderLeft: "3px solid #34D399", fontSize: 13, color: "#4EEDB3", lineHeight: 1.6 }}>{p}</div>)}
                </GlassCard>
                {report.advice && <div style={{ background: "rgba(108,99,255,0.1)", borderRadius: 16, padding: 16, marginBottom: 16, borderLeft: `3px solid ${P}`, fontSize: 13, color: "#C4B5FD", lineHeight: 1.7 }}>{report.advice}</div>}
                <button onClick={buildTest} disabled={genTest} style={{ width: "100%", background: genTest ? SURFACE : "rgba(255,101,132,0.12)", border: `1px solid ${genTest ? BORDER : "rgba(255,101,132,0.3)"}`, borderRadius: 16, padding: 16, color: genTest ? MUTED : "#FF8FA5", fontSize: 15, fontWeight: 700, cursor: genTest ? "wait" : "pointer" }}>
                  {genTest ? "Hazırlanıyor..." : "✏️ Test Başlat"}
                </button>
              </>}
          </div>
        )}

        {/* TEST */}
        {tab === "test" && (
          <div style={{ padding: 16 }}>
            {genTest ? <div style={{ textAlign: "center", padding: 60 }}><Spinner color={ACCENT} size={40} /><div style={{ color: MUTED, fontSize: 14, marginTop: 16 }}>Test hazırlanıyor...</div></div>
              : !test ? <div style={{ textAlign: "center", padding: "56px 24px" }}>
                <div style={{ fontSize: 14, color: MUTED, marginBottom: 20 }}>Henüz test yok.</div>
                {canAct && <button onClick={buildTest} style={{ background: "rgba(255,101,132,0.12)", border: "1px solid rgba(255,101,132,0.3)", color: "#FF8FA5", borderRadius: 14, padding: "13px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Test Oluştur</button>}
              </div>
              : !submitted ? <>
                <GlassCard style={{ padding: "18px 20px", marginBottom: 14, background: "rgba(255,101,132,0.1)", border: "1px solid rgba(255,101,132,0.2)" }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: TEXT }}>Tekrar Testi</div>
                  <div style={{ fontSize: 13, color: MUTED, marginTop: 3 }}>{test.qs?.length} soru</div>
                </GlassCard>
                {(test.qs || []).map((q: any, qi: number) => (
                  <GlassCard key={qi} style={{ padding: 16, marginBottom: 12 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
                      <span style={{ background: `linear-gradient(135deg,${P},${P2})`, color: "white", borderRadius: 10, width: 26, height: 26, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{qi + 1}</span>
                      <Chip label={q.subject} style={{ background: subS(q.subject).bg, color: subS(q.subject).tx }} />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, lineHeight: 1.7, marginBottom: 14 }}>{q.q}</div>
                    {Object.entries(q.opts || {}).map(([k, v]: any) => {
                      const sel = answers[qi] === k;
                      return <div key={k} onClick={() => setAnswers(a => ({ ...a, [qi]: k }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderRadius: 14, marginBottom: 8, cursor: "pointer", border: `1px solid ${sel ? "rgba(108,99,255,0.5)" : BORDER}`, background: sel ? "rgba(108,99,255,0.12)" : SURFACE, transition: "all .15s" }}>
                        <span style={{ width: 26, height: 26, borderRadius: 10, border: `1.5px solid ${sel ? P : BORDER}`, background: sel ? P : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: sel ? "white" : MUTED, flexShrink: 0 }}>{k}</span>
                        <span style={{ fontSize: 13, color: sel ? TEXT : MUTED, fontWeight: sel ? 600 : 400 }}>{v}</span>
                      </div>;
                    })}
                  </GlassCard>
                ))}
                <button onClick={() => setSubmitted(true)} disabled={Object.keys(answers).length < (test.qs || []).length}
                  style={{ width: "100%", background: Object.keys(answers).length < (test.qs || []).length ? SURFACE : `linear-gradient(135deg,${P},${P2})`, color: Object.keys(answers).length < (test.qs || []).length ? MUTED : "white", border: "none", borderRadius: 16, padding: 16, fontSize: 15, fontWeight: 700, cursor: "pointer", transition: "all .2s" }}>
                  Testi Bitir ({Object.keys(answers).length}/{(test.qs || []).length})
                </button>
              </> : <>
                <GlassCard style={{ padding: "28px 20px", marginBottom: 16, textAlign: "center", background: `linear-gradient(135deg,rgba(108,99,255,0.15),rgba(255,101,132,0.1))`, border: `1px solid rgba(108,99,255,0.2)` }}>
                  <div style={{ fontSize: 52, fontWeight: 900, letterSpacing: -2, color: TEXT, lineHeight: 1 }}>{score}<span style={{ fontSize: 28, opacity: .5 }}>/{test.qs.length}</span></div>
                  <div style={{ fontSize: 15, color: MUTED, marginTop: 8, fontWeight: 600 }}>{score === test.qs.length ? "🎉 Mükemmel!" : score >= Math.ceil(test.qs.length / 2) ? "👍 İyi iş!" : "📚 Daha fazla çalış."}</div>
                </GlassCard>
                {(test.qs || []).map((q: any, qi: number) => {
                  const ok = answers[qi] === q.ans;
                  return <GlassCard key={qi} style={{ padding: 14, marginBottom: 12, borderLeft: `3px solid ${ok ? "#34D399" : ACCENT}` }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 10, lineHeight: 1.6 }}>{q.q}</div>
                    <div style={{ fontSize: 12, color: "#4EEDB3", fontWeight: 700 }}>✓ {q.ans}. {q.opts?.[q.ans]}</div>
                    {!ok && <div style={{ fontSize: 12, color: "#FF8FA5", marginTop: 4 }}>✗ Cevabın: {answers[qi]}. {q.opts?.[answers[qi]]}</div>}
                    <div style={{ fontSize: 12, color: "#C4B5FD", background: "rgba(108,99,255,0.1)", borderRadius: 10, padding: "9px 12px", marginTop: 10, lineHeight: 1.6 }}>{q.exp}</div>
                  </GlassCard>;
                })}
                <button onClick={() => { setTest(null); setAnswers({}); setSubmitted(false); setTab("home"); }} style={{ width: "100%", background: "rgba(255,255,255,0.05)", border: `1px solid ${BORDER}`, borderRadius: 16, padding: 14, color: TEXT, fontSize: 15, fontWeight: 700, cursor: "pointer" }}>Ana Sayfaya Dön</button>
              </>}
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 420, background: "rgba(26,25,41,0.97)", backdropFilter: "blur(24px)", borderTop: `1px solid ${BORDER}`, display: "flex", zIndex: 20, paddingBottom: "env(safe-area-inset-bottom)" }}>
        {NAV_ITEMS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: "10px 4px 12px", border: "none", background: "transparent", cursor: "pointer", position: "relative", color: tab === t.id ? P2 : MUTED, transition: "color .2s" }}>
            {tab === t.id && <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 32, height: 2, background: `linear-gradient(90deg,${P},${P2})`, borderRadius: "0 0 4px 4px" }} />}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{t.icon}</div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: .3 }}>{t.label}</div>
            {t.badge && <span style={{ position: "absolute", top: 6, right: "12%", background: ACCENT, color: "white", fontSize: 9, fontWeight: 800, borderRadius: 10, padding: "1px 5px", minWidth: 16, textAlign: "center" }}>{t.badge}</span>}
            {t.dot && !t.badge && <span style={{ position: "absolute", top: 8, right: "20%", width: 7, height: 7, background: "#4ADE80", borderRadius: "50%", border: `1.5px solid ${CARD}` }} />}
          </button>
        ))}
      </div>
    </div>
  );
}