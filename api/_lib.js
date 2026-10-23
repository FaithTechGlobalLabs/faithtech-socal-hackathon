/* =============================================================================
   api/_lib.js — shared helpers for the submit and judges endpoints.

   Functions live in <root>/api (not site/api); vercel.json sets
   outputDirectory:"site" for the static pages. Ported from the claudesocal
   Impact Lab form code, trimmed to what the submit and judges endpoints use.

   NO DEPENDENCIES. The project has no package.json and no build step. Supabase
   and Resend are both reached over their REST APIs with the global fetch that
   Node 24 ships. Adding node_modules here would change how Vercel builds the
   whole site, so we do not.

   Filename starts with "_", so Vercel does not route it.
   ========================================================================== */

'use strict';

const crypto = require('crypto');

// Internal notifications retain the established owner inbox independently of public contact.
const OWNER_NOTIFY_DEFAULT = 'travis@aurapathai.com';

/* ---- environment ---------------------------------------------------------
   Every var is read here and nowhere else. A missing var is a 503 with the
   names in it, never a silent success and never a fake 200. The service key
   lives only in process.env: it is never sent to the browser and never written
   into a committed file. */
/* REQUIRED: without these a submission cannot be STORED, so there is nothing honest to tell
   the visitor and the endpoint refuses with a 503 that names them. */
const ENV_SPEC = [
  ['SUPABASE_URL', 'https://<project-ref>.supabase.co'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'the service_role key from Supabase, server only'],
];

/* OPTIONAL: mail. Losing the confirmation email is a degradation, not a failure — the row is
   still written and Travis still has it. Blocking the whole form on a missing mail key would
   throw away real submissions to protect a nicety, so the handler falls through to the
   durable mail queue. The worker reports missing configuration and retries when restored. */
const MAIL_SPEC = [
  ['RESEND_API_KEY', 're_... from resend.com/api-keys'],
  ['FORM_MAIL_FROM', 'FaithTech SoCal Create Hackathon <forms@aurapathai.com>, a Resend-verified domain'],
];

function readEnv() {
  const missing = [];
  const env = {};
  for (const [name] of ENV_SPEC) {
    const v = process.env[name];
    if (!v || !String(v).trim()) missing.push(name);
    else env[name] = String(v).trim();
  }
  for (const [name] of MAIL_SPEC) {
    const v = process.env[name];
    if (v && String(v).trim()) env[name] = String(v).trim();
  }
  env.MAIL_READY = MAIL_SPEC.every(([n]) => !!env[n]);
  // Optional, with a default that is known to receive mail.
  env.FORM_NOTIFY_TO = (process.env.FORM_NOTIFY_TO || OWNER_NOTIFY_DEFAULT).trim();
  env.FORM_IP_SALT = (process.env.FORM_IP_SALT || '').trim();
  env.ANALYTICS_HASH_SECRET = (process.env.ANALYTICS_HASH_SECRET || '').trim();
  // Signs team edit codes (api/impact-lab-submit.js). The submit endpoint refuses without it.
  env.EDIT_CODE_SECRET = (process.env.EDIT_CODE_SECRET || '').trim();
  return { env, missing };
}

/* ---- request reading -----------------------------------------------------
   On Vercel req.body is already parsed for JSON and urlencoded bodies. Under
   the local harness it is not. Handle both rather than assuming either; reading
   a stream Vercel has already consumed hangs the function. */
const BODY_CAP = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      if (Number(req.headers['content-length']) > BODY_CAP || Buffer.byteLength(JSON.stringify(req.body)) > BODY_CAP) return reject(new Error('body too large'));
      return resolve(req.body);
    }
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      if (Number(req.headers['content-length']) > BODY_CAP || Buffer.byteLength(req.body) > BODY_CAP) return reject(new Error('body too large'));
      return resolve(parseRaw(req, String(req.body)));
    }

    /* Past the cap we stop keeping the bytes but keep draining the socket, then
       answer 413. Destroying the request instead resets the connection, and the
       browser shows its own network error page rather than our sentence — the
       first version of this did exactly that and the test caught it as
       ECONNRESET. Only a genuinely abusive body (32x the cap) gets cut off. */
    const CAP = BODY_CAP;
    const chunks = [];
    let seen = 0;
    let over = false;
    const timer = setTimeout(() => reject(new Error('body read timed out')), 10000);
    req.on('close', () => clearTimeout(timer));
    req.on('aborted', () => reject(new Error('request aborted')));
    req.on('data', (c) => {
      seen += c.length;
      if (seen > CAP) {
        over = true;
        if (seen > CAP * 32) req.destroy();
        return;
      }
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on('end', () => {
      clearTimeout(timer);
      if (over) return reject(new Error('body too large'));
      resolve(parseRaw(req, Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
  });
}

/* Marks a body that claimed to be JSON but did not parse. Callers that do not
   look for it see an empty object, as before. */
const BAD_JSON = Symbol('bad json');

function parseRaw(req, raw) {
  const type = String(req.headers['content-type'] || '');
  if (!raw) return {};
  if (type.indexOf('application/json') !== -1) {
    try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; }
    catch (_) { return Object.defineProperty({}, BAD_JSON, { value: true }); }
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

/* ---- who is asking, and in what shape ----------------------------------- */
function wantsJson(req) {
  const a = String(req.headers['accept'] || '');
  return a.indexOf('application/json') !== -1;
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  if (fwd) return fwd.split(',')[0].trim();
  return String(req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown');
}

/* Raw IPs are never stored. The hash is what lands in the table, so the row is
   still rate-limitable and still not a location record. */
function hashIp(ip, salt) {
  return crypto.createHash('sha256').update(String(salt || '') + '|' + String(ip)).digest('hex').slice(0, 32);
}

/* ---- rate limiting -------------------------------------------------------
   Two layers, because neither is enough alone.
   1. In-memory sliding window. Instant, free, and only covers the one warm
      instance that happens to serve the request. Catches a burst.
   2. A count against the table itself. Survives cold starts and spans
      instances. Costs one extra round trip. Fails OPEN on a network error:
      losing a real speaker application to a flaky count query would be worse
      than letting one extra row through. */
const MEM = new Map(); // key -> array of timestamps
const MEM_WINDOW_MS = 10 * 60 * 1000;
const MEM_MAX = 5;
const DB_WINDOW_MS = 60 * 60 * 1000;
const DB_MAX = 8;

function memoryRateExceeded(key, max = MEM_MAX, windowMs = MEM_WINDOW_MS) {
  const now = Date.now();
  const hits = (MEM.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  MEM.set(key, hits);
  if (MEM.size > 5000) MEM.clear(); // crude, bounded, and never the only defence
  return hits.length > max;
}

async function dbRateExceeded(env, table, ipHash) {
  if (!ipHash) return false;
  const since = new Date(Date.now() - DB_WINDOW_MS).toISOString();
  const url = env.SUPABASE_URL.replace(/\/+$/, '') +
    '/rest/v1/' + table +
    '?select=id&ip_hash=eq.' + encodeURIComponent(ipHash) +
    '&created_at=gte.' + encodeURIComponent(since) +
    '&limit=' + (DB_MAX + 1);
  try {
    const r = await boundedFetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > DB_MAX;
  } catch (_) {
    return false; // fail open, on purpose, and say so in the log
  }
}

/* ---- validation ----------------------------------------------------------
   Server side. The browser's `required` and `maxlength` are a courtesy to
   people; they are not a check, because nothing stops a POST that skips the
   page entirely. Every field is capped, every choice is checked against a
   list, and unknown keys are dropped rather than stored. */
function str(v) {
  if (v === undefined || v === null) return '';
  return String(Array.isArray(v) ? v[0] : v).replace(/\u0000/g, '').trim();
}

const EMAIL_RE = /^[^\s@,;:<>"'\\]+@[^\s@.,;:<>"'\\]+(\.[^\s@.,;:<>"'\\]+)+$/;

function validate(spec, body) {
  const values = {};
  const errors = [];
  for (const f of spec) {
    const raw = str(body[f.name]);
    if (!raw) {
      if (f.required) errors.push({ field: f.name, message: f.label + ' is needed.' });
      values[f.name] = null;
      continue;
    }
    if (f.max && raw.length > f.max) {
      errors.push({ field: f.name, message: f.label + ' is longer than ' + f.max + ' characters.' });
      continue;
    }
    if (f.type === 'email' && !EMAIL_RE.test(raw)) {
      errors.push({ field: f.name, message: 'That email address does not look like an address.' });
      continue;
    }
    if (f.type === 'url') {
      let u = raw;
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      let parsed = null;
      try { parsed = new URL(u); } catch (_) { parsed = null; }
      if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        errors.push({ field: f.name, message: 'That link is not a web address.' });
        continue;
      }
      values[f.name] = parsed.href;
      continue;
    }
    if (f.oneOf && f.oneOf.indexOf(raw) === -1) {
      errors.push({ field: f.name, message: 'Choose one of the listed options for ' + f.label.toLowerCase() + '.' });
      continue;
    }
    values[f.name] = raw;
  }
  return { values, errors };
}

/* ---- the two bot checks --------------------------------------------------
   honeypot: a field a person never sees and never fills. Anything in it is a
             script. We answer 200 and drop the submission on the floor, so the
             script has nothing to tune against.
   timing:   the page stamps a load time into a hidden field. A submit that
             lands under MIN_FILL_MS after the stamp was not typed. The stamp is
             only present when JavaScript ran, so this check is skipped on the
             no-JavaScript path rather than pretending to cover it. */
/* 2500ms silently discarded real people. A short form is email + one select; autofill and
   password managers complete it in well under a second, and the caller answered the drop with
   the FULL success copy — measured at 0.4s the page said "Your metro is on the record" while
   nothing had been written. That is the exact silent-success failure this endpoint exists to
   remove, reintroduced by its own bot check. Lowered, and a fast submit is no longer dropped:
   it is stored and FLAGGED, so a false positive costs a review rather than a lost person. */
const MIN_FILL_MS = 900;
const MAX_FORM_AGE_MS = 12 * 60 * 60 * 1000;

function botVerdict(body) {
  if (str(body.company_website)) return 'honeypot';
  const ts = Number(str(body.ts));
  if (str(body.js) === '1' && Number.isFinite(ts) && ts > 0) {
    const age = Date.now() - ts;
    if (age < MIN_FILL_MS) return 'too-fast';
    if (age > MAX_FORM_AGE_MS) return 'stale';
  }
  return null;
}

/* Deadlines cover response bodies as well as response headers. */
async function boundedFetch(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    return new Response(body || null, { status: response.status, headers: response.headers });
  } finally { clearTimeout(timer); }
}

async function rpc(env, name, payload) {
  const response = await boundedFetch(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const detail = await response.text();
    const error = new Error('database request failed: ' + response.status);
    error.conflict = detail.includes('idempotency key reused');
    throw error;
  }
  // PostgREST returns204 for SQL functions declared RETURNS void.
  // Data-returning RPCs must still provide valid JSON.
  if (response.status === 204) return null;
  return response.json();
}

/* ---- Supabase ------------------------------------------------------------ */
async function insertRow(env, table, row) {
  const url = env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/' + table;
  const r = await boundedFetch(url, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([row]),
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error('supabase insert failed: ' + r.status + ' ' + text.slice(0, 400));
    err.status = r.status;
    throw err;
  }
  try { return JSON.parse(text)[0] || null; } catch (_) { return null; }
}

/* ---- responses -----------------------------------------------------------
   One shape, two renderings. fetch() asks for JSON and gets JSON. A browser
   with JavaScript switched off posts the form directly, lands here, and gets a
   real page: same stylesheet, same words, correct status code. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function respond(req, res, status, payload) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (wantsJson(req)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(htmlPage(payload));
}

function htmlPage(p) {
  const errs = (p.errors || []).map((e) => '<li>' + escapeHtml(e.message) + '</li>').join('');
  // Receipt actions are local routes only. Reject protocols, network-path URLs,
  // query strings and backslashes rather than turning payload data into an open link.
  const links = (Array.isArray(p.links) ? p.links : []).filter((link) =>
    link && typeof link.href === 'string' && /^\/(?!\/)[a-z0-9/_-]*(?:#[a-z0-9_-]+)?$/i.test(link.href) &&
    typeof link.label === 'string' && link.label.trim());
  const actions = links.map((link) => '<a class="btn btn-ghost" href="' +
    escapeHtml(link.href) + '">' + escapeHtml(link.label) + '</a>').join(' ');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>' + escapeHtml(p.title) + ' — FaithTech SoCal Create Hackathon</title>' +
    '<link rel="stylesheet" href="/judges.css"></head>' +
    '<body class="p-form"><main id="main"><section class="section"><div class="wrap">' +
    '<h1 class="h2">' + escapeHtml(p.title) + '</h1>' +
    '<p class="prose">' + escapeHtml(p.message) + '</p>' +
    (p.ok && p.email ? '<p class="prose" style="overflow-wrap:anywhere"><strong>Email:</strong> ' + escapeHtml(p.email) + '</p>' : '') +
    (errs ? '<ul class="prose">' + errs + '</ul>' : '') +
    (actions ? '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:26px">' + actions + '</div>' : '') +
    '<p style="margin-top:26px"><a class="btn btn-primary" href="' + escapeHtml(p.backHref || '/') + '">' +
    escapeHtml(p.backLabel || 'Back') + '</a></p>' +
    '</div></section></main></body></html>';
}

module.exports = {
  readEnv, readBody, BAD_JSON, wantsJson, clientIp, hashIp,
  validate, botVerdict, insertRow, respond, escapeHtml,
  memoryRateExceeded, MEM, boundedFetch,
};
