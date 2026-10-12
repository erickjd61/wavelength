import { html, render } from './vendor/preact-htm.js';
import { normCode } from './lib.js';
import { Student } from './student.js';
import { Teach } from './teach.js';
import { Screen } from './screen.js';

const path = location.pathname.replace(/\/+$/, '');
const params = new URLSearchParams(location.search);
const pathCode = (path.match(/^\/j\/([A-Za-z0-9]+)/) || [])[1];
const code = normCode(params.get('c') || pathCode || '');

let view;
if (path === '/teach') view = html`<${Teach} />`;
else if (path === '/screen') view = html`<${Screen} code=${code} />`;
else view = html`<${Student} initialCode=${code} />`;

render(view, document.getElementById('app'));
