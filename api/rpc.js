// Wavelength live API — one endpoint, backed by Upstash Redis (REST).
// GET  /api/rpc?code=X&role=student|screen|teacher&v=N&sid=S&seen=1   -> poll (cheap when nothing changed)
//      student polls send their secret key in the x-wl-key header; teachers send x-wl-pin
// POST /api/rpc {op, code, ...}                                       -> student and facilitator actions
const crypto = require('crypto');
const { checkEmail, policyOf, DEFAULT_EMAIL_POLICY } = require('../shared/validate.js');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
// Preview deployments keep their data under a separate prefix, so testing never touches live classes.
const NS = process.env.WL_NAMESPACE || (process.env.VERCEL_ENV === 'preview' ? 'wlp' : 'wl');
// Only production advertises its public domain; previews fall back to the address the page was opened on.
const PUBLIC_BASE = process.env.VERCEL_ENV === 'production' && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL.replace(/^https?:\/\//, '') : (process.env.WL_PUBLIC_BASE || null);
const CLASS_TTL = 60 * 24 * 3600; // a class is erased after 60 days without use
const SESSION_MAX_MS = 24 * 3600 * 1000; // a session closes on its own 24 hours after it became active
// Sessions already running when auto-close shipped count their 24 hours from the release, not from creation.
const AUTOCLOSE_RELEASE = Date.parse('2026-10-19T18:00:00Z');
const STALE_MS = 2 * 60 * 1000;   // a phone not heard from in 2 minutes is treated as gone
const MAX_GROUPS = 36;            // 12 colour/shape pairs, repeated with a number (Teal Triangle 2) for big lectures

async function redis(cmds) {
  if (!URL_ || !TOKEN) throw err(503, 'Database not connected yet');
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Database error ' + r.status);
  const out = await r.json();
  return out.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const err = (status, message, code) => Object.assign(new Error(message), { status, code });
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hash = (pin) => sha('wl:' + String(pin));
const keyHash = (key) => sha('wlk:' + String(key));
const K = (code, part) => NS + ':c:' + code + ':' + part;
// meta, students, groups, last-seen, answers, legacy connections, version, done, student key hashes, connection pairs,
// session-opened time, shared group biographies, auto-close lock
const parts = ['meta', 's', 'g', 'seen', 'ans', 'conn', 'v', 'done', 'k', 'cx', 'open', 'bio', 'closing'];
const touch = (code, which = parts) => which.map(p => ['EXPIRE', K(code, p), CLASS_TTL]);
const obj = (flat) => { const o = {}; for (let i = 0; flat && i < flat.length; i += 2) o[flat[i]] = flat[i + 1]; return o; };
const jparse = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (_) { return d; } };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const pairId = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const RESERVED = ['TEACH', 'SCREEN', 'API', 'INDEX', 'SHARED', 'VENDOR'];

const DEFAULT_AGENDA = [{ key: 'welcome', mins: 3 }, { key: 'frequency', mins: 7 }, { key: 'truths', mins: 7 }, { key: 'wrap', mins: 3 }];
const DEFAULT_Q = [
  { id: 'interest', text: 'What’s something you’re into outside of school?', active: true },
  { id: 'hope', text: 'One thing you hope to learn this semester?', active: true },
  { id: 'comfort', text: 'What helps you feel comfortable in a group?', active: true },
  { id: 'knowme', text: 'One thing you want your professor to know about you?', active: false },
  { id: 'hobby', text: 'What are your hobbies?', active: false },
];

async function load(code, now = Date.now(), noClose) {
  const [meta, s, g, seen, ans, v, dn, k, cx, open, bio] = await redis([
    ['GET', K(code, 'meta')], ['HGETALL', K(code, 's')], ['HGETALL', K(code, 'g')], ['HGETALL', K(code, 'seen')],
    ['HGETALL', K(code, 'ans')], ['GET', K(code, 'v')], ['HGETALL', K(code, 'done')], ['HGETALL', K(code, 'k')], ['HGETALL', K(code, 'cx')],
    ['GET', K(code, 'open')], ['HGETALL', K(code, 'bio')],
  ]);
  if (!meta) return null;
  const students = {}; const so = obj(s); for (const id in so) { const p = jparse(so[id], null); if (p) students[id] = p; }
  const groups = {}; const go = obj(g); for (const id in go) groups[id] = Number(go[id]);
  const keys = obj(k);                                         // sid -> hash of the student's secret key
  const bySecret = {}; for (const id in keys) bySecret[keys[id]] = id;
  // seen / answers / done are stored under the key hash, so only the key holder can write their own.
  const seenO = {}; const se = obj(seen); for (const h in se) if (bySecret[h]) seenO[bySecret[h]] = Number(se[h]);
  const answers = {}; const ao = obj(ans); for (const h in ao) if (bySecret[h]) answers[bySecret[h]] = jparse(ao[h], {});
  const done = {}; const dno = obj(dn); for (const h in dno) if (bySecret[h]) done[bySecret[h]] = Number(dno[h]);
  const pairs = {}; const cxo = obj(cx); for (const f in cxo) { const p = jparse(cxo[f], null); if (p) pairs[f] = p; }
  const m = jparse(meta, {});
  m.emailPolicy = policyOf(m.emailPolicy || DEFAULT_EMAIL_POLICY);
  if (!m.groupMode) m.groupMode = 'count';
  if (!m.groupSize) m.groupSize = 4;
  // Shared biography lines, field "<group>:<lineId>" -> {text, at, by}
  const bios = {}; const bo = obj(bio);
  for (const f in bo) { const i = f.indexOf(':'), line = jparse(bo[f], null); if (i < 1 || !line) continue; const gi = Number(f.slice(0, i)); (bios[gi] = bios[gi] || []).push({ id: f.slice(i + 1), ...line }); }
  for (const gi in bios) bios[gi].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const st = { meta: m, students, groups, keys, seen: seenO, answers, done, pairs, bios, v: Number(v || 0), openedAt: open ? Number(open) : null };
  // Legacy sessions (active before auto-close existed) count from the release.
  if (!st.openedAt && (m.launched || Object.values(students).some(p => p.status === 'active' && !p.nophone))) st.openedAt = Math.max(m.createdAt || 0, AUTOCLOSE_RELEASE);
  // A student who moved to a new phone shows up twice until the old phone goes quiet; then the old entry steps aside.
  const byEmail = {};
  Object.values(students).forEach(p => { if (p.status === 'active' && !p.nophone && p.email) (byEmail[p.email.toLowerCase()] = byEmail[p.email.toLowerCase()] || []).push(p); });
  const stale = [];
  for (const e in byEmail) {
    const list = byEmail[e]; if (list.length < 2) continue;
    const newest = list.reduce((x, y) => ((seenO[y.id] || 0) > (seenO[x.id] || 0) ? y : x));
    list.forEach(p => { if (p !== newest && now - (seenO[p.id] || 0) > STALE_MS && groups[p.id] != null && groups[p.id] === groups[newest.id]) { p.status = 'away'; stale.push(p); } });
  }
  if (stale.length) await redis([['HSET', K(code, 's'), ...stale.flatMap(p => [p.id, JSON.stringify(p)])], ['INCR', K(code, 'v')]]);
  if (!noClose && st.openedAt && now - st.openedAt >= SESSION_MAX_MS) {
    // Only one request performs the close; the rest reload the result.
    const [lock] = await redis([['SET', K(code, 'closing'), '1', 'NX', 'EX', 60]]);
    if (lock === 'OK') {
      const cmds = closeSession(st, code, now);
      await redis([['SET', K(code, 'meta'), JSON.stringify(st.meta)], ...cmds, bump(code), ...touch(code, parts.filter(p => p !== 'closing'))]);
    }
    return load(code, now, true);
  }
  return st;
}

// End the current session: phone students rejoin with one tap next time, named no-device students stay,
// unnamed seats, groups, answers, done marks and biographies are cleared.
function closeSession(st, code, now) {
  const m = st.meta, cmds = [], keep = [];
  for (const id in st.students) {
    const p = st.students[id];
    p.last = st.groups[id] != null ? st.groups[id] : p.last; p.late = false;
    if (p.nophone && p.guest) { cmds.push(['HDEL', K(code, 's'), id]); delete st.students[id]; continue; }
    if (!p.nophone && p.status === 'active') p.status = 'away';
    keep.push(p);
  }
  st.groups = {};
  Object.assign(m, { launched: false, ended: false, seg: 0, segAccum: 0, segStartedAt: null, running: false, priorMs: 0, pushedPrompt: null, projMode: 'join', projKey: null,
    session: (m.session || 1) + 1, round: (m.round || 0) + 1, headcount: 0, groupsSent: false, lastClosedAt: now });
  const manual = keep.filter(p => p.nophone && p.status === 'active');
  manual.forEach(p => place(st, p, m.avoid === false ? -1 : (p.last != null ? p.last : -1)));
  cmds.push(['DEL', K(code, 'g')], ['DEL', K(code, 'ans')], ['DEL', K(code, 'done')], ['DEL', K(code, 'bio')], ['DEL', K(code, 'open')]);
  const flat = []; keep.forEach(p => flat.push(p.id, JSON.stringify(p))); if (flat.length) cmds.push(['HSET', K(code, 's'), ...flat]);
  const gflat = []; manual.forEach(p => gflat.push(p.id, String(st.groups[p.id]))); if (gflat.length) cmds.push(['HSET', K(code, 'g'), ...gflat]);
  st.openedAt = null;
  return cmds;
}

function present(st) { return Object.values(st.students).filter(p => p && p.status === 'active'); }
function groupCount(st) {
  if (st.meta.groupMode === 'size') {
    let max = -1; present(st).forEach(p => { const g = st.groups[p.id]; if (g != null && g > max) max = g; });
    return Math.max(1, Math.min(MAX_GROUPS, max + 1));
  }
  return Math.max(1, Math.min(MAX_GROUPS, st.meta.groupCount || 5));
}
// Group for someone joining mid-stream: the smallest open group. In "group size" mode a new group
// opens once every open group has reached the target size.
function autoGroup(st, avoid) {
  const n = groupCount(st), sz = Array(n).fill(0), locked = st.meta.locked || [];
  present(st).forEach(p => { const g = st.groups[p.id]; if (g != null && g < n) sz[g]++; });
  const open = [...sz.keys()].filter(g => !locked[g]);
  const pool = open.length ? open : [...sz.keys()];
  // Before groups are made, "group size" mode opens a new group when the others are full. After that
  // (or once class has started) a late joiner only fills the smallest existing group — no one else moves.
  const settled = st.meta.groupsSent || st.meta.launched;
  if (st.meta.groupMode === 'size' && !settled && n < MAX_GROUPS && pool.every(g => sz[g] >= st.meta.groupSize)) return n;
  return pool.sort((a, b) => (sz[a] - sz[b]) || ((a === avoid ? 1 : 0) - (b === avoid ? 1 : 0)) || a - b)[0];
}
function place(st, p, avoid) { const g = autoGroup(st, avoid); st.groups[p.id] = g; return g; }

function outMeta(st, strip) {
  const { pinHash, ...rest } = st.meta; rest.groupCount = groupCount(st);
  (strip || []).forEach(k => { delete rest[k]; });
  return rest;
}
const rosterEntry = (st, p) => ({ id: p.id, name: p.name, g: st.groups[p.id], late: !!p.late, nophone: !!p.nophone, guest: !!p.guest });

function connectionsFor(st, sid) {
  const accepted = [], incoming = [], outgoing = [];
  for (const f in st.pairs) {
    const [a, b] = f.split('|'); if (a !== sid && b !== sid) continue;
    const other = a === sid ? b : a, pr = st.pairs[f], p = st.students[other];
    if (!p) continue;
    const base = { id: other, name: p.name, g: st.groups[other] };
    if (pr.status === 'accepted') accepted.push({ ...base, email: p.shareEmail ? p.email || '' : '', linkedin: p.shareLinkedin ? p.linkedin || '' : '' });
    else if (pr.from === sid) outgoing.push(base);                       // pending or quietly declined — never revealed to the sender
    else if (pr.status === 'pending') incoming.push(base);
  }
  return { accepted, incoming, outgoing };
}

function forStudent(st, sid, now) {
  const me = st.students[sid] || null;
  const roster = present(st).map(p => rosterEntry(st, p));
  const meta = outMeta(st, ['scripts', 'templates', 'headcount']);
  if (!me) return { v: st.v, now, base: PUBLIC_BASE, meta, roster, me: null };
  const { email, linkedin, shareEmail, shareLinkedin, anon, name, status, late, id } = me;
  return { v: st.v, now, base: PUBLIC_BASE, meta, roster, me: {
    id, name, email, linkedin, shareEmail, shareLinkedin, anon, status, late, g: st.groups[sid],
    connections: connectionsFor(st, sid), answers: st.answers[sid] || {}, doneRound: st.done[sid] != null ? st.done[sid] : null,
    bio: st.groups[sid] != null ? (st.bios[st.groups[sid]] || []).map(l => ({ id: l.id, text: l.text, at: l.at })) : [],
  } };
}
function forScreen(st, now) {
  return { v: st.v, now, base: PUBLIC_BASE, meta: outMeta(st, ['scripts', 'introQuestions', 'templates', 'emailPolicy']), roster: present(st).map(p => rosterEntry(st, p)) };
}
function forTeacher(st, now) {
  const answers = {};
  for (const id in st.answers) { const p = st.students[id]; if (p) answers[id] = { anon: !!p.anon, name: p.anon ? null : p.name, a: st.answers[id] }; }
  const connCounts = {}; let accepted = 0, pending = 0;
  for (const f in st.pairs) {
    const pr = st.pairs[f];
    if (pr.status === 'accepted') { accepted++; f.split('|').forEach(id => { connCounts[id] = (connCounts[id] || 0) + 1; }); }
    else if (pr.status === 'pending') pending++;
  }
  const doneIds = Object.keys(st.done).filter(id => st.done[id] === (st.meta.round || 0));
  // Contact details reach the facilitator only when the student chose to share them.
  const students = Object.values(st.students).map(p => ({ ...p, email: p.shareEmail ? p.email || '' : '', linkedin: p.shareLinkedin ? p.linkedin || '' : '' }));
  const bioCounts = {}; for (const gi in st.bios) bioCounts[gi] = st.bios[gi].length;   // counts only: the text is for the group
  return { v: st.v, now, base: PUBLIC_BASE, meta: outMeta(st), students, groups: st.groups, seen: st.seen, answers, connCounts, connTotals: { accepted, pending }, doneIds, bioCounts,
    autoCloseAt: st.openedAt ? st.openedAt + SESSION_MAX_MS : null };
}

const bump = (code) => ['INCR', K(code, 'v')];

async function teacherAuth(code, pin) {
  const meta = jparse((await redis([['GET', K(code, 'meta')]]))[0], null);
  if (!meta) throw err(404, 'No class with that code');
  if (meta.pinHash !== hash(pin)) throw err(403, 'Wrong facilitator PIN');
  return meta;
}
function verifyStudent(st, sid, key) {
  if (!sid || !key || !st.keys[sid] || st.keys[sid] !== keyHash(key)) throw err(403, 'Please rejoin the class on this phone.', 'rejoin');
  const p = st.students[sid];
  if (!p) throw err(403, 'Please rejoin the class on this phone.', 'rejoin');
  return p;
}
// Light check for the frequent single-field writes (answers, done): one read instead of loading the class.
async function verifyKeyOnly(code, sid, key) {
  const [stored, exists] = await redis([['HGET', K(code, 'k'), sid || '-'], ['EXISTS', K(code, 'meta')]]);
  if (!exists) throw err(404, 'No class with that code');
  if (!sid || !key || !stored || stored !== keyHash(key)) throw err(403, 'Please rejoin the class on this phone.', 'rejoin');
  return stored;
}

function manualStudent(st, name, opts, now) {
  const id = 'np' + crypto.randomBytes(5).toString('hex');
  const p = { id, name: clean(name, 40) || 'Student', email: '', linkedin: '', shareEmail: false, shareLinkedin: false, anon: false, status: 'active', nophone: true, guest: !!(opts && opts.guest), joinedAt: now, late: !!st.meta.launched, last: null };
  st.students[id] = p;
  place(st, p, -1);
  return p;
}

async function facilitatorAction(code, body, now) {
  const st = await load(code, now);
  if (!st) throw err(404, 'No class with that code');
  if (st.meta.pinHash !== hash(body.pin)) throw err(403, 'Wrong facilitator PIN');
  const m = st.meta, a = body.action, cmds = [], result = { ok: true };
  const elapsed = () => (m.segAccum || 0) + (m.running && m.segStartedAt ? now - m.segStartedAt : 0);
  const saveStudents = (list) => { const flat = []; list.forEach(p => flat.push(p.id, JSON.stringify(p))); if (flat.length) cmds.push(['HSET', K(code, 's'), ...flat]); };
  const saveGroups = (list) => { const flat = []; list.forEach(p => { if (st.groups[p.id] != null) flat.push(p.id, String(st.groups[p.id])); }); if (flat.length) cmds.push(['HSET', K(code, 'g'), ...flat]); };
  switch (a) {
    case 'start': cmds.push(['SET', K(code, 'open'), String(now), 'NX']); m.round = (m.round || 0) + 1; Object.assign(m, { launched: true, ended: false, seg: 0, segAccum: 0, segStartedAt: now, running: true, pushedPrompt: null, projMode: 'instructions', projKey: null, priorMs: 0 }); break;
    case 'next': {
      m.round = (m.round || 0) + 1;
      m.priorMs = (m.priorMs || 0) + elapsed();
      if (m.seg >= m.agenda.length - 1) Object.assign(m, { ended: true, running: false, segAccum: 0, segStartedAt: null });
      else Object.assign(m, { seg: m.seg + 1, segAccum: 0, segStartedAt: now, running: true, pushedPrompt: null, projKey: null, calledNum: null });
      break;
    }
    case 'pause': if (m.running) { m.segAccum = elapsed(); m.running = false; m.segStartedAt = null; } break;
    case 'resume': if (!m.running && m.launched && !m.ended) { m.running = true; m.segStartedAt = now; } break;
    case 'addMin': if (m.agenda[m.seg]) m.agenda[m.seg].mins += 1; break;
    case 'proj': m.projMode = ['join', 'instructions', 'groups', 'off'].includes(body.mode) ? body.mode : 'join'; m.projKey = body.key || null; break;
    case 'push': m.pushedPrompt = body.text ? clean(body.text, 300) : null; if (m.pushedPrompt) m.round = (m.round || 0) + 1; break;
    case 'resetDone': m.round = (m.round || 0) + 1; break;
    case 'call': m.calledNum = body.n || null; break;
    case 'agenda': {
      const ag = (body.agenda || []).filter(x => x && x.key).map(x => ({ key: clean(x.key, 30), mins: Math.max(1, Math.min(90, Number(x.mins) || 1)) }));
      if (ag.length >= 2) m.agenda = ag;
      if (body.budget) m.budget = Math.max(5, Math.min(180, Number(body.budget)));
      if (m.seg > m.agenda.length - 1) m.seg = m.agenda.length - 1;
      break;
    }
    case 'content': {
      if (body.key) {
        m.prompts = m.prompts || {}; m.scripts = m.scripts || {};
        if (Array.isArray(body.prompts)) m.prompts[body.key] = body.prompts.map(t => clean(t, 300)).slice(0, 20);
        if (typeof body.script === 'string') m.scripts[body.key] = clean(body.script, 1500);
      }
      if (Array.isArray(body.templates)) m.templates = body.templates.slice(0, 20);
      break;
    }
    case 'questions': m.introQuestions = (body.questions || []).map(q => ({ id: clean(q.id, 30), text: clean(q.text, 200), active: !!q.active })).slice(0, 10); break;
    case 'groups': {
      // Apply a previewed assignment. mode 'count' = fixed number of groups; mode 'size' = target people per group.
      const mode = body.mode === 'size' ? 'size' : 'count';
      const map = body.map || {}, flat = [];
      let maxG = 0;
      for (const id in map) {
        if (!st.students[id]) continue;
        const g = Math.max(0, Math.min(MAX_GROUPS - 1, Math.floor(Number(map[id]) || 0)));
        if (g > maxG) maxG = g;
        flat.push(id, String(g));
      }
      m.groupMode = mode;
      if (mode === 'size') m.groupSize = Math.max(2, Math.min(50, Number(body.size) || m.groupSize || 4));
      m.groupCount = Math.max(1, Math.min(MAX_GROUPS, Number(body.count) || maxG + 1));
      m.locked = (body.locked || m.locked || []).slice(0, m.groupCount).map(Boolean);
      m.groupsSent = true;
      cmds.push(['DEL', K(code, 'g')]); if (flat.length) cmds.push(['HSET', K(code, 'g'), ...flat]);
      // Brand-new groups start a fresh biography and fresh "done" marks; moving a few people keeps both.
      if (body.reshuffle) { cmds.push(['DEL', K(code, 'bio')]); m.round = (m.round || 0) + 1; }
      break;
    }
    case 'groupMode': {
      // Change the rule used for students who join later, without regrouping anyone.
      m.groupMode = body.mode === 'size' ? 'size' : 'count';
      if (body.size) m.groupSize = Math.max(2, Math.min(50, Number(body.size)));
      if (body.count) m.groupCount = Math.max(1, Math.min(MAX_GROUPS, Number(body.count)));
      break;
    }
    case 'lock': m.locked = (body.locked || []).map(Boolean); break;
    case 'settings':
      if (body.name != null) m.name = clean(body.name, 80);
      if (body.expected != null) m.expected = Math.max(0, Math.min(1000, Number(body.expected) || 0));
      if (body.avoid != null) m.avoid = !!body.avoid;
      if (body.emailPolicy) m.emailPolicy = policyOf({ ...m.emailPolicy, ...body.emailPolicy });
      break;
    case 'remove': {
      const p = st.students[body.sid];
      if (p) {
        if (p.nophone) cmds.push(['HDEL', K(code, 's'), p.id]);           // manual entries have nothing to keep
        else { p.status = 'removed'; cmds.push(['HSET', K(code, 's'), p.id, JSON.stringify(p)], ['HDEL', K(code, 'k'), p.id]); }
        cmds.push(['HDEL', K(code, 'g'), p.id]);
      }
      break;
    }
    case 'addNoPhone': {
      // One name or a pasted list (one per line). Each goes into the smallest group.
      const names = (Array.isArray(body.names) ? body.names : [body.name]).map(n => clean(n, 40)).filter(Boolean).slice(0, 300);
      if (!names.length) throw err(400, 'Type at least one name');
      const added = names.map(n => manualStudent(st, n, null, now));
      saveStudents(added); saveGroups(added); result.added = added.length;
      break;
    }
    case 'topUp': {
      // "There are 32 people in the room": add unnamed seats so everyone present gets a group.
      const want = Math.max(0, Math.min(1000, Math.floor(Number(body.headcount) || 0)));
      m.headcount = want;
      const here = present(st).length, need = Math.max(0, want - here);
      let n = present(st).filter(p => p.guest).reduce((mx, p) => Math.max(mx, Number((p.name.match(/(\d+)$/) || [])[1]) || 0), 0);
      const added = []; for (let i = 0; i < need; i++) added.push(manualStudent(st, 'Guest ' + (++n), { guest: true }, now));
      saveStudents(added); saveGroups(added); result.added = added.length; result.headcount = want; result.present = here;
      break;
    }
    case 'rename': {
      const p = st.students[body.sid];
      if (!p || !p.nophone) throw err(400, 'Only students added by hand can be renamed here');
      const name = clean(body.name, 40); if (!name) throw err(400, 'Type a name');
      p.name = name; p.guest = false; saveStudents([p]);
      break;
    }
    case 'newSession': cmds.push(...closeSession(st, code, now)); break;
    case 'deleteAll': await redis(parts.map(p => ['DEL', K(code, p)])); return { deleted: true };
    default: throw err(400, 'Unknown action');
  }
  cmds.unshift(['SET', K(code, 'meta'), JSON.stringify(m)]);
  cmds.push(bump(code), ...touch(code));
  await redis(cmds);
  return result;
}

function newMeta(code, b, now) {
  return { code, name: clean(b.name, 80) || 'My class', pinHash: hash(b.pin), createdAt: now, agenda: DEFAULT_AGENDA, budget: 20, seg: 0, segAccum: 0, segStartedAt: null, running: false, launched: false, ended: false, priorMs: 0,
    groupMode: 'count', groupCount: 5, groupSize: 4, locked: [], projMode: 'join', projKey: null, pushedPrompt: null, prompts: {}, scripts: {}, introQuestions: DEFAULT_Q, templates: [],
    expected: Math.max(0, Math.min(1000, Number(b.expected) || 0)), avoid: true, session: 1, emailPolicy: policyOf(DEFAULT_EMAIL_POLICY), headcount: 0 };
}

async function studentOp(code, b, now) {
  const sid = clean(b.sid, 40), key = String(b.key || '');
  switch (b.op) {
    case 'join': {
      const st = await load(code, now);
      if (!st) throw err(404, 'No class with that code');
      const pr = b.profile || {};
      const name = clean(pr.name, 40);
      if (!name) throw err(400, 'Type your name to join.', 'name');
      const em = checkEmail(pr.email, st.meta.emailPolicy);
      if (!em.ok) throw err(400, em.error, 'email');
      // Reuse the student's record only when this phone proves it owns it.
      let p = sid && st.students[sid], newKey = null, id = sid;
      if (!p || p.status === 'removed' || p.nophone || !st.keys[sid] || st.keys[sid] !== keyHash(key)) {
        id = 's' + crypto.randomBytes(8).toString('hex'); newKey = crypto.randomBytes(24).toString('hex');
        p = { id, joinedAt: now, last: null };
      }
      const wasActive = p.status === 'active';
      Object.assign(p, { name, email: em.value, linkedin: clean(pr.linkedin, 160), shareEmail: !!pr.shareEmail, shareLinkedin: !!pr.shareLinkedin, anon: !!pr.anon, status: 'active' });
      if (!wasActive && !p.returning) p.late = !!(st.meta.launched && st.meta.seg > 0);
      delete p.returning;
      const kh = newKey ? keyHash(newKey) : st.keys[id];
      const cmds = [];
      // Same student on a new phone (or after clearing the browser): matched by email, they go back to their
      // own group instead of being placed somewhere new. Their old entry steps aside only if that phone has gone quiet.
      if (newKey && em.value) {
        const prev = Object.values(st.students).find(q => q.id !== id && !q.nophone && q.status === 'active' && (q.email || '').toLowerCase() === em.value.toLowerCase() && st.groups[q.id] != null);
        if (prev) {
          st.groups[id] = st.groups[prev.id];
          if (!st.seen[prev.id] || now - st.seen[prev.id] > STALE_MS) { prev.status = 'away'; cmds.push(['HSET', K(code, 's'), prev.id, JSON.stringify(prev)]); }
          cmds.push(['HSET', K(code, 'g'), id, String(st.groups[id])]);
          p.late = !!prev.late; p.returning = true;
        }
      }
      st.students[id] = p;
      cmds.push(['HSET', K(code, 's'), id, JSON.stringify(p)], ['HSET', K(code, 'k'), id, kh], ['HSET', K(code, 'seen'), kh, String(now)], ['SET', K(code, 'open'), String(now), 'NX']);
      let g = st.groups[id];
      if (g == null || g >= groupCount(st)) { g = place(st, p, st.meta.avoid === false ? -1 : (p.last != null ? p.last : -1)); cmds.push(['HSET', K(code, 'g'), id, String(g)]); }
      cmds.push(bump(code), ...touch(code));
      await redis(cmds);
      return { sid: id, key: newKey || key, g, late: p.late };
    }
    case 'profile': {
      const st = await load(code, now); if (!st) throw err(404, 'No class with that code');
      const p = verifyStudent(st, sid, key), pr = b.profile || {};
      if (pr.email != null) { const em = checkEmail(pr.email, st.meta.emailPolicy); if (!em.ok) throw err(400, em.error, 'email'); p.email = em.value; }
      if (pr.linkedin != null) p.linkedin = clean(pr.linkedin, 160);
      ['shareEmail', 'shareLinkedin', 'anon'].forEach(k => { if (pr[k] != null) p[k] = !!pr[k]; });
      if (pr.name) p.name = clean(pr.name, 40);
      await redis([['HSET', K(code, 's'), sid, JSON.stringify(p)], bump(code)]);
      return { ok: true, email: p.email };
    }
    case 'answers': {
      const kh = await verifyKeyOnly(code, sid, key), a = {};
      for (const k in (b.answers || {})) a[clean(k, 30)] = clean(b.answers[k], 500);
      await redis([['HSET', K(code, 'ans'), kh, JSON.stringify(a)], ['EXPIRE', K(code, 'ans'), CLASS_TTL], bump(code)]);
      return { ok: true };
    }
    case 'done': {
      // "We're done discussing" — tied to the current round, so it resets on Next, a new prompt, or regrouping.
      const kh = await verifyKeyOnly(code, sid, key), round = Number(b.round) || 0;
      await redis(b.done ? [['HSET', K(code, 'done'), kh, String(round)], ['EXPIRE', K(code, 'done'), CLASS_TTL], bump(code)] : [['HDEL', K(code, 'done'), kh], bump(code)]);
      return { ok: true };
    }
    // Connections: one hash field per pair, {from, status: pending|accepted|declined}. Contact details are shared only once accepted.
    case 'request': {
      const st = await load(code, now); if (!st) throw err(404, 'No class with that code');
      verifyStudent(st, sid, key);
      const ids = [...new Set((Array.isArray(b.to) ? b.to : [b.to]).map(x => clean(x, 40)))].filter(id => id && id !== sid).slice(0, 60);
      let outgoing = Object.keys(st.pairs).filter(f => st.pairs[f].from === sid && st.pairs[f].status === 'pending').length;
      const cmds = []; let sent = 0, accepted = 0;
      for (const id of ids) {
        const other = st.students[id];
        if (!other || other.nophone || other.status === 'removed') continue;
        const f = pairId(sid, id), cur = st.pairs[f];
        if (!cur || (cur.status === 'declined' && cur.from === id)) {
          if (outgoing >= 100) throw err(429, 'You have a lot of requests waiting. Give classmates a moment to respond.');
          cmds.push(['HSET', K(code, 'cx'), f, JSON.stringify({ from: sid, status: 'pending', at: now })]); sent++; outgoing++;
        } else if (cur.status === 'pending' && cur.from === id) {
          cmds.push(['HSET', K(code, 'cx'), f, JSON.stringify({ ...cur, status: 'accepted', at: now })]); accepted++;   // they asked first: connect
        }
      }
      if (cmds.length) await redis([...cmds, ['EXPIRE', K(code, 'cx'), CLASS_TTL], bump(code)]);
      return { ok: true, sent, accepted };
    }
    case 'respond': {
      const st = await load(code, now); if (!st) throw err(404, 'No class with that code');
      verifyStudent(st, sid, key);
      const from = clean(b.from, 40), f = pairId(sid, from), cur = st.pairs[f];
      if (!cur || cur.status !== 'pending' || cur.from !== from) throw err(404, 'That request is no longer waiting.');
      await redis([['HSET', K(code, 'cx'), f, JSON.stringify({ ...cur, status: b.accept ? 'accepted' : 'declined', at: now })], bump(code)]);
      return { ok: true };
    }
    case 'cancel': {   // withdraw my request, or remove an accepted connection
      const st = await load(code, now); if (!st) throw err(404, 'No class with that code');
      verifyStudent(st, sid, key);
      const other = clean(b.id, 40), f = pairId(sid, other), cur = st.pairs[f];
      if (cur && (cur.status === 'accepted' || cur.from === sid)) await redis([['HDEL', K(code, 'cx'), f], bump(code)]);
      return { ok: true };
    }
    // Collective Biography: one shared answer per group. Any member can add, edit or remove any line;
    // nobody outside the group (including the projector and facilitator) sees the text.
    case 'bioAdd': case 'bioEdit': case 'bioDel': {
      const st = await load(code, now); if (!st) throw err(404, 'No class with that code');
      const p = verifyStudent(st, sid, key), g = st.groups[sid];
      if (p.status !== 'active' || g == null) throw err(400, 'Join a group first.');
      const lines = st.bios[g] || [];
      if (b.op === 'bioAdd') {
        const text = clean(b.text, 300); if (!text) throw err(400, 'Type a sentence first.');
        if (lines.length >= 60) throw err(400, 'Your group’s answer is full. Edit or remove a line to add more.');
        const lid = now.toString(36) + crypto.randomBytes(3).toString('hex');
        await redis([['HSET', K(code, 'bio'), g + ':' + lid, JSON.stringify({ text, at: now, by: sid })], ['EXPIRE', K(code, 'bio'), CLASS_TTL], bump(code)]);
        return { ok: true, id: lid };
      }
      const lid = clean(b.id, 40), line = lines.find(l => l.id === lid);
      if (!line) throw err(404, 'That line was already removed.');
      if (b.op === 'bioDel') { await redis([['HDEL', K(code, 'bio'), g + ':' + lid], bump(code)]); return { ok: true }; }
      const text = clean(b.text, 300); if (!text) throw err(400, 'Type a sentence, or remove the line instead.');
      await redis([['HSET', K(code, 'bio'), g + ':' + lid, JSON.stringify({ text, at: line.at, by: line.by, editedBy: sid })], bump(code)]);
      return { ok: true };
    }
    default: throw err(400, 'Unknown request');
  }
}

async function handle(req) {
  const now = Date.now();
  if (req.method === 'GET') {
    const q = req.query || {};
    const code = normCode(q.code), sid = clean(q.sid, 40), role = q.role || 'student';
    if (!code) throw err(400, 'Missing code');
    const pin = req.headers['x-wl-pin'], key = req.headers['x-wl-key'];
    if (role !== 'teacher' && q.v != null) {
      const v = Number((await redis([['GET', K(code, 'v')]]))[0] || 0);
      // Heartbeat stored under the key's hash: only the key holder can mark themselves as connected.
      if (v > 0 && role === 'student' && key && q.seen === '1') await redis([['HSET', K(code, 'seen'), keyHash(key), String(now)]]);
      if (String(v) === String(q.v) && v > 0) return { v, now, same: true };
    }
    const st = await load(code, now);
    if (!st) throw err(404, 'No class with that code');
    if (role === 'teacher') { if (st.meta.pinHash !== hash(pin)) throw err(403, 'Wrong facilitator PIN'); return forTeacher(st, now); }
    if (role === 'screen') return forScreen(st, now);
    if (sid) verifyStudent(st, sid, key);
    return forStudent(st, sid, now);
  }
  const b = req.body && typeof req.body === 'object' ? req.body : jparse(req.body, {});
  const code = normCode(b.code);
  if (!code) throw err(400, 'Missing class code');
  switch (b.op) {
    case 'check': {
      const meta = jparse((await redis([['GET', K(code, 'meta')]]))[0], null);
      return meta ? { exists: true, name: meta.name, emailPolicy: policyOf(meta.emailPolicy || DEFAULT_EMAIL_POLICY) } : { exists: false };
    }
    case 'create': {
      const pin = String(b.pin || '');
      if (RESERVED.includes(code)) throw err(400, 'That code is reserved. Pick another.');
      if (code.length < 3) throw err(400, 'Use a code of at least 3 letters or numbers.');
      if (pin.length < 4) throw err(400, 'PIN must be at least 4 characters');
      const st = await load(code, now, true);
      if (st) {
        if (st.meta.pinHash !== hash(pin)) throw err(409, 'That code is already in use. Pick a different code, or choose “Open my class” if it’s yours.');
        if (!b.fresh) {
          // Never reopen old data silently: tell the facilitator what is there and let them choose.
          const all = Object.values(st.students);
          return { exists: true, summary: { name: st.meta.name, createdAt: st.meta.createdAt, session: st.meta.session || 1, students: all.filter(p => !p.nophone && p.status !== 'removed').length } };
        }
        await redis(parts.map(p => ['DEL', K(code, p)]));
      }
      await redis([['SET', K(code, 'meta'), JSON.stringify(newMeta(code, b, now))], ['SET', K(code, 'v'), '1'], ...touch(code, ['meta', 'v'])]);   // the session opens when the first student joins
      return { ok: true, created: true };
    }
    case 'auth': await teacherAuth(code, b.pin); return { ok: true };
    case 'fac': return facilitatorAction(code, b, now);
    default: return studentOp(code, b, now);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.status(200).json(await handle(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message || 'Server error', code: e.code }); }
};
module.exports.handle = handle;
module.exports._internals = { keyHash, pairId, MAX_GROUPS, NS, SESSION_MAX_MS };
