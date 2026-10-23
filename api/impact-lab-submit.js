/* api/impact-lab-submit.js — POST /api/impact-lab-submit, the team submission
   form on the FaithTech SoCal Create Hackathon hub (Sat 2026-10-24).
   Ported from the claudesocal Impact Lab (same tables, new event_slug).

   Stores one row in public.impact_lab_submissions. Sends no email. Organizers
   and judges read rows at /judges (api/impact-lab-submissions.js).

   Editing: every save is a new row, and the judges view shows the newest row
   per team (earlier rows stay as its history). Teams match on teamKey():
   invisible characters stripped, spaces collapsed, case ignored. A team name
   belongs to whoever first submitted it. Only the team can change its row:
   every successful save returns an edit code (teamKey + '.' + HMAC of it,
   keyed by EDIT_CODE_SECRET). The team keeps that code. Saving under a taken
   name, or changing a row, needs the code. {action:'fetch', edit_code} returns
   that one team's fields to prefill the form; a wrong code gets the same
   "not found" answer as a missing team. Email is never a credential. An edit
   may change anything, the team name included, at any time: a rename moves
   the team's earlier rows, judge votes, scores and locked finalist slot, and
   the edit code changes with it. Lost code: an organizer re-issues it.

   There is no server-side deadline. "Code freeze 4:00 PM" is guidance only.

   RATE LIMIT NOTE: many people share the venue Wi-Fi, so every submission
   arrives from one public IP. This endpoint only keeps a generous
   per-instance burst limit. */

'use strict';

const crypto = require('crypto');
const lib = require('./_lib.js');

const TABLE = 'impact_lab_submissions';
const EVENT_SLUG = (process.env.EVENT_SLUG || 'faithtech-socal-2026-10-24').trim();
const BACK = { backHref: '/#submit', backLabel: 'Open a blank form' };
const KEEP = ' Use your browser\'s Back button to keep what you typed.';
const CHALLENGES = { 1: 'Mobile-first church onboarding', 2: 'Testimony sharing', 3: 'The first 30 days' };

/* What a judge needs from each team, in the order the form asks for it.
   Judging weights live in api/impact-lab-submissions.js (AREAS). */
const FIELDS = [
  { name: 'team_name',      label: 'Team name',                 required: true,  max: 120 },
  { name: 'challenge',      label: 'Track',                 required: true,  max: 1, oneOf: Object.keys(CHALLENGES) },
  { name: 'one_liner',      label: 'Who it is for',             required: true,  max: 200 },
  { name: 'what_it_does',   label: 'What it does',              required: true,  max: 1200 },
  // A team gives a GitHub repo, a link we can open, or both (checked below), so a
  // non-technical team is never forced onto GitHub. repo_url is NOT NULL in the
  // shared table, so "no repo" is stored as ''. demo_video_url is the optional
  // walkthrough video. real_vs_mocked and try_it are legacy columns, not collected.
  { name: 'repo_url',       label: 'GitHub repo',               required: false, max: 500, type: 'url' },
  { name: 'live_demo_url',  label: 'Link to see it',            required: false, max: 500, type: 'url' },
  { name: 'demo_video_url', label: 'Demo video',                required: false, max: 500, type: 'url' },
  { name: 'members',        label: 'Team members',              required: true,  max: 1000 },
  { name: 'contact_name',   label: 'Contact name',              required: true,  max: 120 },
  { name: 'contact_email',  label: 'Contact email',             required: true,  max: 254, type: 'email' },
];

const MISSING = {
  challenge: 'Pick your track.',
  one_liner: 'Say who it is for, in one line.',
  members: 'List your team, one name per line.',
};

/* Invisible format characters (zero-width space and joiners, word joiner, BOM,
   bidi marks: Unicode Cf) plus the blank-looking Hangul and Braille fillers.
   Stripped before any required or length check, so a name made only of them
   counts as empty. */
const INVISIBLE = /[\p{Cf}\u115F\u1160\u3164\uFFA0\u2800]/gu;
const stripInvisible = (v) => String(v).replace(INVISIBLE, '');
/* A team name as people mean it: no invisible characters, single spaces. */
const normName = (v) => stripInvisible(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
/* The key every view, vote and score uses to match a team across resubmissions. */
const teamKey = (v) => normName(v).toLowerCase();

/* Names, one per line (commas also accepted). Emails are not needed here. */
function parseMembers(text) {
  const names = String(text || '').split(/\r?\n|,/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const errors = [];
  if (!names.length) errors.push('List at least one name.');
  if (names.length > 10) errors.push('List at most 10 people. One team per submission.');
  if (names.some((n) => n.length > 120)) errors.push('One name is longer than 120 characters.');
  return { members: names, errors };
}

/* Edit codes: teamKey + '.' + 32 hex chars of HMAC-SHA256(EDIT_CODE_SECRET,
   EVENT_SLUG|teamKey). Only the server can make one; the team sees it once, on
   its receipt. Checked with a constant-time compare. Returns the team key the
   code is for, or '' if the code is missing or wrong. */
function editCodeFor(secret, key) {
  const mac = crypto.createHmac('sha256', secret).update(EVENT_SLUG + '|' + key).digest('hex').slice(0, 32);
  return key + '.' + mac;
}
function keyForEditCode(secret, code) {
  const s = typeof code === 'string' ? code.trim() : '';
  const at = s.lastIndexOf('.');
  if (at < 1) return '';
  const expected = Buffer.from(editCodeFor(secret, s.slice(0, at)));
  const given = Buffer.from(s);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return '';
  return s.slice(0, at);
}

async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return lib.respond(req, res, 405, { ok: false, code: 'method_not_allowed',
      title: 'That address only takes a form',
      message: 'Open the hackathon hub and use the submission form.', ...BACK });
  }

  let body;
  try { body = await lib.readBody(req); }
  catch (e) {
    // Vercel's body parser throws on malformed JSON; only a real overflow is "too much text".
    if (/too large/.test(e && e.message)) {
      return lib.respond(req, res, 413, { ok: false, code: 'too_large', title: 'That was too much text',
        message: 'The submission was larger than the form allows. Shorten it and try again.' + KEEP, ...BACK });
    }
    body = { [lib.BAD_JSON]: true };
  }
  if (body[lib.BAD_JSON]) {
    return lib.respond(req, res, 400, { ok: false, code: 'unreadable', title: 'We couldn\'t read that',
      message: 'The submission did not arrive as a readable form. Reload the page and submit again.', ...BACK });
  }

  // Every field is text. An object or a list is refused, never stored as "[object Object]".
  const raw = body;
  const clean = {};
  const typeErrors = [];
  for (const f of FIELDS) {
    const v = body[f.name];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) {
      typeErrors.push({ field: f.name, message: f.label + ' must be text.' });
      continue;
    }
    clean[f.name] = f.name === 'team_name' ? normName(v) : stripInvisible(v);
  }
  for (const k of ['company_website', 'ts', 'js']) if (typeof body[k] === 'string') clean[k] = body[k];
  if (body.action === 'fetch') {
    typeErrors.length = 0;
    for (const k of Object.keys(clean)) delete clean[k];
  }
  if (typeErrors.length) {
    return lib.respond(req, res, 400, { ok: false, code: 'invalid', title: 'Nothing was sent',
      message: 'The form needs a little more before it can go:', errors: typeErrors, ...BACK });
  }
  const action = typeof raw.action === 'string' ? raw.action : '';
  const editCode = typeof raw.edit_code === 'string' ? raw.edit_code : '';
  body = clean;
  if (action === 'fetch') return fetchTeam(req, res, editCode);

  const bot = lib.botVerdict(body);
  if (bot === 'honeypot') {
    return lib.respond(req, res, 200, { ok: true, code: 'received', title: 'Submission received',
      message: 'Your team submission is saved.', ...BACK });
  }

  const { values, errors } = lib.validate(FIELDS, body);
  errors.forEach((e) => { if (MISSING[e.field] && / is needed\.$/.test(e.message)) e.message = MISSING[e.field]; });

  let members = [];
  if (values.members) {
    const parsed = parseMembers(values.members);
    members = parsed.members;
    parsed.errors.forEach((m) => errors.push({ field: 'members', message: m }));
  }

  // http:// is upgraded rather than refused. The repo must be a public GitHub link (owner/repo).
  for (const k of ['repo_url', 'live_demo_url', 'demo_video_url']) {
    if (values[k]) values[k] = values[k].replace(/^http:\/\//i, 'https://');
  }
  if (!values.repo_url && !values.live_demo_url) {
    const need = 'Add a GitHub repo or a link we can open. One is enough.';
    errors.push({ field: 'repo_url', message: need }, { field: 'live_demo_url', message: need });
  }
  if (values.repo_url && !/^https:\/\/(www\.)?github\.com\/[^/\s]+\/[^/?#\s]+/i.test(values.repo_url)) {
    errors.push({ field: 'repo_url', message: 'Paste the full public GitHub link with the owner and the repo, like ' +
      'https://github.com/your-team/your-repo.' });
  }

  if (errors.length) {
    return lib.respond(req, res, 400, { ok: false, code: 'invalid', title: 'Nothing was sent',
      message: 'The form needs a little more before it can go.' + KEEP, errors, ...BACK });
  }

  const { env, missing } = lib.readEnv();
  if (!env.EDIT_CODE_SECRET) missing.push('EDIT_CODE_SECRET');
  if (missing.length) {
    console.error('[' + TABLE + '] refusing submission: missing env ' + missing.join(', '));
    return lib.respond(req, res, 503, { ok: false, code: 'not_configured', missing,
      title: 'Submissions are not connected yet',
      message: 'Nothing was stored. Find an organizer and show them this message.', ...BACK });
  }

  const ipHash = lib.hashIp(lib.clientIp(req), env.FORM_IP_SALT || env.SUPABASE_SERVICE_ROLE_KEY);
  if (lib.memoryRateExceeded(TABLE + ':' + ipHash, 60, 10 * 60 * 1000)) {
    res.setHeader('Retry-After', '120');
    return lib.respond(req, res, 429, { ok: false, code: 'rate_limited', title: 'Too many submissions at once',
      message: 'Nothing was stored. Wait two minutes and try again, or find an organizer.', ...BACK });
  }

  const row = {
    event_slug: EVENT_SLUG,
    team_name: values.team_name,
    challenge: values.challenge,
    one_liner: values.one_liner,
    what_it_does: values.what_it_does,
    repo_url: values.repo_url || '',
    live_demo_url: values.live_demo_url,
    demo_video_url: values.demo_video_url,
    members,
    contact_name: values.contact_name,
    contact_email: values.contact_email.toLowerCase(),
    no_phi_confirmed: true,
    ip_hash: ipHash,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
    suspect: bot || null,
  };

  const all = await currentRows(env);
  if (all === null) {
    return lib.respond(req, res, 503, { ok: false, code: 'not_checked', title: 'We could not check that team name',
      message: 'Nothing was stored. Try again in a moment, or find an organizer.' + KEEP, ...BACK });
  }
  const latest = latestByTeam(all);
  const key = teamKey(values.team_name);
  // Which team is this save for? Only a valid edit code makes it an edit. A plain
  // submit under a taken name is refused, whatever email it gives.
  const ownKey = keyForEditCode(env.EDIT_CODE_SECRET, editCode);
  let from = '';
  if (ownKey) {
    if (!latest.has(ownKey)) {
      return lib.respond(req, res, 403, { ok: false, code: 'not_owner', title: 'That edit code does not match',
        message: 'Nothing was saved. Check the code from your receipt, or find an organizer.', ...BACK });
    }
    from = ownKey;
  }
  if (latest.has(key) && key !== from) {
    return lib.respond(req, res, 409, { ok: false, code: 'name_taken', title: 'That team name is taken',
      message: 'Nothing was saved. If this is your team, open Edit your submission and paste your edit code. ' +
        'Otherwise pick another name.' + KEEP,
      errors: [{ field: 'team_name', message: 'Taken. Edit your submission instead, or pick another name.' }], ...BACK });
  }
  const earlier = from ? all.filter((x) => teamKey(x.team_name) === from) : [];

  let saved;
  try { saved = await lib.insertRow(env, TABLE, row); }
  catch (e) {
    console.error('[' + TABLE + '] insert failed: ' + e.message);
    return lib.respond(req, res, 502, { ok: false, code: 'not_saved', title: 'We could not save that',
      message: 'Your submission may not have been stored. Try again once, then find an organizer.', ...BACK });
  }

  let renameNote = '';
  if (from && key !== from) {
    const ok = await carryRename(env, earlier, from, values.team_name);
    renameNote = ok ? ' Renamed from ' + normName(earlier[earlier.length - 1].team_name) + '; votes and scores moved with it.'
      : ' Renamed, but moving earlier votes and scores did not finish: tell an organizer.';
  }

  const when = clock((saved && saved.created_at) || Date.now());
  const ch = 'Track ' + values.challenge + ' (' + CHALLENGES[values.challenge] + ')';
  const status = earlier.length ? 'Updated ' + values.team_name + ' (version ' + (earlier.length + 1) + ', ' + ch + '); judges see this one.' + renameNote
      : 'New team: ' + values.team_name + ', ' + ch + '.';
  const editCodeNow = editCodeFor(env.EDIT_CODE_SECRET, key);
  const lines = [
    'Saved at ' + when + '. ' + status,
    'Your edit code is ' + editCodeNow + '. Keep it: it is the only way to change this submission. ' +
      'If you rename your team, the code changes too. Lost it? Find an organizer.',
    'Code freeze is at 4:00 PM. After that the judges read every submission and pick the demos for the room.',
  ];
  const payload = {
    ok: true, code: 'received', id: saved && saved.id,
    title: earlier && earlier.length ? 'Submission updated' : 'Submission received',
    message: lines.join(' '), lines,
    updated: earlier.length > 0, edit_code: editCodeNow,
    first_saved_at: earlier && earlier.length ? earlier[0].created_at : (saved && saved.created_at) || null,
    team_name: values.team_name, challenge: values.challenge, repo_url: values.repo_url,
    ...BACK, backLabel: 'Back to the hub',
  };
  if (lib.wantsJson(req)) return lib.respond(req, res, 200, payload);
  res.statusCode = 200;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.end(receiptPage(payload));
}

const clock = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });

/* Every submission row, oldest first, with what ownership checks and lookups
   need; null when they could not be read. */
const base = (env) => env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
const auth = (env) => ({ apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY });
async function currentRows(env) {
  try {
    const r = await lib.boundedFetch(base(env) + TABLE + '?select=*&event_slug=eq.' + encodeURIComponent(EVENT_SLUG) +
      '&order=created_at.asc', { headers: auth(env) });
    if (!r.ok) return null;
    const rows = await r.json();
    return Array.isArray(rows) ? rows : null;
  } catch (_) { return null; }
}
/* team key -> its newest row */
function latestByTeam(rows) {
  const m = new Map();
  rows.forEach((x) => m.set(teamKey(x.team_name), x));
  return m;
}

/* "Edit your submission": the one team this edit code belongs to, with every
   field to prefill the form. Nothing comes back without a valid code. A wrong
   code and a missing team get the same answer. */
async function fetchTeam(req, res, editCode) {
  const no = (status, title, message) => lib.respond(req, res, status, { ok: false, code: 'not_found', title, message, ...BACK });
  const { env, missing } = lib.readEnv();
  if (missing.length || !env.EDIT_CODE_SECRET) return no(503, 'Submissions are not connected yet', 'Find an organizer.');
  const ipHash = lib.hashIp(lib.clientIp(req), env.FORM_IP_SALT || env.SUPABASE_SERVICE_ROLE_KEY);
  if (lib.memoryRateExceeded(TABLE + ':fetch:' + ipHash, 60, 10 * 60 * 1000)) return no(429, 'Too many tries', 'Wait two minutes and try again.');
  const key = keyForEditCode(env.EDIT_CODE_SECRET, editCode);
  if (!key) return no(404, 'No submission matches that code', 'Check the code from your receipt, or find an organizer.');
  const all = await currentRows(env);
  if (all === null) return no(503, 'We could not look that up', 'Try again in a moment, or find an organizer.');
  const x = latestByTeam(all).get(key);
  if (!x) return no(404, 'No submission matches that code', 'Check the code from your receipt, or find an organizer.');
  const versions = all.filter((r) => teamKey(r.team_name) === key).length;
  const team = { team_name: normName(x.team_name), challenge: x.challenge, one_liner: x.one_liner,
    what_it_does: x.what_it_does, repo_url: x.repo_url || '', live_demo_url: x.live_demo_url || '',
    demo_video_url: x.demo_video_url || '',
    members: (Array.isArray(x.members) ? x.members : []).map((m) => (typeof m === 'string' ? m : (m && m.name) || '')).filter(Boolean).join('\n'),
    contact_name: x.contact_name, contact_email: x.contact_email, versions, saved_at: x.created_at };
  return lib.respond(req, res, 200, { ok: true, code: 'found', team, edit_code: editCode.trim() });
}

/* A rename: earlier rows, judge votes and scores move to the new name, and a
   locked finalist slot follows. Returns false if any step failed. */
async function carryRename(env, earlier, oldKey, newName) {
  const newKey = teamKey(newName);
  const slug = 'event_slug=eq.' + encodeURIComponent(EVENT_SLUG);
  const patch = (path, body) => lib.boundedFetch(base(env) + path, { method: 'PATCH', body: JSON.stringify(body),
    headers: { ...auth(env), 'Content-Type': 'application/json', Prefer: 'return=minimal' } }).then((r) => r.ok).catch(() => false);
  const ids = earlier.map((x) => x.id).filter(Boolean).map(encodeURIComponent).join(',');
  const steps = [
    ids ? patch(TABLE + '?id=in.(' + ids + ')', { team_name: newName }) : true,
    patch('impact_lab_votes?' + slug + '&team_key=eq.' + encodeURIComponent(oldKey), { team_key: newKey, team_name: newName }),
    patch('impact_lab_scores?' + slug + '&team_key=eq.' + encodeURIComponent(oldKey), { team_key: newKey, team_name: newName }),
  ];
  let ok = (await Promise.all(steps)).every(Boolean);
  try {
    const r = await lib.boundedFetch(base(env) + 'impact_lab_settings?select=finalist_keys&' + slug, { headers: auth(env) });
    if (r.ok) {
      const row = (await r.json())[0];
      if (row && Array.isArray(row.finalist_keys) && row.finalist_keys.includes(oldKey)) {
        ok = (await patch('impact_lab_settings?' + slug, { finalist_keys: row.finalist_keys.map((k) => (k === oldKey ? newKey : k)) })) && ok;
      }
    }
  } catch (_) { ok = false; }
  if (!ok) console.error('[' + TABLE + '] rename ' + oldKey + ' -> ' + newKey + ' did not fully carry over');
  return ok;
}

/* The no-JavaScript receipt: one short line each, and the demo call link. */
function receiptPage(p) {
  const esc = lib.escapeHtml;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>' + esc(p.title) + ' — FaithTech SoCal Create Hackathon</title><link rel="stylesheet" href="/judges.css"></head>' +
    '<body class="p-form"><main id="main"><section class="section"><div class="wrap">' +
    '<h1 class="h2">' + esc(p.title) + '</h1>' +
    p.lines.map((l) => '<p class="prose">' + esc(l) + '</p>').join('') +
    '<p style="margin-top:16px"><a class="btn btn-ghost" href="/">' + esc(p.backLabel) + '</a></p>' +
    '</div></section></main></body></html>';
}

module.exports = handler;
module.exports.parseMembers = parseMembers;
module.exports.normName = normName;
module.exports.teamKey = teamKey;
module.exports.stripInvisible = stripInvisible;
module.exports.CHALLENGES = CHALLENGES;
module.exports.TABLE = TABLE;
module.exports.EVENT_SLUG = EVENT_SLUG;
