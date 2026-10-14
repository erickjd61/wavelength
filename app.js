import { html, render, useErrorBoundary } from './vendor/preact-htm.js';
import { normCode } from './lib.js';
import { Student } from './student.js';
import { Teach } from './teach.js';
import { Screen } from './screen.js';

const path = location.pathname.replace(/\/+$/, '');
const params = new URLSearchParams(location.search);
// Short class links: /BIO101 (also /j/BIO101 and /?c=BIO101 for older links).
const pathCode = (path.match(/^\/j\/([A-Za-z0-9]+)/) || [])[1] || (path !== '/teach' && path !== '/screen' ? (path.match(/^\/([A-Za-z0-9]{3,8})$/) || [])[1] : null);
const code = normCode(params.get('c') || pathCode || '');

let view;
if (path === '/teach') view = html`<${Teach} />`;
else if (path === '/screen') view = html`<${Screen} code=${code} />`;
else view = html`<${Student} initialCode=${code} />`;

// If any screen ever crashes, show a way back instead of a frozen page.
function Safe({ children }) {
  const [error] = useErrorBoundary(e => { try { console.error(e); } catch (_) {} });
  if (error) return html`<div class="dark-bg" style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px"><div style="max-width:380px;display:flex;flex-direction:column;gap:14px;text-align:center">
    <div style="font-size:26px;font-weight:900">Something went wrong</div><div class="sub">Reloading usually fixes it. You'll stay in your class and group.</div>
    <button class="btn btn-white" onClick=${() => location.reload()}>Reload</button></div></div>`;
  return children;
}
render(html`<${Safe}>${view}<//>`, document.getElementById('app'));
