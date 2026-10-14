// Server tests for api/rpc.js against the in-memory database.   Run:  npm test   (node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createMock } = require('../scripts/mock-redis.js');

process.env.KV_REST_API_URL = 'http://mock';
process.env.KV_REST_API_TOKEN = 't';
process.env.WL_NAMESPACE = 'wltest';
const mock = createMock();
globalThis.fetch = async (u, opts) => ({ ok: true, json: async () => mock.pipeline(JSON.parse(opts.body)) });
const { handle, _internals } = require(path.join(__dirname, '..', 'api', 'rpc.js'));
const { checkEmail } = require(path.join(__dirname, '..', 'shared', 'validate.js'));

let n = 0;
const fresh = () => 'T' + (++n).toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
const post = (body) => handle({ method: 'POST', body, headers: {} });
const get = (q, headers = {}) => handle({ method: 'GET', query: q, headers });
const fails = async (p, status, code) => {
  try { await p; } catch (e) { assert.equal(e.status, status, e.message); if (code) assert.equal(e.code, code); return e; }
  assert.fail('expected an error ' + status);
};
async function makeClass(extra = {}) {
  const code = fresh();
  await post({ op: 'create', code, pin: '1234', name: 'Test', ...extra });
  return code;
}
const fac = (code, action, body = {}) => post({ op: 'fac', code, pin: '1234', action, ...body });
const join = (code, name, extra = {}) => post({ op: 'join', code, profile: { name, email: name.toLowerCase().replace(/\W/g, '') + '@school.edu', ...extra } });
const me = (code, s) => get({ code, role: 'student', sid: s.sid }, { 'x-wl-key': s.key });
const teacher = (code) => get({ code, role: 'teacher' }, { 'x-wl-pin': '1234' });

// ---------------- Privacy: student keys
test('a student id alone is not a credential', async () => {
  const code = await makeClass();
  const a = await join(code, 'Ana', { email: 'ana@school.edu', shareEmail: true });
  const b = await join(code, 'Ben');
  assert.match(a.key, /^[0-9a-f]{48}$/);
  // Ben knows Ana's id (it is in everyone's roster) but not her key.
  await fails(get({ code, role: 'student', sid: a.sid }), 403, 'rejoin');
  await fails(get({ code, role: 'student', sid: a.sid }, { 'x-wl-key': b.key }), 403, 'rejoin');
  await fails(post({ op: 'profile', code, sid: a.sid, key: b.key, profile: { name: 'Hacked' } }), 403, 'rejoin');
  await fails(post({ op: 'answers', code, sid: a.sid, key: b.key, answers: { hope: 'x' } }), 403, 'rejoin');
  await fails(post({ op: 'done', code, sid: a.sid, key: 'nope', round: 1, done: true }), 403, 'rejoin');
  await fails(post({ op: 'request', code, sid: a.sid, key: b.key, to: [b.sid] }), 403, 'rejoin');
  // Rejoining with Ana's id but no key creates a separate identity and leaves Ana untouched.
  const imp = await post({ op: 'join', code, sid: a.sid, profile: { name: 'Fake Ana', email: 'f@school.edu' } });
  assert.notEqual(imp.sid, a.sid);
  const ana = await me(code, a);
  assert.equal(ana.me.name, 'Ana');
  // Ben's own view never contains Ana's email.
  const ben = await me(code, b);
  assert.ok(!JSON.stringify(ben).includes('ana@school.edu'));
  // Returning on the same phone keeps the same identity.
  const again = await post({ op: 'join', code, sid: a.sid, key: a.key, profile: { name: 'Ana', email: 'ana@school.edu' } });
  assert.equal(again.sid, a.sid);
  assert.equal(again.key, a.key);
});

test('projector and facilitator payloads leak no secrets or unshared contact info', async () => {
  const code = await makeClass();
  const a = await join(code, 'Cara', { email: 'cara@school.edu', shareEmail: false, linkedin: 'linkedin.com/in/cara', shareLinkedin: false });
  await join(code, 'Dev', { email: 'dev@school.edu', shareEmail: true });
  const screen = JSON.stringify(await get({ code, role: 'screen' }));
  const t = JSON.stringify(await teacher(code));
  for (const out of [screen, t]) {
    assert.ok(!out.includes('cara@school.edu'));
    assert.ok(!out.includes('linkedin.com/in/cara'));
    assert.ok(!out.includes(_internals.keyHash(a.key)));
    assert.ok(!out.includes(a.key));
    assert.ok(!out.includes('pinHash'));
  }
  assert.ok(t.includes('dev@school.edu'), 'shared email reaches the facilitator roster');
  assert.ok(!screen.includes('dev@school.edu'), 'projector never shows emails');
});

test('answers, done and heartbeat are tied to the key holder', async () => {
  const code = await makeClass();
  const a = await join(code, 'Eli');
  await post({ op: 'answers', code, sid: a.sid, key: a.key, answers: { hope: 'Leadership' } });
  await fac(code, 'start');
  const round = (await teacher(code)).meta.round;
  await post({ op: 'done', code, sid: a.sid, key: a.key, round, done: true });
  await get({ code, role: 'student', sid: a.sid, v: '0', seen: '1' }, { 'x-wl-key': a.key });
  const t = await teacher(code);
  assert.equal(t.answers[a.sid].a.hope, 'Leadership');
  assert.deepEqual(t.doneIds, [a.sid]);
  assert.ok(t.seen[a.sid] > 0);
  assert.equal((await me(code, a)).me.answers.hope, 'Leadership');
});

// ---------------- Connections: request -> accept / decline
test('connections need acceptance, and contact info appears only after accept', async () => {
  const code = await makeClass();
  const a = await join(code, 'Fay', { email: 'fay@school.edu', shareEmail: true });
  const b = await join(code, 'Gus', { email: 'gus@school.edu', shareEmail: true });
  const r = await post({ op: 'request', code, sid: a.sid, key: a.key, to: [b.sid] });
  assert.equal(r.sent, 1);
  let fa = (await me(code, a)).me.connections, gb = (await me(code, b)).me.connections;
  assert.deepEqual(fa.outgoing.map(x => x.id), [b.sid]);
  assert.deepEqual(gb.incoming.map(x => x.id), [a.sid]);
  assert.equal(fa.accepted.length, 0);
  assert.ok(!JSON.stringify(await me(code, b)).includes('fay@school.edu'), 'no email before accept');
  assert.ok(!JSON.stringify(await me(code, a)).includes('gus@school.edu'), 'no email before accept');
  await post({ op: 'respond', code, sid: b.sid, key: b.key, from: a.sid, accept: true });
  fa = (await me(code, a)).me.connections; gb = (await me(code, b)).me.connections;
  assert.equal(fa.accepted[0].email, 'gus@school.edu');
  assert.equal(gb.accepted[0].email, 'fay@school.edu');
  const t = await teacher(code);
  assert.equal(t.connTotals.accepted, 1);
  assert.equal(t.connCounts[a.sid], 1);
});

test('declining is private and does not connect; the sender cannot re-send', async () => {
  const code = await makeClass();
  const a = await join(code, 'Hal'), b = await join(code, 'Ida');
  await post({ op: 'request', code, sid: a.sid, key: a.key, to: [b.sid] });
  await post({ op: 'respond', code, sid: b.sid, key: b.key, from: a.sid, accept: false });
  const fa = (await me(code, a)).me.connections, gb = (await me(code, b)).me.connections;
  assert.deepEqual(fa.outgoing.map(x => x.id), [b.sid], 'sender still just sees "requested"');
  assert.equal(fa.accepted.length + gb.accepted.length + gb.incoming.length, 0);
  assert.equal((await post({ op: 'request', code, sid: a.sid, key: a.key, to: [b.sid] })).sent, 0);
  // The person who declined can change their mind later.
  assert.equal((await post({ op: 'request', code, sid: b.sid, key: b.key, to: [a.sid] })).sent, 1);
});

test('mutual requests connect; cancel and remove work; no auto-reciprocal links', async () => {
  const code = await makeClass();
  const a = await join(code, 'Jo'), b = await join(code, 'Kai'), c = await join(code, 'Lu');
  await post({ op: 'request', code, sid: a.sid, key: a.key, to: [b.sid] });
  const r = await post({ op: 'request', code, sid: b.sid, key: b.key, to: [a.sid] });
  assert.equal(r.accepted, 1);
  await post({ op: 'request', code, sid: a.sid, key: a.key, to: [c.sid] });
  await post({ op: 'cancel', code, sid: a.sid, key: a.key, id: c.sid });
  assert.equal((await me(code, c)).me.connections.incoming.length, 0);
  await post({ op: 'cancel', code, sid: b.sid, key: b.key, id: a.sid });
  assert.equal((await me(code, a)).me.connections.accepted.length, 0);
  // Someone cannot accept a request that was never sent.
  await fails(post({ op: 'respond', code, sid: c.sid, key: c.key, from: a.sid, accept: true }), 404);
  // Students without a device can't be requested.
  await fac(code, 'addNoPhone', { names: ['Max'] });
  const np = (await teacher(code)).students.find(p => p.name === 'Max');
  assert.equal((await post({ op: 'request', code, sid: a.sid, key: a.key, to: [np.id] })).sent, 0);
});

// ---------------- Email
test('email validator accepts real addresses and explains bad ones', () => {
  for (const ok of ['a@b.co', 'jordan.lee@purdue.edu', 'x+tag@cs.purdue.edu', '  Name@Gmail.COM ']) assert.ok(checkEmail(ok).ok, ok);
  assert.equal(checkEmail('  Name@Gmail.COM ').value, 'Name@gmail.com');
  const cases = { '': /Enter your email/, 'jordan': /needs an @/, 'a@@b.edu': /just one @/, '@purdue.edu': /before the @/, 'a@': /after the @/,
    'a@purdue': /needs a dot/, 'a@purdue.': /misplaced dot/, 'a@purdue..edu': /misplaced dot/, 'a b@x.edu': /spaces/, 'a@x.e': /ending/, 'a@x.123': /ending/, '.a@x.edu': /start or end/, 'a@-x.edu': /character/ };
  for (const [v, re] of Object.entries(cases)) { const r = checkEmail(v); assert.equal(r.ok, false, v); assert.match(r.error, re, v); }
  assert.equal(checkEmail('', { required: false }).ok, true);
  assert.match(checkEmail('a@gmail.com', { domains: ['purdue.edu'] }).error, /@purdue\.edu/);
  assert.ok(checkEmail('a@cs.purdue.edu', { domains: ['purdue.edu'] }).ok);
});

test('join and profile enforce the class email policy', async () => {
  const code = await makeClass();
  await fails(post({ op: 'join', code, profile: { name: 'Nia', email: 'nia@school' } }), 400, 'email');
  await fails(post({ op: 'join', code, profile: { name: 'Nia' } }), 400, 'email');
  const a = await post({ op: 'join', code, profile: { name: 'Nia', email: 'Nia@School.EDU' } });
  assert.equal((await me(code, a)).me.email, 'Nia@school.edu');
  await fails(post({ op: 'profile', code, sid: a.sid, key: a.key, profile: { email: 'broken' } }), 400, 'email');
  await fac(code, 'settings', { emailPolicy: { domains: ['purdue.edu'] } });
  await fails(post({ op: 'join', code, profile: { name: 'Oz', email: 'oz@gmail.com' } }), 400, 'email');
  assert.ok((await post({ op: 'join', code, profile: { name: 'Oz', email: 'oz@purdue.edu' } })).sid);
  assert.deepEqual((await post({ op: 'check', code })).emailPolicy, { required: true, domains: ['purdue.edu'] });
});

// ---------------- Students without a device
test('bulk add, headcount top-up, rename, and they survive a new session', async () => {
  const code = await makeClass();
  const a = await join(code, 'Pia');
  const r = await fac(code, 'addNoPhone', { names: ['Quinn', 'Rae', 'Sol'] });
  assert.equal(r.added, 3);
  const top = await fac(code, 'topUp', { headcount: 10 });
  assert.equal(top.added, 6);
  let t = await teacher(code);
  let active = t.students.filter(p => p.status === 'active');
  assert.equal(active.length, 10);
  assert.ok(active.every(p => t.groups[p.id] != null), 'everyone has a group');
  assert.equal(active.filter(p => p.guest).length, 6);
  assert.equal((await fac(code, 'topUp', { headcount: 10 })).added, 0, 'no double counting');
  const guest = active.find(p => p.name === 'Guest 1');
  await fac(code, 'rename', { sid: guest.id, name: 'Tess' });
  await fails(fac(code, 'rename', { sid: a.sid, name: 'Nope' }), 400);
  await fac(code, 'newSession');
  t = await teacher(code);
  const byName = Object.fromEntries(t.students.map(p => [p.name, p]));
  for (const nm of ['Quinn', 'Rae', 'Sol', 'Tess']) { assert.equal(byName[nm].status, 'active', nm + ' stays'); assert.ok(t.groups[byName[nm].id] != null, nm + ' grouped'); }
  assert.equal(t.students.filter(p => p.guest).length, 0, 'unnamed seats cleared');
  assert.equal(byName.Pia.status, 'away', 'phone students rejoin with one tap');
  const again = await post({ op: 'join', code, sid: a.sid, key: a.key, profile: { name: 'Pia', email: 'pia@school.edu' } });
  assert.equal(again.sid, a.sid);
});

// ---------------- Groups
test('group-size mode opens new groups as students join; count mode stays fixed', async () => {
  const code = await makeClass();
  await fac(code, 'groupMode', { mode: 'size', size: 3 });
  for (let i = 0; i < 10; i++) await join(code, 'S' + i);
  let t = await teacher(code);
  const sizes = {}; Object.values(t.groups).forEach(g => { sizes[g] = (sizes[g] || 0) + 1; });
  assert.equal(t.meta.groupCount, 4);
  assert.deepEqual(Object.values(sizes).sort(), [1, 3, 3, 3]);
  await fac(code, 'groupMode', { mode: 'count', count: 2 });
  await join(code, 'Late');
  t = await teacher(code);
  assert.equal(t.meta.groupCount, 2);
});

test('more than five groups, up to the 36-group cap', async () => {
  const code = await makeClass();
  const ids = [];
  for (let i = 0; i < 40; i++) ids.push((await join(code, 'P' + i)).sid);
  const map = {}; ids.forEach((id, i) => { map[id] = i % 12; });
  await fac(code, 'groups', { map, mode: 'count', count: 12 });
  let t = await teacher(code);
  assert.equal(t.meta.groupCount, 12);
  assert.equal(new Set(Object.values(t.groups)).size, 12);
  ids.forEach((id, i) => { map[id] = i; });
  await fac(code, 'groups', { map, mode: 'count', count: 40 });
  t = await teacher(code);
  assert.equal(t.meta.groupCount, 36);
  assert.ok(Math.max(...Object.values(t.groups)) <= 35);
});

// ---------------- Class lifecycle
test('re-creating a code never silently reopens old data', async () => {
  const code = await makeClass();
  await join(code, 'Uma');
  const r = await post({ op: 'create', code, pin: '1234', name: 'Again' });
  assert.equal(r.exists, true);
  assert.equal(r.summary.students, 1);
  assert.equal((await teacher(code)).students.length, 1, 'nothing changed');
  await fails(post({ op: 'create', code, pin: '9999' }), 409);
  await post({ op: 'create', code, pin: '1234', name: 'Fresh', fresh: true });
  const t = await teacher(code);
  assert.equal(t.students.length, 0);
  assert.equal(t.meta.name, 'Fresh');
});

test('class data expires after inactivity and preview data is namespaced', async () => {
  const code = await makeClass();
  await join(code, 'Vic');
  const keys = mock.keys('wltest:c:' + code + ':');
  assert.ok(keys.length >= 5);
  for (const k of keys) assert.equal(mock.ttl.get(k), 60 * 24 * 3600, k + ' has a TTL');
  assert.equal(mock.keys('wl:c:' + code).length, 0, 'nothing written outside the namespace');
  await fac(code, 'deleteAll');
  assert.equal(mock.keys('wltest:c:' + code + ':').length, 0);
});

test('polling stays cheap when nothing changed', async () => {
  const code = await makeClass();
  const a = await join(code, 'Wes');
  const first = await get({ code, role: 'student', sid: a.sid }, { 'x-wl-key': a.key });
  const before = mock.commands;
  const r = await get({ code, role: 'student', sid: a.sid, v: String(first.v) }, { 'x-wl-key': a.key });
  assert.equal(r.same, true);
  assert.equal(mock.commands - before, 1);
});
