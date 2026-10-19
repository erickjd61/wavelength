// In-memory stand-in for the Upstash Redis REST pipeline, covering only the commands Wavelength uses.
// Used by the tests and the local dev server; never deployed as an API route.
function createMock() {
  const db = new Map(), ttl = new Map();
  let commands = 0;
  const hashOf = (k, create) => {
    let h = db.get(k);
    if (!(h instanceof Map)) { if (!create) return null; h = new Map(); db.set(k, h); }
    return h;
  };
  function run(c) {
    commands++;
    const [op, k, ...a] = c;
    switch (String(op).toUpperCase()) {
      case 'GET': { const v = db.get(k); return v == null || v instanceof Map ? null : v; }
      case 'SET': {
        const opts = a.slice(1).map(x => String(x).toUpperCase());
        if (opts.includes('NX') && db.has(k)) return null;
        db.set(k, String(a[0])); ttl.delete(k);
        const ex = opts.indexOf('EX'); if (ex >= 0) ttl.set(k, Number(a[ex + 2]));
        return 'OK';
      }
      case 'INCR': { const v = Number(db.get(k) || 0) + 1; db.set(k, String(v)); return v; }
      case 'DEL': ttl.delete(k); return db.delete(k) ? 1 : 0;
      case 'EXISTS': return db.has(k) ? 1 : 0;
      case 'EXPIRE': if (!db.has(k)) return 0; ttl.set(k, Number(a[0])); return 1;
      case 'HSET': { const h = hashOf(k, true); let n = 0; for (let i = 0; i < a.length; i += 2) { if (!h.has(a[i])) n++; h.set(a[i], String(a[i + 1])); } return n; }
      case 'HDEL': { const h = hashOf(k); if (!h) return 0; let n = 0; a.forEach(f => { if (h.delete(f)) n++; }); if (!h.size) db.delete(k); return n; }
      case 'HGET': { const h = hashOf(k); return h && h.has(a[0]) ? h.get(a[0]) : null; }
      case 'HGETALL': { const h = hashOf(k); if (!h) return []; const o = []; h.forEach((v, f) => o.push(f, v)); return o; }
      default: throw new Error('ERR unknown command ' + op);
    }
  }
  return {
    db, ttl,
    pipeline(cmds) { return cmds.map(c => { try { return { result: run(c) }; } catch (e) { return { error: e.message }; } }); },
    get commands() { return commands; },
    keys(prefix) { return [...db.keys()].filter(k => !prefix || k.startsWith(prefix)); },
  };
}
module.exports = { createMock };
