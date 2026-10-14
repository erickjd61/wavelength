// Local test server: serves the site and /api/rpc against an in-memory database.
//   node scripts/dev.js [port]      then open http://localhost:5173/teach
// Nothing here touches the real database.
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const { createMock } = require('./mock-redis.js');
const ROOT = path.join(__dirname, '..'), PORT = Number(process.argv[2] || process.env.PORT || 5173);
const mock = createMock();
process.env.KV_REST_API_URL = 'http://127.0.0.1:' + PORT + '/__redis';
process.env.KV_REST_API_TOKEN = 'dev-token';
const handler = require(path.join(ROOT, 'api/rpc.js'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  let body = ''; req.on('data', d => { body += d; }); req.on('end', async () => {
    if (u.pathname === '/__redis/pipeline') {
      if (req.headers.authorization !== 'Bearer dev-token') { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(mock.pipeline(JSON.parse(body))));
    }
    if (u.pathname === '/__stats') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ commands: mock.commands })); }
    if (u.pathname === '/api/rpc') {
      const rq = { method: req.method, query: u.query, headers: req.headers, body: body ? JSON.parse(body) : {} };
      const rs = { code: 200, setHeader() {}, status(s) { this.code = s; return this; }, json(o) { res.writeHead(this.code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); } };
      return handler(rq, rs);
    }
    let p = u.pathname;
    if (p === '/' || p === '/teach' || p === '/screen' || p.startsWith('/j/') || /^\/[A-Za-z0-9]{3,8}$/.test(p)) p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory() || p.startsWith('/scripts/') || p.startsWith('/tests/')) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
}).listen(PORT, () => console.log('Wavelength dev server on http://localhost:' + PORT + '  (in-memory data)'));
