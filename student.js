import { html, useState, useEffect, useRef } from './vendor/preact-htm.js';
import { G, gLabel, info, GAMES } from './content.js';
import { ls, normCode, first, short, fmt, post, usePoll, useTick, timing, Toggle, Dots, useToast, colorVars, GuideSheet } from './lib.js';

const blankProfile = { name: '', email: '', linkedin: '', shareEmail: true, shareLinkedin: true, anon: false };

export function Student({ initialCode }) {
  const [code, setCode] = useState(initialCode || '');
  const [screen, setScreen] = useState(initialCode ? 'checking' : 'landing');
  const [codeInput, setCodeInput] = useState('');
  const [err, setErr] = useState('');
  const [profile, setProfile] = useState(() => ({ ...blankProfile, ...ls.get('wl:profile', {}) }));
  const [sid, setSid] = useState(null);
  const [busy, setBusy] = useState(false);

  const goCode = async (c) => {
    c = normCode(c); if (!c) return;
    setErr(''); setBusy(true);
    try {
      const { exists } = await post({ op: 'check', code: c });
      if (!exists) { setErr('No class with that code. Check the screen at the front of the room.'); setScreen('code'); return; }
      setCode(c);
      try { history.replaceState(null, '', '/?c=' + c); } catch (_) {}
      const known = ls.get('wl:sid:' + c, null);
      if (known && profile.name) { setSid(known); setScreen('returning'); } else setScreen('profile');
    } catch (e) { setErr(e.message); setScreen('code'); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (initialCode) goCode(initialCode); }, []);

  const join = async () => {
    if (!profile.name.trim()) return;
    setBusy(true); setErr('');
    ls.set('wl:profile', profile);
    try {
      const r = await post({ op: 'join', code, sid: ls.get('wl:sid:' + code, null), profile });
      ls.set('wl:sid:' + code, r.sid); setSid(r.sid);
      setScreen('assigning');
      setTimeout(() => setScreen('reveal:' + r.g + (r.late ? ':late' : '')), 900);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  if (screen === 'landing') return html`<${Landing} onStudent=${() => setScreen('code')} />`;
  if (screen === 'checking') return html`<div class="phone dark-bg"><div class="pad" style="justify-content:center;align-items:center"><${Dots} /></div></div>`;
  if (screen === 'code') return html`<${CodeScreen} value=${codeInput} onInput=${setCodeInput} err=${err} busy=${busy} onSubmit=${() => goCode(codeInput)} onBack=${() => setScreen('landing')} />`;
  if (screen === 'returning') return html`<div class="phone dark-bg"><div class="pad">
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px">
        <div class="eyebrow">Class ${code}</div>
        <div class="h1" style="font-size:40px">Welcome back, ${first(profile.name)}</div>
        <div class="sub">You'll rejoin your class and get today's group.</div>
      </div>
      ${err && html`<div class="err">${err}</div>`}
      <button class="btn btn-white" disabled=${busy} onClick=${join}>Join today's class →</button>
      <button style="margin-top:10px;min-height:44px;font-size:14px;font-weight:600;color:rgba(255,255,255,.6)" onClick=${() => { ls.del('wl:sid:' + code); setProfile({ ...blankProfile }); setScreen('profile'); }}>Not ${first(profile.name)}? Start fresh</button>
    </div></div>`;
  if (screen === 'profile') return html`<${ProfileScreen} code=${code} p=${profile} set=${setProfile} err=${err} busy=${busy} onSubmit=${join} />`;
  if (screen === 'assigning') return html`<div class="phone dark-bg"><div class="pad" style="justify-content:center;align-items:center;gap:26px">
      <div class="dots">${['#06b6a4', '#7a4dff', '#ff6b5e', '#2e6bff', '#f5a300'].map((c, i) => html`<span style=${{ background: c, animation: `wl-livedot 1s ease-in-out ${i * 0.15}s infinite` }}></span>`)}</div>
      <div style="font-size:19px;font-weight:600;color:rgba(255,255,255,.72)">Finding your group…</div></div></div>`;
  if (screen.startsWith('reveal:')) {
    const [, g, late] = screen.split(':');
    return html`<${Reveal} g=${Number(g)} onConfirm=${() => setScreen('app' + (late ? ':late' : ''))} />`;
  }
  return html`<${StudentApp} code=${code} sid=${sid} profile=${profile} setProfile=${setProfile} lateIntro=${screen === 'app:late'} onRejoin=${() => setScreen('returning')} />`;
}

function Landing({ onStudent }) {
  return html`<div class="phone dark-bg" style="overflow:hidden">
    <div style="position:absolute;bottom:-40px;left:-10%;width:220%;opacity:.5;animation:wl-drift 9s linear infinite;pointer-events:none">
      <svg viewBox="0 0 200 40" width="100%" height="160" preserveAspectRatio="none"><defs><linearGradient id="wlg" x1="0" x2="1"><stop offset="0" stop-color="#06b6a4"/><stop offset=".35" stop-color="#7a4dff"/><stop offset=".6" stop-color="#ff6b5e"/><stop offset=".8" stop-color="#2e6bff"/><stop offset="1" stop-color="#f5a300"/></linearGradient></defs><path d="M0 20 Q 12.5 2 25 20 T 50 20 T 75 20 T 100 20 T 125 20 T 150 20 T 175 20 T 200 20" fill="none" stroke="url(#wlg)" stroke-width="2.4"/></svg>
    </div>
    <div class="pad" style="position:relative">
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:26px">
        <${Dots} />
        <div><div style="font-size:44px;font-weight:900;letter-spacing:-1.5px;line-height:1">Wavelength</div>
        <div style="margin-top:18px;font-size:18px;line-height:1.4;color:rgba(255,255,255,.65);max-width:280px">Where strangers become friends</div></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px">
        <button class="btn btn-white" onClick=${onStudent}>I'm here for class →</button>
        <a class="btn btn-ghost" style="text-decoration:none" href="/teach">I'm running the class</a>
      </div>
    </div></div>`;
}

function CodeScreen({ value, onInput, err, busy, onSubmit, onBack }) {
  return html`<div class="phone dark-bg"><div class="pad">
    <button onClick=${onBack} style="color:rgba(255,255,255,.6);font-size:15px;font-weight:600;align-self:flex-start;min-height:44px;margin-bottom:14px">← Back</button>
    <div class="eyebrow">Step 1 of 2</div>
    <div class="h1">Join your class</div>
    <form style="margin-top:26px" onSubmit=${(e) => { e.preventDefault(); onSubmit(); }}>
      <input class="field mono" value=${value} onInput=${e => onInput(e.target.value.toUpperCase())} placeholder="Class code" maxlength="8" autocapitalize="characters" autocomplete="off" style="font-size:28px;letter-spacing:4px;text-align:center;padding:20px" aria-label="Class code" />
      ${err && html`<div class="err" style="text-align:center">${err}</div>`}
    </form>
    <div class="sub" style="text-align:center;font-size:13.5px">Or scan the QR code on the screen with your camera. Nothing to download.</div>
    <div style="flex:1"></div>
    <button class="btn btn-white" disabled=${!value.trim() || busy} onClick=${onSubmit}>${busy ? 'Checking…' : 'Continue'}</button>
  </div></div>`;
}

function VisChip({ on, onClick }) {
  return html`<button onClick=${onClick} class="chip" style=${{ minHeight: '32px', color: on ? '#ffd37a' : 'rgba(255,255,255,.75)', background: on ? 'rgba(255,211,122,.18)' : 'rgba(255,255,255,.1)' }}>${on ? 'Connections see this' : 'Only you'} ⇄</button>`;
}

function ProfileScreen({ code, p, set, err, busy, onSubmit }) {
  const up = (k, v) => set({ ...p, [k]: v });
  return html`<div class="phone dark-bg"><div class="pad" style="gap:18px">
    <div><div class="eyebrow">Step 2 of 2 · Class ${code}</div><div class="h1" style="font-size:30px">How classmates see you</div></div>
    <div>
      <div class="label-row"><span>Name <span style="color:rgba(255,255,255,.5);font-weight:600">· required</span></span><span class="chip" style="background:rgba(255,255,255,.14)">Everyone in class</span></div>
      <input class="field" value=${p.name} onInput=${e => up('name', e.target.value)} placeholder="What classmates call you" maxlength="40" autocomplete="name" aria-label="Your name" />
    </div>
    <div>
      <div class="label-row"><span>Email <span style="color:rgba(255,255,255,.5);font-weight:600">· optional</span></span><${VisChip} on=${p.shareEmail} onClick=${() => up('shareEmail', !p.shareEmail)} /></div>
      <input class="field" type="email" value=${p.email} onInput=${e => up('email', e.target.value)} placeholder="you@school.edu" autocomplete="email" aria-label="Email" />
    </div>
    <div>
      <div class="label-row"><span>LinkedIn <span style="color:rgba(255,255,255,.5);font-weight:600">· optional</span></span><${VisChip} on=${p.shareLinkedin} onClick=${() => up('shareLinkedin', !p.shareLinkedin)} /></div>
      <input class="field" value=${p.linkedin} onInput=${e => up('linkedin', e.target.value)} placeholder="linkedin.com/in/you" aria-label="LinkedIn" />
    </div>
    <button onClick=${() => up('anon', !p.anon)} style="width:100%;min-height:64px;display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:12px 16px;text-align:left">
      <span style="flex:1"><span style="display:block;font-size:15px;font-weight:800">Answer teacher questions anonymously</span><span style="display:block;font-size:13px;color:rgba(255,255,255,.6);margin-top:3px;line-height:1.35">Your teacher sees your answers without your name.</span></span>
      <${Toggle} on=${p.anon} />
    </button>
    <div style="font-size:12.5px;color:rgba(255,255,255,.5);line-height:1.45">Your name and group are visible to your class. Email and LinkedIn go only to people you connect with, and to your teacher's roster if you share them.</div>
    ${err && html`<div class="err">${err}</div>`}
    <div style="flex:1"></div>
    <button class="btn btn-white" disabled=${!p.name.trim() || busy} onClick=${onSubmit}>${busy ? 'Joining…' : 'Find my group'}</button>
  </div></div>`;
}

function Reveal({ g, onConfirm }) {
  const C = G(g);
  return html`<div class="phone color-bg" style=${{ ...colorVars(g), overflow: 'hidden' }}><div class="pad" style="align-items:center">
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:36px">
      <div style="font-size:15px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,.75);animation:wl-pop .4s .15s both">Your group</div>
      <div style="position:relative;display:flex;align-items:center;justify-content:center">
        <div style="position:absolute;width:196px;height:196px;border-radius:50%;border:3px solid #fff;animation:wl-ring 1.1s ease-out .3s both"></div>
        <div class="orb" style="width:196px;height:196px;font-size:84px;animation:wl-bloom .7s cubic-bezier(.34,1.4,.5,1) both, wl-glow 2.4s 1s ease-in-out infinite">${C.sym}</div>
      </div>
      <div style="text-align:center;animation:wl-pop .5s .25s both">
        <div style="font-size:22px;font-weight:500;color:rgba(255,255,255,.8)">You're</div>
        <div style="font-size:72px;font-weight:900;letter-spacing:-2px;line-height:1">${C.name}</div>
        <div style="font-size:24px;font-weight:800;margin-top:8px">${C.sym} ${C.shape}</div>
      </div>
    </div>
    <button class="btn btn-white" style="color:var(--cd)" onClick=${onConfirm}>This is me</button>
  </div></div>`;
}

function StudentApp({ code, sid, profile, setProfile, lateIntro, onRejoin }) {
  const { data, offline, error, offset, refresh } = usePoll({ code, role: 'student', sid, interval: 3000 });
  useTick(1000);
  const [tab, setTab] = useState('now');
  const [big, setBig] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [coachOpen, setCoachOpen] = useState(true);
  const [lateCard, setLateCard] = useState(lateIntro);
  const [toast, showToast] = useToast();
  const lastG = useRef(null), lastSeg = useRef(null);
  const [moved, setMoved] = useState(false);
  const [doneLocal, setDoneLocal] = useState(null); // optimistic { round, done }

  const me = data && data.me;
  const meta = data && data.meta;
  useEffect(() => {
    if (!me || me.g == null) return;
    if (lastG.current != null && lastG.current !== me.g) { setMoved(true); try { navigator.vibrate && navigator.vibrate(200); } catch (_) {} }
    lastG.current = me.g;
  }, [me && me.g]);
  const segKey = meta ? (meta.agenda[meta.seg] || {}).key + ':' + meta.seg : null;
  useEffect(() => { if (segKey && lastSeg.current && lastSeg.current !== segKey) { setCoachOpen(true); setTab('now'); } lastSeg.current = segKey; }, [segKey]);

  if (error && !data) return html`<div class="phone dark-bg"><div class="pad" style="justify-content:center;gap:16px"><div class="h1">Can't reach the class</div><div class="sub">${error}</div><button class="btn btn-white" onClick=${refresh}>Try again</button></div></div>`;
  if (!data) return html`<div class="phone dark-bg"><div class="pad" style="justify-content:center;align-items:center"><${Dots} /></div></div>`;
  if (!me || me.status !== 'active' || me.g == null) return html`<div class="phone dark-bg"><div class="pad" style="justify-content:center;gap:16px">
      <div class="h1">${me && me.status === 'removed' ? 'You were removed from this class' : 'A new session started'}</div>
      <div class="sub">${me && me.status === 'removed' ? 'If that was a mistake, rejoin below.' : 'Rejoin to get today’s group.'}</div>
      <button class="btn btn-white" onClick=${onRejoin}>Rejoin class</button></div></div>`;

  const g = me.g, C = G(g);
  const T = timing(meta, offset);
  const segItem = T.item, seg = T.seg;
  const mates = data.roster.filter(p => p.id !== sid && p.g === g);
  const prompts = ((meta.prompts && meta.prompts[segItem.key]) || seg.prompts || []).filter(Boolean);
  const pool = prompts.length ? prompts : ((meta.prompts && meta.prompts.frequency) || info('frequency').prompts);
  const segLeftLabel = !meta.launched ? 'starting soon' : meta.ended ? 'class has ended' : T.segLeft >= 0 ? fmt(T.segLeft) + ' left' : 'wrapping up';
  const isGame = !!GAMES.find(x => x.key === segItem.key);
  const round = meta.round || 0;
  const isDone = doneLocal && doneLocal.round === round ? doneLocal.done : me.doneRound === round;
  const canDone = meta.launched && !meta.ended && segItem.key !== 'welcome' && segItem.key !== 'wrap';
  const toggleDone = async () => {
    const nd = !isDone; setDoneLocal({ round, done: nd });
    try { await post({ op: 'done', code, sid, round, done: nd }); if (nd) showToast('Your teacher can see you’re done'); }
    catch (e) { setDoneLocal({ round, done: !nd }); showToast(e.message); }
  };
  const doneBtn = canDone && html`<${DoneButton} done=${isDone} onClick=${toggleDone} />`;
  const showWrap = meta.ended || segItem.key === 'wrap';

  const saveProfile = async (patch) => {
    const np = { ...profile, ...patch }; setProfile(np); ls.set('wl:profile', np);
    try { await post({ op: 'profile', code, sid, profile: patch }); refresh(); } catch (e) { showToast(e.message); }
  };

  return html`<div class="phone color-bg" style=${{ ...colorVars(g), height: '100dvh', minHeight: 0, overflow: 'hidden' }}>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px 10px;flex-shrink:0">
      <div style="display:flex;align-items:center;gap:12px;min-width:0">
        <span class="orb" style="width:44px;height:44px;flex-shrink:0;font-size:18px;box-shadow:0 0 0 3px rgba(255,255,255,.25)">${C.sym}</span>
        <div style="min-width:0"><div style="font-size:13px;color:rgba(255,255,255,.75);font-weight:600">Hi ${first(me.name)}</div><div style="font-size:17px;font-weight:800">${gLabel(g)}</div></div>
      </div>
      <div style="display:flex;gap:8px">
        <button onClick=${() => setBig(!big)} aria-label="Larger text" style=${{ width: '44px', height: '44px', borderRadius: '50%', background: big ? 'rgba(255,255,255,.4)' : 'rgba(255,255,255,.14)', fontWeight: 800, fontSize: '15px' }}>Aa</button>
        <button onClick=${() => setSheet('privacy')} aria-label="Privacy" style="width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.14);font-size:15px;font-weight:900">i</button>
      </div>
    </div>
    ${offline && html`<div class="netpill" style="margin:0 16px 8px;flex-shrink:0"><span style="width:8px;height:8px;border-radius:50%;background:#f5c26b;animation:wl-livedot 1.2s infinite;flex-shrink:0"></span>Weak connection · your group is saved on this phone. Updates will catch up.</div>`}
    ${tab === 'now' && meta.launched && !meta.ended && html`<div style="margin:0 16px 8px;background:#fff;color:#101116;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.2);flex-shrink:0">
      <button onClick=${() => setCoachOpen(!coachOpen)} style="width:100%;min-height:50px;padding:10px 14px;display:flex;align-items:center;gap:12px;text-align:left;color:#101116">
        <span class="orb" style="width:30px;height:30px;flex-shrink:0;font-size:13px;color:#fff;background:radial-gradient(circle at 38% 32%,var(--cs),var(--c))">${C.sym}</span>
        <span style="flex:1;min-width:0"><span style="display:block;font-size:10.5px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:rgba(16,17,22,.5)">Do this now · ${seg.name}</span>
          <span style=${{ display: 'block', fontSize: coachOpen ? '15px' : '14px', fontWeight: 700, lineHeight: 1.3, marginTop: '2px', whiteSpace: coachOpen ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${seg.coach}</span></span>
        <span style="font-size:12px;font-weight:800;color:rgba(16,17,22,.45);align-self:flex-start;padding-top:2px">${coachOpen ? 'Hide' : 'Show'}</span>
      </button></div>`}

    <div style=${{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', zoom: big ? 1.2 : 1 }}>
      ${tab === 'now' && html`<div style="padding:4px 16px 24px;display:flex;flex-direction:column;gap:14px">
        ${moved && html`<div class="card-white" style="display:flex;align-items:center;gap:12px;padding:16px 18px"><span style="flex:1;font-size:16px;font-weight:800;line-height:1.3">New group: ${C.sym} ${gLabel(g)}. Find phones showing your new color.</span><button class="btn-sm" style="background:var(--cd);color:#fff" onClick=${() => setMoved(false)}>Got it</button></div>`}
        ${lateCard && meta.launched && html`<div class="card-white"><div style="font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.55">Joined mid-class · you haven't missed anything important</div>
          <div style="font-size:15.5px;font-weight:700;margin-top:8px;line-height:1.4">Look for: ${mates.slice(0, 5).map(m => first(m.name)).join(', ') || 'your color on other phones'}</div>
          <button class="btn-sm" style="margin-top:12px;background:var(--cd);color:#fff" onClick=${() => setLateCard(false)}>Got it</button></div>`}
        <div class="card" style="padding:22px">
          <div style="display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.78)"><span style="width:8px;height:8px;border-radius:50%;background:#fff;animation:wl-livedot 1.4s infinite"></span>${meta.launched ? 'Happening now' : 'Before class'} · ${segLeftLabel}</div>
          <div style="font-size:34px;font-weight:900;letter-spacing:-1.2px;line-height:1.04;margin-top:10px">${meta.launched ? seg.name : 'Class starts soon'}</div>
          <div style="font-size:16.5px;color:rgba(255,255,255,.88);margin-top:8px;line-height:1.4">${meta.launched ? seg.do : 'You’re in. Say hi to someone near you while everyone joins.'}</div>
          ${meta.launched && isGame && html`<button class="btn-sm" style="margin-top:16px;background:#fff;color:var(--cd);border-radius:30px" onClick=${() => setSheet('guide')}>How to play</button>`}
        </div>
        ${meta.pushedPrompt && html`<div class="card-white"><div style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;opacity:.6">From your instructor</div><div style="font-size:21px;font-weight:800;line-height:1.25;margin-top:8px">${meta.pushedPrompt}</div></div>`}
        ${doneBtn}
        ${meta.calledNum && segItem.key === 'molecules' && html`<div class="card-white" style="text-align:center"><div style="font-size:12px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.6">Make a group of</div><div style="font-size:72px;font-weight:900;line-height:1">${meta.calledNum}</div></div>`}
        ${(!meta.launched || segItem.key === 'welcome') && html`<${IntroQuestions} code=${code} sid=${sid} meta=${meta} me=${me} anon=${profile.anon} onAnon=${() => saveProfile({ anon: !profile.anon })} toast=${showToast} refresh=${refresh} />`}
        ${meta.launched && segItem.key === 'truths' && html`<${Truths} />`}
        ${showWrap && html`<${WrapPick} code=${code} sid=${sid} data=${data} me=${me} profile=${profile} toast=${showToast} refresh=${refresh} />`}
        ${meta.launched && !meta.ended && html`<div style="display:flex;align-items:center;gap:12px;padding:4px 4px 0;color:rgba(255,255,255,.7);font-size:13.5px"><span style="font-weight:700">Up next</span><span style="flex:1;height:1px;background:rgba(255,255,255,.22)"></span><span>${T.next ? T.next.name : 'You’re all set'}</span></div>`}
      </div>`}
      ${tab === 'group' && html`<${GroupTab} C=${C} g=${g} mates=${mates} pool=${pool} doneBtn=${doneBtn} />`}
      ${tab === 'connect' && html`<${ConnectTab} code=${code} sid=${sid} data=${data} me=${me} profile=${profile} saveProfile=${saveProfile} toast=${showToast} refresh=${refresh} />`}
    </div>

    <div class="tabbar">
      <button onClick=${() => setTab('now')} style=${{ color: tab === 'now' ? '#fff' : 'rgba(255,255,255,.55)' }}><span style="width:22px;height:22px;border-radius:50%;border:2.4px solid currentColor;display:flex;align-items:center;justify-content:center"><span style="width:6px;height:6px;border-radius:50%;background:currentColor"></span></span>Now</button>
      <button onClick=${() => setTab('group')} style=${{ color: tab === 'group' ? '#fff' : 'rgba(255,255,255,.55)' }}><span style="height:22px;font-size:17px;line-height:22px">${C.sym}</span>Group</button>
      <button onClick=${() => setTab('connect')} style=${{ color: tab === 'connect' ? '#fff' : 'rgba(255,255,255,.55)' }}><span style="width:22px;height:22px;border-radius:8px;border:2.4px solid currentColor;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800">+</span>Connect</button>
    </div>
    ${sheet === 'guide' && html`<${GuideSheet} k=${segItem.key} onClose=${() => setSheet(null)} />`}
    ${sheet === 'privacy' && html`<div class="sheet-wrap"><button class="scrim" aria-label="Close" onClick=${() => setSheet(null)}></button><div class="sheet">
      <div class="grab"></div><div style="font-size:22px;font-weight:900">About your privacy</div>
      <div style="font-size:14px;color:rgba(255,255,255,.65);margin-top:8px;line-height:1.5">You always know where an answer goes before you send it.</div>
      ${[['Everyone in class', 'rgba(255,255,255,.85)', 'Your name and your group color.'], ['Teacher only', '#9db8ff', 'Your get-to-know-you answers. Turn on anonymous and your name is left off.'], ['Connections', '#ffd37a', 'Only the contact info you choose to share. Also the only contact info in your teacher’s roster export.'], ['Stays on this phone', '#6fe3ab', 'Your two truths.']].map(([t, c, d]) => html`<div style="background:#1f2027;border-radius:14px;padding:13px 15px;margin-top:10px"><div style=${{ fontSize: '11.5px', fontWeight: 800, textTransform: 'uppercase', color: c }}>● ${t}</div><div style="font-size:14px;color:rgba(255,255,255,.65);margin-top:5px;line-height:1.4">${d}</div></div>`)}
    </div></div>`}
    ${toast}
  </div>`;
}

function IntroQuestions({ code, sid, meta, me, anon, onAnon, toast, refresh }) {
  const qs = (meta.introQuestions || []).filter(q => q.active);
  const submitted = me.answers && Object.keys(me.answers).length > 0;
  const [ans, setAns] = useState(() => ({ ...(me.answers || {}) }));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!qs.length) return null;
  if (submitted && !editing) return html`<div style="background:rgba(84,214,141,.18);border:1px solid rgba(84,214,141,.42);border-radius:20px;padding:16px 18px;font-weight:700;font-size:14.5px;display:flex;align-items:center;gap:10px"><span style="flex:1">✓ ${anon ? 'Sent anonymously — your teacher sees answers, not your name.' : 'Thanks — your teacher can see your answers.'}</span><button class="btn-sm" style="background:rgba(255,255,255,.14)" onClick=${() => setEditing(true)}>Edit</button></div>`;
  const send = async () => {
    setBusy(true);
    try { await post({ op: 'answers', code, sid, answers: ans }); setEditing(false); refresh(); } catch (e) { toast(e.message); }
    finally { setBusy(false); }
  };
  return html`<div class="card">
    <div class="eyebrow" style="color:rgba(255,255,255,.75)">A few questions from your teacher</div>
    <div style="font-size:13.5px;color:rgba(255,255,255,.72);margin-top:6px">Optional. Helps them get to know the class.</div>
    <button onClick=${onAnon} style="margin-top:14px;width:100%;min-height:52px;display:flex;align-items:center;gap:12px;background:rgba(0,0,0,.2);border-radius:14px;padding:10px 14px;text-align:left">
      <span style="flex:1"><span style="display:block;font-size:14.5px;font-weight:800">Answer anonymously</span><span style="display:block;font-size:12.5px;color:rgba(255,255,255,.7);margin-top:2px">Your teacher sees the answer, not your name.</span></span><${Toggle} on=${anon} />
    </button>
    <div style="display:flex;flex-direction:column;gap:14px;margin-top:16px">
      ${qs.map(q => html`<div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px"><span style="font-size:14.5px;font-weight:700;line-height:1.3">${q.text}</span>
        <span class="chip" style="color:#c9d7ff;background:rgba(111,155,255,.24);font-size:10px">${anon ? 'Teacher · anonymous' : 'Teacher only'}</span></div>
        <input class="field" style="padding:13px 14px;font-size:15px;background:rgba(255,255,255,.1)" value=${ans[q.id] || ''} onInput=${e => setAns({ ...ans, [q.id]: e.target.value })} placeholder="Type your answer…" maxlength="500" />
      </div>`)}
    </div>
    <button class="btn" style="margin-top:16px;min-height:50px;font-size:15px;background:#fff;color:var(--cd)" disabled=${busy} onClick=${send}>Share with my teacher</button>
  </div>`;
}

function Truths() {
  const [t, setT] = useState(() => ls.get('wl:truths', { a: '', b: '', done: false }));
  const save = (n) => { setT(n); ls.set('wl:truths', n); };
  if (t.done) return html`<div style="background:rgba(84,214,141,.18);border:1px solid rgba(84,214,141,.42);border-radius:20px;padding:16px 18px;font-weight:700;font-size:14.5px">
    <div>✓ Locked in. Find a partner with a different color.</div>
    <div style="font-weight:600;margin-top:10px;line-height:1.5">1. ${t.a}<br />2. ${t.b}</div>
    <button class="btn-sm" style="margin-top:10px;background:rgba(255,255,255,.14)" onClick=${() => save({ ...t, done: false })}>Edit</button></div>`;
  return html`<div class="card">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span class="eyebrow" style="color:rgba(255,255,255,.75)">Your two truths</span><span class="chip" style="background:rgba(255,255,255,.16);font-size:10px">Stays on this phone</span></div>
    <input class="field" style="margin-top:14px;background:rgba(255,255,255,.1)" value=${t.a} onInput=${e => save({ ...t, a: e.target.value })} placeholder="Truth #1" />
    <input class="field" style="margin-top:10px;background:rgba(255,255,255,.1)" value=${t.b} onInput=${e => save({ ...t, b: e.target.value })} placeholder="Truth #2" />
    <button class="btn" style="margin-top:14px;min-height:50px;font-size:15px;background:#fff;color:var(--cd)" disabled=${!t.a.trim() || !t.b.trim()} onClick=${() => save({ ...t, done: true })}>Ready to trade</button>
  </div>`;
}

function shareSummary(p) {
  const bits = ['name'].concat(p.shareEmail && p.email ? ['email'] : []).concat(p.shareLinkedin && p.linkedin ? ['LinkedIn'] : []);
  return bits.length === 1 ? 'name' : bits.slice(0, -1).join(', ') + ' and ' + bits[bits.length - 1];
}

function WrapPick({ code, sid, data, me, profile, toast, refresh }) {
  const already = new Set((me.conns || []).map(c => c.id));
  const roster = data.roster.filter(p => p.id !== sid && !p.nophone && !already.has(p.id));
  const mates = roster.filter(p => p.g === me.g);
  const others = roster.filter(p => p.g !== me.g);
  const [picked, setPicked] = useState(() => new Set(mates.map(p => p.id)));
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  if (done) return html`<div style="background:rgba(84,214,141,.18);border:1px solid rgba(84,214,141,.42);border-radius:20px;padding:18px;font-weight:700;font-size:15px;line-height:1.4">✓ Saved ${done} connection${done === 1 ? '' : 's'}. They're in Connect.</div>`;
  if (!roster.length) return html`<div class="card" style="font-weight:700">You're connected with everyone here. Nice.</div>`;
  const toggle = (id) => { const n = new Set(picked); n.has(id) ? n.delete(id) : n.add(id); setPicked(n); };
  const row = (p, tag) => { const on = picked.has(p.id), k = G(p.g); return html`<button onClick=${() => toggle(p.id)} style=${{ width: '100%', minHeight: '54px', display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', borderRadius: '14px', border: '1.5px solid ' + (on ? 'var(--c)' : 'rgba(0,0,0,.1)'), textAlign: 'left', color: 'var(--cd)' }}>
      <span style=${{ width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0, background: k.base, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>${(p.name || '?')[0].toUpperCase()}</span>
      <span style="flex:1"><span style="display:block;font-size:15.5px;font-weight:800">${short(p.name)}</span><span style="display:block;font-size:12.5px;opacity:.6">${tag}</span></span>
      <span style=${{ width: '26px', height: '26px', borderRadius: '8px', flexShrink: 0, background: on ? 'var(--cd)' : 'rgba(0,0,0,.08)', color: '#fff', fontSize: '14px', fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>${on ? '✓' : ''}</span></button>`; };
  const save = async () => {
    setBusy(true);
    try { await post({ op: 'connect', code, sid, ids: [...picked] }); setDone(picked.size); refresh(); } catch (e) { toast(e.message); }
    finally { setBusy(false); }
  };
  return html`<div class="card-white">
    <div style="font-size:12px;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;opacity:.55">Before you go · under a minute</div>
    <div style="font-size:24px;font-weight:900;letter-spacing:-.5px;margin-top:6px">Who did you meet?</div>
    <div style="font-size:13.5px;opacity:.7;margin-top:4px;line-height:1.4">Tap to keep. You'll each see the other's shared info. They'll get your ${shareSummary(profile)}.</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
      ${mates.map(p => row(p, 'Your group'))}
      ${(showAll ? others : others.filter(p => picked.has(p.id))).map(p => row(p, gLabel(p.g)))}
    </div>
    ${others.length > 0 && !showAll && html`<button class="btn-sm" style="margin-top:10px;color:var(--cd);text-decoration:underline" onClick=${() => setShowAll(true)}>Met someone from another group? Show everyone (${others.length})</button>`}
    <button class="btn" style="margin-top:14px;background:var(--cd);color:#fff;font-size:16px" disabled=${busy || !picked.size} onClick=${save}>Save ${picked.size} connection${picked.size === 1 ? '' : 's'}</button>
  </div>`;
}

function DoneButton({ done, onClick }) {
  return html`<button onClick=${onClick} aria-pressed=${done} style=${{ width: '100%', minHeight: '60px', borderRadius: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '17px', fontWeight: 800, background: done ? 'rgba(84,214,141,.22)' : 'rgba(255,255,255,.95)', color: done ? '#fff' : 'var(--cd)', border: done ? '1.5px solid rgba(84,214,141,.6)' : '1.5px solid transparent' }}>
    ${done ? html`<span>✓ Done — teacher notified</span><span style="font-size:13px;font-weight:700;opacity:.75">· Undo</span>` : html`<span>We're done discussing</span>`}
  </button>`;
}

function GroupTab({ C, mates, pool, doneBtn }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  return html`<div style="min-height:100%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:24px 30px 110px">
    <div class="orb" style="width:236px;height:236px;font-size:104px;animation:wl-glow 3s ease-in-out infinite">${C.sym}</div>
    <div style="text-align:center"><div style="font-size:66px;font-weight:900;letter-spacing:-2px;line-height:1">${C.name}</div><div style="font-size:24px;font-weight:800;margin-top:8px">${C.sym} ${C.shape}</div></div>
    ${mates.length > 0 && html`<div style="text-align:center;font-size:14.5px;color:rgba(255,255,255,.85);line-height:1.5;max-width:320px">With ${mates.map(m => first(m.name)).join(', ')}</div>`}
    ${!open && html`<button onClick=${() => setOpen(true)} style="position:absolute;bottom:14px;left:0;right:0;min-height:56px;display:flex;flex-direction:column;align-items:center;gap:4px;color:rgba(255,255,255,.85)"><span style="font-size:22px;line-height:.6">⌃</span><span style="font-size:13.5px;font-weight:700">Tap for a conversation prompt</span></button>`}
    ${open && html`<div style="position:absolute;bottom:12px;left:14px;right:14px;animation:wl-sheet .34s cubic-bezier(.4,0,.2,1) both">
      <div style="background:#fff;color:var(--cd);border-radius:24px;padding:18px 22px 20px;box-shadow:0 -12px 44px rgba(0,0,0,.4)">
        <div style="display:flex;align-items:center;justify-content:space-between"><span style="font-size:11px;font-weight:800;letter-spacing:1px;text-transform:uppercase;opacity:.55">Talk about this</span><button onClick=${() => setOpen(false)} aria-label="Close" style="width:44px;height:44px;margin:-12px -12px -12px 0;font-size:20px;color:rgba(0,0,0,.4)">×</button></div>
        <div style="font-size:21px;font-weight:800;line-height:1.25;margin-top:6px">${pool[i % pool.length]}</div>
        <button onClick=${() => setI(i + 1)} style="margin-top:10px;min-height:44px;font-size:14px;font-weight:800;text-decoration:underline">New prompt →</button>
      </div>${doneBtn && html`<div style="margin-top:10px">${doneBtn}</div>`}</div>`}
    ${!open && doneBtn && html`<div style="width:100%;max-width:360px">${doneBtn}</div>`}
  </div>`;
}

function ConnectTab({ code, sid, data, me, profile, saveProfile, toast, refresh }) {
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [li, setLi] = useState(profile.linkedin || '');
  const [em, setEm] = useState(profile.email || '');
  const conns = me.conns || [];
  const have = new Set(conns.map(c => c.id));
  const candidates = data.roster.filter(p => p.id !== sid && !p.nophone && !have.has(p.id) && (!q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())));
  const add = async (id) => { try { await post({ op: 'connect', code, sid, ids: [id] }); toast('Connected'); refresh(); } catch (e) { toast(e.message); } };
  return html`<div style="padding:4px 16px 24px;display:flex;flex-direction:column;gap:14px">
    <div style="font-size:28px;font-weight:900;letter-spacing:-1px">Connect</div>
    ${!adding && html`<button onClick=${() => setAdding(true)} style="width:100%;background:#fff;color:var(--cd);border-radius:24px;padding:22px;display:flex;flex-direction:column;align-items:center;gap:8px">
      <span style="width:54px;height:54px;border-radius:50%;background:radial-gradient(circle at 38% 32%,var(--cs),var(--c));display:flex;align-items:center;justify-content:center;color:#fff;font-size:28px;font-weight:700">+</span>
      <span style="font-size:19px;font-weight:800">Add a classmate</span><span style="font-size:13.5px;opacity:.65;font-weight:600">You'll each see the other's shared info</span></button>`}
    ${adding && html`<div class="card-white">
      <div style="display:flex;align-items:center;gap:8px"><input class="field" style="color:#101116;background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.12)" value=${q} onInput=${e => setQ(e.target.value)} placeholder="Search by name" aria-label="Search classmates" /><button class="btn-sm" onClick=${() => { setAdding(false); setQ(''); }}>Done</button></div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px;max-height:320px;overflow-y:auto">
        ${candidates.slice(0, 40).map(p => html`<button onClick=${() => add(p.id)} style="display:flex;align-items:center;gap:12px;min-height:50px;padding:6px 8px;border-radius:12px;text-align:left;color:#101116"><span style=${{ width: '34px', height: '34px', borderRadius: '50%', background: G(p.g).base, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>${(p.name || '?')[0].toUpperCase()}</span><span style="flex:1;font-weight:700">${p.name}</span><span style="font-size:13px;font-weight:800;color:var(--cd)">+ Add</span></button>`)}
        ${!candidates.length && html`<div style="opacity:.6;padding:8px">No one to add${q ? ' with that name' : ''}.</div>`}
      </div></div>`}
    <div style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);border-radius:20px;padding:16px 18px;display:flex;flex-direction:column;gap:12px">
      <div class="eyebrow" style="color:rgba(255,255,255,.75)">What your connections see</div>
      <div style="display:flex;align-items:center;gap:10px"><span style="flex:1;font-size:15px;font-weight:700">${me.name}</span><span class="chip" style="background:rgba(255,255,255,.16)">Always</span></div>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="field" style="padding:12px 14px;font-size:14.5px;background:rgba(255,255,255,.1)" value=${em} onInput=${e => setEm(e.target.value)} onBlur=${() => em !== profile.email && saveProfile({ email: em })} placeholder="Add email (optional)" />
        <${VisChip} on=${profile.shareEmail} onClick=${() => saveProfile({ shareEmail: !profile.shareEmail })} />
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="field" style="padding:12px 14px;font-size:14.5px;background:rgba(255,255,255,.1)" value=${li} onInput=${e => setLi(e.target.value)} onBlur=${() => li !== profile.linkedin && saveProfile({ linkedin: li })} placeholder="Add LinkedIn (optional)" />
        <${VisChip} on=${profile.shareLinkedin} onClick=${() => saveProfile({ shareLinkedin: !profile.shareLinkedin })} />
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between"><span class="eyebrow" style="color:rgba(255,255,255,.72)">My connections</span><span style="font-size:13px;font-weight:800;background:rgba(255,255,255,.18);padding:3px 11px;border-radius:20px">${conns.length}</span></div>
    ${!conns.length && html`<div style="font-size:14.5px;color:rgba(255,255,255,.75);line-height:1.45">No connections yet. Add classmates here, or save who you met at wrap-up.</div>`}
    ${conns.map(c => html`<div style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.1);border-radius:14px;padding:12px 14px;min-height:60px">
      <span style=${{ width: '38px', height: '38px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, color: '#fff', background: c.g != null ? G(c.g).base : '#555', flexShrink: 0 }}>${(c.name || '?')[0].toUpperCase()}</span>
      <span style="flex:1;min-width:0"><span style="display:block;font-weight:700;font-size:16px">${c.name}</span>
        ${c.email && html`<a href=${'mailto:' + c.email} style="display:block;font-size:13px;color:rgba(255,255,255,.85);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.email}</a>`}
        ${!c.email && !c.linkedin && html`<span style="display:block;font-size:12.5px;color:rgba(255,255,255,.6)">Name only</span>`}</span>
      ${c.linkedin && html`<a href=${/^https?:/.test(c.linkedin) ? c.linkedin : 'https://' + c.linkedin} target="_blank" rel="noopener" style="font-size:12px;font-weight:800;background:rgba(255,255,255,.16);padding:8px 12px;border-radius:20px;color:#fff;text-decoration:none">LinkedIn</a>`}
    </div>`)}
  </div>`;
}
