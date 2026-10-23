// QA for the edit-code change. Runs the real submit handler against an in-memory
// fake of Supabase. Not part of the deployed site. Run: node _qa/edit-code-test.js
'use strict';
const path = require('path');
const lib = require(path.join(__dirname, '..', 'api', '_lib.js'));
const handler = require(path.join(__dirname, '..', 'api', 'impact-lab-submit.js'));

const rows = [];
let seq = 0;
process.env.EDIT_CODE_SECRET = 'test-secret-not-real';

lib.readEnv = () => ({ env: { SUPABASE_URL: 'http://fake', SUPABASE_SERVICE_ROLE_KEY: 'k', EDIT_CODE_SECRET: 'test-secret-not-real', FORM_IP_SALT: 'salt' }, missing: [] });
// GET returns all rows. PATCH on impact_lab_submissions?id=in.(..) renames those rows,
// as carryRename does in production. Votes/scores/settings PATCHes are no-ops here.
lib.boundedFetch = async (url, opts = {}) => {
  if (opts.method === 'PATCH') {
    const m = /id=in\.\(([^)]*)\)/.exec(url);
    if (m) { const ids = m[1].split(',').map(Number); const body = JSON.parse(opts.body);
      rows.forEach((r) => { if (ids.includes(r.id)) Object.assign(r, body); }); }
    return { ok: true, json: async () => [] };
  }
  return { ok: true, json: async () => rows.slice() };
};
lib.insertRow = async (env, table, row) => { const r = { ...row, id: ++seq, created_at: new Date(1e12 + seq).toISOString() }; rows.push(r); return r; };
lib.readBody = async (req) => req.body;

// Every reply goes through lib.respond; capture it as JSON with its status.

lib.respond = (rq, rs, status, payload) => { rs.statusCode = status; rs.end(JSON.stringify(payload)); };

function call(body) {
  return new Promise((resolve) => {
    const req = { method: 'POST', headers: { accept: 'application/json', 'user-agent': 'qa' }, socket: { remoteAddress: '10.0.0.' + (++seq % 200) }, body: { ts: '1', js: '1', ...body } };
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(s) { resolve({ status: this.statusCode, json: s ? JSON.parse(s) : null }); } };
    handler(req, res).catch((e) => resolve({ status: 'THREW', err: e.stack }));
  });
}

const base = { team_name: 'Riverside Builders', challenge: '1', one_liner: 'Pastors in Lagos', what_it_does: 'Registers a church by text.',
  repo_url: 'https://github.com/riverside/app', members: 'Ann\nBen', contact_name: 'Ann', contact_email: 'ann@example.com' };

let fails = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  ' + JSON.stringify(detail))); if (!cond) fails++; }

(async () => {
  // 1. New team gets an edit code.
  const a = await call(base);
  check('new submit ok', a.status === 200 && a.json.ok, a);
  const code = a.json && a.json.edit_code;
  check('receipt carries edit_code', typeof code === 'string' && code.startsWith('riverside builders.'), code);
  check('receipt has no team_key or contact_email', !('team_key' in a.json) && !('contact_email' in a.json), a.json);

  // 2. Email alone cannot fetch the team.
  const f1 = await call({ action: 'fetch', edit_code: 'ann@example.com' });
  check('fetch with email refused', f1.status === 404 && !f1.json.team, f1);

  // 3. A made-up code for a real team name is refused.
  const f2 = await call({ action: 'fetch', edit_code: 'riverside builders.00000000000000000000000000000000' });
  check('forged code refused', f2.status === 404 && !f2.json.team, f2);

  // 4. Real code returns the team's fields.
  const f3 = await call({ action: 'fetch', edit_code: code });
  check('real code fetches team', f3.status === 200 && f3.json.team && f3.json.team.contact_email === 'ann@example.com', f3);

  // 5. Plain submit under taken name, with the right email but no code: refused.
  const t1 = await call({ ...base, what_it_does: 'Hijacked text' });
  check('same-name submit without code refused (409)', t1.status === 409, t1);
  check('row count unchanged after refused takeover', rows.length === 1, rows.length);

  // 6. Edit with a valid code saves a new version and returns a fresh code.
  const e1 = await call({ ...base, what_it_does: 'Version two.', edit_code: code });
  check('edit with valid code saves (200)', e1.status === 200 && e1.json.updated === true, e1);
  check('edit returns same-team code', e1.json && e1.json.edit_code === code, e1.json && e1.json.edit_code);

  // 7. Forged code on an edit is refused and writes nothing.
  const before = rows.length;
  const e2 = await call({ ...base, what_it_does: 'Forged', edit_code: 'riverside builders.00000000000000000000000000000000' });
  check('forged code on save refused (409 or 403)', e2.status === 409 || e2.status === 403, e2);
  check('forged save wrote no row', rows.length === before, rows.length);

  // 8. Rename with a valid code moves the team; old code stops working, new code works.
  const r1 = await call({ ...base, team_name: 'Riverside Crew', edit_code: code });
  check('rename with valid code ok', r1.status === 200, r1);
  const newCode = r1.json && r1.json.edit_code;
  const oldFetch = await call({ action: 'fetch', edit_code: code });
  check('old code dead after rename', oldFetch.status === 404, oldFetch);
  const newFetch = await call({ action: 'fetch', edit_code: newCode });
  check('new code fetches renamed team', newFetch.status === 200 && newFetch.json.team.team_name === 'Riverside Crew', newFetch);

  // 9. Garbage inputs do not throw.
  for (const bad of [undefined, '', '.', 'nodot', 12345]) {
    const g = await call({ action: 'fetch', edit_code: bad });
    check('garbage code ' + JSON.stringify(bad) + ' is a clean 404', g.status === 404, g);
  }

  console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
