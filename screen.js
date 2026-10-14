import { html } from './vendor/preact-htm.js';
import { G, gLabel, info } from './content.js';
import { short, fmt, usePoll, useTick, timing, QR, Dots, joinUrl, prettyLink, Shape } from './lib.js';

export function Screen({ code }) {
  const { data, error, offset } = usePoll({ code, role: 'screen', interval: 2500, enabled: !!code });
  useTick(1000);
  if (!code) return html`<div class="screen" style="display:flex;align-items:center;justify-content:center;font-size:24px">Open this page from the facilitator screen.</div>`;
  if (error && !data) return html`<div class="screen" style="display:flex;align-items:center;justify-content:center;font-size:24px;padding:40px;text-align:center">${error}</div>`;
  if (!data) return html`<div class="screen" style="display:flex;align-items:center;justify-content:center"><${Dots} /></div>`;
  const meta = data.meta, T = timing(meta, offset), mode = meta.projMode || 'join';
  const fs = () => { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch (_) {} };
  const fsBtn = html`<button onClick=${fs} style="position:fixed;bottom:14px;right:14px;font-size:12px;font-weight:700;color:rgba(255,255,255,.35);padding:8px 12px;border-radius:10px;background:rgba(255,255,255,.04);z-index:5">Full screen</button>`;
  const vw = 'min(1vw, 1.78vh)';
  const u = (n) => `calc(${n} * ${vw})`;

  if (mode === 'off') return html`<div class="screen" style="display:flex;align-items:center;justify-content:center;gap:${u(2)};flex-direction:column"><${Dots} size=${18} /><div style=${{ fontSize: u(3), fontWeight: 900, color: 'rgba(255,255,255,.25)' }}>Wavelength</div>${fsBtn}</div>`;

  if (mode === 'join' || !meta.launched && mode !== 'groups' && mode !== 'instructions') {
    return html`<div class="screen" style="background:radial-gradient(120% 120% at 20% 0%,#1c1f2b 0%,#0c0d12 65%);display:flex;align-items:center;justify-content:center;padding:${u(4)}">
      <div style=${{ display: 'flex', alignItems: 'center', gap: u(7), width: '100%', maxWidth: u(110) }}>
        <div style=${{ flex: 1, minWidth: 0 }}>
          <${Dots} size=${18} />
          <div style=${{ fontSize: u(2.2), fontWeight: 700, color: 'rgba(255,255,255,.6)', marginTop: u(3) }}>${meta.name}</div>
          <div style=${{ fontSize: u(5.4), fontWeight: 900, letterSpacing: '-.02em', lineHeight: 1.02, marginTop: u(1) }}>Join on your phone</div>
          <div style=${{ fontSize: u(2), color: 'rgba(255,255,255,.65)', marginTop: u(2.5) }}>Scan the code, or go to</div>
          <div style=${{ fontSize: u(2.4), fontWeight: 800, marginTop: u(.5), wordBreak: 'break-all' }}>${prettyLink(code, data.base)}</div>
          <div style=${{ fontSize: u(2), color: 'rgba(255,255,255,.65)', marginTop: u(3) }}>Class code</div>
          <div class="mono" style=${{ fontSize: u(9), letterSpacing: '.12em', lineHeight: 1 }}>${code}</div>
          <div style=${{ display: 'flex', alignItems: 'baseline', gap: u(1.2), marginTop: u(3.5) }}><span style=${{ fontSize: u(5), fontWeight: 900 }}>${data.roster.length}</span><span style=${{ fontSize: u(2), color: 'rgba(255,255,255,.6)' }}>${meta.expected ? 'of ' + meta.expected + ' joined' : 'joined'}</span></div>
        </div>
        <div style=${{ background: '#fff', borderRadius: u(2.4), padding: u(1.6), flexShrink: 0 }}><${QR} text=${joinUrl(code, data.base)} size=${Math.round(Math.min(window.innerWidth * 0.34, window.innerHeight * 0.62))} /></div>
      </div>${fsBtn}</div>`;
  }

  if (mode === 'groups') {
    const n = meta.groupCount || 1, cols = Array.from({ length: n }, () => []);
    data.roster.forEach(p => { if (p.g != null && cols[p.g]) cols[p.g].push(p); });
    // Wrap into rows for big classes and shrink text so every name still fits on one screen.
    const perRow = n <= 6 ? n : n <= 12 ? 6 : n <= 24 ? 8 : 9, rows = Math.ceil(n / perRow);
    const most = Math.max(1, ...cols.map(c => c.length));
    // Size text to fit both the card height (most members) and the column width (longest label/name).
    const pad = rows > 2 ? 0.9 : 1.6, inner = (94 - (perRow - 1) * (rows > 2 ? 0.9 : 1.4)) / perRow - pad * 2;
    const longName = Math.max(4, ...data.roster.map(p => short(p.name).length));
    const longHead = Math.max(...cols.map((_, g) => (G(g).name + (G(g).num > 1 ? ' ' + G(g).num : '')).length));
    const nameFs = Math.max(0.8, Math.min(1.85, 44 / rows / (most + 2.6) / 1.45, inner / (0.56 * longName)));
    const headFs = Math.max(1.1, Math.min(2.4, 6.5 / Math.sqrt(rows), (inner - 0.8) / (1 + 0.62 * longHead)));
    return html`<div class="screen" style=${{ padding: u(3), display: 'flex', flexDirection: 'column', gap: u(2) }}>
      <div style=${{ display: 'flex', alignItems: 'baseline', gap: u(2) }}><div style=${{ fontSize: u(4), fontWeight: 900 }}>Find your group</div><div style=${{ fontSize: u(1.8), color: 'rgba(255,255,255,.55)' }}>${data.roster.length} students · ${n} groups</div></div>
      <div style=${{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${perRow}, minmax(0,1fr))`, gridAutoRows: 'minmax(0,1fr)', gap: u(rows > 2 ? 0.9 : 1.4), minHeight: 0 }}>${cols.map((ms, g) => { const k = G(g); return html`<div style=${{ background: k.base + '1f', border: '2px solid ' + k.base + '88', borderRadius: u(1.4), padding: u(rows > 2 ? 0.9 : 1.6), overflow: 'hidden', minHeight: 0 }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: u(0.8), fontSize: u(headFs), fontWeight: 900, color: k.soft, whiteSpace: 'nowrap', overflow: 'hidden' }}><${Shape} g=${g} size=${Math.round(headFs * 9)} />${k.name}${k.num > 1 ? ' ' + k.num : ''}</div>
        <div style=${{ fontSize: u(Math.max(0.9, headFs * 0.55)), color: 'rgba(255,255,255,.55)', marginBottom: u(0.6), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${k.shapeLabel} · ${ms.length}</div>
        ${ms.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => html`<div style=${{ fontSize: u(nameFs), fontWeight: 700, padding: u(nameFs * 0.18) + ' 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${short(p.name)}</div>`)}
      </div>`; })}</div>${fsBtn}</div>`;
  }

  const key = meta.projKey || T.item.key, gm = info(key);
  const showTimer = !meta.projKey || meta.projKey === T.item.key;
  const extra = !!meta.pushedPrompt || (meta.calledNum && key === 'molecules');
  const stepFs = extra ? 2.8 : 4, dot = extra ? 4.4 : 6;
  return html`<div class="screen" style=${{ background: `radial-gradient(120% 120% at 0% 0%, ${gm.color}55 0%, #0c0d12 60%)`, padding: u(5), display: 'flex', flexDirection: 'column' }}>
    <div style=${{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: u(3) }}>
      <div><div style=${{ fontSize: u(1.8), fontWeight: 800, letterSpacing: '.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>${meta.ended ? 'Class wrapped' : 'Now'}</div><div style=${{ fontSize: u(6.5), fontWeight: 900, letterSpacing: '-.02em', lineHeight: 1 }}>${gm.name}</div><div style=${{ fontSize: u(2.2), color: 'rgba(255,255,255,.65)', marginTop: u(1) }}>${gm.tagline}</div></div>
      ${showTimer && meta.launched && !meta.ended && html`<div class="mono" style=${{ fontSize: u(9), lineHeight: 1, color: T.segLeft < 0 ? '#ff8a7e' : T.segLeft < 60 ? '#f5c26b' : '#fff' }}>${fmt(Math.max(0, T.segLeft))}</div>`}
    </div>
    <div style=${{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: u(extra ? 1.6 : 2.6), padding: u(2) + ' 0' }}>
      ${gm.proj.map((t, i) => html`<div style=${{ display: 'flex', alignItems: 'center', gap: u(2.4) }}><span style=${{ width: u(dot), height: u(dot), borderRadius: '50%', background: gm.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: u(dot / 2), fontWeight: 900, flexShrink: 0 }}>${i + 1}</span><span style=${{ fontSize: u(stepFs), fontWeight: 800, lineHeight: 1.15 }}>${t}</span></div>`)}
      ${meta.pushedPrompt && html`<div style=${{ marginTop: u(2), background: '#fff', color: '#101116', borderRadius: u(2), padding: u(2.4), fontSize: u(3), fontWeight: 800, lineHeight: 1.25 }}>${meta.pushedPrompt}</div>`}
      ${meta.calledNum && key === 'molecules' && html`<div style=${{ fontSize: u(8), fontWeight: 900, lineHeight: 1 }}>Groups of ${meta.calledNum}</div>`}
    </div>
    <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: u(1.6), color: 'rgba(255,255,255,.45)' }}><span>Joining late? Scan at ${prettyLink(code, data.base)} · code <b class="mono">${code}</b></span><span>${T.next && !meta.ended ? 'Up next: ' + T.next.name : ''}</span></div>
    ${fsBtn}</div>`;
}
