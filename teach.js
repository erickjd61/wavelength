import { html, useState, useEffect, useMemo } from './vendor/preact-htm.js';
import { G, gLabel, info, GAMES, QUICK } from './content.js';
import { ls, normCode, first, short, fmt, post, usePoll, useTick, timing, assignGroups, pairStats, QR, Toggle, Dots, useToast, joinUrl, prettyLink, GuideSheet } from './lib.js';

const clock = (startMs, offSec) => { if (!startMs) return ''; const d = new Date(startMs + offSec * 1000); return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };

export function Teach() {
  const [auth, setAuth] = useState(() => ls.get('wl:teach', null));
  if (!auth) return html`<${Setup} onReady=${(a) => { ls.set('wl:teach', a); setAuth(a); }} />`;
  return html`<${TeachApp} code=${auth.code} pin=${auth.pin} onSignOut=${() => { ls.del('wl:teach'); setAuth(null); }} />`;
}

function Setup({ onReady }) {
  const [mode, setMode] = useState('new');
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [expected, setExpected] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const gen = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += a[Math.floor(Math.random() * a.length)]; setCode(c); };
  const go = async (e) => {
    e && e.preventDefault();
    const c = normCode(code); setErr('');
    if (c.length < 4) return setErr('Use a code of 4–8 letters or numbers.');
    if (pin.length < 4) return setErr('PIN must be at least 4 characters.');
    setBusy(true);
    try {
      if (mode === 'new') await post({ op: 'create', code: c, pin, name: name || 'My class', expected: Number(expected) || 0 });
      else await post({ op: 'auth', code: c, pin });
      onReady({ code: c, pin });
    } catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };
  return html`<div class="dark-bg" style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px">
    <form onSubmit=${go} style="width:100%;max-width:460px;display:flex;flex-direction:column;gap:16px">
      <${Dots} size=${12} />
      <div><div style="font-size:34px;font-weight:900;letter-spacing:-1px">Run a class</div><div class="sub">Students join from their own phones. You control the session from here.</div></div>
      <div style="display:flex;gap:4px;background:rgba(255,255,255,.06);border-radius:12px;padding:4px">
        ${[['new', 'New class'], ['resume', 'Open my class']].map(([m, l]) => html`<button type="button" onClick=${() => { setMode(m); setErr(''); }} style=${{ flex: 1, minHeight: '42px', borderRadius: '9px', fontWeight: 800, fontSize: '14px', background: mode === m ? '#2e6bff' : 'transparent', color: mode === m ? '#fff' : 'rgba(255,255,255,.65)' }}>${l}</button>`)}
      </div>
      ${mode === 'new' && html`<div><div class="label-row">Class name</div><input class="field" value=${name} onInput=${e => setName(e.target.value)} placeholder="e.g. OLS 274 · Leadership" maxlength="80" /></div>`}
      <div><div class="label-row"><span>Class code <span style="color:rgba(255,255,255,.5);font-weight:600">· students type this</span></span>${mode === 'new' && html`<button type="button" onClick=${gen} style="font-size:13px;font-weight:800;color:#8fb0ff">Generate</button>`}</div>
        <input class="field mono" value=${code} onInput=${e => setCode(normCode(e.target.value))} placeholder="BIO101" maxlength="8" style="font-size:26px;letter-spacing:4px;text-transform:uppercase" autocapitalize="characters" /></div>
      <div><div class="label-row"><span>Facilitator PIN <span style="color:rgba(255,255,255,.5);font-weight:600">· only you need this</span></span></div>
        <input class="field" type="password" value=${pin} onInput=${e => setPin(e.target.value)} placeholder="At least 4 characters" autocomplete=${mode === 'new' ? 'new-password' : 'current-password'} /></div>
      ${mode === 'new' && html`<div><div class="label-row">Expected students <span style="color:rgba(255,255,255,.5);font-weight:600">· optional</span></div><input class="field" type="number" min="0" value=${expected} onInput=${e => setExpected(e.target.value)} placeholder="30" /></div>`}
      ${err && html`<div class="err">${err}</div>`}
      <button class="btn btn-blue" disabled=${busy} type="submit">${busy ? 'One moment…' : mode === 'new' ? 'Create class' : 'Open class'}</button>
      <div style="font-size:12.5px;color:rgba(255,255,255,.5);line-height:1.5">Use the same code and PIN on your laptop and phone to control the class from both. Keep the PIN private — it's what stops students from changing the session.</div>
    </form></div>`;
}

function TeachApp({ code, pin, onSignOut }) {
  const { data, error, status, offline, offset, refresh } = usePoll({ code, role: 'teacher', pin, interval: 2000 });
  useTick(1000);
  const [view, setView] = useState('run');
  const [toast, showToast] = useToast();
  const [guide, setGuide] = useState(null);
  const act = async (action, payload = {}, msg) => {
    try { await post({ op: 'fac', code, pin, action, ...payload }); if (msg) showToast(msg); refresh(); return true; }
    catch (e) { showToast(e.message); return false; }
  };
  if (error && !data) return html`<div class="dark-bg" style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px"><div style="max-width:420px;display:flex;flex-direction:column;gap:14px">
    <div style="font-size:28px;font-weight:900">${status === 403 ? 'That PIN didn’t work' : status === 404 ? 'Class not found' : 'Can’t reach Wavelength'}</div><div class="sub">${error}</div>
    <button class="btn btn-blue" onClick=${refresh}>Try again</button><button class="btn btn-ghost" onClick=${onSignOut}>Use a different class</button></div></div>`;
  if (!data) return html`<div class="dark-bg" style="min-height:100vh;display:flex;align-items:center;justify-content:center"><${Dots} /></div>`;

  const meta = data.meta;
  const T = timing(meta, offset);
  const nowMs = Date.now() + offset;
  const active = data.students.filter(p => p.status === 'active');
  const away = data.students.filter(p => p.status === 'away');
  const online = (p) => p.nophone || (data.seen[p.id] && nowMs - data.seen[p.id] < 45000);
  const ctx = { data, meta, T, act, code, pin, active, away, online, showToast, setView, setGuide, nowMs, offset, refresh };
  const live = meta.launched && !meta.ended;
  const nav = [['run', 'Run'], ['groups', 'Groups'], ['agenda', 'Agenda & prompts'], ['insights', 'Insights'], ['wrap', 'Wrap-up']];
  const openScreen = () => window.open('/screen?c=' + code, 'wl-screen');

  return html`<div class="t-shell">
    <div class="t-top">
      <div style="display:flex;align-items:center;gap:10px"><${Dots} size=${9} /><span style="font-size:18px;font-weight:900;letter-spacing:-.3px">Wavelength</span></div>
      <div class="hide-sm" style="width:1px;height:28px;background:rgba(255,255,255,.1)"></div>
      <div style="min-width:0"><div style="font-size:15px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px">${meta.name}</div><div style="font-size:12.5px;color:rgba(255,255,255,.55)">Session ${meta.session || 1} · ${active.length} here</div></div>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', fontWeight: 800, background: 'rgba(255,255,255,.05)', padding: '6px 11px', borderRadius: '20px', color: meta.ended ? 'rgba(255,255,255,.55)' : live ? '#54d68d' : '#f5c26b' }}><span style="width:7px;height:7px;border-radius:50%;background:currentColor"></span>${meta.ended ? 'Ended' : live ? (meta.running ? 'Live' : 'Paused') : 'Not started'}</div>
      ${offline && html`<div style="font-size:12.5px;color:#f5c26b;font-weight:700">Connection hiccup — retrying…</div>`}
      <div style="flex:1"></div>
      <div class="mono" style="font-size:18px;background:rgba(255,255,255,.06);padding:7px 14px;border-radius:10px;letter-spacing:2px">${code}</div>
      <button class="gbtn hide-sm" style="background:#fff;color:#101116" onClick=${openScreen}>Open projector screen</button>
      <button class="gbtn hide-sm" onClick=${onSignOut} title="Sign out of this class on this device">Sign out</button>
    </div>
    <div class="t-body">
      <div class="t-nav">
        ${nav.map(([k, l]) => html`<button class=${view === k ? 'on' : ''} onClick=${() => setView(k)}>${l}</button>`)}
        <div style="flex:1"></div>
        <div class="panel" style="padding:14px"><div class="k">Connections saved</div><div style="font-size:30px;font-weight:900;margin-top:4px">${Math.round(Object.values(data.connCounts).reduce((a, b) => a + b, 0) / 2)}</div><div style="font-size:12.5px;color:rgba(255,255,255,.6)">between students in this class</div></div>
      </div>
      <div class="t-main">
        ${view === 'run' && !meta.launched && html`<${RunPre} ...${ctx} openScreen=${openScreen} />`}
        ${view === 'run' && meta.launched && html`<${RunLive} ...${ctx} openScreen=${openScreen} />`}
        ${view === 'groups' && html`<${Groups} ...${ctx} />`}
        ${view === 'agenda' && html`<${Agenda} ...${ctx} />`}
        ${view === 'insights' && html`<${Insights} ...${ctx} />`}
        ${view === 'wrap' && html`<${Wrap} ...${ctx} onSignOut=${onSignOut} />`}
      </div>
    </div>
    <div class="t-tabs">${[['run', 'Run'], ['groups', 'Groups'], ['agenda', 'Agenda'], ['insights', 'Insights'], ['wrap', 'Wrap-up']].map(([k, l]) => html`<button class=${view === k ? 'on' : ''} onClick=${() => setView(k)}>${l}</button>`)}</div>
    ${guide && html`<${GuideSheet} k=${guide} onClose=${() => setGuide(null)} showSay=${true} say=${(meta.scripts && meta.scripts[guide]) || info(guide).say} onProj=${() => { act('proj', { mode: 'instructions', key: guide }, 'Projector: ' + info(guide).name); setGuide(null); }} />`}
    ${toast}
  </div>`;
}

function Timeline({ meta, T }) {
  let cum = 0; const ag = meta.agenda;
  return html`<div style="display:flex;gap:4px;margin-top:12px">${ag.map((it, i) => {
    const g = info(it.key), done = meta.launched && (i < T.segIdx || meta.ended), cur = meta.launched && !meta.ended && i === T.segIdx;
    const fill = done ? 100 : cur ? Math.min(100, T.segElapsed / (it.mins * 60) * 100) : 0; const start = cum; cum += it.mins;
    return html`<div style=${{ flex: it.mins, minWidth: 0, height: '54px', position: 'relative', borderRadius: '10px', background: cur ? 'rgba(46,107,255,.16)' : 'rgba(255,255,255,.04)', border: '1px solid ' + (cur ? 'rgba(111,155,255,.7)' : 'rgba(255,255,255,.09)'), overflow: 'hidden', padding: '6px 10px' }}>
      <span style=${{ position: 'absolute', left: 0, top: 0, bottom: 0, width: fill + '%', background: g.color + (done ? '33' : '6b') }}></span>
      <span style=${{ position: 'relative', display: 'block', fontSize: '13px', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: done ? 'rgba(255,255,255,.55)' : '#fff' }}>${g.name}</span>
      <span class="mono" style="position:relative;display:block;font-size:11.5px;color:rgba(255,255,255,.6);white-space:nowrap">+${start}′ · ${it.mins}m</span></div>`;
  })}</div>`;
}

function GroupBars({ data, meta, active }) {
  const n = meta.groupCount || 5, arr = Array.from({ length: n }, () => []);
  active.forEach(p => { const g = data.groups[p.id]; if (g != null && arr[g]) arr[g].push(p); });
  const max = Math.max(1, ...arr.map(a => a.length));
  return arr.map((ms, g) => { const k = G(g); return html`<div style="display:flex;align-items:center;gap:10px;font-size:14px"><span style=${{ width: '18px', color: k.base }}>${k.sym}</span><span style="width:118px;font-weight:700">${gLabel(g)}</span><span style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden"><span style=${{ display: 'block', height: '100%', width: (ms.length / max * 100) + '%', background: k.base }}></span></span><span style="width:20px;text-align:right;font-weight:800">${ms.length}</span>${(meta.locked || [])[g] && html`<span style="font-size:11px;color:#f5c26b">🔒</span>`}</div>`; });
}

function drift(data, meta, active) {
  const n = meta.groupCount || 5, sz = Array(n).fill(0);
  active.forEach(p => { const g = data.groups[p.id]; if (g != null && g < n) sz[g]++; });
  const max = Math.max(...sz), min = Math.min(...sz);
  return max - min >= 2 ? gLabel(sz.indexOf(min)) + ' has ' + min + ', ' + gLabel(sz.indexOf(max)) + ' has ' + max + '.' : null;
}

function RunPre({ data, meta, T, act, code, active, setView, openScreen }) {
  const link = joinUrl(code, data.base);
  return html`<div class="grid2">
    <div class="panel" style="padding:24px;display:flex;flex-direction:column;gap:18px">
      <div><div class="k">Before class</div><div style="font-size:30px;font-weight:900;letter-spacing:-.6px;margin-top:4px">Get everyone in</div></div>
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <${QR} text=${link} size=${150} />
        <div style="min-width:0"><div class="k">Class code</div><div class="mono" style="font-size:44px;letter-spacing:4px;margin-top:4px">${code}</div><div style="font-size:13.5px;color:rgba(255,255,255,.6);word-break:break-all">${prettyLink(code, data.base)}</div></div>
      </div>
      <div><div style="display:flex;align-items:baseline;gap:10px"><span style="font-size:46px;font-weight:900;line-height:1">${active.length}</span><span style="font-size:16px;color:rgba(255,255,255,.6)">${meta.expected ? 'of ' + meta.expected + ' joined' : 'joined'}</span></div>
        <div class="bar" style="margin-top:12px;height:10px"><div style=${{ width: (meta.expected ? Math.min(100, active.length / meta.expected * 100) : (active.length ? 100 : 0)) + '%', background: '#54d68d', transition: 'width .6s' }}></div></div></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;max-height:140px;overflow-y:auto">${active.slice().sort((a, b) => b.joinedAt - a.joinedAt).map(p => html`<span style=${{ fontSize: '13px', fontWeight: 700, padding: '6px 10px', borderRadius: '20px', background: G(data.groups[p.id]).base + '33', border: '1px solid ' + G(data.groups[p.id]).base + '66' }}>${G(data.groups[p.id]).sym} ${short(p.name)}</span>`)}</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="gbtn" style="flex:1;min-height:52px" onClick=${() => { act('proj', { mode: 'join' }); openScreen(); }}>Show join screen on projector</button>
        <button class="gbtn blue" style="flex:1;min-height:52px;font-size:15px" onClick=${() => act('start', {}, 'Class started')}>Start class →</button>
      </div>
    </div>
    <div class="col">
      <div class="panel"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="k">Today's plan</span><button onClick=${() => setView('agenda')} style="font-size:13px;font-weight:800;color:#8fb0ff">Edit agenda →</button></div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">${meta.agenda.map(it => { const g = info(it.key); return html`<div style="display:flex;align-items:center;gap:10px;font-size:14.5px"><span style=${{ width: '10px', height: '10px', borderRadius: '50%', background: g.color }}></span><span style="flex:1;font-weight:700">${g.name}</span><span style="color:rgba(255,255,255,.6)">${it.mins} min</span></div>`; })}</div>
        <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:12px">${T.planTotal} of ${meta.budget} min budget</div></div>
      <div class="panel"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="k">Auto-grouping</span><button onClick=${() => setView('groups')} style="font-size:13px;font-weight:800;color:#8fb0ff">Groups →</button></div>
        <div style="font-size:15px;line-height:1.45;margin-top:10px;color:rgba(255,255,255,.85)">${meta.groupCount} groups. Each student joins the smallest group${meta.avoid !== false ? ', avoiding last session’s groupmates where possible' : ''}.</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px"><${GroupBars} data=${data} meta=${meta} active=${active} /></div></div>
    </div>
  </div>`;
}

function PushPrompts({ meta, T, act }) {
  const [custom, setCustom] = useState('');
  const list = (((meta.prompts && meta.prompts[T.item.key]) || T.seg.prompts || []).length ? ((meta.prompts && meta.prompts[T.item.key]) || T.seg.prompts) : ((meta.prompts && meta.prompts.frequency) || info('frequency').prompts)).filter(Boolean);
  return html`<div>
    <div class="k" style="margin-bottom:10px">Push a prompt to every phone</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${list.map(t => { const on = meta.pushedPrompt === t; return html`<button onClick=${() => act('push', { text: on ? '' : t }, on ? 'Prompt cleared' : 'Prompt sent to every phone')} style=${{ minHeight: '44px', maxWidth: '100%', textAlign: 'left', background: on ? 'rgba(46,107,255,.2)' : 'rgba(255,255,255,.05)', border: '1px solid ' + (on ? 'rgba(111,155,255,.6)' : 'rgba(255,255,255,.1)'), borderRadius: '12px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '10px' }}><span style="font-size:14px;font-weight:600">${t}</span><span style=${{ fontSize: '11px', fontWeight: 800, color: on ? '#8fb0ff' : 'rgba(255,255,255,.5)' }}>${on ? 'LIVE · tap to clear' : 'Push'}</span></button>`; })}</div>
    <form style="display:flex;gap:8px;margin-top:10px" onSubmit=${e => { e.preventDefault(); if (custom.trim()) { act('push', { text: custom.trim() }, 'Prompt sent to every phone'); setCustom(''); } }}>
      <input class="field" style="padding:11px 13px;font-size:14px" value=${custom} onInput=${e => setCustom(e.target.value)} placeholder="Or type your own prompt…" maxlength="300" /><button class="gbtn" type="submit">Send</button></form>
  </div>`;
}

function DonePanel({ data, meta, active, act }) {
  const doneSet = new Set(data.doneIds || []);
  const people = active.filter(p => !p.nophone);
  const n = meta.groupCount || 5, rows = Array.from({ length: n }, () => ({ total: 0, done: 0 }));
  people.forEach(p => { const g = data.groups[p.id]; if (g != null && rows[g]) { rows[g].total++; if (doneSet.has(p.id)) rows[g].done++; } });
  const doneN = people.filter(p => doneSet.has(p.id)).length;
  return html`<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="k">Done discussing</span><span style="font-size:22px;font-weight:900">${doneN}<span style="font-size:14px;color:rgba(255,255,255,.55);font-weight:700"> of ${people.length}</span></span></div>
    <div class="bar" style="margin-top:10px"><div style=${{ width: (people.length ? doneN / people.length * 100 : 0) + '%', background: '#54d68d', transition: 'width .4s' }}></div></div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">${rows.map((r, g) => { const k = G(g), all = r.total > 0 && r.done === r.total; return html`<div style="display:flex;align-items:center;gap:10px;font-size:13.5px"><span style=${{ width: '18px', color: k.base }}>${k.sym}</span><span style="flex:1;font-weight:700">${gLabel(g)}</span><span style=${{ fontWeight: 800, color: all ? '#54d68d' : 'rgba(255,255,255,.75)' }}>${all ? '✓ All done' : r.done + ' / ' + r.total}</span></div>`; })}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px"><span style="font-size:12px;color:rgba(255,255,255,.5);line-height:1.4">Students tap “We're done” on their phones. Resets on Next, a new prompt, or regrouping.</span><button class="gbtn" style="min-height:36px;font-size:12.5px;flex-shrink:0" onClick=${() => act('resetDone', {}, 'Done marks cleared')}>Reset</button></div>
  </div>`;
}

function RunLive({ data, meta, T, act, active, online, setView, setGuide, openScreen, nowMs }) {
  const seg = T.seg, segLeft = T.segLeft;
  const dr = drift(data, meta, active);
  const offline = active.filter(p => !online(p));
  const say = (meta.scripts && meta.scripts[T.item.key]) || seg.say;
  const endAt = meta.launched ? clock(nowMs - T.classElapsed * 1000, meta.budget * 60) : '';
  return html`<div class="col" style="gap:16px">
    <div class="panel">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><span class="k">Timeline</span><span style="font-size:13.5px;color:rgba(255,255,255,.65)">${T.planTotal} min planned · ${meta.budget} min budget</span><span style="flex:1"></span><span style="font-size:14px;font-weight:700">${meta.ended ? 'Class ended' : html`Planned end ${endAt} · <span style="color:#8fb0ff">${Math.max(0, Math.ceil((meta.budget * 60 - T.classElapsed) / 60))} min left</span>`}</span></div>
      <${Timeline} meta=${meta} T=${T} />
      ${T.overMin > 0 && !meta.ended && html`<div style="display:flex;align-items:center;gap:12px;margin-top:12px;background:rgba(255,107,94,.1);border:1px solid rgba(255,107,94,.35);border-radius:12px;padding:10px 14px"><span style="flex:1;font-size:14px;color:#ffb3aa;font-weight:700">On pace to run ${T.overMin} min over your ${meta.budget}-min plan. Trim a game or hit Next early.</span><button class="gbtn" onClick=${() => setView('agenda')}>Edit agenda</button></div>`}
    </div>
    <div class="grid-run">
      <div class="panel" style="padding:22px;display:flex;flex-direction:column;gap:16px">
        <div style="display:flex;align-items:center;gap:10px" class="k"><span style=${{ width: '12px', height: '12px', borderRadius: '50%', background: seg.color }}></span>Now · ${T.segIdx + 1} of ${meta.agenda.length}<span style=${{ marginLeft: 'auto', color: meta.running ? '#54d68d' : '#f5c26b' }}>${meta.ended ? 'Ended' : meta.running ? 'Running' : 'Paused'}</span></div>
        <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap">
          <div style="min-width:0"><div style="font-size:40px;font-weight:900;letter-spacing:-1px;line-height:1">${meta.ended ? 'Class wrapped' : seg.name}</div><div style="font-size:16px;color:rgba(255,255,255,.6);margin-top:6px">${meta.ended ? 'Students see their wrap-up screen.' : seg.tagline}</div></div>
          ${!meta.ended && html`<div style="text-align:right"><div class="mono" style=${{ fontSize: '72px', lineHeight: .9, color: segLeft < 0 ? '#ff8a7e' : segLeft < 60 ? '#f5c26b' : '#fff' }}>${fmt(segLeft)}</div><div style="font-size:13px;color:rgba(255,255,255,.55);margin-top:6px">${segLeft < 0 ? 'over the planned ' + T.item.mins + ' min' : 'left of ' + T.item.mins + ':00'}</div></div>`}
        </div>
        ${!meta.ended && html`<div class="bar"><div style=${{ width: Math.min(100, T.segElapsed / T.planned * 100) + '%', background: segLeft < 0 ? '#ff8a7e' : seg.color }}></div></div>`}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${!meta.ended && html`<button class="gbtn" style="min-height:50px" onClick=${() => act(meta.running ? 'pause' : 'resume')}>${meta.running ? 'Pause' : 'Resume'}</button>
          <button class="gbtn" style="min-height:50px" onClick=${() => act('addMin')}>+1 min</button>
          <button class="gbtn" style="min-height:50px" onClick=${() => setGuide(T.item.key)}>Guide</button>`}
          ${!meta.ended && html`<button class="gbtn blue" style="flex:1;min-height:50px;font-size:16px;min-width:200px" onClick=${() => act('next', {}, T.next ? 'Now: ' + T.next.name : 'Class wrapped · wrap-up sent to phones')}>${T.next ? 'Next: ' + T.next.name : 'End class'} →</button>`}
          ${meta.ended && html`<button class="gbtn blue" style="min-height:50px" onClick=${() => setView('wrap')}>Go to wrap-up →</button>`}
        </div>
        ${!meta.ended && html`<div style="background:rgba(46,107,255,.1);border:1px solid rgba(111,155,255,.32);border-radius:16px;padding:16px 18px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap"><span style="font-size:11.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9fb9ff">Say this</span><button class="gbtn" style="min-height:36px;font-size:13px" onClick=${() => act('proj', { mode: 'instructions', key: null }, 'Projector: instructions')}>Show instructions on projector</button></div>
          <div style="font-size:19px;line-height:1.5;margin-top:8px">“${say}”</div></div>`}
        ${!meta.ended && T.item.key === 'molecules' && html`<div><div class="k" style="margin-bottom:10px">Call a group size</div><div style="display:flex;gap:8px">${[2, 3, 4, 5, 6].map(n => html`<button onClick=${() => act('call', { n }, 'Called groups of ' + n)} style=${{ flex: 1, minHeight: '52px', borderRadius: '14px', fontSize: '20px', fontWeight: 900, background: meta.calledNum === n ? '#7a4dff' : 'rgba(255,255,255,.06)' }}>${n}</button>`)}</div></div>`}
        ${!meta.ended && html`<${PushPrompts} meta=${meta} T=${T} act=${act} />`}
      </div>
      <div class="col">
        ${!meta.ended && T.item.key !== 'welcome' && T.item.key !== 'wrap' && html`<${DonePanel} data=${data} meta=${meta} active=${active} act=${act} />`}
        <div class="panel"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="k">Class progress</span><span style="font-size:22px;font-weight:900">${meta.ended ? 100 : Math.round(T.segIdx / meta.agenda.length * 100)}%</span></div>
          <div class="bar" style="margin-top:10px"><div style=${{ width: (meta.ended ? 100 : T.segIdx / meta.agenda.length * 100) + '%', background: '#6f9bff' }}></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:13px;color:rgba(255,255,255,.6)"><span>${active.length - offline.length} of ${active.length} phones connected</span><button onClick=${() => setView('insights')} style="font-weight:800;color:#8fb0ff">Per student →</button></div></div>
        <div class="panel" style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="k">Groups</span><button onClick=${() => setView('groups')} style="font-size:13px;font-weight:800;color:#8fb0ff">Regroup →</button></div>
          <${GroupBars} data=${data} meta=${meta} active=${active} />
          ${dr && html`<div style="background:rgba(245,163,0,.12);border:1px solid rgba(245,163,0,.35);border-radius:12px;padding:10px 12px;margin-top:4px"><div style="font-size:13px;color:#f5c26b;font-weight:700;line-height:1.35">Sizes drifted. ${dr}</div><button class="gbtn gold" style="margin-top:8px;min-height:38px;font-size:13px" onClick=${() => setView('groups')}>Rebalance in Groups</button></div>`}</div>
        <div class="panel"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="k">Quiet flags</span><span style="font-size:12px;color:rgba(255,255,255,.45)">Only on your screen</span></div>
          ${!offline.length && html`<div style="font-size:13.5px;color:rgba(255,255,255,.6);margin-top:10px">Every phone is connected.</div>`}
          <div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">${offline.slice(0, 8).map(p => html`<div style="display:flex;align-items:center;gap:10px;padding:4px 0"><span style="width:8px;height:8px;border-radius:50%;background:#f5c26b;flex-shrink:0"></span><span style="flex:1;min-width:0"><span style="display:block;font-size:14px;font-weight:700">${p.name}</span><span style="display:block;font-size:12px;color:rgba(255,255,255,.5)">Phone not responding · may have left or locked their screen</span></span></div>`)}</div></div>
        <div class="panel"><div class="k">On the projector</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px">${[['join', 'Join screen'], ['instructions', 'Instructions'], ['groups', 'Groups by name'], ['off', 'Blank']].map(([m, l]) => html`<button onClick=${() => act('proj', { mode: m })} style=${{ minHeight: '36px', padding: '0 10px', borderRadius: '9px', fontSize: '12.5px', fontWeight: 800, background: meta.projMode === m ? '#2e6bff' : 'rgba(255,255,255,.06)', color: meta.projMode === m ? '#fff' : 'rgba(255,255,255,.7)' }}>${l}</button>`)}</div>
          <button class="gbtn" style="margin-top:12px;width:100%" onClick=${openScreen}>Open projector screen ↗</button></div>
      </div>
    </div>
  </div>`;
}

function Groups({ data, meta, act, active, showToast }) {
  const [draft, setDraft] = useState(null);
  const [count, setCount] = useState(meta.groupCount || 5);
  const [sel, setSel] = useState(null);
  const [seed, setSeed] = useState(1);
  const [npName, setNpName] = useState('');
  const [dragId, setDragId] = useState(null);
  const locked = meta.locked || [];
  const avoid = meta.avoid !== false;
  const map = draft || data.groups;
  const n = draft ? count : (meta.groupCount || 5);
  const cols = Array.from({ length: n }, () => []);
  active.forEach(p => { const g = map[p.id]; if (g != null && cols[g]) cols[g].push(p); });
  const stats = pairStats(map, active);
  const reshuffle = (c = n) => { const s = seed + 1; setSeed(s); setCount(c); setDraft(assignGroups(active, c, locked.slice(0, c), data.groups, avoid, s + Date.now() % 1000)); setSel(null); };
  const rebalance = () => {
    const m = { ...data.groups };
    for (let k = 0; k < 60; k++) {
      const arr = Array.from({ length: n }, () => []); active.forEach(p => { if (arr[m[p.id]]) arr[m[p.id]].push(p); });
      const sz = arr.map(a => a.length), open = [...sz.keys()].filter(g => !locked[g]), pool = open.length > 1 ? open : [...sz.keys()];
      const big = pool.reduce((a, g) => sz[g] > sz[a] ? g : a, pool[0]), small = pool.reduce((a, g) => sz[g] < sz[a] ? g : a, pool[0]);
      if (sz[big] - sz[small] <= 1) break; m[arr[big][arr[big].length - 1].id] = small;
    }
    setCount(n); setDraft(m); setSel(null);
  };
  const moveTo = (id, g) => { if (!id) return; setDraft({ ...(draft || data.groups), [id]: g }); if (!draft) setCount(n); setSel(null); };
  const send = async () => { if (await act('groups', { map: draft, groupCount: count, locked: locked.slice(0, count) }, 'New groups sent to ' + active.length + ' phones')) setDraft(null); };
  const toggleLock = (g) => { const l = Array.from({ length: n }, (_, i) => !!locked[i]); l[g] = !l[g]; act('lock', { locked: l }, gLabel(g) + (l[g] ? ' locked — reshuffles won’t touch it' : ' unlocked')); };
  const selP = sel && active.find(p => p.id === sel);
  return html`<div class="col">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="margin-right:auto"><div style="font-size:28px;font-weight:900;letter-spacing:-.5px">Groups</div><div style="font-size:14px;color:rgba(255,255,255,.6)">${active.length} students · ${stats.fresh} new pairs${stats.rep ? ' · ' + stats.rep + ' repeats from last session' : ''}</div></div>
      <div style="display:flex;align-items:center;gap:6px;background:#1a1c24;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:4px">
        <button onClick=${() => n > 2 && reshuffle(n - 1)} aria-label="Fewer groups" style="width:40px;height:40px;border-radius:9px;background:rgba(255,255,255,.06);font-size:20px">−</button><span style="font-size:14.5px;font-weight:800;padding:0 8px">${n} groups</span><button onClick=${() => n < 5 && reshuffle(n + 1)} aria-label="More groups" style="width:40px;height:40px;border-radius:9px;background:rgba(255,255,255,.06);font-size:20px">+</button></div>
      <button onClick=${() => act('settings', { avoid: !avoid })} style="min-height:48px;display:flex;align-items:center;gap:10px;background:#1a1c24;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:0 14px;font-size:14px;font-weight:700">Avoid last session's groups <${Toggle} on=${avoid} /></button>
      <button class="gbtn blue" style="min-height:48px" onClick=${() => reshuffle()}>Reshuffle</button>
    </div>
    ${draft && html`<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:rgba(245,163,0,.1);border:1px solid rgba(245,163,0,.4);border-radius:16px;padding:14px 16px">
      <div style="flex:1;min-width:220px"><div style="font-size:15px;font-weight:800;color:#f5c26b">Preview — phones haven't changed yet</div><div style="font-size:13.5px;color:rgba(255,255,255,.7);margin-top:2px">Tap a name, then "Move here," to adjust. Send when it looks right.</div></div>
      <button class="gbtn" onClick=${() => reshuffle()}>Shuffle again</button><button class="gbtn" onClick=${() => { setDraft(null); setCount(meta.groupCount || 5); setSel(null); }}>Cancel</button><button class="gbtn gold" onClick=${send}>Send to ${active.length} phones</button></div>`}
    ${!draft && drift(data, meta, active) && html`<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:#1a1c24;border:1px solid rgba(245,163,0,.35);border-radius:16px;padding:12px 16px"><span style="flex:1;font-size:14px;color:#f5c26b;font-weight:700">Group sizes drifted. ${drift(data, meta, active)}</span><button class="gbtn gold" onClick=${rebalance}>Preview rebalance</button></div>`}
    <div style="font-size:13px;color:rgba(255,255,255,.5)">Tap a name and then "Move here" (or drag on a laptop). Locked groups stay put when you reshuffle.</div>
    <div class="board">${cols.map((ms, g) => { const k = G(g), isLocked = !!locked[g]; return html`<div onDragOver=${e => e.preventDefault()} onDrop=${e => { e.preventDefault(); moveTo(dragId, g); setDragId(null); }} style="background:#1a1c24;border:1px solid rgba(255,255,255,.08);border-radius:16px;overflow:hidden;min-height:200px">
      <div style=${{ height: '6px', background: k.base }}></div>
      <div style="display:flex;align-items:center;gap:8px;padding:12px 12px 8px"><span style=${{ color: k.base, fontSize: '16px' }}>${k.sym}</span><span style="flex:1;min-width:0;font-size:14.5px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${gLabel(g)}</span><span style="font-size:13px;font-weight:800;color:rgba(255,255,255,.6)">${ms.length}</span></div>
      <div style="padding:0 12px 8px"><button onClick=${() => toggleLock(g)} style=${{ minHeight: '30px', padding: '0 10px', borderRadius: '8px', fontSize: '12px', fontWeight: 800, background: isLocked ? 'rgba(245,163,0,.2)' : 'rgba(255,255,255,.06)', color: isLocked ? '#f5c26b' : 'rgba(255,255,255,.7)' }}>${isLocked ? 'Locked' : 'Lock'}</button></div>
      <div style="display:flex;flex-direction:column;gap:5px;padding:0 10px 12px">
        ${ms.slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => { const moved = draft && data.groups[p.id] !== g, s = sel === p.id; const badge = p.nophone ? 'no phone' : moved ? 'moved' : p.late ? 'late' : ''; return html`<button class="member" draggable="true" onDragStart=${e => { setDragId(p.id); try { e.dataTransfer.setData('text/plain', p.id); } catch (_) {} }} onClick=${() => setSel(s ? null : p.id)} style=${{ background: s ? 'rgba(46,107,255,.32)' : moved ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.05)', border: '1px solid ' + (s ? '#6f9bff' : moved ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.08)') }}><span style="flex:1;min-width:0;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span>${badge && html`<span style="font-size:10.5px;font-weight:800;text-transform:uppercase;color:rgba(255,255,255,.65);background:rgba(255,255,255,.08);padding:2px 6px;border-radius:6px">${badge}</span>`}</button>`; })}
        ${selP && map[sel] !== g && html`<button onClick=${() => moveTo(sel, g)} style="min-height:40px;border-radius:10px;border:1.5px dashed #6f9bff;color:#8fb0ff;font-size:13px;font-weight:800">Move ${first(selP.name)} here</button>`}
      </div></div>`; })}</div>
    ${selP && !draft && html`<div class="panel" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="flex:1;font-size:14px">${selP.name} left early or joined by mistake?</span><button class="gbtn" onClick=${() => { act('remove', { sid: selP.id }, selP.name + ' removed from the class'); setSel(null); }}>Remove from class</button></div>`}
    <div class="panel"><div class="k">Student without a phone?</div><div style="font-size:13.5px;color:rgba(255,255,255,.6);margin-top:6px">Add them by name. They'll go into the smallest group and appear on the projector's group list.</div>
      <form style="display:flex;gap:8px;margin-top:10px;max-width:460px" onSubmit=${e => { e.preventDefault(); if (npName.trim()) { act('addNoPhone', { name: npName.trim() }, npName.trim() + ' added'); setNpName(''); } }}><input class="field" style="padding:11px 13px;font-size:14px" value=${npName} onInput=${e => setNpName(e.target.value)} placeholder="Student name" maxlength="40" /><button class="gbtn" type="submit">Add</button></form></div>
  </div>`;
}

function Agenda({ meta, T, act, showToast }) {
  const [editKey, setEditKey] = useState(meta.agenda[1] ? meta.agenda[1].key : meta.agenda[0].key);
  const [tplName, setTplName] = useState('');
  const ag = meta.agenda;
  const save = (agenda, budget) => act('agenda', { agenda, budget: budget || meta.budget });
  const setMins = (i, d) => save(ag.map((x, j) => j === i ? { ...x, mins: Math.max(1, x.mins + d) } : x));
  const move = (i, d) => { const a = ag.slice(), j = i + d; if (i < 1 || j < 1 || i > a.length - 2 || j > a.length - 2) return; [a[i], a[j]] = [a[j], a[i]]; save(a); };
  const remove = (i) => { if (i === 0 || i === ag.length - 1) return; save(ag.filter((_, j) => j !== i)); };
  const add = (key) => { const a = ag.slice(); a.splice(a.length - 1, 0, { key, mins: 8 }); save(a); setEditKey(key); };
  const apply = (t) => { act('agenda', { agenda: t.agenda.map(([key, mins]) => ({ key, mins })), budget: t.budget }, 'Loaded “' + t.name + '”'); };
  const templates = meta.templates || [];
  const ed = info(editKey);
  const prompts = (meta.prompts && meta.prompts[editKey]) || ed.prompts;
  const [script, setScript] = useState((meta.scripts && meta.scripts[editKey]) || ed.say);
  const [plist, setPlist] = useState(prompts);
  useEffect(() => { setScript((meta.scripts && meta.scripts[editKey]) || ed.say); setPlist((meta.prompts && meta.prompts[editKey]) || ed.prompts); }, [editKey]);
  const saveContent = (p = plist, s = script) => act('content', { key: editKey, prompts: p.filter(x => x.trim()), script: s }, 'Saved');
  const inAg = ag.map(x => x.key);
  return html`<div class="grid-ag">
    <div class="col">
      <div class="panel" style="padding:14px"><div class="k" style="margin-bottom:10px">Quick start</div>
        <div style="display:flex;flex-direction:column;gap:6px">${QUICK.map(t => html`<button onClick=${() => apply(t)} style="min-height:52px;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px 12px"><span style="display:block;font-size:14.5px;font-weight:800">${t.name}</span><span style="display:block;font-size:12px;color:rgba(255,255,255,.55)">${t.agenda.length - 2} games · ${t.budget} min</span></button>`)}</div></div>
      <div class="panel" style="padding:14px"><div class="k" style="margin-bottom:10px">My templates</div>
        ${!templates.length && html`<div style="font-size:13px;color:rgba(255,255,255,.5)">None yet.</div>`}
        <div style="display:flex;flex-direction:column;gap:6px">${templates.map(t => html`<button onClick=${() => apply(t)} style="min-height:52px;text-align:left;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px 12px"><span style="display:block;font-size:14.5px;font-weight:800">${t.name}</span><span style="display:block;font-size:12px;color:rgba(255,255,255,.55)">${t.agenda.length - 2} games · ${t.budget} min</span></button>`)}</div>
        <input class="field" style="margin-top:10px;padding:11px 12px;font-size:14px" value=${tplName} onInput=${e => setTplName(e.target.value)} placeholder="Name this agenda" maxlength="40" />
        <button class="gbtn" style="margin-top:8px;width:100%;color:#8fb0ff" onClick=${() => { const name = tplName.trim() || 'My plan ' + (templates.length + 1); act('content', { templates: [...templates, { name, budget: meta.budget, agenda: ag.map(x => [x.key, x.mins]) }] }, 'Saved “' + name + '”'); setTplName(''); }}>Save as template</button></div>
    </div>
    <div class="col">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="margin-right:auto"><div style="font-size:26px;font-weight:900;letter-spacing:-.5px">Agenda</div><div style="font-size:14px;color:rgba(255,255,255,.6)">${T.planTotal} min planned</div></div>
        <span style="font-size:13.5px;font-weight:700;color:rgba(255,255,255,.65)">Budget</span>
        <div style="display:flex;align-items:center;gap:4px;background:#1a1c24;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:4px"><button onClick=${() => save(ag, Math.max(5, meta.budget - 5))} aria-label="Less time" style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.06);font-size:18px">−</button><span style="font-size:14.5px;font-weight:800;padding:0 6px">${meta.budget} min</span><button onClick=${() => save(ag, Math.min(180, meta.budget + 5))} aria-label="More time" style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,.06);font-size:18px">+</button></div>
      </div>
      ${T.planTotal > meta.budget ? html`<div style="background:rgba(255,107,94,.1);border:1px solid rgba(255,107,94,.35);color:#ffb3aa;border-radius:12px;padding:11px 14px;font-size:14px;font-weight:700">This agenda is ${T.planTotal - meta.budget} min over your ${meta.budget}-min budget.</div>` : html`<div style="background:rgba(84,214,141,.08);border:1px solid rgba(84,214,141,.3);color:#8fe3b3;border-radius:12px;padding:11px 14px;font-size:14px;font-weight:700">Fits your ${meta.budget}-min budget with ${meta.budget - T.planTotal} min to spare.</div>`}
      ${meta.launched && !meta.ended && html`<div style="font-size:13px;color:rgba(255,255,255,.55)">Class is live — changes apply right away. Avoid reordering activities that already happened.</div>`}
      <div style="display:flex;flex-direction:column;gap:8px">${ag.map((it, i) => { const g = info(it.key), fixed = i === 0 || i === ag.length - 1, s = editKey === it.key; return html`<div style=${{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', background: s ? 'rgba(46,107,255,.14)' : '#1a1c24', border: '1px solid ' + (s ? 'rgba(111,155,255,.55)' : 'rgba(255,255,255,.08)'), borderRadius: '14px', padding: '8px 10px 8px 12px' }}>
        <button onClick=${() => setEditKey(it.key)} style="flex:1;min-width:150px;min-height:44px;display:flex;align-items:center;gap:12px;text-align:left"><span style=${{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0, background: g.color, fontSize: '13px', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>${i + 1}</span><span style="font-size:16px;font-weight:800">${g.name}</span></button>
        <div style="display:flex;align-items:center;gap:4px"><button onClick=${() => setMins(i, -1)} aria-label="Shorter" style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.06)">−</button><span class="mono" style="font-size:14px;width:56px;text-align:center">${it.mins} min</span><button onClick=${() => setMins(i, 1)} aria-label="Longer" style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.06)">+</button></div>
        ${fixed ? html`<span style="width:110px;text-align:center;font-size:12px;color:rgba(255,255,255,.45)">always included</span>` : html`<button onClick=${() => move(i, -1)} aria-label="Move up" style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.06)">↑</button><button onClick=${() => move(i, 1)} aria-label="Move down" style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.06)">↓</button><button onClick=${() => remove(i)} aria-label="Remove" style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.65)">×</button>`}
      </div>`; })}</div>
      ${GAMES.some(g => !inAg.includes(g.key)) && html`<div class="k" style="margin-top:6px">Add a game</div><div style="display:flex;flex-wrap:wrap;gap:8px">${GAMES.filter(g => !inAg.includes(g.key)).map(g => html`<button onClick=${() => add(g.key)} style="min-height:44px;display:flex;align-items:center;gap:8px;padding:0 14px;border-radius:12px;background:rgba(255,255,255,.05);border:1px dashed rgba(255,255,255,.2);font-size:14px;font-weight:700"><span style=${{ width: '10px', height: '10px', borderRadius: '50%', background: g.color }}></span>+ ${g.name}</button>`)}</div>`}
    </div>
    <div class="panel" style="display:flex;flex-direction:column;gap:14px">
      <div style="display:flex;align-items:center;gap:10px"><span style=${{ width: '16px', height: '16px', borderRadius: '50%', background: ed.color }}></span><div><div style="font-size:20px;font-weight:900">${ed.name}</div><div style="font-size:13px;color:rgba(255,255,255,.55)">${ed.tagline}</div></div></div>
      <div><div style="font-size:11.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#9fb9ff;margin-bottom:6px">Say this (read aloud)</div>
        <textarea class="field" rows="5" style="font-size:14px;background:rgba(46,107,255,.08);border-color:rgba(111,155,255,.3)" value=${script} onInput=${e => setScript(e.target.value)} onBlur=${() => saveContent(plist, script)}></textarea></div>
      <div><div class="k" style="margin-bottom:6px">Prompts</div>
        <div style="display:flex;flex-direction:column;gap:6px">${plist.map((t, i) => html`<div style="display:flex;gap:6px"><input class="field" style="padding:10px 12px;font-size:13.5px" value=${t} onInput=${e => setPlist(plist.map((x, j) => j === i ? e.target.value : x))} onBlur=${() => saveContent()} placeholder="Write a prompt" /><button onClick=${() => { const p = plist.filter((_, j) => j !== i); setPlist(p); saveContent(p); }} aria-label="Remove prompt" style="width:38px;border-radius:10px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.65)">×</button></div>`)}</div>
        <button class="gbtn" style="margin-top:8px;color:#8fb0ff" onClick=${() => setPlist([...plist, ''])}>+ Add prompt</button></div>
      <div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px"><span class="k">Projector instructions</span><button onClick=${() => act('proj', { mode: 'instructions', key: editKey }, 'Projector: ' + ed.name)} style="font-size:12.5px;font-weight:800;color:#8fb0ff">Show now →</button></div>
        ${ed.proj.map((t, i) => html`<div style="display:flex;gap:10px;align-items:center;font-size:13.5px;margin-top:6px"><span style=${{ width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0, background: ed.color, fontSize: '11px', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>${i + 1}</span>${t}</div>`)}</div>
      <div style="font-size:13px;color:rgba(255,255,255,.55);line-height:1.45;border-top:1px solid rgba(255,255,255,.08);padding-top:12px"><b style="color:rgba(255,255,255,.75)">Why this game · </b>${ed.why}</div>
    </div>
  </div>`;
}

function Insights({ data, meta, act, active, online, setView }) {
  const [tab, setTab] = useState('progress');
  const qs = meta.introQuestions || [];
  const answered = (id) => data.answers[id] && Object.values(data.answers[id].a || {}).some(x => x && x.trim());
  const rows = data.students.filter(p => p.status !== 'removed').slice().sort((a, b) => a.name.localeCompare(b.name)).map(p => {
    const steps = [p.status === 'active', !!answered(p.id), (data.connCounts[p.id] || 0) > 0];
    const done = steps.filter(Boolean).length;
    return { p, done, steps, on: p.status === 'active' && online(p) };
  });
  const tabs = [['progress', 'Progress'], ['questions', 'Answers']];
  return html`<div class="col">
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap"><div style="margin-right:auto"><div style="font-size:28px;font-weight:900;letter-spacing:-.5px">Insights</div><div style="font-size:14px;color:rgba(255,255,255,.6)">A pulse check, not a grade.</div></div>
      <div style="display:flex;gap:4px;background:#1a1c24;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:4px">${tabs.map(([k, l]) => html`<button onClick=${() => setTab(k)} style=${{ minHeight: '40px', padding: '0 16px', borderRadius: '9px', fontSize: '14px', fontWeight: 800, background: tab === k ? '#2e6bff' : 'transparent', color: tab === k ? '#fff' : 'rgba(255,255,255,.6)' }}>${l}</button>`)}</div></div>
    ${tab === 'progress' && html`
      <div class="panel" style="font-size:13.5px;color:rgba(255,255,255,.7);line-height:1.5">Each student has three check-ins: <b>joined today</b>, <b>answered your questions</b>, and <b>saved at least one connection</b>. The dot shows whether their phone is connected right now.</div>
      ${!rows.length && html`<div class="panel" style="color:rgba(255,255,255,.6)">No students yet.</div>`}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:8px">${rows.map(({ p, done, steps, on }) => { const g = data.groups[p.id], k = g != null ? G(g) : null; return html`<div style="display:flex;align-items:center;gap:12px;background:#1a1c24;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:10px 14px">
        <span style=${{ width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, background: p.status !== 'active' ? 'rgba(255,255,255,.25)' : on ? '#54d68d' : '#f5c26b' }}></span>
        <span style=${{ width: '16px', color: k ? k.base : 'rgba(255,255,255,.3)' }}>${k ? k.sym : '–'}</span>
        <span style="flex:1;min-width:0;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}${p.nophone ? ' · no phone' : ''}</span>
        <span style="display:flex;gap:4px">${steps.map((s, i) => html`<span title=${['Joined today', 'Answered questions', 'Saved a connection'][i]} style=${{ width: '22px', height: '6px', borderRadius: '3px', background: s ? '#6f9bff' : 'rgba(255,255,255,.12)' }}></span>`)}</span>
        <span style="width:64px;text-align:right;font-size:12.5px;font-weight:700;color:rgba(255,255,255,.6)">${p.status === 'away' ? 'Not yet' : done + ' of 3'}</span></div>`; })}</div>`}
    ${tab === 'questions' && html`<div class="grid2">
      <div class="panel"><div class="k">Questions students see at Welcome</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">${qs.map(q => html`<button onClick=${() => act('questions', { questions: qs.map(x => x.id === q.id ? { ...x, active: !x.active } : x) })} style=${{ minHeight: '50px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,.03)', border: '1px solid ' + (q.active ? 'rgba(111,155,255,.45)' : 'rgba(255,255,255,.08)'), borderRadius: '12px', padding: '10px 14px' }}><span style=${{ width: '22px', height: '22px', borderRadius: '6px', flexShrink: 0, background: q.active ? '#2e6bff' : 'rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 900 }}>${q.active ? '✓' : ''}</span><span style="flex:1;font-size:14.5px;font-weight:600">${q.text}</span></button>`)}</div></div>
      <div class="col">${qs.filter(q => q.active).map(q => { const list = Object.values(data.answers).filter(x => x.a && x.a[q.id] && x.a[q.id].trim()); return html`<div class="panel"><div style="font-size:15px;font-weight:800">${q.text}</div><div style="font-size:12.5px;color:rgba(255,255,255,.5);margin-top:2px">${list.length} answer${list.length === 1 ? '' : 's'}</div>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:10px">${list.map(x => html`<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:9px 12px;font-size:14px;line-height:1.4">${x.a[q.id]}<span style="display:block;font-size:12px;color:rgba(255,255,255,.45);margin-top:3px">${x.anon ? 'Anonymous' : x.name}</span></div>`)}</div></div>`; })}
        <div style="font-size:13px;color:rgba(255,255,255,.5);line-height:1.45">Students who chose anonymous appear without names. Answers never go to other students.</div></div>
    </div>`}
  </div>`;
}

function Wrap({ data, meta, act, active, code, showToast, onSignOut }) {
  const [confirmDel, setConfirmDel] = useState(false);
  const roster = data.students.filter(p => p.status === 'active' || p.status === 'away').slice().sort((a, b) => a.name.localeCompare(b.name));
  const emailN = roster.filter(p => p.shareEmail && p.email).length, liN = roster.filter(p => p.shareLinkedin && p.linkedin).length;
  const total = Math.round(Object.values(data.connCounts).reduce((a, b) => a + b, 0) / 2);
  const csvCell = (s) => '"' + String(s || '').replace(/"/g, '""') + '"';
  const download = () => {
    const lines = [['Name', 'Email', 'LinkedIn', 'Group'].join(',')].concat(roster.map(p => [p.name, p.shareEmail ? p.email : '', p.shareLinkedin ? p.linkedin : '', data.groups[p.id] != null ? gLabel(data.groups[p.id]) : ''].map(csvCell).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = code + '-roster.csv'; document.body.appendChild(a); a.click(); a.remove();
    showToast('Downloaded ' + code + '-roster.csv · ' + roster.length + ' rows');
  };
  return html`<div class="col">
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap"><div style="margin-right:auto"><div style="font-size:28px;font-weight:900;letter-spacing:-.5px">Wrap-up</div><div style="font-size:14px;color:rgba(255,255,255,.6)">At the Wrap-up activity, students get one screen: who they met, save, done.</div></div>
      ${meta.launched && !meta.ended && html`<button class="gbtn blue" onClick=${() => act('next', {}, 'Advanced')}>${meta.seg >= meta.agenda.length - 1 ? 'End class' : 'Next activity'} →</button>`}</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
      <div style="background:linear-gradient(150deg,#2e6bff,#173b8c);border-radius:18px;padding:18px"><div style="font-size:36px;font-weight:900">${total}</div><div style="font-size:13.5px;color:rgba(255,255,255,.88)">connections saved between students</div></div>
      <div style="background:linear-gradient(150deg,#2fbf71,#14663c);border-radius:18px;padding:18px"><div style="font-size:36px;font-weight:900">${active.length}</div><div style="font-size:13.5px;color:rgba(255,255,255,.9)">students in today's session</div></div>
      <div class="panel"><div style="font-size:36px;font-weight:900">${Object.keys(data.answers).length}</div><div style="font-size:13.5px;color:rgba(255,255,255,.65)">students answered your questions</div></div>
    </div>
    <div class="panel" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px">
      <div style="display:flex;flex-direction:column;gap:12px"><div style="font-size:18px;font-weight:900">Roster export</div>
        <div style="font-size:13.5px;color:rgba(255,255,255,.65);line-height:1.45">Only what each student chose to share:</div>
        <div style="display:flex;flex-direction:column;gap:8px;font-size:14px">
          <div><span style="color:#54d68d;font-weight:900">✓</span> Name · all ${roster.length} students</div>
          <div><span style="color:#54d68d;font-weight:900">✓</span> Email · ${emailN} who shared it</div>
          <div><span style="color:#54d68d;font-weight:900">✓</span> LinkedIn · ${liN} who shared it</div>
          <div style="color:rgba(255,255,255,.55)">× Not included: question answers, anonymous responses, two truths, activity data</div></div>
        <button class="btn" style="background:#fff;color:#101116;min-height:48px;font-size:15px" disabled=${!roster.length} onClick=${download}>Download CSV · ${roster.length} rows</button></div>
      <div style="min-width:0">
        <div style="display:grid;grid-template-columns:1fr 1.2fr 1.2fr;gap:10px;padding:0 12px 8px" class="k"><span>Name</span><span>Email</span><span>LinkedIn</span></div>
        <div style="display:flex;flex-direction:column;gap:4px">${roster.slice(0, 8).map(p => html`<div style="display:grid;grid-template-columns:1fr 1.2fr 1.2fr;gap:10px;font-size:13.5px;background:rgba(255,255,255,.03);border-radius:8px;padding:9px 12px"><span style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span><span style=${{ color: p.shareEmail && p.email ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.35)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${p.shareEmail && p.email ? p.email : 'not shared'}</span><span style=${{ color: p.shareLinkedin && p.linkedin ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.35)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${p.shareLinkedin && p.linkedin ? p.linkedin : 'not shared'}</span></div>`)}</div>
        ${roster.length > 8 && html`<div style="font-size:12.5px;color:rgba(255,255,255,.45);margin-top:8px;padding-left:12px">Preview · first 8 of ${roster.length}</div>`}</div>
    </div>
    <div class="panel" style="display:flex;flex-direction:column;gap:12px">
      <div style="font-size:18px;font-weight:900">Next class</div>
      <div style="font-size:14px;color:rgba(255,255,255,.7);line-height:1.5">Start a new session with the same code. Students keep their profile and connections, rejoin with one tap, and get grouped with new faces.</div>
      <div><button class="gbtn blue" onClick=${() => { if (confirm('Start a new session? Groups and today’s answers reset; students and connections stay.')) act('newSession', {}, 'New session ready — students rejoin with the same code'); }}>Start a new session</button></div>
    </div>
    <div class="panel" style="display:flex;flex-direction:column;gap:12px;border-color:rgba(255,107,94,.25)">
      <div style="font-size:18px;font-weight:900">Delete class data</div>
      <div style="font-size:14px;color:rgba(255,255,255,.7);line-height:1.5">Permanently erase this class — every student, answer, and connection — from the database. This can't be undone.</div>
      ${!confirmDel ? html`<div><button class="gbtn" style="color:#ffb3aa" onClick=${() => setConfirmDel(true)}>Delete class data…</button></div>` : html`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="gbtn" onClick=${() => setConfirmDel(false)}>Cancel</button><button class="gbtn" style="background:#ff6b5e;border-color:#ff6b5e" onClick=${async () => { if (await act('deleteAll', {}, 'Class deleted')) onSignOut(); }}>Yes, delete everything</button></div>`}
    </div>
  </div>`;
}
