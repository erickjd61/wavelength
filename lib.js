import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { G, info } from './content.js';

export const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
export const first = (n) => String(n || '').trim().split(/\s+/)[0];
export const short = (n) => { const [f, l] = String(n || '').trim().split(/\s+/); return l ? f + ' ' + l[0] + '.' : (f || ''); };
export const fmt = (sec) => { const a = Math.abs(Math.round(sec)); return (sec < 0 ? '+' : '') + Math.floor(a / 60) + ':' + String(a % 60).padStart(2, '0'); };
export const joinUrl = (code) => location.origin + '/?c=' + code;
export const prettyLink = (code) => location.host + '/?c=' + code;

export async function post(body) {
  const r = await fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch (_) {}
  if (!r.ok) throw new Error(j.error || 'Something went wrong (' + r.status + ')');
  return j;
}

// Polls the class state. Cheap when nothing changed (server answers "same").
export function usePoll({ code, role, sid, pin, interval = 2500, enabled = true }) {
  const [state, setState] = useState({ data: null, error: null, offline: false, offset: 0 });
  const ref = useRef({ v: null, data: null, fails: 0, n: 0, kick: null });
  useEffect(() => {
    if (!enabled || !code) return;
    let stop = false, timer = null;
    ref.current = { v: null, data: null, fails: 0, n: 0, kick: null };
    const tick = async () => {
      const r0 = ref.current;
      const q = new URLSearchParams({ code, role });
      if (sid) q.set('sid', sid);
      if (r0.v != null && r0.data && role !== 'teacher') q.set('v', r0.v);
      if (role === 'student' && sid && r0.n % 5 === 0) q.set('seen', '1');
      r0.n++;
      try {
        const t0 = Date.now();
        const r = await fetch('/api/rpc?' + q, { headers: pin ? { 'x-wl-pin': pin } : {}, cache: 'no-store' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw Object.assign(new Error(j.error || 'Error ' + r.status), { status: r.status });
        const offset = j.now - Math.round((t0 + Date.now()) / 2);
        r0.fails = 0;
        if (!j.same) { r0.v = j.v; r0.data = j; }
        if (!stop) setState({ data: r0.data, error: null, offline: false, offset });
      } catch (e) {
        r0.fails++;
        if (!stop) setState(s => ({ ...s, error: e.status ? e.message : s.error, status: e.status, offline: !e.status && r0.fails >= 2 }));
      }
      if (!stop) timer = setTimeout(tick, document.hidden ? Math.max(interval, 8000) : r0.fails ? Math.min(10000, interval * (1 + r0.fails)) : interval);
    };
    ref.current.kick = () => { clearTimeout(timer); tick(); };
    const onVis = () => { if (!document.hidden) ref.current.kick && ref.current.kick(); };
    document.addEventListener('visibilitychange', onVis);
    tick();
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [code, role, sid, pin, enabled]);
  return { ...state, refresh: () => ref.current.kick && ref.current.kick() };
}

export function useTick(ms = 1000) { const [, set] = useState(0); useEffect(() => { const i = setInterval(() => set(x => x + 1), ms); return () => clearInterval(i); }, [ms]); }

// Timer math shared by every screen, using the server clock.
export function timing(meta, offset) {
  const now = Date.now() + (offset || 0);
  const ag = meta.agenda || [];
  const segIdx = Math.min(meta.seg || 0, Math.max(0, ag.length - 1));
  const item = ag[segIdx] || { key: 'welcome', mins: 3 };
  const elapsedMs = (meta.segAccum || 0) + (meta.running && meta.segStartedAt ? now - meta.segStartedAt : 0);
  const planned = item.mins * 60;
  const segElapsed = meta.launched && !meta.ended ? elapsedMs / 1000 : 0;
  const segLeft = planned - segElapsed;
  const classElapsed = ((meta.priorMs || 0) + (meta.ended ? 0 : elapsedMs)) / 1000;
  const planTotal = ag.reduce((a, x) => a + x.mins, 0);
  const remaining = ag.slice(segIdx + 1).reduce((a, x) => a + x.mins, 0) * 60;
  const projected = meta.launched && !meta.ended ? (meta.priorMs || 0) / 1000 + Math.max(segElapsed, planned) + remaining : planTotal * 60;
  return { segIdx, item, seg: info(item.key), next: ag[segIdx + 1] ? info(ag[segIdx + 1].key) : null, planned, segElapsed, segLeft, classElapsed, planTotal, projected, overMin: Math.ceil((projected - (meta.budget || planTotal) * 60) / 60) };
}

export function assignGroups(list, count, locked, prev, avoid, seed) {
  const res = {}, members = Array.from({ length: count }, () => []);
  const put = (s, g) => { res[s.id] = g; members[g].push(s); };
  const pool = [];
  list.forEach(s => { const g = prev ? prev[s.id] : null; if (g != null && g < count && locked[g]) put(s, g); else pool.push(s); });
  let x = (seed * 7919 + 17) % 233280;
  const rnd = () => (x = (x * 9301 + 49297) % 233280) / 233280;
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const open = [...Array(count).keys()].filter(g => !locked[g]);
  const targets = open.length ? open : [...Array(count).keys()];
  pool.forEach(s => {
    const min = Math.min(...targets.map(g => members[g].length));
    let best = targets.find(g => members[g].length === min), bc = 1e9;
    targets.forEach(g => {
      if (members[g].length !== min) return;
      const c = avoid ? members[g].filter(m => (m.last != null && m.last === s.last) || (prev && prev[m.id] != null && prev[m.id] === prev[s.id])).length : 0;
      if (c < bc) { bc = c; best = g; }
    });
    put(s, best);
  });
  return res;
}
export function pairStats(map, list) {
  const by = {}; list.forEach(s => { const g = map[s.id]; if (g == null) return; (by[g] = by[g] || []).push(s); });
  let fresh = 0, rep = 0;
  Object.values(by).forEach(ms => { for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) ((ms[i].last != null && ms[i].last === ms[j].last) ? rep++ : fresh++); });
  return { fresh, rep };
}

export function QR({ text, size = 200, dark = '#0c0d12', light = '#ffffff' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!window.qrcode || !ref.current) return;
    const q = window.qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), cell = size / (n + 8), c = ref.current, ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1; c.width = size * dpr; c.height = size * dpr; ctx.scale(dpr, dpr);
    ctx.fillStyle = light; ctx.fillRect(0, 0, size, size); ctx.fillStyle = dark;
    for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) if (q.isDark(r, k)) ctx.fillRect((k + 4) * cell, (r + 4) * cell, Math.ceil(cell), Math.ceil(cell));
  }, [text, size]);
  return html`<canvas ref=${ref} style=${{ width: size + 'px', height: size + 'px', borderRadius: '12px', display: 'block' }} aria-label=${'QR code for ' + text}></canvas>`;
}

export function Toggle({ on }) {
  return html`<span class="toggle" style=${{ justifyContent: on ? 'flex-end' : 'flex-start', background: on ? '#54d68d' : 'rgba(255,255,255,.22)' }}><span></span></span>`;
}
export function Dots({ size = 14 }) {
  return html`<div class="dots">${['#06b6a4', '#7a4dff', '#ff6b5e', '#2e6bff', '#f5a300'].map(c => html`<span style=${{ background: c, width: size + 'px', height: size + 'px' }}></span>`)}</div>`;
}
export function useToast() {
  const [t, set] = useState(null); const r = useRef(null);
  const show = (m) => { set(m); clearTimeout(r.current); r.current = setTimeout(() => set(null), 3000); };
  return [t ? html`<div class="toast" role="status">${t}</div>` : null, show];
}
export function colorVars(g) { const k = G(g); return { '--c': k.base, '--cd': k.deep, '--cs': k.soft }; }

export function GuideSheet({ k, onClose, showSay, say, onProj }) {
  const gd = info(k);
  return html`<div class="sheet-wrap"><button class="scrim" aria-label="Close" onClick=${onClose}></button>
    <div class="sheet">
      <div class="grab"></div>
      <div style="display:flex;align-items:center;gap:12px">
        <span style=${{ width: '30px', height: '30px', borderRadius: '50%', background: gd.color, flexShrink: 0 }}></span>
        <div style="flex:1"><div style="font-size:24px;font-weight:900;line-height:1">${gd.name}</div><div style="font-size:13.5px;color:rgba(255,255,255,.6);margin-top:3px">${gd.tagline}</div></div>
        <button onClick=${onClose} aria-label="Close" style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.08);font-size:18px">×</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:18px">
        ${[[gd.size, 'Group'], [gd.time, 'Time'], [gd.setting, 'Setting']].map(([v, l]) => html`<div style="flex:1;background:#1f2027;border-radius:12px;padding:11px 8px;text-align:center"><div style="font-size:13px;font-weight:800">${v}</div><div style="font-size:10.5px;color:rgba(255,255,255,.5);text-transform:uppercase;margin-top:2px">${l}</div></div>`)}
      </div>
      ${showSay && html`<div style="background:rgba(46,107,255,.14);border:1px solid rgba(111,155,255,.4);border-radius:16px;padding:16px;margin-top:16px">
        <div style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9fb9ff">Say this</div>
        <div style="font-size:16px;line-height:1.5;margin-top:6px">“${say}”</div>
        ${onProj && html`<button class="btn-sm" style="margin-top:12px;background:#2e6bff" onClick=${onProj}>Show instructions on projector</button>`}
      </div>`}
      <div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px;margin-top:16px">
        <div class="k">Why this game</div><div style="font-size:15px;line-height:1.5;color:rgba(255,255,255,.88);margin-top:6px">${gd.why}</div>
      </div>
      <div class="k" style="margin:20px 2px 12px">How to play</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${gd.steps.map((t, i) => html`<div style="display:flex;gap:13px;align-items:flex-start"><span style=${{ width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0, background: gd.color, fontSize: '13px', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>${i + 1}</span><span style="font-size:15px;line-height:1.4;padding-top:2px">${t}</span></div>`)}
      </div>
    </div></div>`;
}
