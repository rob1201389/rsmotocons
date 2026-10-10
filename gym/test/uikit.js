/* jsdom harness for the coaching UI tests: real index.html, real scripts, a
   served origin, a fixed clock (Mon 14 Sep 2026, 10:30 Sydney time). */
process.env.TZ = 'Australia/Sydney';
const { JSDOM } = require('jsdom');
const fs = require('fs'), http = require('http'), path = require('path');
const APP = fs.existsSync(path.join(__dirname, '../public/index.html')) ? path.join(__dirname, '../public') : __dirname;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
let server, ORIGIN;
const serve = () => new Promise(res => {
  server = http.createServer((req, rq) => {
    const f = path.join(APP, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
    fs.readFile(f, (err, buf) => { if (err) { rq.writeHead(404); rq.end('nope'); return; }
      rq.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); rq.end(buf); });
  }).listen(0, '127.0.0.1', () => { ORIGIN = 'http://127.0.0.1:' + server.address().port + '/'; res(); });
});
const stop = () => server && server.close();
const wait = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.parse('2026-09-14T10:30:00+10:00');
function boot(state, opts) {
  opts = opts || {};
  const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const errors = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', resources: 'usable', url: ORIGIN + 'index.html', pretendToBeVisual: true,
    beforeParse(w) {
      const Real = w.Date, t0 = Real.now(), at = opts.now || NOW;
      w.Date = class extends Real { constructor(...a) { if (a.length) super(...a); else super(at + (Real.now() - t0)); } static now() { return at + (Real.now() - t0); } };
      w.requestAnimationFrame = cb => setTimeout(() => cb(w.performance.now()), 16);
      w.cancelAnimationFrame = id => clearTimeout(id);
      w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.matchMedia = q => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
      w.navigator.vibrate = () => true;
      Object.defineProperty(w.navigator, 'onLine', { get: () => true, configurable: true });
      w.indexedDB = undefined;
      w.localStorage.clear(); if (state) w.localStorage.setItem('recomp.v3', JSON.stringify(state));
      w.confirm = () => true; w.alert = () => {}; w.scrollTo = () => {};
      w.HTMLElement.prototype.scrollIntoView = function () {};
      w.addEventListener('error', e => errors.push(String(e.message)));
      w.addEventListener('unhandledrejection', e => errors.push('rejection: ' + (e.reason && e.reason.stack || e.reason)));
      if (opts.fetch) w.fetch = opts.fetch;
    }
  });
  dom.errors = errors;
  return dom;
}
const click = (w, e) => { if (!e) throw new Error('click: element not found'); e.dispatchEvent(new w.Event('click', { bubbles: true })); };
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const byText = (root, sel, s) => [...root.querySelectorAll(sel)].find(e => text(e).includes(s));
const type = (w, input, v) => { input.value = v; input.dispatchEvent(new w.Event('input', { bubbles: true })); input.dispatchEvent(new w.Event('change', { bubbles: true })); };
module.exports = { serve, stop, boot, wait, click, text, byText, type, NOW, APP };
