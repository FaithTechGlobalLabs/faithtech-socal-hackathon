'use strict';
// Re-issue a team's edit code (the team lost its receipt).
// Usage: node ops/reissue-edit-code.cjs "Team Name"
// Reads EDIT_CODE_SECRET from ../organizer-keys-PRIVATE.txt (production secret).
// Same formula as api/impact-lab-submit.js: teamKey + '.' + HMAC(EVENT_SLUG|teamKey).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const name = process.argv[2];
if (!name) { console.error('Usage: node ops/reissue-edit-code.cjs "Team Name"'); process.exit(1); }
const keys = fs.readFileSync(path.join(__dirname, '..', '..', 'organizer-keys-PRIVATE.txt'), 'utf8');
const m = /^EDIT_CODE_SECRET=(.+)$/m.exec(keys);
if (!m) { console.error('EDIT_CODE_SECRET not found in organizer-keys-PRIVATE.txt'); process.exit(1); }
const slug = process.env.EVENT_SLUG || 'faithtech-socal-2026-10-24';
const key = name.replace(/[\p{Cf}ᅟᅠㅤﾠ⠀]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
console.log(key + '.' + crypto.createHmac('sha256', m[1].trim()).update(slug + '|' + key).digest('hex').slice(0, 32));
