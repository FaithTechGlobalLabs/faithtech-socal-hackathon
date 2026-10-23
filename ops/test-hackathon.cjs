'use strict';
// FaithTech SoCal Create Hackathon: submit endpoint and judges views, Supabase faked at fetch.
// Run: node --test ops/test-hackathon.cjs
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');

process.env.SUPABASE_URL = 'https://fake.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.IMPACT_LAB_LOCK_DELAY_MS = '0';
process.env.IMPACT_LAB_ADMIN_KEY = 'adminsecret99';
process.env.IMPACT_LAB_ORGANIZER_KEY = 'orgsecret99';
process.env.JUDGES_KEY = 'judgesecret99';
process.env.EDIT_CODE_SECRET = 'editsecret99';
process.env.EVENT_SLUG = 'faithtech-socal-2026-10-24-test';
const submit = require('../api/impact-lab-submit.js');
const view = require('../api/impact-lab-submissions.js');

let rows = [];
let scores = [];
let votes = [];
let settings = [];
/* The PostgREST filters the endpoints send (eq. and in.(…)), applied to a fake row. */
function where(u) {
  const tests = [];
  for (const [k, v] of u.searchParams) {
    if (['select', 'order', 'on_conflict'].includes(k)) continue;
    const val = (r) => (k === 'judge_name_lower' ? String(r.judge_name).toLowerCase() : r[k]);
    if (k === 'event_slug') tests.push((r) => r.event_slug === undefined || 'eq.' + r.event_slug === v);
    else if (v.startsWith('eq.')) tests.push((r) => String(val(r)) === v.slice(3));
    else if (v.startsWith('in.(')) { const set = v.slice(4, -1).split(',').map(decodeURIComponent); tests.push((r) => set.includes(String(val(r)))); }
  }
  return (r) => tests.every((t) => t(r));
}
/* DELETE with the filters; returns [kept, response]. */
function del(list, u, opts) {
  const hit = where(u);
  const gone = list.filter(hit);
  const kept = list.filter((r) => !hit(r));
  const body = /return=representation/.test((opts.headers || {}).Prefer || '') ? JSON.stringify(gone.map((r) => ({ id: r.id }))) : null;
  return [kept, new Response(body, { status: body ? 200 : 204 })];
}
global.fetch = async (url, opts = {}) => {
  const u = new URL(url);
  if (u.pathname.endsWith('/impact_lab_settings')) {
    if (settings === null) return new Response('{"message":"relation does not exist"}', { status: 404 });
    if (opts.method === 'POST') {
      assert.strictEqual(u.searchParams.get('on_conflict'), 'event_slug');
      const row = JSON.parse(opts.body)[0];
      const old = settings.find((r) => r.event_slug === row.event_slug) || {};
      settings = settings.filter((r) => r.event_slug !== row.event_slug).concat([{ ...old, ...row }]);
      return new Response(null, { status: 201 });
    }
    if (opts.method === 'PATCH') { const patch = JSON.parse(opts.body); settings = settings.map((r) => ({ ...r, ...patch })); return new Response(null, { status: 204 }); }
    assert.strictEqual(u.searchParams.get('event_slug'), 'eq.faithtech-socal-2026-10-24-test');
    return new Response(JSON.stringify(settings), { status: 200 });
  }
  if (u.pathname.endsWith('/impact_lab_votes')) {
    if (opts.method === 'POST') {
      assert.strictEqual(u.searchParams.get('on_conflict'), 'event_slug,judge_name_lower,team_key');
      const row = JSON.parse(opts.body)[0];
      const i = votes.findIndex((v) => v.team_key === row.team_key && v.judge_name.toLowerCase() === row.judge_name.toLowerCase());
      if (i >= 0) votes[i] = { ...votes[i], ...row };
      else votes.push({ ...row, id: '33333333-3333-4333-8333-' + String(votes.length + Math.floor(Math.random() * 1e6)).padStart(12, '0'), created_at: new Date().toISOString() });
      return new Response(null, { status: 201 });
    }
    if (opts.method === 'DELETE') {
      assert.strictEqual(u.searchParams.get('event_slug'), 'eq.faithtech-socal-2026-10-24-test');
      let res; [votes, res] = del(votes, u, opts); return res;
    }
    if (opts.method === 'PATCH') {
      assert.strictEqual(u.searchParams.get('event_slug'), 'eq.faithtech-socal-2026-10-24-test');
      const patch = JSON.parse(opts.body);
      const hit = where(u);
      votes = votes.map((v) => (hit(v) ? { ...v, ...patch } : v));
      return new Response(null, { status: 204 });
    }
    // Reads return only the selected columns, as PostgREST does.
    const cols = (u.searchParams.get('select') || '*').split(',');
    const pick = (v) => (cols[0] === '*' ? v : Object.fromEntries(cols.filter((c) => c in v).map((c) => [c, v[c]])));
    return new Response(JSON.stringify(votes.map(pick)), { status: 200 });
  }
  if (u.pathname.endsWith('/impact_lab_scores')) {
    if (opts.method === 'POST') {
      assert.strictEqual(u.searchParams.get('on_conflict'), 'event_slug,judge_name_lower,team_key');
      assert.match(opts.headers.Prefer, /resolution=merge-duplicates/);
      const row = JSON.parse(opts.body)[0];
      let i = scores.findIndex((s) => s.event_slug === row.event_slug && s.team_key === row.team_key &&
        s.judge_name.toLowerCase() === row.judge_name.toLowerCase());
      if (i >= 0) scores[i] = { ...scores[i], ...row };
      else { scores.push({ ...row, id: '22222222-2222-4222-8222-' + String(scores.length + Math.floor(Math.random() * 1e6)).padStart(12, '0'), created_at: row.updated_at }); i = scores.length - 1; }
      return new Response(JSON.stringify([scores[i]]), { status: 201 });
    }
    if (opts.method === 'DELETE') { let res; [scores, res] = del(scores, u, opts); return res; }
    if (opts.method === 'PATCH') { const patch = JSON.parse(opts.body); const hit = where(u); scores = scores.map((x) => (hit(x) ? { ...x, ...patch } : x)); return new Response(null, { status: 204 }); }
    return new Response(JSON.stringify(scores.filter(where(u))), { status: 200 });
  }
  if (opts.method === 'POST') {
    const row = { ...JSON.parse(opts.body)[0], id: '11111111-1111-4111-8111-' + String(rows.length + Math.floor(Math.random() * 1e6)).padStart(12, '0'),
      created_at: new Date(Date.UTC(2026, 9, 17, 22, rows.length)).toISOString() };
    rows.push(row);
    return new Response(JSON.stringify([row]), { status: 201 });
  }
  if (opts.method === 'DELETE') { let res; [rows, res] = del(rows, u, opts); return res; }
  if (opts.method === 'PATCH') { const patch = JSON.parse(opts.body); const hit = where(u); rows = rows.map((x) => (hit(x) ? { ...x, ...patch } : x)); return new Response(null, { status: 204 }); }
  return new Response(JSON.stringify(rows), { status: 200 });
};

function call(handler, { method = 'POST', url = '/', body, headers: extra = {} } = {}) {
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
  Object.assign(req, { method, url, headers: { accept: 'application/json', 'content-type': 'application/json', ...extra },
    socket: { remoteAddress: '10.0.0.1' } });
  return new Promise((resolve) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(b) { resolve({ status: this.statusCode, headers: this.headers, body: String(b || '') }); } };
    handler(req, res);
  });
}


const V = '/judges';
const good = { team_name: 'Team A', challenge: '1', one_liner: 'A pastor onboarding a new church member on a phone',
  what_it_does: 'Walks a new believer through first steps.', repo_url: 'https://github.com/a/b',
  live_demo_url: 'https://a.example.com', members: 'Ada Lovelace\nGrace Hopper', contact_name: 'Ada Lovelace',
  contact_email: 'Ada@Example.com' };
const JH = { 'x-judges-key': 'judgesecret99' };
const get = (q) => call(view, { method: 'GET', url: V + (q || ''), headers: JH });
const post = (body) => call(view, { body, headers: JH });
const scoreBody = (o) => ({ action: 'score', judge: 'Travis', team: 'team a', impact: 5, product: 4, demo: 3, note: '', ...o });

test('submit: stores under EVENT_SLUG, names the track, a repo must be a real GitHub link', async () => {
  const r = await call(submit, { body: good });
  assert.strictEqual(r.status, 200, r.body);
  assert.match(JSON.parse(r.body).message, /Track 1 \(Mobile-first church onboarding\)/);
  assert.strictEqual(rows[0].event_slug, 'faithtech-socal-2026-10-24-test');
  assert.strictEqual(submit.EVENT_SLUG, 'faithtech-socal-2026-10-24-test');
  assert.deepStrictEqual(Object.values(submit.CHALLENGES), ['Mobile-first church onboarding', 'Testimony sharing', 'The first 30 days']);
  for (const bad of ['https://gitlab.com/a/b', 'https://github.com', 'https://github.com/onlyowner']) {
    const x = await call(submit, { body: { ...good, team_name: 'Bad', repo_url: bad } });
    assert.strictEqual(x.status, 400, bad);
    assert.ok(JSON.parse(x.body).errors.some((e) => e.field === 'repo_url'), bad);
  }
  assert.strictEqual((await call(submit, { body: { ...good, team_name: 'T4', challenge: '4' } })).status, 400);
  const ok = await call(submit, { body: { ...good, team_name: 'NoDemo', live_demo_url: '' } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(rows.find((x) => x.team_name === 'NoDemo').live_demo_url, null);
  rows = rows.filter((x) => x.team_name === 'Team A');
});

test('submit: a taken name needs the edit code; the code fetches and edits; email is not a credential', async () => {
  const first = rows.find((x) => x.team_name === 'Team A');
  assert.ok(first);
  const x = await call(submit, { body: { ...good, what_it_does: 'Hijacked' } });
  assert.strictEqual(x.status, 409, 'same name, same email, no code');
  const code = JSON.parse((await call(submit, { body: { action: 'fetch', edit_code: 'nope' } })).body);
  assert.strictEqual(code.ok, false);
  assert.strictEqual((await call(submit, { body: { action: 'fetch', edit_code: 'ada@example.com' } })).status, 404);
  const forged = await call(submit, { body: { action: 'fetch', edit_code: 'team a.00000000000000000000000000000000' } });
  assert.strictEqual(forged.status, 404);
  // A fresh save returns the code on the receipt; the code prefills and edits.
  const fresh = JSON.parse((await call(submit, { body: { ...good, team_name: 'Team Code', contact_email: 'c@example.com' } })).body);
  assert.ok(fresh.edit_code && fresh.edit_code.startsWith('team code.'), fresh.edit_code);
  const f = JSON.parse((await call(submit, { body: { action: 'fetch', edit_code: fresh.edit_code } })).body);
  assert.strictEqual(f.team.team_name, 'Team Code');
  const e = await call(submit, { body: { ...good, team_name: 'Team Code', what_it_does: 'v2', edit_code: fresh.edit_code } });
  assert.strictEqual(e.status, 200, e.body);
  assert.strictEqual(JSON.parse(e.body).updated, true);
  rows = rows.filter((r) => r.team_name === 'Team A');
});

test('submit: a GitHub repo OR a link is enough; neither is refused; video is stored', async () => {
  const linkOnly = await call(submit, { body: { ...good, team_name: 'No Repo Team', repo_url: '', live_demo_url: 'https://www.figma.com/proto/abc',
    demo_video_url: 'https://youtu.be/xyz', contact_email: 'nr@example.com' } });
  assert.strictEqual(linkOnly.status, 200, linkOnly.body);
  const row = rows.find((x) => x.team_name === 'No Repo Team');
  assert.strictEqual(row.repo_url, '', 'no repo is stored as empty string (column is NOT NULL)');
  assert.strictEqual(row.demo_video_url, 'https://youtu.be/xyz');
  const neither = await call(submit, { body: { ...good, team_name: 'Nothing Team', repo_url: '', live_demo_url: '' } });
  assert.strictEqual(neither.status, 400);
  const fields = JSON.parse(neither.body).errors.map((e) => e.field);
  assert.ok(fields.includes('repo_url') && fields.includes('live_demo_url'), fields.join());
  const repoOnly = await call(submit, { body: { ...good, team_name: 'Repo Only', live_demo_url: '', contact_email: 'ro@example.com' } });
  assert.strictEqual(repoOnly.status, 200, repoOnly.body);
  const v = await get('?view=shortlist');
  assert.match(v.body, /No Repo Team/);
  assert.match(v.body, /youtu\.be\/xyz/);
  rows = rows.filter((x) => x.team_name === 'Team A');
});

test('weights are 40/30/30 and 5/4/3 is exactly 4.1', () => {
  assert.strictEqual(view.weighted({ impact: 5, product: 4, demo: 3 }), 4.1);
  assert.strictEqual(view.weighted({ impact: 5, product: 5, demo: 5 }), 5);
  assert.strictEqual(view.weighted({ impact: 1, product: 1, demo: 1 }), 1);
  assert.strictEqual(view.validateScore(scoreBody({ demo: undefined })).ok, false);
  assert.strictEqual(view.validateScore(scoreBody({ impact: 6 })).ok, false);
  assert.deepStrictEqual(view.AREAS.map((a) => a[2]), [40, 30, 30]);
  assert.strictEqual(view.validateScore(scoreBody()).ok, true);
  assert.deepStrictEqual(view.JUDGES, ['Travis', 'Dana', 'Holly', 'Pastor Calin', 'Jesse']);
});

test('judges pages are branded for the hackathon and carry no Impact Lab or Claude copy', async () => {
  for (const q of ['', '?view=shortlist', '?view=order', '?view=order&present=1', '?view=score', '?view=results']) {
    const r = await get(q);
    assert.strictEqual(r.status, 200, q);
    assert.match(r.body, /FaithTech SoCal Create Hackathon/, q);
    assert.doesNotMatch(r.body, /Impact Lab|OC Claude|Claude SoCal|meet\.google|claudesocal|Illumination/i, q);
    assert.match(r.body, /href="\/judges\.css/, q);
    assert.doesNotMatch(r.body, /ada@example\.com/i, 'no contact email on the open page');
  }
  const score = await get('?view=score');
  for (const t of ['Redemptive potential', 'Usable by the end user', 'Technical viability']) {
    assert.ok(score.body.includes(t), t);
  }
  assert.match((await get('?view=shortlist')).body, /Mobile-first church onboarding/);
});

test('shortlist, lock, score, results: Most Redemptive is the top weighted score', async () => {
  await call(submit, { body: { ...good, team_name: 'Team B', challenge: '2', contact_email: 'b@example.com' } });
  for (const j of ['Travis', 'Dana']) for (const t of ['team a', 'team b']) {
    const r = await post({ action: 'vote', judge: j, team: t, on: true }); assert.strictEqual(r.status, 200, r.body);
  }
  const lock = await post({ action: 'lock', admin: 'orgsecret99', confirm: '1' });
  assert.strictEqual(lock.status, 303);
  assert.match((await get('?view=order')).body, /Finalists locked/);
  assert.strictEqual((await post({ action: 'vote', judge: 'Jesse', team: 'team a', on: true })).status, 409);
  for (const j of ['Travis', 'Dana']) {
    assert.strictEqual((await post(scoreBody({ judge: j }))).status, 200);
    assert.strictEqual((await post(scoreBody({ judge: j, team: 'team b', impact: 3, product: 3, demo: 3, note: 'ok' }))).status, 200);
  }
  // notes are stored as typed (no legacy [c4:N] prefix)
  assert.strictEqual(scores[0].note, null);
  const mine = JSON.parse((await get('?format=scores.json&judge=Travis')).body).scores;
  const a = mine.find((x) => x.team_key === 'team a');
  assert.strictEqual(a.demo, 3);
  assert.ok(!('care' in a));
  assert.strictEqual(a.note, null);
  assert.strictEqual(mine.find((x) => x.team_key === 'team b').note, 'ok');
  const res = (await get('?view=results')).body;
  assert.match(res, /Most Redemptive[\s\S]*Team A[\s\S]*4\.10?/);
  assert.match(res, /40% redemptive potential \+ 30% usable by the end user \+ 30% technical viability/);
  assert.match(res, /Scores private|private/i);
});

test('organizer keys: tools need the typed key, nothing ships in a public page, CSV needs the admin key', async () => {
  const pub = (await get('?view=order')).body;
  assert.ok(!pub.includes('orgsecret99') && !pub.includes('adminsecret99'), 'no key in a public page');
  assert.match(pub, /type="password"/);
  assert.strictEqual((await post({ action: 'tools', admin: 'wrong' })).status, 403);
  assert.strictEqual((await post({ action: 'tools', admin: '' })).status, 403);
  const tools = await post({ action: 'tools', admin: 'orgsecret99' });
  assert.strictEqual(tools.status, 200);
  assert.match(tools.body, /Organizer tools/);
  assert.strictEqual((await post({ action: 'csv', admin: 'orgsecret99' })).status, 403);
  const csv = await post({ action: 'csv', admin: 'adminsecret99' });
  assert.strictEqual(csv.status, 200);
  assert.match(csv.body, /contact_email/);
  assert.strictEqual((await post({ action: 'reveal', admin: 'orgsecret99', confirm: '1' })).status, 303);
  const sc = await get('?format=scores.csv');
  assert.strictEqual(sc.status, 200);
  assert.match(sc.body, /redemptive_potential,usable_by_end_user,technical_viability,weighted/);
  assert.match(sc.body, /4\.10/);
});

test('judges key: no key is 401 on writes and data reads; the link sets a cookie; cookie works', async () => {
  const bare = (o) => call(view, o);
  assert.strictEqual((await bare({ body: scoreBody() })).status, 401);
  assert.strictEqual((await bare({ body: { action: 'vote', judge: 'Travis', team: 'team a', on: true } })).status, 401);
  for (const q of ['?format=scores.json', '?format=votes.json', '?format=scores.csv', '?view=results', '']) {
    const r = await bare({ method: 'GET', url: V + q });
    assert.strictEqual(r.status, 401, q);
    assert.doesNotMatch(r.body, /Team A/, q);
  }
  assert.strictEqual((await call(view, { method: 'GET', url: V + '?format=scores.json', headers: { 'x-judges-key': 'wrong' } })).status, 401);
  const link = await bare({ method: 'GET', url: V + '?key=judgesecret99&view=score' });
  assert.strictEqual(link.status, 303);
  assert.strictEqual(link.headers.location, '/judges?view=score');
  assert.match(link.headers['set-cookie'], /HttpOnly; Secure; SameSite=Lax/);
  const viaCookie = await call(view, { method: 'GET', url: V + '?format=votes.json', headers: { cookie: 'jk=judgesecret99' } });
  assert.strictEqual(viaCookie.status, 200);
  assert.strictEqual((await bare({ method: 'GET', url: V + '?key=nope' })).status, 401);
});
