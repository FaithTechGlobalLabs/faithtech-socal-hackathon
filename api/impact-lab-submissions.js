/* api/impact-lab-submissions.js — judges page for the FaithTech SoCal Create
   Hackathon: shortlist, demo order, digital scoring and live results.

   Judges open the pretty URL /judges; vercel.json rewrites it
   here. The page is open (no key) but marked
   noindex, never cached and kept out of the sitemap and agent index. An old
   ?key=… link still works; the key is simply ignored.

   The afternoon runs in four views, linked as steps at the top of every page:

     1 Shortlist   ?view=shortlist  from 4:00, every submission by challenge; each
                                    judge taps "Want to see this demo" (votes)
     2 Demo order  ?view=order      the finalists in running order for Mike to
                                    call; &present=1 is a projector-only layout
     3 Score       ?view=score      during demos: finalists first, in demo order,
                                    then the other submissions, still scorable
     4 Results     ?view=results    winners, then weighted averages, finalists
                                    (and any team with scores) by default (&all=1)

   There are no clock cutoffs.
   Voting stays open until an organizer taps "Close voting and lock finalists"
   on Demo order (admin key). That stores the finalists, in running order, in
   impact_lab_settings, so later submissions, deletions or count changes never
   reshuffle who demos. "Reopen voting" undoes it. With no ?view the page opens
   on Shortlist while voting is open, then on Score.

   Finalists are the teams most voted by the listed JUDGES (votes under any
   other name are shown flagged and not counted), always including the top
   PER_CHALLENGE of each challenge that has votes; see finalists(). How many is
   one number for every view: what an organizer saved with the admin key, else
   IMPACT_LAB_FINALISTS, else FINALISTS; see readSettings().

     GET  ?format=scores.json | votes.json | scores.csv
     POST {action:'score', judge, team, impact, product, demo, note}   upsert one score (JSON)
     POST {action:'vote', judge, team, on}                              shortlist toggle (JSON)
     POST admin=ADMIN&action=csv                      submissions CSV (has contact emails)
     POST admin=ADMIN&delete=ID                       remove a team: every version, its votes and scores
     POST admin=ADMIN&action=delete-score&id=ID       remove one score
     POST admin=ADMIN&action=delete-vote&id=ID        remove one shortlist vote
     POST admin=ADMIN&action=set-finalists&n=N        finalist count for every view (voting open only)
     POST admin=ADMIN&action=lock | unlock            close voting and lock finalists / reopen

   Judges have no login. The page asks for a name once (kept in localStorage).
   Scores are one row per (judge name, team), upserted on (event_slug,
   judge_name_lower, team_key); votes use the same key and toggling off keeps
   the row with wanted = false, so organizer views can show who changed what.
   The server validates every field and only accepts a score or a vote for a
   team that has a current submission; the team name and challenge on the row
   come from that submission, not the client. Teams match on teamKey() from
   impact-lab-submit.js (invisible characters stripped, spaces collapsed).

   The open page shows contact names only. Contact emails are in the
   submissions CSV, which needs the admin key (IMPACT_LAB_ADMIN_KEY), as
   do the deletes, the count and the lock. Organizer tools open with the organizer key
   (IMPACT_LAB_ORGANIZER_KEY) typed in; every change asks in a pop-up first. Wrong admin keys are counted per IP (hashed): after FAIL_MAX
   misses in FAIL_WINDOW_MS every admin attempt from that IP waits
   LOCK_DELAY_MS and wrong keys get 429. Score and vote writes have a light
   per-instance burst limit, generous enough for six judges sharing the
   venue's one public IP. */

'use strict';

const crypto = require('crypto');
const lib = require('./_lib.js');
const { CHALLENGES, TABLE, EVENT_SLUG, teamKey, stripInvisible } = require('./impact-lab-submit.js');

const SELF = '/judges';
const SCORES = 'impact_lab_scores';
const VOTES = 'impact_lab_votes';
const SETTINGS = 'impact_lab_settings';
const CSS_VER = '20261023a';
/* [field, label, weight in percent, judge prompt] — weights sum to 100.
   Keys are the existing score columns (impact, product, demo); `care` is the
   fourth area and is stored inside the note column (see packNote / unpackNote)
   because the shared scores table has only three score columns. */
const AREAS = [
  ['impact', 'Works live end to end', 35, 'Does the prototype actually run, start to finish, in front of you?'],
  ['product', 'Baptize would adopt it', 30, 'Would Baptize The World put this to use for real people?'],
  ['demo', 'Usable by a non-technical pastor or new believer', 20, 'Could a pastor or new believer use it without help?'],
  ['care', 'Built the way we said', 15, 'Consent, honest data, team care: did they build it the way the day asked?'],
];
/* The judges, as tap targets. "Other" takes free text; scores and votes under a
   name not on this list are marked so organizers can spot oddities. */
const JUDGES = (process.env.IMPACT_LAB_JUDGES
  ? process.env.IMPACT_LAB_JUDGES.split(',').map((x) => x.trim()).filter(Boolean)
  : ['Travis', 'Dana', 'Holly', 'Pastor Calin', 'Jesse']);
const isListed = (name) => JUDGES.some((j) => j.toLowerCase() === String(name || '').trim().toLowerCase());
/* A listed judge is always stored under the canonical spelling ("mike" -> "Mike"). */
const canonical = (name) => JUDGES.find((j) => j.toLowerCase() === String(name).toLowerCase()) || name;
const SCORE_MAX = 600; // writes per IP per instance per window
const SCORE_WINDOW_MS = 10 * 60 * 1000;
const FINALISTS = 12;
const PER_CHALLENGE = 2;
/* Results rank a team below the rest until this many listed judges scored it. */
const MIN_SCORES = 2;
/* A judge name used from more networks than this is flagged on organizer views. */
const MAX_NETWORKS = 2;
const esc = lib.escapeHtml;

/* Two keys, both from the environment and never in a page:
   IMPACT_LAB_ORGANIZER_KEY opens organizer tools and authorises every change
   except the submissions CSV (contact emails), which needs IMPACT_LAB_ADMIN_KEY.
   An unset key disables itself; it never falls back to a default. */
const ADMIN_KEY = String(process.env.IMPACT_LAB_ADMIN_KEY || '').trim();
const TOOLS_TOKEN = String(process.env.IMPACT_LAB_ORGANIZER_KEY || '').trim();
const keyIs = (supplied, expected) => {
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(supplied || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
};
/* A team renamed or deleted while a judge had the page open. */
const GONE = { ok: false, code: 'gone', message: 'This team just changed its name or was removed. Refresh the page, then tap again.' };
function adminOk(supplied, action) {
  return keyIs(supplied, ADMIN_KEY) || (action !== 'csv' && keyIs(supplied, TOOLS_TOKEN));
}
/* Judges key: every judge read and write needs it (cookie set by opening
   /judges?key=KEY, or an X-Judges-Key header). Unset means locked for everyone. */
const JUDGES_KEY = String(process.env.JUDGES_KEY || '').trim();
const cookieOf = (req, name) => {
  const m = String(req.headers.cookie || '').split(/;\s*/).map((c) => c.split('=')).find((c) => c[0] === name);
  return m ? decodeURIComponent(m.slice(1).join('=')) : '';
};
const judgesAuthed = (req) => keyIs(req.headers['x-judges-key'], JUDGES_KEY) || keyIs(cookieOf(req, 'jk'), JUDGES_KEY);

const adminEnabled = () => Boolean(ADMIN_KEY || TOOLS_TOKEN);

/* Failed-admin-key counter. Peeked before checking a key, bumped only on a miss. */
const FAILS = new Map(); // ipHash -> array of timestamps
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 10;
const LOCK_DELAY_MS = Number(process.env.IMPACT_LAB_LOCK_DELAY_MS || 2000);
function recentFails(id) {
  const now = Date.now();
  const hits = (FAILS.get(id) || []).filter((t) => now - t < FAIL_WINDOW_MS);
  FAILS.set(id, hits);
  return hits;
}
function locked(id) { return recentFails(id).length >= FAIL_MAX; }
function recordFail(id) {
  recentFails(id).push(Date.now());
  if (FAILS.size > 5000) FAILS.clear();
}

/* ---- scoring math, finalists and validation (exported for tests) ------- */

/* Weighted score in hundredths, integer math so 5/4/3 is exactly 415. */
function weighted100(s) { return 35 * s.impact + 30 * s.product + 20 * s.demo + 15 * s.care; }
function weighted(s) { return weighted100(s) / 100; }

function cleanLine(v) {
  return stripInvisible(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Judge and team must arrive as text; an object or list is refused rather than
   read as "[object Object]". */
function checkWho(body, errors) {
  for (const k of ['judge', 'team', 'note']) {
    if (body[k] !== undefined && body[k] !== null && typeof body[k] !== 'string') errors.push(k + ': must be text');
  }
  if (errors.length) return { judge_name: '', team_key: '' };
  const judge = canonical(cleanLine(body.judge));
  if (!judge) errors.push('judge: add your name');
  else if (judge.length > 60) errors.push('judge: 60 characters at most');
  const team = teamKey(cleanLine(body.team));
  if (!team) errors.push('team: missing');
  else if (team.length > 120) errors.push('team: too long');
  return { judge_name: judge, team_key: team };
}

function validateScore(body) {
  const errors = [];
  const out = checkWho(body, errors);
  for (const [f] of AREAS) {
    const raw = body[f];
    const n = typeof raw === 'number' ? raw : (/^\s*[1-5]\s*$/.test(String(raw)) ? Number(raw) : NaN);
    if (!Number.isInteger(n) || n < 1 || n > 5) errors.push(f + ': 1 to 5');
    out[f] = n;
  }
  const note = cleanLine(body.note);
  if (note.length > 270) errors.push('note: 270 characters at most');
  out.note = note || null;
  return { ok: errors.length === 0, errors, value: out };
}

function validateVote(body) {
  const errors = [];
  const out = checkWho(body, errors);
  const on = body.on === true || body.on === 'true' ? true : body.on === false || body.on === 'false' ? false : null;
  if (on === null) errors.push('on: true or false');
  out.on = on;
  return { ok: errors.length === 0, errors, value: out };
}

/* When a team first submitted (its first version), for "earlier submission" ties. */
const firstAt = (t) => String(t.first_at || t.created_at || '');

/* Rank for the shortlist: votes from listed judges, then the earlier
   submission, then name. */
function byVotes(a, b) {
  return b.votes - a.votes || firstAt(a).localeCompare(firstAt(b)) ||
    String(a.team_name).localeCompare(String(b.team_name));
}

/* `teams` is [{team_key, team_name, challenge, created_at, …}] (current
   submissions), `votes` the vote rows. Only votes from the JUDGES list count:
   the page has no login, so a typed "Other" name could otherwise stuff a team
   into the finals. Off-list votes are tallied separately (`others`) and shown
   flagged. Returns every team tallied and ranked (`ranked`), and the finalists
   in running order (`order`): the n most-voted teams with at least one counted
   vote, always including the top PER_CHALLENGE of each challenge, then grouped
   Track 1 → 3 and by votes within a challenge. The guarantee can push the
   count above n when n is small. */
function finalists(teams, votes, n = FINALISTS) {
  const tally = new Map(teams.map((t) => [t.team_key, { ...t, votes: 0, voters: [], others: [] }]));
  const seen = new Set();
  votes.forEach((v) => {
    const t = tally.get(v.team_key);
    const k = String(v.judge_name).trim().toLowerCase() + '\n' + v.team_key;
    if (!t || v.wanted === false || seen.has(k)) return;
    seen.add(k);
    if (isListed(v.judge_name)) { t.votes += 1; t.voters.push(String(v.judge_name)); }
    else t.others.push(String(v.judge_name));
  });
  const ranked = [...tally.values()].sort(byVotes);
  const voted = ranked.filter((t) => t.votes > 0);
  const pick = new Set();
  Object.keys(CHALLENGES).forEach((c) => voted.filter((t) => t.challenge === c).slice(0, PER_CHALLENGE)
    .forEach((t) => pick.add(t.team_key)));
  for (const t of voted) { if (pick.size >= n) break; pick.add(t.team_key); }
  const order = Object.keys(CHALLENGES).flatMap((c) => voted.filter((t) => t.challenge === c && pick.has(t.team_key)));
  order.forEach((t, i) => { t.slot = i + 1; t.finalist = true; });
  return { order, ranked };
}

/* The finalists every view uses. While voting is open they are live from
   finalists(); once an organizer locks them, `lock.keys` (team keys in running
   order, saved at the lock) decides, so nothing can reshuffle the demos. A
   locked team that was since deleted drops out; late submissions are never
   finalists. */
function lineup(teams, votes, n, lock) {
  const live = finalists(teams, votes, n);
  if (!lock || !Array.isArray(lock.keys)) return { ...live, locked: false };
  live.ranked.forEach((t) => { t.finalist = false; delete t.slot; });
  const byKey = new Map(live.ranked.map((t) => [t.team_key, t]));
  const order = lock.keys.map((k) => byKey.get(k)).filter(Boolean);
  order.forEach((t, i) => { t.slot = i + 1; t.finalist = true; });
  return { order, ranked: live.ranked, locked: true };
}

/* The next finalist this judge has not scored, after `current` in running
   order and wrapping around; null when every finalist is scored. Runs on the
   server in tests and in the browser (embedded with toString), so ES5 only. */
function nextTeam(order, scored, current) {
  var i = order.indexOf(current);
  for (var k = 1; k <= order.length; k++) {
    var t = order[(i + k) % order.length];
    if (t !== current && !scored[t]) return t;
  }
  return null;
}

function parseN(raw) {
  const n = Number.parseInt(String(raw || ''), 10);
  return Number.isInteger(n) && n >= 1 && n <= 40 ? n : null;
}

/* Leaderboard over a team set. `teams` is [{team_key, team_name, challenge,
   first_at}], `scores` the score rows to count (the caller passes listed
   judges only). Order: teams with at least MIN_SCORES judges first, then
   weighted average, then the tie-break rule (TIE_RULE): more judges, higher
   impact average, earlier submission. Teams nobody has scored come last.
   Every scored team gets its own rank; `tie` says which rule split it from a
   neighbour with the same average. Teams under MIN_SCORES have no rank. */
const TIE_RULE = 'Same average: more judges first, then the higher "works live" average, then the earlier submission.';
function leaderboard(teams, scores) {
  const byTeam = new Map(teams.map((t) => [t.team_key, { ...t, scores: [] }]));
  scores.forEach((s) => { const t = byTeam.get(s.team_key); if (t) t.scores.push(s); });
  const rows = [...byTeam.values()].map((t) => {
    const n = t.scores.length;
    const avg = (f) => (n ? t.scores.reduce((a, s) => a + s[f], 0) / n : null);
    return { ...t, judges: n, enough: n >= MIN_SCORES,
      score: n ? t.scores.reduce((a, s) => a + weighted100(s), 0) / (100 * n) : null,
      impact: avg('impact'), product: avg('product'), demo: avg('demo'), care: avg('care'),
      scores: t.scores.slice().sort((a, b) => weighted100(b) - weighted100(a) ||
        String(a.judge_name).localeCompare(String(b.judge_name))) };
  });
  const same = (x, y) => x !== null && y !== null && Math.abs(x - y) < 1e-9;
  rows.sort((a, b) => (a.score === null) - (b.score === null) || (b.enough - a.enough) ||
    (same(a.score, b.score) ? 0 : (b.score || 0) - (a.score || 0)) ||
    b.judges - a.judges || (same(a.impact, b.impact) ? 0 : (b.impact || 0) - (a.impact || 0)) ||
    firstAt(a).localeCompare(firstAt(b)) || String(a.team_name).localeCompare(String(b.team_name)));
  const why = (hi, lo) => hi.judges !== lo.judges ? 'more judges' : !same(hi.impact, lo.impact) ? 'higher works-live average' :
    'earlier submission';
  let rank = 0;
  rows.forEach((r, i) => {
    r.rank = r.enough ? ++rank : null;
    r.tie = null;
    if (!r.enough) return;
    const prev = rows[i - 1];
    const next = rows[i + 1];
    if (prev && prev.enough && same(prev.score, r.score)) r.tie = { with: prev.team_name, by: why(prev, r), above: false };
    else if (next && next.enough && same(next.score, r.score)) r.tie = { with: next.team_name, by: why(r, next), above: true };
  });
  return rows;
}

/* ---- Supabase ----------------------------------------------------------- */

function rest(env, path, opts = {}) {
  return lib.boundedFetch(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/' + path, { ...opts, headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    ...(opts.headers || {}) } });
}
const SLUG_Q = 'event_slug=eq.' + encodeURIComponent(EVENT_SLUG);

async function readJson(env, path, what) {
  const r = await rest(env, path);
  if (!r.ok) throw new Error(what + ' read failed: ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const rows = await r.json();
  return Array.isArray(rows) ? rows : [];
}
const fetchRows = (env) => readJson(env, TABLE + '?select=*&' + SLUG_Q + '&order=created_at.asc', 'submission');
const SCORE_COLS = 'id,created_at,updated_at,judge_name,team_key,team_name,challenge,impact,product,demo,note,ip_hash';
/* The fourth area ("Built the way we said") has no column in the shared scores
   table, so it rides at the front of the note as "[c4:N] ". packNote adds it on
   write, unpackNote takes it off on read; no view ever sees the prefix. A row
   without one (not written by this code) reads as 3. */
const packNote = (care, note) => '[c4:' + care + '] ' + (note || '');
function unpackNote(row) {
  const m = /^\[c4:([1-5])\] ?/.exec(row.note || '');
  const note = m ? (row.note || '').slice(m[0].length) : (row.note || '');
  return { ...row, care: m ? Number(m[1]) : 3, note: note || null };
}
const fetchScores = async (env) => (await readJson(env, SCORES + '?select=' + SCORE_COLS + '&' + SLUG_Q + '&order=updated_at.asc', 'score')).map(unpackNote);
/* What a judge's own phone needs back about one of their scores. */
const ownScore = (s) => ({ judge_name: s.judge_name, team_key: s.team_key, impact: s.impact, product: s.product, demo: s.demo,
  care: s.care, note: s.note, updated_at: s.updated_at });
const fetchVotes = (env) => readJson(env, VOTES + '?select=id,judge_name,team_key,team_name,created_at,updated_at,wanted,ip_hash&' + SLUG_Q + '&order=created_at.asc', 'vote');

async function upsertScore(env, row) {
  const r = await rest(env, SCORES + '?on_conflict=event_slug,judge_name_lower,team_key', {
    method: 'POST', body: JSON.stringify([row]), headers: { 'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation' } });
  if (!r.ok) throw new Error('score write failed: ' + r.status + ' ' + (await r.text()).slice(0, 300));
  const saved = await r.json();
  return Array.isArray(saved) ? saved[0] : saved;
}

async function setVote(env, row, on) {
  const r = on
    ? await rest(env, VOTES + '?on_conflict=event_slug,judge_name_lower,team_key', {
      method: 'POST', body: JSON.stringify([row]), headers: { 'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal' } })
    // Un-voting keeps the row (wanted = false) so the organizer views keep a trail.
    : await rest(env, VOTES + '?' + SLUG_Q + '&judge_name_lower=eq.' + encodeURIComponent(row.judge_name.toLowerCase()) +
      '&team_key=eq.' + encodeURIComponent(row.team_key), { method: 'PATCH', body: JSON.stringify({ wanted: false,
        updated_at: row.updated_at, ip_hash: row.ip_hash }), headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' } });
  if (!r.ok) throw new Error('vote write failed: ' + r.status + ' ' + (await r.text()).slice(0, 300));
}

async function deleteById(env, table, id) {
  const r = await rest(env, table + '?id=eq.' + encodeURIComponent(id) + '&' + SLUG_Q,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!r.ok) throw new Error('delete failed: ' + r.status);
}

/* Shared organizer state, one row per event: the finalist count every view
   uses (saved setting, else IMPACT_LAB_FINALISTS, else FINALISTS) and the
   finalist lock. A missing table or a failed read falls back to an open,
   unlocked default rather than taking the page down. */
async function readSettings(env) {
  const envN = parseN(process.env.IMPACT_LAB_FINALISTS);
  const out = { n: envN || FINALISTS, source: envN ? 'env' : 'default', lock: null, revealed: null };
  try {
    const r = await rest(env, SETTINGS + '?select=*&' + SLUG_Q);
    if (!r.ok) return out;
    const row = (await r.json())[0];
    if (!row) return out;
    const n = parseN(row.finalists);
    if (n) Object.assign(out, { n, source: 'set', at: row.updated_at });
    if (row.locked_at && Array.isArray(row.finalist_keys)) out.lock = { at: row.locked_at, keys: row.finalist_keys.map(String) };
    if (row.revealed_at) out.revealed = row.revealed_at;
  } catch (_) { /* fall back */ }
  return out;
}

async function writeSettings(env, fields, ipId) {
  const r = await rest(env, SETTINGS + '?on_conflict=event_slug', {
    method: 'POST', body: JSON.stringify([{ event_slug: EVENT_SLUG, ...fields, ip_hash: ipId,
      updated_at: new Date().toISOString() }]),
    headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' } });
  if (!r.ok) throw new Error('settings write failed: ' + r.status + ' ' + (await r.text()).slice(0, 300));
}

/* Delete rows matching a PostgREST filter; returns how many went. */
async function deleteWhere(env, table, filter) {
  const r = await rest(env, table + '?' + filter + '&' + SLUG_Q + '&select=id',
    { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  if (!r.ok) throw new Error('delete failed: ' + r.status);
  const gone = await r.json().catch(() => []);
  return Array.isArray(gone) ? gone.length : 0;
}

/* A team, all at once: every version of its submission (matched on teamKey, so
   "A  B" and "a b" are one team), and its votes and scores, which would
   otherwise sit orphaned and come back if the name is reused. */
async function deleteTeam(env, rows, id) {
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  const key = teamKey(row.team_name);
  const ids = rows.filter((r) => teamKey(r.team_name) === key).map((r) => r.id);
  const versions = await deleteWhere(env, TABLE, 'id=in.(' + ids.map(encodeURIComponent).join(',') + ')');
  const k = 'team_key=eq.' + encodeURIComponent(key);
  const [votes, scores] = await Promise.all([deleteWhere(env, VOTES, k), deleteWhere(env, SCORES, k)]);
  return { name: normTeamName(row.team_name), versions, votes, scores };
}
const normTeamName = (n) => stripInvisible(n).replace(/\s+/g, ' ').trim();

/* The newest row per team (case-insensitive name) is the one judges see. */
function markLatest(rows) {
  const latest = new Map();
  rows.forEach((r) => latest.set(teamKey(r.team_name), r.id));
  return rows.map((r) => ({ ...r, latest: latest.get(teamKey(r.team_name)) === r.id }));
}
/* The judge-facing fields of one submission row. No contact email. */
const judgeFields = (r) => ({
  team_name: normTeamName(r.team_name), challenge: r.challenge, created_at: r.created_at,
  one_liner: r.one_liner, what_it_does: r.what_it_does, repo_url: r.repo_url,
  demo_url: r.live_demo_url || r.demo_video_url, members: (Array.isArray(r.members) ? r.members : [])
    .map((m) => (typeof m === 'string' ? m : (m && m.name) || '')).filter(Boolean),
  contact_name: r.contact_name });

/* Judge-facing fields of each team's latest submission, with how many versions
   it has, when the first was saved and every earlier version (newest first),
   so nothing a team submitted is out of the judges' sight. No contact email. */
function currentTeams(rows) {
  const first = new Map();
  const count = new Map();
  rows.forEach((r) => {
    const k = teamKey(r.team_name);
    if (!first.has(k) || String(r.created_at) < String(first.get(k))) first.set(k, r.created_at);
    count.set(k, (count.get(k) || 0) + 1);
  });
  return markLatest(rows).filter((r) => r.latest).map((r) => ({
    id: r.id, team_key: teamKey(r.team_name), team_name: normTeamName(r.team_name), challenge: r.challenge,
    created_at: r.created_at, first_at: first.get(teamKey(r.team_name)), versions: count.get(teamKey(r.team_name)),
    one_liner: r.one_liner, what_it_does: r.what_it_does, repo_url: r.repo_url,
    demo_url: r.live_demo_url || r.demo_video_url, members: (Array.isArray(r.members) ? r.members : [])
      .map((m) => (typeof m === 'string' ? m : (m && m.name) || '')).filter(Boolean),
    contact_name: r.contact_name, suspect: r.suspect,
    history: rows.filter((o) => o.id !== r.id && teamKey(o.team_name) === teamKey(r.team_name))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map(judgeFields) }));
}

/* ---- HTML --------------------------------------------------------------- */

function headers(res, type) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', type);
}

function pt(iso) {
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles',
    weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
const clock = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' });
const fmt = (n, d = 2) => (n === null || n === undefined ? '–' : n.toFixed(d));
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

function shell(title, inner, script) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    '<title>' + esc(title) + ' — FaithTech SoCal Create Hackathon</title>' +
    '<meta name="theme-color" content="#16160C">' +
    '<link rel="stylesheet" href="/judges.css?v=' + CSS_VER + '"></head>' +
    '<body class="p-form lab-admin"><main id="main"><section class="section lab-judge"><div class="wrap">' + inner +
    '</div></section></main>' + (script ? '<script>' + script + '</script>' : '') + '</body></html>';
}

function link(href, text, cls) {
  return href ? '<a class="lab-btn' + (cls ? ' ' + cls : '') + '" href="' + esc(href) +
    '" rel="noopener noreferrer" target="_blank">' + esc(text) + '</a>' : '';
}

function field(label, text) {
  return text ? '<p class="lab-k">' + esc(label) + '</p><p class="lab-v">' + esc(text) + '</p>' : '';
}

const chip = (c) => '<span class="lab-chip">Track ' + esc(c) + '</span>';

/* Who it is for, what it does, Repo / Demo: the same on every view. */
function about(t, clamp) {
  const long = clamp && String(t.what_it_does || '').length > 160;
  return field('Who it is for', t.one_liner) + (long ? '<p class="lab-k">What it does</p><p class="lab-v lab-clamp">' +
      esc(t.what_it_does) + '</p><button type="button" class="lab-linkbtn lab-more" aria-expanded="false">More</button>' :
      field('What it does', t.what_it_does)) +
    '<div class="lab-links">' + [link(t.repo_url, 'Repo'), t.demo_url ? link(t.demo_url, 'Demo', 'lab-btn--demo') :
      '<span class="lab-muted">No demo link</span>'].join('') + '</div>';
}

/* The card shows every judge-facing field of the latest version (who it is for,
   what it does, repo, demo or "No demo link", team, contact and time). Earlier
   versions fold underneath, each listing only what it changed, so a team's
   resubmissions are never out of sight. Contact emails stay with organizers. */
const VERSION_FIELDS = [
  ['Team name', (v) => v.team_name],
  ['Track', (v) => v.challenge + ' · ' + (CHALLENGES[v.challenge] || 'unknown track')],
  ['Who it is for', (v) => v.one_liner],
  ['What it does', (v) => v.what_it_does],
  ['Repo link', (v) => v.repo_url],
  ['Demo link', (v) => v.demo_url || ''],
  ['Team members', (v) => v.members.join('\n')],
  ['Contact', (v) => v.contact_name],
];
function changes(v, newer) {
  const diff = VERSION_FIELDS.filter(([, get]) => String(get(v) || '') !== String(get(newer) || ''));
  if (!diff.length) return '<p class="lab-muted">Same as the version after it.</p>';
  return '<dl class="lab-dl">' + diff.map(([label, get]) => {
    const val = String(get(v) || '');
    const shown = !val ? '<span class="lab-muted">None given</span>'
      : /^https?:\/\//i.test(val) ? '<a href="' + esc(val) + '" rel="noopener noreferrer" target="_blank">' + esc(val) + '</a>'
      : esc(val);
    return '<dt>' + esc(label) + '</dt><dd>' + shown + '</dd>';
  }).join('') + '</dl>';
}
function history(t) {
  const hist = t.history || [];
  if (!hist.length) return '';
  return '<details class="lab-all"><summary>' + plural(hist.length, 'earlier version') + '</summary>' +
    hist.map((v, i) => '<div class="lab-ver"><p class="lab-k">Version ' + (hist.length - i) + ' · ' + esc(pt(v.created_at)) +
      ' · what was different</p>' + changes(v, i === 0 ? t : hist[i - 1]) + '</div>').join('') + '</details>';
}
const team = (t) => (t.members.length ? '<p class="lab-k">Team</p><p class="lab-v">' + esc(t.members.join(', ')) + '</p>' : '');
/* Expand all: every clamped "What it does" and every earlier-versions panel. */
const ALL_FIELDS_JS = `[].forEach.call(document.querySelectorAll('[data-all-fields]'),function(b){b.addEventListener('click',function(){
  var on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',on?'true':'false');b.textContent=on?'Collapse all':'Expand all';
  [].forEach.call(document.querySelectorAll('details.lab-all'),function(d){d.open=on;var c=d.closest('.lab-scard');if(on&&c)c.open=true});
  [].forEach.call(document.querySelectorAll('.lab-more'),function(m){if((m.getAttribute('aria-expanded')==='true')!==on)m.click()})})});`;
const allToggle = '<button type="button" class="lab-linkbtn" data-all-fields aria-pressed="false">Expand all</button>';

const VIEWS = [
  ['shortlist', '1', 'Shortlist'],
  ['order', '2', 'Demo order'],
  ['score', '3', 'Score'],
  ['results', '4', 'Results'],
];
/* Each step says where things stand, from server state, not the planned clock. */
function stepState(v, opts) {
  if (v === 'shortlist') return opts.lock ? 'Closed' : 'Voting open';
  if (v === 'order') return opts.lock ? 'Locked ' + lockedAt(opts) : 'Top ' + (opts.n || FINALISTS);
  if (v === 'score') return 'Weighted';
  return opts.revealed ? 'Revealed' : 'Scores private';
}
/* The finalist count is server state, not a query parameter, so links carry
   only the view and the Results toggle. An old ?n= link is ignored. */
function href(view, opts = {}) {
  const q = ['view=' + view];
  if (opts.all) q.push('all=1');
  return SELF + '?' + q.join('&');
}

function steps(active, opts) {
  return '<nav class="lab-steps" aria-label="Judging steps">' + VIEWS.map(([v, n, label]) =>
    '<a href="' + esc(href(v)) + '"' + (active === v ? ' aria-current="page"' : '') +
      '><span class="lab-step-n">' + n + ' · ' + esc(stepState(v, opts)) + '</span><span class="lab-step-t">' + label + '</span></a>').join('') + '</nav>';
}

function lockedAt(opts) { return opts.lock ? clock(Date.parse(opts.lock.at)) : ''; }

/* `lead` goes right under the heading, above the steps (Results puts the
   winners there so they fit one projector screen). */
function top(active, notice, opts = {}, lead = '') {
  return '<p class="label">FaithTech SoCal Create Hackathon</p>' +
    '<h1 class="h2 lab-judge-h1">Judges</h1>' +
    (notice ? '<p class="notice lab-notice" role="status">' + esc(notice) + '</p>' : '') + lead + steps(active, opts);
}

function nameBox(verb) {
  return '<div class="lab-panel lab-name">' +
    '<form id="lab-name-form" class="lab-name-form"><p class="lab-k" id="lab-name-q">Who is judging?</p>' +
    '<div class="lab-pick" role="group" aria-labelledby="lab-name-q">' + JUDGES.map((j) =>
      '<button type="button" class="lab-pick-btn" data-judge="' + esc(j) + '">' + esc(j) + '</button>').join('') +
      '<button type="button" class="lab-pick-btn" data-judge="">Other</button></div>' +
    '<div class="lab-name-row" id="lab-other" hidden><input class="input" id="lab-judge-name" maxlength="60" autocomplete="name" ' +
      'placeholder="Your name" aria-label="Your name"><button class="btn btn-primary" type="submit">' + esc(verb) + '</button></div>' +
    '<p class="lab-muted">Once per phone. Your picks and scores are saved under this name.</p></form>' +
    '<p id="lab-who" class="lab-who" hidden>Judging as <b></b> <button type="button" class="lab-linkbtn" id="lab-name-edit">Change</button></p></div>';
}

/* Shared by the Shortlist and Score scripts: the judge name in localStorage. */
const NAME_JS = `var SELF=${JSON.stringify(SELF)},K='labJudgeName';
function get(){try{return localStorage.getItem(K)||''}catch(e){return ''}}
function put(v){try{localStorage.setItem(K,v)}catch(e){}}
var nameIn=document.getElementById('lab-judge-name'),who=document.getElementById('lab-who'),
  form=document.getElementById('lab-name-form'),other=document.getElementById('lab-other');
function showName(){var n=get();form.hidden=!!n;who.hidden=!n;who.querySelector('b').textContent=n;nameIn.value=n}
function askName(){form.hidden=false;who.hidden=true;form.scrollIntoView({block:'center'});var b=form.querySelector('.lab-pick-btn');if(b)b.focus()}
function setName(v){v=String(v).replace(/\\s+/g,' ').trim().slice(0,60);if(!v){other.hidden=false;nameIn.focus();return}put(v);showName();load()}
form.addEventListener('submit',function(e){e.preventDefault();setName(nameIn.value)});
[].forEach.call(document.querySelectorAll('.lab-pick-btn'),function(b){b.addEventListener('click',function(){
  if(b.dataset.judge){setName(b.dataset.judge)}else{other.hidden=false;nameIn.value='';nameIn.focus()}})});
document.getElementById('lab-name-edit').addEventListener('click',function(){try{localStorage.removeItem(K)}catch(e){}
  showName();other.hidden=true;load();var b=form.querySelector('.lab-pick-btn');if(b)b.focus()});
function post(body){return fetch(SELF,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body)})
  .then(function(r){return r.json().catch(function(){return{}}).then(function(d){return{ok:r.ok&&d.ok,d:d}})})}
function why(d){return (d.errors||[]).join(', ')||d.message||'try again'}`;

/* ---- 1 Shortlist -------------------------------------------------------- */

function voteCard(t, open) {
  return '<article class="lab-sub lab-short" data-team="' + esc(t.team_key) + '" data-ch="' + esc(t.challenge) + '">' +
    '<div class="lab-sub-head"><h3 class="lab-team">' + esc(t.team_name) + '</h3></div>' +
    about(t, true) + team(t) + history(t) +
    '<button type="button" class="lab-vote" aria-pressed="false"' + (open ? '' : ' disabled') + '>' +
      '<span class="lab-vote-off">Want to see this demo</span><span class="lab-vote-on">On my shortlist · tap to remove</span></button>' +
    '<p class="lab-score-status lab-muted" data-status role="status" aria-live="polite"></p>' +
    '<p class="lab-muted lab-sub-meta">Submitted ' + esc(pt(t.created_at)) + (t.versions > 1 ? ' · version ' + t.versions : '') +
      (t.contact_name ? ' · contact ' + esc(t.contact_name) : '') +
      (t.suspect ? ' · flagged: ' + esc(t.suspect) : '') + '</p></article>';
}

const SHORTLIST_SCRIPT = `(function(){
${NAME_JS}
var cards=[].slice.call(document.querySelectorAll('.lab-short')),mine={},
  picks=document.getElementById('lab-picks'),chips=[].slice.call(document.querySelectorAll('[data-prog]'));
function status(el,t,bad){var p=el.querySelector('[data-status]');p.textContent=t;p.classList.toggle('lab-bad',!!bad)}
function paint(){var by={},n=0;
  cards.forEach(function(el){var on=!!mine[el.dataset.team];el.querySelector('.lab-vote').setAttribute('aria-pressed',on?'true':'false');
    el.classList.toggle('lab-short--on',on);if(on){n++;by[el.dataset.ch]=(by[el.dataset.ch]||0)+1}});
  picks.textContent=n;
  chips.forEach(function(c){var k=c.dataset.prog,has=+c.dataset.subs>0,v=by[k]||0;
    c.querySelector('b').textContent=!has?'none in':v?'\\u2713 '+v:'\\u2014';c.classList.toggle('lab-prog--done',!has||v>0)});
  document.getElementById('lab-prog-done').hidden=!get()||chips.some(function(c){return !c.classList.contains('lab-prog--done')})}
function load(){var n=get().toLowerCase();mine={};
  if(!n){paint();return}
  fetch(SELF+'?format=votes.json',{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    (d.votes||[]).forEach(function(v){if(String(v.judge_name).toLowerCase()===n)mine[v.team_key]=true});paint()
  }).catch(paint)}
[].forEach.call(document.querySelectorAll('.lab-more'),function(b){b.addEventListener('click',function(){
  var on=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',on?'true':'false');
  b.previousElementSibling.classList.toggle('lab-clamp',!on);b.textContent=on?'Less':'More'})});
// Back on this tab (another phone may have changed this judge's picks): reload them.
var last=0;function again(){if(document.hidden||Date.now()-last<2000)return;last=Date.now();load()}
document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);
cards.forEach(function(el){var b=el.querySelector('.lab-vote');b.addEventListener('click',function(){
  if(!get()){status(el,'Pick your name at the top first.',true);askName();return}
  var t=el.dataset.team,on=!mine[t];if(on)mine[t]=true;else delete mine[t];paint();b.disabled=true;status(el,'Saving\\u2026');
  post({action:'vote',judge:get(),team:t,on:on}).then(function(x){b.disabled=false;
    if(x.ok){status(el,on?'Added to your shortlist':'Removed from your shortlist')}
    else{if(on)delete mine[t];else mine[t]=true;paint();status(el,'Not saved: '+why(x.d),true)}
  }).catch(function(){b.disabled=false;if(on)delete mine[t];else mine[t]=true;paint();status(el,'Not saved: no connection. Tap again.',true)})})});
${ALL_FIELDS_JS}
showName();load();
})();`;

function shortlist(rows, opts, notice) {
  const teams = currentTeams(rows);
  const open = !opts.lock;
  const byName = (a, b) => a.team_name.localeCompare(b.team_name);
  const count = (c) => teams.filter((t) => t.challenge === c).length;
  const bar = '<div class="lab-bar" aria-live="polite"><span class="lab-bar-main">Your picks <b id="lab-picks">0</b></span>' +
    '<span class="lab-prog">' + Object.keys(CHALLENGES).map((c) => '<a href="#c' + c + '" class="lab-prog-c" data-prog="' + c +
      '" data-subs="' + count(c) + '">Track ' + c + ' <b>—</b></a>').join('') + '</span>' +
    '<span class="lab-prog-ok" id="lab-prog-done" hidden>Every track has a pick</span></div>';
  const rule = open
    ? '<p class="lab-rule"><strong>Tap <em>Want to see this demo</em> on the teams you want on stage, at least one per track.</strong> ' +
      'Picks are private. The top ' + (opts.n || FINALISTS) + ' by judge votes demo.</p>'
    : '<p class="notice lab-notice lab-closed" role="status">Voting is closed: finalists were locked at ' + esc(lockedAt(opts)) + '. ' +
      '<a href="' + esc(href('order', opts)) + '">See the demo order</a> or <a href="' + esc(href('score', opts)) + '">start scoring</a>.</p>';
  const stray = teams.filter((t) => !CHALLENGES[t.challenge]).sort(byName);
  const groups = Object.keys(CHALLENGES).map((c) => {
    const list = teams.filter((t) => t.challenge === c).sort(byName);
    return '<section class="lab-group" id="c' + c + '"><h2 class="lab-group-title"><span class="label">Track ' + c + '</span>' +
      esc(CHALLENGES[c]) + ' <span class="lab-count">' + list.length + '</span></h2>' +
      (list.length ? list.map((t) => voteCard(t, open)).join('') : '<p class="prose lab-empty">No submissions yet.</p>') + '</section>';
  }).join('') + (stray.length ? '<section class="lab-group" id="cx"><h2 class="lab-group-title"><span class="label">Check these</span>' +
    'No matching track <span class="lab-count">' + stray.length + '</span></h2>' + stray.map((t) => voteCard(t, open)).join('') + '</section>' : '');
  const shown = teams.reduce((n, t) => n + 1 + (t.history || []).length, 0);
  return shell('Shortlist',
    top('shortlist', notice, opts) + nameBox('Start shortlisting') + rule + bar +
    '<p class="lab-muted lab-judge-meta">' + plural(teams.length, 'team') + ' · ' + plural(rows.length, 'submission') +
      (shown === rows.length ? '' : ' · <strong>' + (rows.length - shown) + ' not shown, tell an organizer</strong>') + ' · ' +
      '<a href="' + esc(href('shortlist', opts)) + '">Refresh</a> · ' + allToggle + '</p>' +
    groups, SHORTLIST_SCRIPT);
}

/* ---- 2 Demo order ------------------------------------------------------- */

/* Now presenting, on this device only. Saved as the team key (not a slot
   number, so a changed list never shifts who is up) with the teams presented
   and skipped, and only for today in Pacific time, so yesterday's run never
   carries over. Skip for now parks a no-show in "Come back to". */
const ORDER_SCRIPT = `(function(){
var K='labOrder:v2',rows=[].slice.call(document.querySelectorAll('.lab-ord')),
  keys=rows.map(function(r){return r.dataset.team}),
  now=document.getElementById('lab-now'),nx=document.getElementById('lab-next'),back=document.getElementById('lab-back');
if(!rows.length)return;
var today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'}),st={day:today,team:keys[0],done:[],skip:[]};
try{var s=JSON.parse(localStorage.getItem(K)||'null');if(s&&s.day===today&&s.team)st={day:today,team:s.team,done:s.done||[],skip:s.skip||[]}}catch(e){}
function has(a,k){return a.indexOf(k)>=0}
function drop(a,k){var i=a.indexOf(k);if(i>=0)a.splice(i,1)}
function open(i){return !has(st.done,keys[i])&&!has(st.skip,keys[i])}
function cur(){var i=keys.indexOf(st.team);if(i>=0)return i;for(var j=0;j<keys.length;j++)if(open(j))return j;return 0}
function name(i){return rows[i].querySelector('.lab-ord-name').textContent}
function nextOpen(from){for(var k=1;k<keys.length;k++){var i=(from+k)%keys.length;if(open(i))return i}return -1}
function save(){try{localStorage.setItem(K,JSON.stringify(st))}catch(e){}}
function go(i){st.team=keys[i];drop(st.skip,keys[i]);show()}
function show(){var c=cur();st.team=keys[c];
  rows.forEach(function(el,i){var k=keys[i];el.classList.toggle('lab-ord--now',i===c);el.classList.toggle('lab-ord--done',i!==c&&has(st.done,k));
    el.classList.toggle('lab-ord--skip',i!==c&&has(st.skip,k));if(i===c)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current')});
  now.querySelector('[data-slot]').textContent=(c+1)+' of '+rows.length;
  now.querySelector('[data-name]').textContent=name(c);now.querySelector('[data-meta]').textContent=rows[c].dataset.meta;
  var n=nextOpen(c);nx.textContent=n>=0?'Up next: '+name(n):st.skip.length?'Then: come back to the skipped teams':'Last demo';
  document.getElementById('lab-prev').disabled=c===0;
  back.hidden=!st.skip.length;var ul=back.querySelector('ul');ul.textContent='';
  st.skip.forEach(function(k){var i=keys.indexOf(k);if(i<0)return;var li=document.createElement('li'),b=document.createElement('button');
    b.type='button';b.className='btn btn-ghost';b.textContent=(i+1)+'. '+name(i);b.addEventListener('click',function(){go(i)});li.appendChild(b);ul.appendChild(li)});
  save()}
document.getElementById('lab-fwd').addEventListener('click',function(){var c=cur();drop(st.skip,keys[c]);if(!has(st.done,keys[c]))st.done.push(keys[c]);
  var n=nextOpen(c);if(n<0&&st.skip.length)n=keys.indexOf(st.skip[0]);if(n>=0)go(n);else show()});
document.getElementById('lab-skip').addEventListener('click',function(){var c=cur();if(!has(st.skip,keys[c]))st.skip.push(keys[c]);drop(st.done,keys[c]);
  var n=nextOpen(c);if(n>=0)st.team=keys[n];show()});
document.getElementById('lab-prev').addEventListener('click',function(){var c=cur();if(c>0)go(c-1)});
document.getElementById('lab-reset').addEventListener('click',function(){if(!confirm('Start from team 1? This clears presented and skipped teams on this device.'))return;
  st={day:today,team:keys[0],done:[],skip:[]};show()});
rows.forEach(function(el,i){el.querySelector('.lab-ord-pick').addEventListener('click',function(){go(i);now.scrollIntoView({block:'start',behavior:'smooth'})})});
show();
})();`;

const otherVotes = (t) => (t.others.length ? ' <span class="lab-flag" title="' + esc(t.others.join(', ')) + '">+' +
  t.others.length + ' Other, not counted</span>' : '');

/* Organizer controls under the running order: the shared finalist count and,
   per live vote, a Remove form. Both need the admin key. */
function finalistForm(opts) {
  const c = opts.count || { n: opts.n || FINALISTS, source: 'default' };
  const src = c.source === 'set' ? 'set by an organizer' + (c.at ? ' at ' + esc(clock(Date.parse(c.at))) : '') :
    c.source === 'env' ? 'from IMPACT_LAB_FINALISTS' : 'the default';
  return '<div class="lab-panel lab-ncount"><p class="lab-k">Finalists: <b>' + c.n + '</b> (' + src + ')</p>' +
    '<p class="lab-muted">One number for Demo order, Score and Results.' +
    (opts.lock ? ' Locked with the finalists; reopen voting to change it.' : '') + '</p></div>';
}

/* ---- Organizer tools (admin key) ---------------------------------------
   Demo order shows only a key box. The tools page, with every list (teams,
   votes, scores), comes back only from an admin-key POST, so nothing about
   who scored what is in a public page. Its forms carry the key in a hidden
   field (the page is a no-store POST answer). Destructive actions (delete a
   team, remove a vote or score, lock, reopen, reveal or hide results) first answer with a
   confirmation screen saying exactly what will change; only Confirm
   (confirm=1) does it. */
const ADMIN_TAG = '<span class="lab-adminonly">ADMIN ONLY</span>';
const DESTRUCTIVE = ['delete', 'delete-score', 'delete-vote', 'lock', 'unlock', 'reveal', 'unreveal'];

function keyField(key) { return '<input type="hidden" name="admin" value="' + esc(key) + '">'; }

function toolForm(key, action, label, cls, extra = '', ask = null) {
  return '<form class="lab-lockform" method="post" action="' + SELF + '"' +
    (ask ? ' data-ask="' + esc(JSON.stringify(ask)) + '"' : '') + (key ? '' : ' data-key="1"') +
    '><input type="hidden" name="action" value="' + esc(action) + '">' +
    extra + keyField(key || '') + '<button class="btn ' + cls + '" type="submit">' + esc(label) + '</button>' + ADMIN_TAG + '</form>';
}

function organizerTools() {
  if (!adminEnabled()) return '';
  return '<div class="lab-panel lab-org" id="organizer"><p class="lab-k">Organizer tools ' + ADMIN_TAG + '</p>' +
    '<p class="lab-muted">Close or reopen voting, reveal results, the finalist count, downloads and clean-up. ' +
    'Anything that deletes, locks or reveals asks you to confirm in a pop-up first.</p>' +
    '<form class="lab-lockform" method="post" action="' + SELF + '"><input type="hidden" name="action" value="tools">' +
      '<label class="lab-k" for="lab-org-key">Organizer key</label>' +
      '<input class="input" id="lab-org-key" name="admin" type="password" autocomplete="off" required>' +
      '<button class="btn btn-ghost" type="submit">Open organizer tools</button>' + ADMIN_TAG + '</form></div>';
}

function toolsPage(opts, rows, votes, scores, key, count) {
  const teams = currentTeams(rows);
  // What each change will do, shown in the pop-up (describe() reads the same state the server confirm page does).
  const ask = (action, body = {}) => describe(action, body, opts, rows, votes, scores);
  const lock = opts.lock ? toolForm(key, 'unlock', 'Reopen voting…', 'btn-ghost', '', ask('unlock')) :
    toolForm(key, 'lock', 'Close voting and lock finalists…', 'btn-primary', '', ask('lock'));
  const reveal = opts.revealed ? toolForm(key, 'unreveal', 'Hide per-judge scores again…', 'btn-ghost', '', ask('unreveal')) :
    toolForm(key, 'reveal', 'Reveal results…', 'btn-ghost', '', ask('reveal'));
  const countForm = opts.lock ? '<p class="lab-muted">Finalists are locked; reopen voting to change the count.</p>' :
    toolForm(key, 'set-finalists', 'Set for every view', 'btn-ghost', '<label for="lab-n">Finalists</label>' +
      '<input class="input" id="lab-n" name="n" type="number" min="1" max="40" inputmode="numeric" required value="' + (opts.n || FINALISTS) + '">');
  const byName = teams.slice().sort((a, b) => a.team_name.localeCompare(b.team_name));
  const list = (title, items) => '<details class="lab-older"><summary>' + esc(title) + ' (' + items.length + ')</summary><ul class="lab-judges">' +
    items.join('') + '</ul></details>';
  const live = votes.filter((v) => v.wanted !== false && v.id);
  return shell('Organizer tools',
    '<p class="label">FaithTech SoCal Create Hackathon · Sat, October 24</p><h1 class="h2 lab-judge-h1">Organizer tools ' + ADMIN_TAG + '</h1>' +
    '<p class="lab-links"><a class="btn btn-ghost" href="' + esc(href('order')) + '">Back to Demo order</a></p>' +
    '<div class="lab-panel lab-org">' +
    '<p class="lab-k">Voting · ' + (opts.lock ? 'finalists locked at ' + esc(lockedAt(opts)) : 'open') + '</p>' + lock +
    '<p class="lab-k">Results privacy · ' + (opts.revealed ? 'revealed' : 'private') + '</p>' + reveal +
    '<p class="lab-k">Finalist count · ' + (opts.n || FINALISTS) + ' (' + count + ' in the running order)</p>' + countForm +
    '<p class="lab-k">Downloads</p>' + toolForm(null, 'csv', 'Submissions CSV (emails)…', 'btn-ghost', '',
      ['Download contact emails', 'The submissions CSV has every team\u2019s contact email. Type the organizer key to download it.']) +
      toolForm(key, 'scores-csv', 'Scores CSV (with notes)', 'btn-ghost') +
    '<p class="lab-k">Clean up</p>' +
    list('Remove a team', byName.map((t) => '<li><div class="lab-judge-row"><b>' + esc(t.team_name) + '</b><span class="lab-num">Track ' +
      esc(t.challenge) + (t.versions > 1 ? ' · ' + t.versions + ' versions' : '') + '</span></div>' +
      toolForm(key, 'delete', 'Delete team…', 'btn-ghost lab-del', '<input type="hidden" name="delete" value="' + esc(t.id) + '">', ask('delete', { delete: t.id })) + '</li>')) +
    list('Remove a vote', live.map((v) => '<li><div class="lab-judge-row"><b>' + esc(v.judge_name) +
      (isListed(v.judge_name) ? '' : ' <span class="lab-flag">Other · not counted</span>') + '</b><span class="lab-num">' +
      esc(v.team_name || v.team_key) + '</span></div><span class="lab-muted">' + esc(pt(v.updated_at || v.created_at)) + '</span>' +
      toolForm(key, 'delete-vote', 'Remove vote…', 'btn-ghost lab-del', '<input type="hidden" name="id" value="' + esc(v.id) + '">', ask('delete-vote', { id: v.id })) + '</li>')) +
    list('Remove a score', scores.map((x) => '<li><div class="lab-judge-row"><b>' + esc(x.judge_name) + '</b><span class="lab-num">' +
      fmt(weighted(x)) + '</span></div><span class="lab-muted">' + esc(x.team_name || x.team_key) + '</span>' +
      toolForm(key, 'delete-score', 'Remove score…', 'btn-ghost lab-del', '<input type="hidden" name="id" value="' + esc(x.id) + '">', ask('delete-score', { id: x.id })) + '</li>')) +
    '</div>' + ASK_DIALOG, ASK_SCRIPT);
}

/* The pop-up: a form with data-ask (title, then lines) opens it instead of
   submitting; Confirm sends the same form with confirm=1. Without
   JavaScript the form posts as before and gets the confirmation page. */
const ASK_DIALOG = '<dialog class="lab-ask" id="lab-ask" aria-labelledby="lab-ask-t"><p class="lab-k">This will change</p>' +
  '<h2 class="h3" id="lab-ask-t"></h2><div id="lab-ask-body"></div>' +
  '<p id="lab-ask-key" hidden><label class="lab-k" for="lab-ask-in">Organizer key</label>' +
  '<input class="input" id="lab-ask-in" type="password" autocomplete="off"></p><div class="lab-confirm-ctl">' +
  '<button type="button" class="btn btn-primary" id="lab-ask-ok">Confirm</button>' +
  '<button type="button" class="btn btn-ghost" id="lab-ask-no">Cancel</button></div></dialog>';
const ASK_SCRIPT = `(function(){
var d=document.getElementById('lab-ask');if(!d||!d.showModal)return;var f=null;
[].forEach.call(document.querySelectorAll('form[data-ask]'),function(form){form.addEventListener('submit',function(e){
  if(form.dataset.ok)return;e.preventDefault();f=form;var a=[];try{a=JSON.parse(form.dataset.ask)}catch(_){}
  document.getElementById('lab-ask-t').textContent=a[0]||'Confirm';var b=document.getElementById('lab-ask-body');b.textContent='';
  a.slice(1).forEach(function(l){var p=document.createElement('p');p.className='prose';p.textContent=l;b.appendChild(p)});
  var k=document.getElementById('lab-ask-key'),i=document.getElementById('lab-ask-in');k.hidden=!form.dataset.key;i.value='';
  d.showModal();if(form.dataset.key)i.focus()})});
document.getElementById('lab-ask-no').addEventListener('click',function(){d.close()});
document.getElementById('lab-ask-ok').addEventListener('click',function(){if(!f)return;
  if(f.dataset.key){var v=document.getElementById('lab-ask-in').value.trim();if(!v){document.getElementById('lab-ask-in').focus();return}
    f.querySelector('[name=admin]').value=v;d.close();f.submit();f.querySelector('[name=admin]').value='';return}
  var c=document.createElement('input');c.type='hidden';c.name='confirm';c.value='1';f.appendChild(c);f.dataset.ok='1';d.close();f.submit()});
document.getElementById('lab-ask-in').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();document.getElementById('lab-ask-ok').click()}});
})();`;

/* What a destructive action will change, as [title, line, …]; null when the
   item is gone. Counts match what the delete removes. */
function describe(action, body, opts, rows, votes, scores) {
  const q = (s) => '“' + s + '”';
  if (action === 'lock') {
    const list = lineup(currentTeams(rows), votes, opts.n, null).order;
    return ['Close voting and lock finalists', 'Lock these ' + plural(list.length, 'finalist') + ' in this order: ' +
      (list.map((t) => t.slot + '. ' + t.team_name).join(', ') || 'none yet') + '.',
      'Judges can no longer vote. Late submissions can still be scored. You can reopen voting later.'];
  }
  if (action === 'reveal') {
    return ['Reveal results', 'Show every judge\u2019s scores and notes: the \u201cBy judge\u201d breakdown on Results, the public Scores CSV, ' +
      'and all scores in scores.json (' + plural(scores.length, 'score') + ' by ' +
      plural(new Set(scores.map((x) => String(x.judge_name).toLowerCase())).size, 'judge name') + ').',
      'Anyone with the judges link can then see them. You can hide them again.'];
  }
  if (action === 'unreveal') {
    return ['Hide results again', 'Hide every judge\u2019s scores and notes again: Results goes back to averages only, the public ' +
      'Scores CSV is switched off, and scores.json gives each judge only their own rows.',
      'Anyone who already opened or downloaded them keeps what they saw.'];
  }
  if (action === 'unlock') {
    if (!opts.lock) return null;
    return ['Reopen voting', 'Release the locked running order of ' + plural(opts.lock.keys.length, 'finalist') + ' (locked at ' + lockedAt(opts) + ').',
      'Judges can vote again and the order can change.'];
  }
  if (action === 'delete') {
    const row = rows.find((r) => r.id === String(body.delete));
    if (!row) return null;
    const key = teamKey(row.team_name);
    const versions = rows.filter((r) => teamKey(r.team_name) === key).length;
    const v = votes.filter((x) => x.team_key === key).length;
    const sc = scores.filter((x) => x.team_key === key).length;
    return ['Delete ' + normTeamName(row.team_name), 'Delete ' + q(normTeamName(row.team_name)) + ': ' + plural(versions, 'version') + ', ' +
      plural(v, 'vote') + ', ' + plural(sc, 'score') + '. This can’t be undone.'];
  }
  if (action === 'delete-score') {
    const x = scores.find((r) => r.id === String(body.id));
    if (!x) return null;
    return ['Remove a score', 'Remove ' + x.judge_name + '’s score for ' + q(x.team_name || x.team_key) + ' (Works ' + x.impact +
      ' · Adopt ' + x.product + ' · Usable ' + x.demo + ' · Care ' + x.care + ', ' + fmt(weighted(x)) + '). This can’t be undone.'];
  }
  const x = votes.find((r) => r.id === String(body.id));
  if (!x) return null;
  return ['Remove a vote', 'Remove ' + x.judge_name + '’s shortlist vote for ' + q(x.team_name || x.team_key) + '. This can’t be undone.' +
    (opts.lock ? ' The locked running order does not change.' : '')];
}

/* The hard confirmation: what will change, Confirm (repeats the request with
   confirm=1) and Cancel (back to the tools). */
function confirmPage(key, body, title, lines) {
  const keep = ['action', 'delete', 'id'].filter((k) => body[k] !== undefined && body[k] !== null && typeof body[k] !== 'object')
    .map((k) => '<input type="hidden" name="' + k + '" value="' + esc(body[k]) + '">').join('');
  return shell('Confirm: ' + title,
    '<p class="label">FaithTech SoCal Create Hackathon · Organizer tools</p><h1 class="h2 lab-judge-h1">' + esc(title) + ' ' + ADMIN_TAG + '</h1>' +
    '<div class="lab-panel lab-confirm" role="alertdialog" aria-labelledby="lab-confirm-t"><p class="lab-k" id="lab-confirm-t">This will change</p>' +
    lines.map((l) => '<p class="prose">' + esc(l) + '</p>').join('') +
    '<div class="lab-confirm-ctl"><form method="post" action="' + SELF + '">' + keep + keyField(key) +
      '<input type="hidden" name="confirm" value="1"><button class="btn btn-primary" type="submit">Confirm</button></form>' +
    '<form method="post" action="' + SELF + '"><input type="hidden" name="action" value="tools">' + keyField(key) +
      '<button class="btn btn-ghost" type="submit">Cancel</button></form></div></div>');
}

/* Where teams demo. */
const meetBlock = (cls) => '<div class="lab-meet' + (cls ? ' ' + cls : '') + '"><p class="lab-meet-t"><strong>Teams: demos are in the room. ' +
  'Be ready at the front when your team is called. 90 seconds: a working prototype and what God did.</strong></p></div>';

function order(rows, votes, opts, scores, notice) {
  const n = opts.n || FINALISTS;
  const { order: list, ranked } = lineup(currentTeams(rows), votes, n, opts.lock);
  const present = Boolean(opts.present);
  const state = opts.lock
    ? '<p class="notice lab-notice lab-final" role="status"><strong>Finalists locked at ' + esc(lockedAt(opts)) + '.</strong> This is the running order.</p>'
    : '<p class="notice lab-notice" role="status"><strong>Voting open: order may change</strong> until an organizer locks the finalists.</p>';
  const meta = (t) => 'Track ' + t.challenge + ' · ' + (CHALLENGES[t.challenge] || '') + (present ? '' : ' · ' + plural(t.votes, 'vote'));
  let lastCh = '';
  const items = list.map((t) => {
    const head = t.challenge !== lastCh ? '<li class="lab-ord-ch" aria-hidden="true">Track ' + esc(t.challenge) + ' · ' +
      esc(CHALLENGES[t.challenge] || '') + '</li>' : '';
    lastCh = t.challenge;
    return head + '<li class="lab-ord" data-team="' + esc(t.team_key) + '" data-meta="' + esc(meta(t)) + '"><button type="button" class="lab-ord-pick" aria-label="Set ' +
      esc(t.team_name) + ' as now presenting"><span class="lab-ord-n">' + t.slot + '</span>' +
      '<span class="lab-ord-body"><span class="lab-ord-name">' + esc(t.team_name) + '</span>' +
      '<span class="lab-ord-meta">' + [present ? '' : '<b>' + plural(t.votes, 'vote') + '</b>' + otherVotes(t),
        esc(t.members.join(', '))].filter(Boolean).join(' · ') + '</span>' +
      (t.one_liner ? '<span class="lab-ord-one">' + esc(t.one_liner) + '</span>' : '') + '</span>' +
      '<span class="lab-ord-tag lab-ord-tag--skip">Skipped</span></button></li>';
  }).join('');
  const rest = ranked.filter((t) => !t.finalist);
  const body = list.length
    ? '<div class="lab-now" id="lab-now" aria-live="polite"><p class="lab-k">Now presenting · <span data-slot></span></p>' +
      '<p class="lab-now-name" data-name></p><p class="lab-now-meta" data-meta></p>' +
      '<p class="lab-now-next" id="lab-next"></p>' +
      '<div class="lab-now-ctl"><button type="button" class="btn btn-ghost" id="lab-prev">← Previous</button>' +
      '<button type="button" class="btn btn-ghost" id="lab-skip">Skip for now</button>' +
      '<button type="button" class="btn btn-primary" id="lab-fwd">Next team →</button></div>' +
      '<div class="lab-back" id="lab-back" hidden><p class="lab-k">Come back to</p><ul class="lab-back-list"></ul></div>' +
      '<p class="lab-now-reset"><button type="button" class="lab-linkbtn" id="lab-reset">Start from 1</button></p></div>' +
      '<h2 class="lab-group-title lab-ord-title">Running order <span class="lab-count">' + list.length + '</span></h2>' +
      '<ol class="lab-order">' + items + '</ol>'
    : '<div class="lab-panel"><p class="prose"><strong>No shortlist votes yet.</strong> Finalists appear here as judges tap ' +
      '<em>Want to see this demo</em> on the <a href="' + esc(href('shortlist', opts)) + '">Shortlist</a>.</p></div>';
  if (present) {
    return shell('Demo order',
      '<div class="lab-present"><p class="lab-present-bar"><span>' + (opts.lock ? 'Finalists locked at ' + esc(lockedAt(opts)) :
        'Voting open: order may change') + '</span><a href="' + esc(href('order')) + '">Exit presenter mode</a></p>' + body +
        meetBlock('lab-meet--present') + '</div>',
      list.length ? ORDER_SCRIPT : '');
  }
  const others = rest.length ? '<details class="lab-older lab-rest"><summary>' + (opts.lock ? 'Other submissions' : 'Not in the running order') +
    ' (' + rest.length + ')</summary>' +
    '<ul class="lab-judges">' + rest.map((t) => '<li><div class="lab-judge-row"><b>' + esc(t.team_name) + '</b><span class="lab-num">' +
      plural(t.votes, 'vote') + '</span></div><span class="lab-muted">Track ' + esc(t.challenge) + ' · ' +
      esc(CHALLENGES[t.challenge] || '') + '</span>' + otherVotes(t) + '</li>').join('') + '</ul></details>' : '';
  const links = '<p class="lab-links"><a class="btn btn-ghost" href="' + esc(href('order', opts)) + '">Refresh</a>' +
    '<a class="btn btn-ghost" href="' + SELF + '?view=order&amp;present=1">Presenter mode</a></p>';
  return shell('Demo order',
    top('order', notice, opts) + state + meetBlock() +
    '<p class="lab-muted lab-judge-meta">Top ' + n + ' by judge votes, at least ' + PER_CHALLENGE + ' per track, Track 1 to 3.</p>' +
    body + links + finalistForm(opts) + others + judgeActivity(scores || [], list, 'finalists', votes) + organizerTools(),
    list.length ? ORDER_SCRIPT : '');
}

/* ---- 3 Score ------------------------------------------------------------ */

/* Four rows of 1–5 tap targets, a note and Save. The page script wires them up. */
function scorer(t) {
  return '<div class="lab-score" data-team="' + esc(t.team_key) + '">' +
    '<div class="lab-score-head"><p class="lab-k">Your score</p>' +
    '<p class="lab-score-total"><b data-total class="lab-none">Not scored yet</b><span class="lab-muted" data-of hidden> / 5</span></p></div>' +
    AREAS.map((a) => '<div class="lab-score-row" role="group" aria-label="' + esc(a[1]) + ', ' + a[2] + ' percent, 1 to 5">' +
      '<p class="lab-score-label">' + esc(a[1]) + ' <span class="lab-w">' + a[2] + '%</span></p>' +
      '<p class="lab-score-q">' + esc(a[3]) + '</p>' +
      '<div class="lab-taps">' + [1, 2, 3, 4, 5].map((n) =>
        '<button type="button" class="lab-tap" data-area="' + a[0] + '" data-n="' + n + '" aria-pressed="false">' + n + '</button>').join('') +
      '</div></div>').join('') +
    '<label class="lab-k lab-note-label" for="note-' + esc(t.id) + '">Note (optional, one line)</label>' +
    '<input class="input lab-note" id="note-' + esc(t.id) + '" type="text" maxlength="280">' +
    '<p class="lab-score-status lab-muted" data-status role="status" aria-live="polite"></p>' +
    '<div class="lab-save-row"><button type="button" class="btn btn-primary lab-save">Save score</button>' +
      '<button type="button" class="btn btn-ghost lab-nextbtn" hidden>Next team →</button></div></div>';
}

function scoreCard(t) {
  return '<details class="lab-scard" data-team="' + esc(t.team_key) + '"' + (t.finalist ? ' data-final="1"' : '') + '>' +
    '<summary><span class="lab-ord-n">' + (t.slot || '·') + '</span><span class="lab-scard-name">' + esc(t.team_name) +
      '<span class="lab-muted">' + chip(t.challenge) + (t.finalist ? ' ' + plural(t.votes, 'vote') : '') + '</span></span>' +
      '<span class="lab-state" data-state>Not scored</span></summary>' +
    '<div class="lab-scard-body">' + about(t) + team(t) + history(t) +
      scorer(t) + '</div></details>';
}

/* The Score page. Unsaved taps and notes are kept in localStorage per judge
   and team (iOS reloads background tabs) and restored; a card with one says
   "Not saved yet". Each save sends `base`, the updated_at this phone loaded,
   so a stale phone cannot overwrite a newer score; coming back to the tab
   re-fetches and says "Updated on another device" when a row moved. Next team
   follows the demo order: the team now presenting (when this device runs Demo
   order) if this judge has not scored it, else the next unscored finalist
   after the one just saved. */
const SCORE_SCRIPT = `(function(){
${NAME_JS}
var nextTeam=${nextTeam.toString()};
var W={impact:35,product:30,demo:20,care:15},mine={},draft={},loaded=false,
  cards=[].slice.call(document.querySelectorAll('.lab-scard')),
  order=cards.filter(function(c){return c.dataset.final}).map(function(c){return c.dataset.team}),
  prog=document.getElementById('lab-prog'),others=document.getElementById('lab-others');
function dk(t){return 'labDraft:'+get().toLowerCase()+'|'+t}
function keep(t){try{if(draft[t])localStorage.setItem(dk(t),JSON.stringify(draft[t]));else localStorage.removeItem(dk(t))}catch(e){}}
function drafts(){draft={};if(!get())return;cards.forEach(function(c){var t=c.dataset.team;try{var d=JSON.parse(localStorage.getItem(dk(t))||'null');if(d)draft[t]=d}catch(e){}})}
function card(t){for(var i=0;i<cards.length;i++)if(cards[i].dataset.team===t)return cards[i];return null}
function total(s){return s&&s.impact&&s.product&&s.demo&&s.care?((W.impact*s.impact+W.product*s.product+W.demo*s.demo+W.care*s.care)/100).toFixed(2):''}
function scored(){var m={};Object.keys(mine).forEach(function(k){m[k]=true});return m}
function cur(t){return draft[t]||mine[t]||{}}
function same(a,b){return a&&b&&a.impact===b.impact&&a.product===b.product&&a.demo===b.demo&&a.care===b.care&&(a.note||'')===(b.note||'')}
function dirty(t){return !!draft[t]&&!same(draft[t],mine[t])}
function status(el,t,bad){var p=el.querySelector('[data-status]');p.textContent=t;p.classList.toggle('lab-bad',!!bad)}
function paint(el){var t=el.dataset.team,s=cur(t),saved=mine[t],d=dirty(t);
  [].forEach.call(el.querySelectorAll('.lab-tap'),function(b){b.setAttribute('aria-pressed',s[b.dataset.area]===+b.dataset.n?'true':'false')});
  var tt=total(s),tb=el.querySelector('[data-total]');tb.textContent=tt||'Not scored yet';tb.classList.toggle('lab-none',!tt);el.querySelector('[data-of]').hidden=!tt;
  var note=el.querySelector('.lab-note');if(document.activeElement!==note)note.value=s.note||'';
  var st=el.querySelector('[data-state]');st.textContent=d?'Not saved yet':saved?'\\u2713 '+total(saved):'Not scored';
  el.classList.toggle('lab-scard--done',!!saved&&!d);el.classList.toggle('lab-scard--draft',d);
  el.querySelector('.lab-save').textContent=saved?'Update score':'Save score';
  el.classList.toggle('lab-score--off',!get())}
function progress(){var m=scored(),n=order.filter(function(t){return m[t]}).length,all=Object.keys(m).length;
  prog.textContent=order.length?n+' of '+order.length+' finalists scored':all+' scored';
  document.getElementById('lab-prog-all').hidden=!(order.length&&n===order.length)}
function load(){var n=get(),was=mine,first=!loaded;mine={};
  if(!n){draft={};loaded=false;cards.forEach(paint);progress();return}
  if(first)drafts();
  fetch(SELF+'?format=scores.json&judge='+encodeURIComponent(n),{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
    (d.scores||[]).forEach(function(s){mine[s.team_key]={impact:s.impact,product:s.product,demo:s.demo,care:s.care,note:s.note||'',updated_at:s.updated_at}});
    if(!first)Object.keys(mine).concat(Object.keys(was)).forEach(function(t){var a=was[t],b=mine[t],el=card(t);
      if(!el||(a&&b&&a.updated_at===b.updated_at)||(!a&&!b))return;
      status(el,dirty(t)?'Updated on another device. Check, then save again.':'Updated on another device.',dirty(t))});
    loaded=true;cards.forEach(paint);progress()
  }).catch(function(){mine=was;cards.forEach(paint);progress()})}
var last=0;function again(){if(document.hidden||!loaded||Date.now()-last<2000)return;last=Date.now();load()}
document.addEventListener('visibilitychange',again);window.addEventListener('focus',again);
function presenting(){try{var s=JSON.parse(localStorage.getItem('labOrder:v2')||'null'),
  today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Los_Angeles'});
  if(s&&s.day===today&&order.indexOf(s.team)>=0)return s.team}catch(e){}return null}
function after(t){var m=scored(),p=presenting();
  if(p&&p!==t&&!m[p])return p;
  return nextTeam(order,m,order.indexOf(t)>=0?t:(p||t))}
function openCard(el){cards.forEach(function(c){if(c!==el)c.open=false});
  if(others&&!el.dataset.final)others.open=true;el.open=true;
  el.scrollIntoView({block:'start',behavior:'smooth'});el.querySelector('summary').focus({preventScroll:true})}
function edit(t){var s=draft[t]=draft[t]||JSON.parse(JSON.stringify(cur(t)));delete s.updated_at;return s}
function save(el){var t=el.dataset.team,s=cur(t),nb=el.querySelector('.lab-nextbtn'),btn=el.querySelector('.lab-save');
  if(!get()){status(el,'Pick your name at the top first.',true);askName();return}
  if(!(s.impact&&s.product&&s.demo&&s.care)){status(el,'Tap 1 to 5 in all four areas, then Save.',true);return}
  btn.disabled=true;status(el,'Saving\\u2026');
  post({action:'score',judge:get(),team:t,impact:s.impact,product:s.product,demo:s.demo,care:s.care,note:s.note||'',
    base:mine[t]?mine[t].updated_at||null:null}).then(function(x){btn.disabled=false;
    if(!x.ok&&x.d&&x.d.code==='stale'){status(el,'Updated on another device. Check, then save again.',true);load();return}
    if(!x.ok){status(el,'Not saved: '+why(x.d),true);return}
    mine[t]={impact:s.impact,product:s.product,demo:s.demo,care:s.care,note:s.note||'',updated_at:x.d.score&&x.d.score.updated_at};
    delete draft[t];keep(t);paint(el);progress();
    var nx=after(t),c=nx&&card(nx);
    status(el,'\\u2713 Saved: '+total(mine[t])+' / 5'+(c?'':order.length?'. Every finalist is scored.':''));
    nb.hidden=!c;if(c){nb.textContent='Next team: '+c.querySelector('.lab-scard-name').firstChild.textContent+' \\u2192';nb.dataset.to=nx;nb.focus()}
  }).catch(function(){btn.disabled=false;status(el,'Not saved: no connection. Your taps are kept on this phone; tap Save again.',true)})}
cards.forEach(function(el){var t=el.dataset.team;
  el.addEventListener('toggle',function(){if(el.open){cards.forEach(function(c){if(c!==el)c.open=false});if(!get())status(el,'Pick your name at the top first.',true)}});
  el.querySelector('.lab-taps')&&el.addEventListener('click',function(e){var b=e.target.closest('.lab-tap');if(!b)return;
    if(!get()){status(el,'Pick your name at the top first.',true);askName();return}
    var s=edit(t);s[b.dataset.area]=+b.dataset.n;keep(t);paint(el);
    el.querySelector('.lab-nextbtn').hidden=true;
    status(el,same(s,mine[t])?'Saved':s.impact&&s.product&&s.demo&&s.care?'Not saved yet: tap '+(mine[t]?'Update score':'Save score')+'.':'Tap all four areas, then Save.')});
  var note=el.querySelector('.lab-note');
  note.addEventListener('input',function(){var s=edit(t);s.note=note.value.trim();keep(t);paint(el);
    if(!same(s,mine[t]))status(el,'Not saved yet: tap '+(mine[t]?'Update score':'Save score')+'.')});
  el.querySelector('.lab-save').addEventListener('click',function(){save(el)});
  el.querySelector('.lab-nextbtn').addEventListener('click',function(){var c=card(this.dataset.to);if(c)openCard(c)});
});
${ALL_FIELDS_JS}
showName();load();
var first=order.length?card(order[0]):null;if(location.hash==='#first'&&first)openCard(first);
})();`;

function score(rows, votes, opts) {
  const { order: list, ranked } = lineup(currentTeams(rows), votes, opts.n || FINALISTS, opts.lock);
  const rest = ranked.filter((t) => !t.finalist).sort((a, b) => a.challenge.localeCompare(b.challenge) || a.team_name.localeCompare(b.team_name));
  const bar = '<div class="lab-bar" aria-live="polite"><span class="lab-bar-main" id="lab-prog">–</span>' +
    '<span class="lab-prog-ok" id="lab-prog-all" hidden>All finalists scored</span>' +
    '<a class="lab-bar-link" href="' + esc(href('order', opts)) + '">Demo order</a></div>';
  const legend = '<p class="lab-muted lab-judge-meta">Tap a team, score 1 to 5 in each area, then <b>Save score</b>. ' + allToggle + '</p>';
  const fin = list.length
    ? '<section class="lab-group"><h2 class="lab-group-title"><span class="label">In demo order</span>Finalists ' +
      '<span class="lab-count">' + list.length + '</span></h2><div class="lab-slist">' + list.map(scoreCard).join('') + '</div></section>'
    : '<div class="lab-panel"><p class="prose"><strong>No finalists yet.</strong> They come from the ' +
      '<a href="' + esc(href('shortlist', opts)) + '">Shortlist</a> votes. Every submission is below and can be scored.</p></div>';
  const others = rest.length
    ? '<details class="lab-older lab-others" id="lab-others"' + (list.length ? '' : ' open') + '><summary>Other submissions (' +
      rest.length + '), still scorable</summary><div class="lab-slist">' + rest.map(scoreCard).join('') + '</div></details>'
    : '';
  return shell('Scoring',
    top('score', '', opts) + nameBox('Start scoring') + bar + legend + fin + others, SCORE_SCRIPT);
}

/* ---- 4 Results ---------------------------------------------------------- */

/* Counted scores first, then any from names off the JUDGES list, flagged and
   left out of the average. */
/* Per-judge scores and notes stay private until an organizer reveals results:
   before that only the counts show. Counted scores first, then any from names
   off the JUDGES list, flagged and left out of the average. */
function breakdown(t, revealed) {
  const all = t.scores.concat(t.others || []);
  if (!all.length) return '';
  const label = 'By judge (' + t.scores.length + (t.others && t.others.length ? ' + ' + t.others.length + ' Other, not counted' : '') + ')';
  if (!revealed) return '<p class="lab-muted lab-private">' + esc(label) + ': private until an organizer reveals results.</p>';
  return '<details class="lab-older lab-breakdown"><summary>' + esc(label) + '</summary><ul class="lab-judges">' +
    all.map((s) => '<li><div class="lab-judge-row"><b>' + esc(s.judge_name) +
      (isListed(s.judge_name) ? '' : ' <span class="lab-flag">Other · not counted</span>') + '</b><span class="lab-num">' +
      fmt(weighted(s)) + '</span></div><span class="lab-muted">Works ' + s.impact + ' · Adopt ' + s.product +
      ' · Usable ' + s.demo + ' · Care ' + s.care + '</span>' + (s.note ? '<span class="lab-note-text">' + esc(s.note) + '</span>' : '') +
      '</li>').join('') + '</ul></details>';
}

const tieText = (t) => (t.tie ? '<span class="lab-tie"><b>Tie</b> on ' + fmt(t.score) + ' with ' + esc(t.tie.with) + ': ' +
  (t.tie.above ? 'ahead' : 'behind') + ' on ' + esc(t.tie.by) + '</span>' : '');

function rankRow(t, showChallenge, revealed) {
  const few = t.judges > 0 && !t.enough;
  return '<li class="lab-rank' + (t.rank === null ? ' lab-rank--none' : '') + '">' +
    '<div class="lab-rank-head"><span class="lab-rank-n">' + (t.rank === null ? '–' : t.rank) + '</span>' +
    '<div class="lab-rank-name"><b>' + esc(t.team_name) + '</b>' +
      (showChallenge ? '<span class="lab-muted">' + esc(t.challenge) + ' · ' + esc(CHALLENGES[t.challenge] || '') + '</span>' : '') + '</div>' +
    '<span class="lab-rank-score">' + fmt(t.score) + '</span></div>' +
    '<p class="lab-muted lab-rank-meta">' + t.judges + ' of ' + JUDGES.length + ' judges' +
      (t.judges ? ' · Works ' + fmt(t.impact, 1) + ' · Adopt ' + fmt(t.product, 1) + ' · Usable ' + fmt(t.demo, 1) + ' · Care ' + fmt(t.care, 1) : ' · not scored yet') +
      (few ? ' <span class="lab-flag lab-flag--warn">Not enough scores: ranked below</span>' : '') +
      '</p>' + tieText(t) + breakdown(t, revealed) + '</li>';
}

const RESULTS_SCRIPT = `(function(){var b=document.getElementById('lab-auto');var n=60;
setInterval(function(){if(document.querySelector('details[open]')||document.activeElement&&document.activeElement.tagName==='INPUT'){b.textContent='Auto-refresh paused';return}
n-=5;if(n<=0){location.reload();return}b.textContent='Refreshes in '+n+'s'},5000)})();`;

/* Per judge name: scores and shortlist votes, how many finalists they scored
   (and which they have not), the last change, and how many networks (hashed
   IPs) used the name. The page has no login, so anyone can type a judge's
   name: names off the JUDGES list are marked Other, and a name used from more
   than MAX_NETWORKS networks is flagged so organizers can check with that
   judge. `finals` is the finalist list. */
function judgeActivity(scores, finals, label, votes = []) {
  const by = new Map();
  const finalKeys = new Set(finals.map((t) => t.team_key));
  const get = (name) => {
    const k = String(name).trim().toLowerCase();
    if (!by.has(k)) by.set(k, { name: String(name), count: 0, covered: new Set(), votes: 0, last: '', ips: new Set() });
    return by.get(k);
  };
  const touch = (j, row) => {
    const t = row.updated_at || row.created_at || '';
    if (t > j.last) { j.last = t; j.name = String(row.judge_name); }
    if (row.ip_hash) j.ips.add(row.ip_hash);
  };
  scores.forEach((s) => { const j = get(s.judge_name); j.count += 1; if (finalKeys.has(s.team_key)) j.covered.add(s.team_key); touch(j, s); });
  votes.forEach((v) => { const j = get(v.judge_name); if (v.wanted !== false) j.votes += 1; touch(j, v); });
  JUDGES.forEach((n) => get(n));
  const list = [...by.values()].map((j) => ({ ...j, listed: isListed(j.name) }))
    .sort((a, b) => (b.listed - a.listed) || String(a.name).localeCompare(String(b.name)));
  const missing = (j) => {
    if (!j.listed || !finals.length) return '';
    const left = finals.filter((t) => !j.covered.has(t.team_key)).map((t) => t.team_name);
    return '<span class="lab-muted lab-missing">' + (left.length ? 'Not scored yet: ' + esc(left.join(', ')) : 'Every finalist scored') + '</span>';
  };
  return '<div class="lab-panel lab-activity"><p class="lab-k">Judge coverage · ' + esc(label) + ' scored · last change (Pacific) · networks</p><ul class="lab-judges">' +
    list.map((j) => '<li><div class="lab-judge-row"><b>' + esc(j.name) + (j.listed ? '' : ' <span class="lab-flag">Other · not counted</span>') +
      (j.ips.size > MAX_NETWORKS ? ' <span class="lab-flag lab-flag--warn">Used from ' + j.ips.size + ' networks</span>' : '') +
      '</b><span class="lab-num">' + j.covered.size + ' of ' + finals.length + '</span></div><span class="lab-muted">' +
      (j.last ? plural(j.count, 'score') + ' · ' + plural(j.votes, 'shortlist vote') + ' · last change ' + esc(pt(j.last)) +
        ' · ' + plural(j.ips.size, 'network') : 'Nothing saved yet') + '</span>' + missing(j) + '</li>').join('') + '</ul>' +
    '<p class="lab-muted lab-activity-note">Only ' + esc(JUDGES.join(', ')) + ' count. Check with a judge if their name is flagged.</p></div>';
}

/* Best average per area across every team with a listed-judge score (finalist
   or not), to help choose a special award. */
function areaLeaders(board) {
  const scored = board.filter((t) => t.judges);
  return AREAS.map(([f, label]) => {
    if (!scored.length) return { label, best: null, who: [] };
    const best = Math.max(...scored.map((t) => t[f]));
    return { label, best, who: scored.filter((t) => Math.abs(t[f] - best) < 1e-9).map((t) => t.team_name) };
  });
}


/* The top of Results, sized for a 1280x720 projector: places 1 to 3 (ties
   named, with what decided them) and the special-award candidates. */
function winners(board) {
  const places = board.filter((t) => t.rank && t.rank <= 3);
  const ord = ['Most Redemptive', '2nd', '3rd'];
  const award = areaLeaders(board).filter((a) => a.who.length);
  return '<section class="lab-panel lab-win" aria-label="Standings"><p class="lab-k">Standings now · highest weighted score is Most Redemptive</p>' +
    (places.length ? '<ol class="lab-podium">' + places.map((t) => '<li><span class="lab-place">' +
      (t.tie ? 'Tie · ' : '') + ord[t.rank - 1] + '</span><span class="lab-podium-name">' + esc(t.team_name) +
      '</span><span class="lab-podium-score">' + fmt(t.score) + '</span><span class="lab-muted">Track ' + esc(t.challenge) + ' · ' +
      plural(t.judges, 'judge') + '</span>' + tieText(t) + '</li>').join('') + '</ol>'
      : '<p class="prose">No team has ' + MIN_SCORES + ' listed-judge scores yet.</p>') +
    (award.length ? '<p class="lab-award"><b>Special award candidates</b> ' + award.map((a) => esc(a.label) + ': ' +
      esc(a.who.join(', ')) + ' (' + fmt(a.best, 1) + ')').join(' · ') + '</p>' : '') +
    '</section>';
}

function results(rows, scores, votes, opts, notice) {
  const teams = currentTeams(rows);
  const { order: list } = lineup(teams, votes, opts.n || FINALISTS, opts.lock);
  // Rank on listed judges only; off-list scores ride along, flagged, in the breakdown.
  const counted = scores.filter((s) => isListed(s.judge_name));
  const offList = scores.filter((s) => !isListed(s.judge_name));
  const scoredKeys = new Set(counted.map((s) => s.team_key));
  const finalKeys = new Set(list.map((t) => t.team_key));
  // Finalists, plus any team the listed judges scored, so nobody who demoed drops out.
  const picked = teams.filter((t) => finalKeys.has(t.team_key) || scoredKeys.has(t.team_key));
  const showAll = opts.all || !picked.length;
  const shown = showAll ? teams : picked;
  const shownKeys = new Set(shown.map((t) => t.team_key));
  const withOthers = (lb) => lb.map((t) => ({ ...t, others: offList.filter((s) => s.team_key === t.team_key) }));
  const overall = leaderboard(teams, counted);
  const board = withOthers(leaderboard(shown, counted));
  const judges = new Set(counted.filter((s) => shownKeys.has(s.team_key)).map((s) => String(s.judge_name).toLowerCase())).size;
  const per = Object.keys(CHALLENGES).map((c) => {
    const lb = withOthers(leaderboard(shown.filter((t) => t.challenge === c), counted));
    return '<section class="lab-group" id="r' + c + '"><h2 class="lab-group-title"><span class="label">Track ' + c + '</span>' +
      esc(CHALLENGES[c]) + '</h2>' + (lb.length ? '<ol class="lab-board">' + lb.map((t) => rankRow(t, false, opts.revealed)).join('') + '</ol>' :
      '<p class="prose lab-empty">' + (showAll ? 'No submissions yet.' : 'No finalists in this track.') + '</p>') + '</section>';
  }).join('');
  const seg = '<nav class="lab-seg" aria-label="Which teams">' +
    '<a href="' + esc(href('results')) + '"' + (!opts.all ? ' aria-current="page"' : '') + '>Finalists and scored (' + picked.length + ')</a>' +
    '<a href="' + esc(href('results', { all: true })) + '"' + (opts.all ? ' aria-current="page"' : '') + '>All submissions (' + teams.length + ')</a></nav>';
  return shell('Results',
    top('results', notice || (!picked.length && !opts.all ? 'No shortlist votes or scores yet, so every submission is shown.' : ''), opts,
      winners(overall)) + seg +
    '<p class="lab-links lab-judge-top"><a class="btn btn-primary" href="' + esc(href('results', opts)) + '">Refresh</a>' +
    (opts.revealed ? '<a class="btn btn-ghost" href="' + SELF + '?format=scores.csv">Scores CSV</a>' : '') + '</p>' +
    '<p class="lab-muted lab-judge-meta">' + plural(board.length, 'team') + ' · ' + judges + ' of ' + JUDGES.length + ' judges scoring · ' +
      '<span id="lab-auto">Refreshes every minute</span></p>' +
    '<details class="lab-how"><summary>How ranking works</summary><ul class="lab-rules">' +
      '<li>Score = 35% works live + 30% Baptize would adopt + 20% usable by a pastor or new believer + 15% built the way we said (1 to 5), averaged across ' + esc(JUDGES.join(', ')) + '. Other names are shown, not counted.</li>' +
      '<li>Teams with fewer than ' + MIN_SCORES + ' scores rank below the rest.</li><li>' + esc(TIE_RULE) + '</li></ul></details>' +
    '<section class="lab-group"><h2 class="lab-group-title"><span class="label">All tracks</span>Overall</h2>' +
    (board.length ? '<ol class="lab-board">' + board.map((t) => rankRow(t, true, opts.revealed)).join('') + '</ol>' : '<p class="prose lab-empty">No submissions yet.</p>') +
    '</section>' + '<details class="lab-older lab-bych"><summary>By track</summary>' + per + '</details>' +
    judgeActivity(scores, list, 'finalists', votes), RESULTS_SCRIPT);
}

/* ---- CSV ---------------------------------------------------------------- */

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return '"' + safe.replace(/"/g, '""') + '"';
}

function csv(rows) {
  const head = ['submitted_at_pt', 'latest_for_team', 'team_name', 'track', 'one_liner', 'what_it_does',
    'repo_url', 'demo_url', 'members', 'contact_name', 'contact_email', 'id'];
  const lines = markLatest(rows).map((r) => [
    pt(r.created_at), r.latest ? 'yes' : 'no', r.team_name, r.challenge + ' ' + (CHALLENGES[r.challenge] || ''),
    r.one_liner, r.what_it_does, r.repo_url, r.live_demo_url || r.demo_video_url,
    (Array.isArray(r.members) ? r.members : []).join('; '), r.contact_name, r.contact_email, r.id,
  ].map(csvCell).join(','));
  return '﻿' + [head.join(',')].concat(lines).join('\r\n') + '\r\n';
}

function scoresCsv(rows, scores) {
  const current = new Set(currentTeams(rows).map((t) => t.team_key));
  const head = ['team_name', 'track', 'judge_name', 'works_live', 'would_adopt', 'usable', 'built_right', 'weighted', 'note',
    'updated_at_pt', 'team_has_current_submission'];
  const lines = scores.map((s) => [s.team_name, s.challenge + ' ' + (CHALLENGES[s.challenge] || ''), s.judge_name,
    s.impact, s.product, s.demo, s.care, weighted(s).toFixed(2), s.note, pt(s.updated_at || s.created_at),
    current.has(s.team_key) ? 'yes' : 'no'].map(csvCell).join(','));
  return '﻿' + [head.join(',')].concat(lines).join('\r\n') + '\r\n';
}

/* ---- handler ------------------------------------------------------------ */

function json(res, status, obj) {
  res.statusCode = status; headers(res, 'application/json; charset=utf-8');
  return res.end(JSON.stringify(obj));
}

function limited(res, bucket, ipId) {
  if (!lib.memoryRateExceeded(bucket + ':' + ipId, SCORE_MAX, SCORE_WINDOW_MS)) return false;
  res.setHeader('Retry-After', '60');
  json(res, 429, { ok: false, message: 'Too many saves from this network. Wait a minute and tap again.' });
  return true;
}

async function handleScore(req, res, env, body, ipId) {
  if (limited(res, SCORES, ipId)) return undefined;
  const v = validateScore(body);
  if (!v.ok) return json(res, 400, { ok: false, errors: v.errors });
  const team = currentTeams(await fetchRows(env)).find((t) => t.team_key === v.value.team_key);
  if (!team) return json(res, 409, GONE);
  // `base` is the updated_at this device loaded (null: it saw no score). If the
  // row changed since (another phone under the same name), refuse rather than
  // overwrite all three areas with stale values. Pages that send no base skip this.
  if (body.base !== undefined) {
    const base = body.base === null || body.base === '' ? null : String(body.base);
    const now = (await readJson(env, SCORES + '?select=' + SCORE_COLS + '&' + SLUG_Q + '&judge_name_lower=eq.' +
      encodeURIComponent(v.value.judge_name.toLowerCase()) + '&team_key=eq.' + encodeURIComponent(team.team_key), 'score'))[0];
    if (now && String(now.updated_at) !== base) {
      // No values here: the phone re-reads its own row through ?judge= like any reload.
      return json(res, 409, { ok: false, code: 'stale', message: 'Updated on another device, check and save again.' });
    }
  }
  const { care, note, ...cols } = v.value;
  const saved = await upsertScore(env, { event_slug: EVENT_SLUG, ...cols, note: packNote(care, note), team_key: team.team_key,
    team_name: team.team_name.slice(0, 120), challenge: team.challenge, ip_hash: ipId,
    updated_at: new Date().toISOString() });
  return json(res, 200, { ok: true, score: { judge_name: saved && saved.judge_name, team_key: team.team_key,
    impact: v.value.impact, product: v.value.product, demo: v.value.demo, care: v.value.care, note: v.value.note,
    weighted: weighted(v.value), updated_at: saved && saved.updated_at } });
}

async function handleVote(req, res, env, body, ipId) {
  if (limited(res, VOTES, ipId)) return undefined;
  const { lock } = await readSettings(env);
  if (lock) {
    return json(res, 409, { ok: false, message: 'Voting is closed: the finalists were locked at ' + clock(Date.parse(lock.at)) + '.' });
  }
  const v = validateVote(body);
  if (!v.ok) return json(res, 400, { ok: false, errors: v.errors });
  const { judge_name, team_key, on } = v.value;
  if (!on) {
    await setVote(env, { judge_name, team_key, ip_hash: ipId, updated_at: new Date().toISOString() }, false);
    return json(res, 200, { ok: true, on: false, team_key });
  }
  const team = currentTeams(await fetchRows(env)).find((t) => t.team_key === team_key);
  if (!team) return json(res, 409, GONE);
  await setVote(env, { event_slug: EVENT_SLUG, judge_name, team_key: team.team_key,
    team_name: team.team_name.slice(0, 120), challenge: team.challenge, ip_hash: ipId, wanted: true,
    updated_at: new Date().toISOString() }, true);
  return json(res, 200, { ok: true, on: true, team_key: team.team_key });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    res.statusCode = 405; res.setHeader('Allow', 'GET, POST'); return res.end();
  }
  // Judges key gate: before any data is read or written.
  if (req.method === 'GET' && url.searchParams.has('key') && keyIs(url.searchParams.get('key'), JUDGES_KEY)) {
    url.searchParams.delete('key');
    res.statusCode = 303; headers(res, 'text/plain; charset=utf-8');
    res.setHeader('Set-Cookie', 'jk=' + encodeURIComponent(JUDGES_KEY) + '; Path=/; Max-Age=259200; HttpOnly; Secure; SameSite=Lax');
    res.setHeader('Location', SELF + (url.search || ''));
    return res.end();
  }
  if (!judgesAuthed(req)) {
    const wantsData = req.method !== 'GET' || /\.(json|csv)$/.test(url.searchParams.get('format') || '');
    res.statusCode = 401;
    if (wantsData) { headers(res, 'application/json; charset=utf-8'); return res.end(JSON.stringify({ ok: false, code: 'judges_key_required', message: 'Judges link required.' })); }
    headers(res, 'text/html; charset=utf-8');
    return res.end(shell('Judges link required', '<h1 class="h2">Judges link required</h1><p class="prose">Open the private judges link you were given. Ask an organizer if you need it.</p>'));
  }
  const { env, missing } = lib.readEnv();
  if (missing.length) {
    res.statusCode = 503; headers(res, 'text/html; charset=utf-8');
    return res.end(shell('Not configured', '<h1 class="h2">Storage is not connected</h1><p class="prose">Missing ' +
      esc(missing.join(', ')) + '.</p>'));
  }
  const ipId = lib.hashIp(lib.clientIp(req), process.env.FORM_IP_SALT || process.env.IMPACT_LAB_ADMIN_KEY || '');
  const opts = { all: url.searchParams.get('all') === '1', present: url.searchParams.get('present') === '1' };
  const q0 = (k) => url.searchParams.get(k) || '';
  // Every HTML view reads the same finalist count and lock.
  const withSettings = async () => {
    const st = await readSettings(env);
    Object.assign(opts, { count: st, n: st.n, lock: st.lock, revealed: st.revealed });
  };

  try {
    if (req.method === 'POST') {
      let body = {};
      try { body = await lib.readBody(req); } catch (_) { body = {}; }
      const action = String(body.action || (body.delete ? 'delete' : ''));
      if (action === 'score') return await handleScore(req, res, env, body, ipId);
      if (action === 'vote') return await handleVote(req, res, env, body, ipId);

      if (!['tools', 'delete', 'delete-score', 'delete-vote', 'set-finalists', 'lock', 'unlock', 'reveal', 'unreveal', 'csv', 'scores-csv'].includes(action)) {
        return json(res, 400, { ok: false, message: 'Unknown action.' });
      }
      await withSettings();
      // Admin tools live on Demo order, so a refusal answers there.
      const refuse = async (status, msg) => {
        res.statusCode = status; headers(res, 'text/html; charset=utf-8');
        const [rows, votes, scores] = await Promise.all([fetchRows(env), fetchVotes(env), fetchScores(env)]);
        return res.end(order(rows, votes, opts, scores, msg));
      };
            const wasLocked = locked(ipId);
      if (wasLocked && LOCK_DELAY_MS > 0) await new Promise((r) => setTimeout(r, LOCK_DELAY_MS));
      if (!adminOk(body.admin, action)) {
        recordFail(ipId);
        return await refuse(wasLocked ? 429 : 403, 'That organizer key did not match. Nothing was changed.');
      }
      const html = (status, page) => { res.statusCode = status; headers(res, 'text/html; charset=utf-8'); return res.end(page); };
      const key = TOOLS_TOKEN; // pages carry the tools token, never ADMIN_KEY
      if (action === 'tools') {
        const [rows, votes, scores] = await Promise.all([fetchRows(env), fetchVotes(env), fetchScores(env)]);
        const count = lineup(currentTeams(rows), votes, opts.n, opts.lock).order.length;
        return html(200, toolsPage(opts, rows, votes, scores, key, count));
      }
      if (DESTRUCTIVE.includes(action) && String(body.confirm) !== '1') {
        const rid = String(action === 'delete' ? body.delete : body.id || '');
        if (action.startsWith('delete') && !/^[0-9a-f-]{36}$/i.test(rid)) return json(res, 400, { ok: false, message: 'Bad id.' });
        const [rows, votes, scores] = await Promise.all([fetchRows(env), fetchVotes(env), fetchScores(env)]);
        const lines = describe(action, body, opts, rows, votes, scores);
        if (!lines) return refuse(404, 'That item was already gone. Nothing was changed.');
        return html(200, confirmPage(key, { ...body, action }, lines[0], lines.slice(1)));
      }
      if (action === 'scores-csv') {
        res.statusCode = 200; headers(res, 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="faithtech-socal-hackathon-scores.csv"');
        return res.end(scoresCsv(await fetchRows(env), await fetchScores(env)));
      }
      if (action === 'csv') {
        res.statusCode = 200; headers(res, 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="faithtech-socal-hackathon-submissions.csv"');
        return res.end(csv(await fetchRows(env)));
      }
      const back = (where) => {
        res.statusCode = 303;
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Location', SELF + where);
        return res.end();
      };
      if (action === 'reveal' || action === 'unreveal') {
        await writeSettings(env, { revealed_at: action === 'reveal' ? new Date().toISOString() : null }, ipId);
        return back('?view=order&' + action + 'ed=1');
      }
      if (action === 'set-finalists') {
        const n = parseN(body.n);
        if (!n) return json(res, 400, { ok: false, message: 'Finalists: a whole number from 1 to 40.' });
        if (opts.lock) return back('?view=order&notice=count-locked');
        await writeSettings(env, { finalists: n }, ipId);
        return back('?view=order&set=' + n);
      }
      if (action === 'lock') {
        if (opts.lock) return back('?view=order');
        const [rows, votes] = await Promise.all([fetchRows(env), fetchVotes(env)]);
        const keys = lineup(currentTeams(rows), votes, opts.n, null).order.map((t) => t.team_key);
        await writeSettings(env, { locked_at: new Date().toISOString(), finalist_keys: keys }, ipId);
        return back('?view=order&locked=1');
      }
      if (action === 'unlock') {
        await writeSettings(env, { locked_at: null, finalist_keys: null }, ipId);
        return back('?view=order&unlocked=1');
      }
      const id = String(action === 'delete' ? body.delete : body.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { ok: false, message: 'Bad id.' });
      if (action === 'delete') {
        const gone = await deleteTeam(env, await fetchRows(env), id);
        if (!gone) return back('?view=order&deleted=none');
        return back('?view=order&deleted=team&name=' + encodeURIComponent(gone.name) + '&versions=' + gone.versions +
          '&votes=' + gone.votes + '&scores=' + gone.scores);
      }
      await deleteById(env, action === 'delete-score' ? SCORES : VOTES, id);
      return back(action === 'delete-score' ? '?view=order&deleted=score' : '?view=order&deleted=vote');
    }

    const format = url.searchParams.get('format');
    // Until an organizer reveals results, scores.json gives a judge only their
    // own rows (?judge=Name, what the Score page loads); other judges' scores
    // and notes stay private.
    if (format === 'scores.json') {
      const [all, st] = await Promise.all([fetchScores(env), readSettings(env)]);
      const who = cleanLine(q0('judge')).toLowerCase();
      if (who) return json(res, 200, { ok: true, scores: all.filter((x) => String(x.judge_name).toLowerCase() === who).map(ownScore) });
      if (!st.revealed) return json(res, 200, { ok: true, hidden: true, scores: [] });
      return json(res, 200, { ok: true, scores: all.map(({ ip_hash, ...x }) => x) });
    }
    if (format === 'votes.json') {
      const [votes, st] = await Promise.all([fetchVotes(env), readSettings(env)]);
      return json(res, 200, { ok: true, open: !st.lock,
        votes: votes.filter((v) => v.wanted !== false).map((v) => ({ judge_name: v.judge_name, team_key: v.team_key })) });
    }
    const rows = await fetchRows(env);
    if (format === 'scores.csv') {
      if (!(await readSettings(env)).revealed) {
        res.statusCode = 403; headers(res, 'text/plain; charset=utf-8');
        return res.end('Scores are private until an organizer reveals results. Organizers: Demo order, Organizer tools.');
      }
      res.statusCode = 200; headers(res, 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="faithtech-socal-hackathon-scores.csv"');
      return res.end(scoresCsv(rows, await fetchScores(env)));
    }
    await withSettings();
    const q = (k) => url.searchParams.get(k);
    const deleted = q('deleted');
    let view = q('view');
    if (!VIEWS.some(([v]) => v === view)) view = opts.lock ? 'score' : 'shortlist';
    res.statusCode = 200; headers(res, 'text/html; charset=utf-8');
    if (view === 'results') {
      const [scores, votes] = await Promise.all([fetchScores(env), fetchVotes(env)]);
      return res.end(results(rows, scores, votes, opts, ''));
    }
    if (view === 'order') {
      const [votes, scores] = await Promise.all([fetchVotes(env), fetchScores(env)]);
      const set = parseN(q('set'));
      const n = (k) => Number.parseInt(q(k), 10) || 0;
      const notice = deleted === 'vote' ? 'Deleted one vote.' + (opts.lock ? ' The locked running order does not change.' :
        ' The running order below is recalculated.') :
        deleted === 'score' ? 'Deleted one score.' :
        deleted === 'team' ? 'Deleted \u201c' + String(q('name') || '').slice(0, 120) + '\u201d (' + plural(n('versions'), 'version') + '), ' +
          plural(n('votes'), 'vote') + ' and ' + plural(n('scores'), 'score') + '.' :
        deleted === 'none' ? 'That submission was already gone. Nothing was changed.' :
        set ? 'Finalists set to ' + set + ' for Demo order, Score and Results.' :
        q('locked') ? 'Voting closed. The finalists below are locked in this order.' :
        q('unlocked') ? 'Voting reopened. The running order can change again.' :
        q('revealed') ? 'Results revealed: per-judge scores and notes now show on Results and in the Scores CSV.' :
        q('unrevealed') ? 'Results hidden again: per-judge scores and notes are private.' :
        q('notice') === 'count-locked' ? 'The finalists are locked, so the count did not change. Reopen voting first.' : '';
      return res.end(order(rows, votes, opts, scores, notice));
    }
    if (view === 'score') return res.end(score(rows, await fetchVotes(env), opts));
    return res.end(shortlist(rows, opts, format === 'csv' ? 'The submissions CSV needs the admin key: Demo order, Organizer tools.' : ''));
  } catch (e) {
    console.error('[impact-lab-submissions] ' + e.message);
    if (req.method === 'POST' || /\.json$/.test(url.searchParams.get('format') || '')) {
      return json(res, 502, { ok: false, message: 'The database did not answer. Tap again in a moment.' });
    }
    res.statusCode = 502; headers(res, 'text/html; charset=utf-8');
    return res.end(shell('Could not load', '<h1 class="h2">Could not load the judges page</h1><p class="prose">' +
      'The database did not answer. Refresh in a minute.</p>'));
  }
};
module.exports.csv = csv;
module.exports.scoresCsv = scoresCsv;
module.exports.markLatest = markLatest;
module.exports.validateScore = validateScore;
module.exports.validateVote = validateVote;
module.exports.weighted = weighted;
module.exports.leaderboard = leaderboard;
module.exports.finalists = finalists;
module.exports.nextTeam = nextTeam;
module.exports.lineup = lineup;
module.exports.TIE_RULE = TIE_RULE;
module.exports.JUDGES = JUDGES;
module.exports._FAILS = FAILS;
