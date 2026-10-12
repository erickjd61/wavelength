// Wavelength live API — one endpoint, backed by Upstash Redis (REST).
// GET  /api/rpc?code=X&v=N&sid=S&seen=1   -> poll (cheap when nothing changed)
// POST /api/rpc {op, code, ...}            -> student and facilitator actions
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

async function redis(cmds) {
  if (!URL_ || !TOKEN) throw Object.assign(new Error('Database not connected yet'), { status: 503 });
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('Database error ' + r.status);
  const out = await r.json();
  return out.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const hash = (pin) => crypto.createHash('sha256').update('wl:' + String(pin)).digest('hex');
const K = (code, part) => 'wl:c:' + code + ':' + part;
const parts = ['meta', 's', 'g', 'seen', 'ans', 'conn', 'v'];
const obj = (flat) => { const o = {}; for (let i = 0; flat && i < flat.length; i += 2) o[flat[i]] = flat[i + 1]; return o; };
const jparse = (s, d) => { try { return s == null ? d : JSON.parse(s); } catch (_) { return d; } };
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);

const DEFAULT_AGENDA = [{ key: 'welcome', mins: 3 }, { key: 'frequency', mins: 7 }, { key: 'truths', mins: 7 }, { key: 'wrap', mins: 3 }];
const DEFAULT_Q = [
  { id: 'interest', text: 'What’s something you’re into outside of school?', active: true },
  { id: 'hope', text: 'One thing you hope to learn this semester?', active: true },
  { id: 'comfort', text: 'What helps you feel comfortable in a group?', active: true },
  { id: 'knowme', text: 'One thing you want your professor to know about you?', active: false },
  { id: 'hobby', text: 'What are your hobbies?', active: false },
];

async function load(code) {
  const [meta, s, g, seen, ans, conn, v] = await redis([
    ['GET', K(code, 'meta')], ['HGETALL', K(code, 's')], ['HGETALL', K(code, 'g')], ['HGETALL', K(code, 'seen')],
    ['HGETALL', K(code, 'ans')], ['HGETALL', K(code, 'conn')], ['GET', K(code, 'v')],
  ]);
  if (!meta) return null;
  const students = {}; const so = obj(s);
  for (const id in so) students[id] = jparse(so[id], null);
  const groups = {}; const go = obj(g); for (const id in go) groups[id] = Number(go[id]);
  const seenO = {}; const se = obj(seen); for (const id in se) seenO[id] = Number(se[id]);
  const answers = {}; const ao = obj(ans); for (const id in ao) answers[id] = jparse(ao[id], {});
  const conns = {}; const co = obj(conn); for (const id in co) conns[id] = jparse(co[id], []);
  return { meta: jparse(meta, {}), students, groups, seen: seenO, answers, conns, v: Number(v || 0) };
}

function present(st) { return Object.values(st.students).filter(p => p && p.status === 'active'); }
function smallestGroup(st, avoid) {
  const n = st.meta.groupCount || 5, sz = Array(n).fill(0);
  present(st).forEach(p => { const g = st.groups[p.id]; if (g != null && g < n) sz[g]++; });
  const open = [...sz.keys()].filter(g => !(st.meta.locked || [])[g]);
  const pool = open.length ? open : [...sz.keys()];
  return pool.sort((a, b) => (sz[a] - sz[b]) || ((a === avoid ? 1 : 0) - (b === avoid ? 1 : 0)))[0];
}

function publicMeta(m) { const { pinHash, ...rest } = m; return rest; }

function forStudent(st, sid, now) {
  const me = st.students[sid] || null;
  const roster = present(st).map(p => ({ id: p.id, name: p.name, g: st.groups[p.id], late: !!p.late, nophone: !!p.nophone }));
  const myConns = (st.conns[sid] || []).map(id => {
    const p = st.students[id]; if (!p) return null;
    return { id, name: p.name, email: p.shareEmail ? p.email : '', linkedin: p.shareLinkedin ? p.linkedin : '', g: st.groups[id] };
  }).filter(Boolean);
  const { scripts, ...meta } = publicMeta(st.meta);
  return { v: st.v, now, meta, roster, me: me ? { ...me, g: st.groups[sid], conns: myConns, answers: st.answers[sid] || {} } : null };
}
function forScreen(st, now) {
  const { scripts, introQuestions, ...meta } = publicMeta(st.meta);
  return { v: st.v, now, meta, roster: present(st).map(p => ({ id: p.id, name: p.name, g: st.groups[p.id], nophone: !!p.nophone })) };
}
function forTeacher(st, now) {
  const answers = {};
  for (const id in st.answers) {
    const p = st.students[id]; if (!p) continue;
    answers[id] = { anon: !!p.anon, name: p.anon ? null : p.name, a: st.answers[id] };
  }
  const connCounts = {}; for (const id in st.conns) connCounts[id] = (st.conns[id] || []).length;
  return { v: st.v, now, meta: publicMeta(st.meta), students: Object.values(st.students).filter(Boolean), groups: st.groups, seen: st.seen, answers, connCounts };
}

const bump = (code) => ['INCR', K(code, 'v')];

async function teacherAuth(code, pin) {
  const meta = jparse((await redis([['GET', K(code, 'meta')]]))[0], null);
  if (!meta) throw Object.assign(new Error('No class with that code'), { status: 404 });
  if (meta.pinHash !== hash(pin)) throw Object.assign(new Error('Wrong facilitator PIN'), { status: 403 });
  return meta;
}

async function facilitatorAction(code, body, now) {
  const st = await load(code);
  if (!st) throw Object.assign(new Error('No class with that code'), { status: 404 });
  if (st.meta.pinHash !== hash(body.pin)) throw Object.assign(new Error('Wrong facilitator PIN'), { status: 403 });
  const m = st.meta, a = body.action, cmds = [];
  const elapsed = () => (m.segAccum || 0) + (m.running && m.segStartedAt ? now - m.segStartedAt : 0);
  switch (a) {
    case 'start': Object.assign(m, { launched: true, ended: false, seg: 0, segAccum: 0, segStartedAt: now, running: true, pushedPrompt: null, projMode: 'instructions', projKey: null, priorMs: 0 }); break;
    case 'next': {
      const done = elapsed();
      m.priorMs = (m.priorMs || 0) + done;
      if (m.seg >= m.agenda.length - 1) Object.assign(m, { ended: true, running: false, segAccum: 0, segStartedAt: null });
      else Object.assign(m, { seg: m.seg + 1, segAccum: 0, segStartedAt: now, running: true, pushedPrompt: null, projKey: null, calledNum: null });
      break;
    }
    case 'pause': if (m.running) { m.segAccum = elapsed(); m.running = false; m.segStartedAt = null; } break;
    case 'resume': if (!m.running && m.launched && !m.ended) { m.running = true; m.segStartedAt = now; } break;
    case 'addMin': if (m.agenda[m.seg]) m.agenda[m.seg].mins += 1; break;
    case 'proj': m.projMode = ['join', 'instructions', 'groups', 'off'].includes(body.mode) ? body.mode : 'join'; m.projKey = body.key || null; break;
    case 'push': m.pushedPrompt = body.text ? clean(body.text, 300) : null; break;
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
      const n = Math.max(2, Math.min(5, Number(body.groupCount) || m.groupCount));
      m.groupCount = n; m.locked = (body.locked || m.locked || []).slice(0, n);
      const map = body.map || {};
      const flat = []; for (const id in map) if (st.students[id]) flat.push(id, String(Math.max(0, Math.min(n - 1, Number(map[id])))));
      cmds.push(['DEL', K(code, 'g')]); if (flat.length) cmds.push(['HSET', K(code, 'g'), ...flat]);
      break;
    }
    case 'lock': m.locked = (body.locked || []).map(Boolean); break;
    case 'settings': if (body.name != null) m.name = clean(body.name, 80); if (body.expected != null) m.expected = Math.max(0, Math.min(500, Number(body.expected) || 0)); if (body.avoid != null) m.avoid = !!body.avoid; break;
    case 'remove': {
      const p = st.students[body.sid]; if (p) { p.status = 'removed'; cmds.push(['HSET', K(code, 's'), p.id, JSON.stringify(p)], ['HDEL', K(code, 'g'), p.id]); }
      break;
    }
    case 'addNoPhone': {
      const id = 'np' + crypto.randomBytes(4).toString('hex');
      const p = { id, name: clean(body.name, 40) || 'Student', email: '', linkedin: '', shareEmail: false, shareLinkedin: false, anon: false, status: 'active', nophone: true, joinedAt: now, late: !!m.launched };
      st.students[id] = p;
      cmds.push(['HSET', K(code, 's'), id, JSON.stringify(p)], ['HSET', K(code, 'g'), id, String(smallestGroup(st, -1))]);
      break;
    }
    case 'newSession': {
      const flat = [];
      for (const id in st.students) { const p = st.students[id]; if (!p) continue; p.last = st.groups[id] != null ? st.groups[id] : p.last; if (p.status === 'active') p.status = 'away'; p.late = false; flat.push(id, JSON.stringify(p)); }
      if (flat.length) cmds.push(['HSET', K(code, 's'), ...flat]);
      cmds.push(['DEL', K(code, 'g')], ['DEL', K(code, 'ans')]);
      Object.assign(m, { launched: false, ended: false, seg: 0, segAccum: 0, segStartedAt: null, running: false, priorMs: 0, pushedPrompt: null, projMode: 'join', projKey: null, session: (m.session || 1) + 1 });
      break;
    }
    case 'deleteAll': await redis(parts.map(p => ['DEL', K(code, p)])); return { deleted: true };
    default: throw Object.assign(new Error('Unknown action'), { status: 400 });
  }
  cmds.unshift(['SET', K(code, 'meta'), JSON.stringify(m)]);
  cmds.push(bump(code));
  await redis(cmds);
  return { ok: true };
}

async function handle(req) {
  const now = Date.now();
  if (req.method === 'GET') {
    const q = req.query || {};
    const code = normCode(q.code), sid = clean(q.sid, 40), role = q.role || 'student';
    if (!code) throw Object.assign(new Error('Missing code'), { status: 400 });
    const pin = req.headers['x-wl-pin'];
    if (role === 'student' && sid && q.seen === '1') await redis([['HSET', K(code, 'seen'), sid, String(now)]]);
    if (role !== 'teacher' && q.v != null) {
      const v = Number((await redis([['GET', K(code, 'v')]]))[0] || 0);
      if (String(v) === String(q.v) && v > 0) return { v, now, same: true };
    }
    const st = await load(code);
    if (!st) throw Object.assign(new Error('No class with that code'), { status: 404 });
    if (role === 'teacher') { if (st.meta.pinHash !== hash(pin)) throw Object.assign(new Error('Wrong facilitator PIN'), { status: 403 }); return forTeacher(st, now); }
    if (role === 'screen') return forScreen(st, now);
    return forStudent(st, sid, now);
  }
  const b = req.body && typeof req.body === 'object' ? req.body : jparse(req.body, {});
  const code = normCode(b.code);
  if (!code) throw Object.assign(new Error('Missing class code'), { status: 400 });
  switch (b.op) {
    case 'check': { const ex = (await redis([['EXISTS', K(code, 'meta')]]))[0]; return { exists: !!ex }; }
    case 'create': {
      const pin = String(b.pin || '');
      if (pin.length < 4) throw Object.assign(new Error('PIN must be at least 4 characters'), { status: 400 });
      const ex = jparse((await redis([['GET', K(code, 'meta')]]))[0], null);
      if (ex) { if (ex.pinHash !== hash(pin)) throw Object.assign(new Error('That code is taken. Pick another, or enter its PIN.'), { status: 409 }); return { ok: true, resumed: true }; }
      const meta = { code, name: clean(b.name, 80) || 'My class', pinHash: hash(pin), createdAt: now, agenda: DEFAULT_AGENDA, budget: 20, seg: 0, segAccum: 0, segStartedAt: null, running: false, launched: false, ended: false, priorMs: 0, groupCount: 5, locked: [], projMode: 'join', projKey: null, pushedPrompt: null, prompts: {}, scripts: {}, introQuestions: DEFAULT_Q, templates: [], expected: Number(b.expected) || 0, avoid: true, session: 1 };
      await redis([['SET', K(code, 'meta'), JSON.stringify(meta)], ['SET', K(code, 'v'), '1']]);
      return { ok: true, created: true };
    }
    case 'auth': await teacherAuth(code, b.pin); return { ok: true };
    case 'fac': return facilitatorAction(code, b, now);
    case 'join': {
      const st = await load(code);
      if (!st) throw Object.assign(new Error('No class with that code'), { status: 404 });
      const pr = b.profile || {};
      const name = clean(pr.name, 40);
      if (!name) throw Object.assign(new Error('Name is required'), { status: 400 });
      let sid = clean(b.sid, 40); let p = sid && st.students[sid];
      if (!p || p.status === 'removed') { sid = 's' + crypto.randomBytes(6).toString('hex'); p = { id: sid, joinedAt: now, last: null }; }
      const wasActive = p.status === 'active';
      Object.assign(p, { name, email: clean(pr.email, 120), linkedin: clean(pr.linkedin, 160), shareEmail: !!pr.shareEmail, shareLinkedin: !!pr.shareLinkedin, anon: !!pr.anon, status: 'active' });
      if (!wasActive) p.late = !!(st.meta.launched && st.meta.seg > 0);
      st.students[sid] = p;
      const cmds = [['HSET', K(code, 's'), sid, JSON.stringify(p)], ['HSET', K(code, 'seen'), sid, String(now)]];
      let g = st.groups[sid];
      if (g == null || g >= (st.meta.groupCount || 5)) { g = smallestGroup(st, st.meta.avoid === false ? -1 : (p.last != null ? p.last : -1)); cmds.push(['HSET', K(code, 'g'), sid, String(g)]); }
      cmds.push(bump(code));
      await redis(cmds);
      return { sid, g, late: p.late };
    }
    case 'profile': {
      const st = await load(code); const sid = clean(b.sid, 40); const p = st && st.students[sid];
      if (!p) throw Object.assign(new Error('Not in this class'), { status: 404 });
      const pr = b.profile || {};
      ['email', 'linkedin'].forEach(k => { if (pr[k] != null) p[k] = clean(pr[k], 160); });
      ['shareEmail', 'shareLinkedin', 'anon'].forEach(k => { if (pr[k] != null) p[k] = !!pr[k]; });
      if (pr.name) p.name = clean(pr.name, 40);
      await redis([['HSET', K(code, 's'), sid, JSON.stringify(p)], bump(code)]);
      return { ok: true };
    }
    case 'answers': {
      const sid = clean(b.sid, 40); const a = {};
      for (const k in (b.answers || {})) a[clean(k, 30)] = clean(b.answers[k], 500);
      await redis([['HSET', K(code, 'ans'), sid, JSON.stringify(a)], bump(code)]);
      return { ok: true };
    }
    case 'connect': {
      const st = await load(code); const sid = clean(b.sid, 40);
      if (!st || !st.students[sid]) throw Object.assign(new Error('Not in this class'), { status: 404 });
      const ids = (b.ids || []).map(x => clean(x, 40)).filter(id => id !== sid && st.students[id] && !st.students[id].nophone).slice(0, 60);
      const mine = new Set(st.conns[sid] || []); const cmds = [];
      ids.forEach(id => { mine.add(id); const theirs = new Set(st.conns[id] || []); theirs.add(sid); cmds.push(['HSET', K(code, 'conn'), id, JSON.stringify([...theirs])]); });
      cmds.push(['HSET', K(code, 'conn'), sid, JSON.stringify([...mine])], bump(code));
      await redis(cmds);
      return { ok: true, count: mine.size };
    }
    default: throw Object.assign(new Error('Unknown request'), { status: 400 });
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try { res.status(200).json(await handle(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message || 'Server error' }); }
};
module.exports.handle = handle;
