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

// ---------------- Release 1.1
const withClock = async (ms, fn) => { const real = Date.now; Date.now = () => ms; try { return await fn(); } finally { Date.now = real; } };

test('a session closes on its own 24 hours after it became active', async () => {
  const t0 = Date.now();
  const code = await withClock(t0, () => makeClass());
  const a = await withClock(t0 + 1000, () => join(code, 'Ari'));
  await withClock(t0 + 2000, () => fac(code, 'addNoPhone', { names: ['Bo'] }));
  await withClock(t0 + 3000, () => fac(code, 'start'));
  // 23 hours later: still the same session.
  let t = await withClock(t0 + 23 * 3600e3, () => teacher(code));
  assert.equal(t.meta.session, 1); assert.equal(t.meta.launched, true);
  assert.equal(t.autoCloseAt, t0 + 1000 + 24 * 3600e3);
  // 24 hours after the first join: closed exactly once, however many requests arrive.
  const later = t0 + 1000 + 24 * 3600e3 + 5;
  const [t1, t2, s1] = await withClock(later, () => Promise.all([teacher(code), teacher(code), me(code, a)]));
  for (const x of [t1, t2]) { assert.equal(x.meta.session, 2); assert.equal(x.meta.launched, false); }
  assert.equal(s1.me.status, 'away', 'phone is asked to rejoin');
  const bo = t1.students.find(p => p.name === 'Bo');
  assert.equal(bo.status, 'active'); assert.ok(t1.groups[bo.id] != null, 'named no-device student stays grouped');
  assert.equal(t1.autoCloseAt, null, 'next session opens when someone joins');
  // Rejoining starts the next 24-hour window.
  await withClock(later + 60e3, () => post({ op: 'join', code, sid: a.sid, key: a.key, profile: { name: 'Ari', email: 'ari@school.edu' } }));
  t = await withClock(later + 120e3, () => teacher(code));
  assert.equal(t.meta.session, 2); assert.equal(t.autoCloseAt, later + 60e3 + 24 * 3600e3);
});

test('an unused class does not close or bump its session', async () => {
  const t0 = Date.now();
  const code = await withClock(t0, () => makeClass());
  const t = await withClock(t0 + 5 * 24 * 3600e3, () => teacher(code));
  assert.equal(t.meta.session, 1);
  const a = await withClock(t0 + 5 * 24 * 3600e3 + 1, () => join(code, 'Cy'));
  assert.equal((await withClock(t0 + 5 * 24 * 3600e3 + 2, () => me(code, a))).me.status, 'active', 'first student is not kicked out');
});

test('late joiners fill existing groups; nobody already grouped moves', async () => {
  const code = await makeClass();
  await fac(code, 'groupMode', { mode: 'size', size: 2 });
  const ids = []; for (let i = 0; i < 4; i++) ids.push((await join(code, 'G' + i)).sid);
  let t = await teacher(code);
  const before = { ...t.groups };
  assert.equal(t.meta.groupCount, 2);
  await fac(code, 'groups', { map: before, mode: 'size', size: 2, count: 2 });   // facilitator sends groups
  for (let i = 0; i < 3; i++) await join(code, 'Late' + i);
  t = await teacher(code);
  assert.equal(t.meta.groupCount, 2, 'no new group opened for late joiners');
  ids.forEach(id => assert.equal(t.groups[id], before[id], 'existing members stay put'));
  const sizes = [0, 0]; Object.values(t.groups).forEach(g => sizes[g]++);
  assert.ok(Math.abs(sizes[0] - sizes[1]) <= 1, 'late joiners spread across existing groups');
});

test('a student who comes back on a new phone returns to their own group', async () => {
  const t0 = Date.now();
  const code = await withClock(t0, () => makeClass());
  const ids = [];
  for (let i = 0; i < 6; i++) ids.push(await withClock(t0, () => join(code, 'H' + i, { email: 'h' + i + '@school.edu' })));
  const map = {}; ids.forEach((x, i) => { map[x.sid] = i % 3; });
  await withClock(t0, () => fac(code, 'groups', { map, mode: 'count', count: 3 }));
  // H4 (group 1) loses their phone; 5 minutes later joins on a new one with the same email.
  const fresh = await withClock(t0 + 5 * 60e3, () => post({ op: 'join', code, profile: { name: 'H4', email: 'H4@School.edu' } }));
  assert.notEqual(fresh.sid, ids[4].sid);
  assert.equal(fresh.g, 1);
  const t = await withClock(t0 + 5 * 60e3, () => teacher(code));
  assert.equal(t.students.find(p => p.id === ids[4].sid).status, 'away', 'old entry steps aside');
  assert.equal(t.students.filter(p => p.status === 'active').length, 6, 'no duplicate in the roster');
  // If the original phone is still in use, the newcomer is a separate student: nobody is hidden or moved.
  await withClock(t0 + 6 * 60e3, () => get({ code, role: 'student', sid: ids[0].sid, v: '0', seen: '1' }, { 'x-wl-key': ids[0].key }));
  await withClock(t0 + 6 * 60e3 + 1, () => post({ op: 'join', code, profile: { name: 'H0 second phone', email: 'h0@school.edu' } }));
  assert.equal((await withClock(t0 + 6 * 60e3 + 2, () => me(code, ids[0]))).me.status, 'active');
});

test('Collective Biography: one shared answer per group, any member edits, group only', async () => {
  const code = await makeClass();
  const s = []; for (let i = 0; i < 4; i++) s.push(await join(code, 'B' + i));
  const map = { [s[0].sid]: 0, [s[1].sid]: 0, [s[2].sid]: 1, [s[3].sid]: 1 };
  await fac(code, 'groups', { map, mode: 'count', count: 2, reshuffle: true });
  let tick = Date.now();   // distinct timestamps, so the order of lines is well defined
  const add = (x, text) => withClock(tick += 1000, () => post({ op: 'bioAdd', code, sid: x.sid, key: x.key, text }));
  const l1 = await add(s[0], 'We all grew up in Indiana.');
  await add(s[1], 'We all like tacos.');
  await add(s[2], 'Group two line.');
  let v0 = (await me(code, s[0])).me.bio, v1 = (await me(code, s[1])).me.bio, v2 = (await me(code, s[2])).me.bio;
  assert.deepEqual(v0.map(l => l.text), ['We all grew up in Indiana.', 'We all like tacos.']);
  assert.deepEqual(v1, v0, 'both members see the same shared answer');
  assert.deepEqual(v2.map(l => l.text), ['Group two line.']);
  // Anyone in the group can edit or remove any line — but not another group's.
  await post({ op: 'bioEdit', code, sid: s[1].sid, key: s[1].key, id: l1.id, text: 'We all grew up in the Midwest.' });
  await fails(post({ op: 'bioEdit', code, sid: s[2].sid, key: s[2].key, id: l1.id, text: 'hijack' }), 404);
  await fails(post({ op: 'bioDel', code, sid: s[3].sid, key: s[3].key, id: l1.id }), 404);
  await fails(post({ op: 'bioAdd', code, sid: s[0].sid, key: s[2].key, text: 'x' }), 403, 'rejoin');
  v0 = (await me(code, s[0])).me.bio;
  assert.equal(v0[0].text, 'We all grew up in the Midwest.');
  // Group only: not on the projector, not in the facilitator payload (counts only), not in other groups.
  const screen = JSON.stringify(await get({ code, role: 'screen' })), tch = await teacher(code);
  assert.ok(!screen.includes('Midwest') && !JSON.stringify(tch).includes('Midwest'));
  assert.deepEqual(tch.bioCounts, { 0: 2, 1: 1 });
  assert.ok(!JSON.stringify(await me(code, s[2])).includes('Midwest'));
  // Moving one person keeps the answers; making new groups starts fresh.
  await fac(code, 'groups', { map: { ...map, [s[3].sid]: 0 }, mode: 'count', count: 2 });
  assert.equal((await me(code, s[3])).me.bio.length, 2, 'moved student now sees their new group’s answer');
  await fac(code, 'groups', { map, mode: 'count', count: 2, reshuffle: true });
  assert.equal((await me(code, s[0])).me.bio.length, 0);
});

test('students sharing one email (e.g. test phones) all stay in the class over time', async () => {
  const t0 = Date.now();
  const code = await withClock(t0, () => makeClass());
  const phones = [];
  for (let i = 0; i < 4; i++) phones.push(await withClock(t0 + i * 1000, () => post({ op: 'join', code, profile: { name: 'Tester ' + i, email: 'same@school.edu' } })));
  // Only some phones poll; the others sit idle for 10 minutes. Nobody may disappear or be bounced.
  for (let m = 1; m <= 10; m++) await withClock(t0 + m * 60e3, () => get({ code, role: 'student', sid: phones[0].sid, v: '0', seen: '1' }, { 'x-wl-key': phones[0].key }));
  const t = await withClock(t0 + 10 * 60e3 + 5, () => teacher(code));
  assert.equal(t.students.filter(p => p.status === 'active').length, 4);
  for (const p of phones) assert.equal((await withClock(t0 + 10 * 60e3 + 6, () => me(code, p))).me.status, 'active');
});
