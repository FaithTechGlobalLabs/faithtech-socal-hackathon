/* Submission form for the FaithTech SoCal Create Hackathon hub.
   Renders into <div id="submit-form"></div> and posts JSON to
   /api/impact-lab-submit. Every save is a new version; judges see the newest.
   Editing: the receipt shows an edit code. "Edit your submission" takes that
   code, fetches the team's fields, and saves with edit_code. Email is never a
   credential. */
(function () {
  'use strict';
  var root = document.getElementById('submit-form');
  if (!root) return;
  var API = '/api/impact-lab-submit';
  var TRACKS = [
    ['1', 'Mobile-first church onboarding'],
    ['2', 'Testimony sharing'],
    ['3', 'The first 30 days']
  ];

  var css = document.createElement('style');
  css.textContent =
    '#submit-form .sf{max-width:640px}' +
    '#submit-form label,#submit-form legend{display:block;font-weight:600;margin:18px 0 6px;padding:0}' +
    '#submit-form .opt{font-weight:400;color:#B3AEA3}' +
    '#submit-form .help{font-size:14.5px;color:#B3AEA3;margin:0 0 6px}' +
    '#submit-form input[type=text],#submit-form input[type=email],#submit-form input[type=url],#submit-form textarea{' +
      'display:block;width:100%;min-height:48px;padding:11px 12px;font:inherit;color:inherit;background:#1f1f15;' +
      'border:1px solid #5a5a48;border-radius:10px}' +
    '#submit-form textarea{min-height:110px;resize:vertical}' +
    '#submit-form input:focus,#submit-form textarea:focus{outline:3px solid #FFD700;outline-offset:2px}' +
    '#submit-form [aria-invalid=true]{border-color:#ff8a7a}' +
    '#submit-form fieldset{border:0;margin:0;padding:0}' +
    '#submit-form .tr{display:flex;gap:10px;align-items:flex-start;margin:6px 0;padding:10px 12px;border:1px solid #38382c;border-radius:10px;background:#1f1f15;font-weight:400;cursor:pointer}' +
    '#submit-form .tr input{margin:4px 0 0;flex:none;width:18px;height:18px;accent-color:#FFD700}' +
    '#submit-form .err{color:#ff8a7a;font-size:14.5px;margin:6px 0 0}' +
    '#submit-form button{min-height:48px;padding:0 22px;border-radius:10px;border:0;background:#FFD700;color:#16160C;font:inherit;font-weight:700;cursor:pointer}' +
    '#submit-form button.ghost{background:transparent;color:inherit;border:1px solid #5a5a48}' +
    '#submit-form button:disabled{opacity:.6;cursor:default}' +
    '#submit-form .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px;align-items:center}' +
    '#submit-form .box{margin:18px 0;padding:14px 16px;border:1px solid #38382c;border-radius:12px;background:#1f1f15}' +
    '#submit-form .note{margin:14px 0 0;min-height:1.4em}' +
    '#submit-form [hidden]{display:none!important}' +
    '#submit-form .hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}';
  document.head.appendChild(css);

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { e.appendChild(c); });
    return e;
  }
  function field(name, label, opts) {
    opts = opts || {};
    var id = 'sf-' + name;
    var lab = el('label', { 'for': id, text: label });
    if (opts.optional) lab.appendChild(el('span', { 'class': 'opt', text: ' (optional)' }));
    var input = opts.area ? el('textarea', { id: id, name: name, rows: String(opts.rows || 4) })
      : el('input', { id: id, name: name, type: opts.type || 'text' });
    if (opts.max) input.setAttribute('maxlength', String(opts.max));
    if (!opts.optional) input.setAttribute('required', '');
    if (opts.auto) input.setAttribute('autocomplete', opts.auto);
    if (opts.inputmode) input.setAttribute('inputmode', opts.inputmode);
    if (opts.placeholder) input.setAttribute('placeholder', opts.placeholder);
    var kids = [lab];
    if (opts.help) kids.push(el('p', { 'class': 'help', id: id + '-help', text: opts.help }));
    if (opts.help) input.setAttribute('aria-describedby', id + '-help');
    kids.push(input, el('p', { 'class': 'err', id: id + '-err', hidden: '', role: 'alert' }));
    var wrap = el('div', {}, kids);
    return wrap;
  }

  // ---- edit by code
  var find = el('form', { 'class': 'box', id: 'sf-find', novalidate: '' }, [
    el('p', { text: 'Already submitted? Paste the edit code from your receipt.' }),
    el('label', { 'for': 'sf-find-code', text: 'Edit code' }),
    el('input', { id: 'sf-find-code', type: 'text', autocomplete: 'off', spellcheck: 'false', required: '' }),
    el('div', { 'class': 'row' }, [el('button', { type: 'submit', 'class': 'ghost', text: 'Open my submission' })]),
    el('p', { 'class': 'note', id: 'sf-find-msg', role: 'status' })
  ]);
  var banner = el('div', { 'class': 'box', id: 'sf-editing', hidden: '' }, [
    el('p', {}, [document.createTextNode('Editing '), el('b'), document.createTextNode('. Save changes stores a new version; judges see the latest.')]),
    el('div', { 'class': 'row' }, [el('button', { type: 'button', 'class': 'ghost', id: 'sf-edit-cancel', text: 'Stop editing, start a new submission' })])
  ]);

  // ---- main form
  var tracks = el('fieldset', { id: 'sf-track' }, [el('legend', { text: 'Track' })]);
  TRACKS.forEach(function (t, i) {
    var lab = el('label', { 'class': 'tr' }, [
      el('input', { type: 'radio', name: 'challenge', value: t[0], required: '' }),
      el('span', { text: 'Track ' + t[0] + ' · ' + t[1] })
    ]);
    tracks.appendChild(lab);
  });
  tracks.appendChild(el('p', { 'class': 'err', id: 'sf-challenge-err', hidden: '', role: 'alert' }));

  var form = el('form', { 'class': 'sf', id: 'sf-form', action: API, method: 'post', novalidate: '' }, [
    field('team_name', 'Team name', { max: 120, auto: 'off' }),
    tracks,
    field('one_liner', 'Who it is for', { max: 200, help: 'One line. For example: a pastor in Lagos who registers a church by text.' }),
    field('what_it_does', 'What it does', { area: true, rows: 5, max: 1200, help: 'A few sentences. What a person can do with it today.' }),
    field('repo_url', 'Public GitHub repo link', { type: 'url', max: 500, inputmode: 'url', placeholder: 'https://github.com/your-team/your-repo',
      help: 'Must be public. We read it for stewardship, not IP.' }),
    field('live_demo_url', 'Demo video or live app link', { type: 'url', max: 500, inputmode: 'url', optional: true,
      help: 'Optional. Ask Claude to click through your prototype and record a walkthrough.' }),
    field('members', 'Team members', { area: true, rows: 4, max: 1000, help: 'One name per line, up to 10. Everyone has a role.' }),
    field('contact_name', 'Contact name', { max: 120, auto: 'name' }),
    field('contact_email', 'Contact email', { type: 'email', max: 254, auto: 'email', help: 'For organizers to reach your team.' }),
    el('div', { 'class': 'hp', 'aria-hidden': 'true' }, [
      el('label', { 'for': 'sf-company_website', text: 'Leave this empty' }),
      el('input', { id: 'sf-company_website', name: 'company_website', type: 'text', tabindex: '-1', autocomplete: 'off' })
    ]),
    el('input', { type: 'hidden', name: 'ts' }), el('input', { type: 'hidden', name: 'js' }),
    el('input', { type: 'hidden', name: 'edit_code' }),
    el('div', { 'class': 'row' }, [el('button', { type: 'submit', id: 'sf-submit', text: 'Submit' })]),
    el('p', { 'class': 'note', id: 'sf-notice', role: 'status', 'aria-live': 'polite' })
  ]);

  var done = el('div', { 'class': 'box', id: 'sf-done', hidden: '', tabindex: '-1' }, [
    el('h3', { id: 'sf-done-title' }), el('div', { id: 'sf-done-msg' }),
    el('div', { 'class': 'row' }, [el('button', { type: 'button', id: 'sf-again', text: 'Change something' })])
  ]);

  root.appendChild(find); root.appendChild(banner); root.appendChild(form); root.appendChild(done);

  var button = document.getElementById('sf-submit');
  var notice = document.getElementById('sf-notice');
  var NEW_LABEL = 'Submit', EDIT_LABEL = 'Save changes';
  function label() { return form.elements.edit_code.value ? EDIT_LABEL : NEW_LABEL; }
  function stamp() { form.elements.ts.value = String(Date.now()); form.elements.js.value = '1'; }
  stamp();

  function clearErrors() {
    root.querySelectorAll('.err').forEach(function (e) { e.hidden = true; e.textContent = ''; });
    root.querySelectorAll('[aria-invalid]').forEach(function (e) { e.removeAttribute('aria-invalid'); });
  }
  function showErrors(errors) {
    var first = null, by = {};
    (errors || []).forEach(function (e) { (by[e.field] = by[e.field] || []).push(e.message); });
    Object.keys(by).forEach(function (f) {
      var out = document.getElementById('sf-' + f + '-err');
      if (out) { out.textContent = by[f].join(' '); out.hidden = false; }
      var input = f === 'challenge' ? form.querySelector('input[name="challenge"]') : form.elements[f];
      if (input && input.setAttribute) { input.setAttribute('aria-invalid', 'true'); if (!first) first = input; }
    });
    if (first && first.focus) first.focus();
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (button.disabled) return;
    clearErrors();
    var data = {};
    Array.prototype.forEach.call(form.elements, function (e) {
      if (!e.name) return;
      if (e.type === 'radio') { if (e.checked) data[e.name] = e.value; return; }
      data[e.name] = e.value;
    });
    button.disabled = true; button.textContent = 'Submitting…'; notice.textContent = 'Submitting…';
    var timer;
    try {
      var controller = new AbortController();
      timer = setTimeout(function () { controller.abort(); }, 15000);
      var response = await fetch(API, { method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data) });
      var result = await response.json();
      if (response.ok && result.ok === true) {
        document.getElementById('sf-done-title').textContent = result.title;
        var msg = document.getElementById('sf-done-msg');
        msg.textContent = '';
        (Array.isArray(result.lines) ? result.lines : [result.message]).forEach(function (line) {
          msg.appendChild(el('p', { text: String(line) }));
        });
        if (result.edit_code) editing(result.edit_code, result.team_name);
        form.hidden = true; find.hidden = true; done.hidden = false; notice.textContent = '';
        done.scrollIntoView({ block: 'start' }); done.focus();
        return;
      }
      showErrors(result.errors);
      notice.textContent = (result.title ? result.title + '. ' : '') + (result.message || 'Please try again.');
    } catch (_) {
      notice.textContent = 'We could not confirm the submission. Check your connection and try again, or find an organizer.';
    } finally {
      clearTimeout(timer); button.disabled = false; button.textContent = label();
    }
  });

  document.getElementById('sf-again').addEventListener('click', function () {
    done.hidden = true; form.hidden = false; notice.textContent = ''; stamp();
    form.elements.team_name.focus();
  });

  function editing(code, name) {
    form.elements.edit_code.value = code || '';
    banner.hidden = !code; find.hidden = !!code;
    if (code) banner.querySelector('b').textContent = name || 'your team';
    button.textContent = label();
  }
  function fill(t, code) {
    ['team_name', 'one_liner', 'what_it_does', 'repo_url', 'live_demo_url', 'members', 'contact_name', 'contact_email'].forEach(function (k) {
      if (form.elements[k]) form.elements[k].value = t[k] || '';
    });
    var radio = form.querySelector('input[name="challenge"][value="' + t.challenge + '"]');
    if (radio) radio.checked = true;
    clearErrors(); done.hidden = true; form.hidden = false; notice.textContent = '';
    editing(code, t.team_name);
    form.elements.team_name.focus();
  }
  var findMsg = document.getElementById('sf-find-msg');
  find.addEventListener('submit', async function (event) {
    event.preventDefault();
    var code = document.getElementById('sf-find-code').value.trim();
    findMsg.textContent = 'Looking…';
    try {
      var r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ action: 'fetch', edit_code: code }) });
      var d = await r.json();
      if (!r.ok || !d.ok) { findMsg.textContent = (d.title ? d.title + '. ' : '') + (d.message || 'Try again.'); return; }
      findMsg.textContent = '';
      fill(d.team, d.edit_code);
    } catch (_) { findMsg.textContent = 'Could not open that submission. Check your connection and try again.'; }
  });
  document.getElementById('sf-edit-cancel').addEventListener('click', function () {
    form.reset(); editing('', ''); clearErrors(); notice.textContent = ''; stamp();
    form.elements.team_name.focus();
  });
})();
