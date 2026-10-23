# Organizer runbook: FaithTech SoCal Create Hackathon hub

Vercel project: `faithtech-socal-hackathon` (scope travcjohnsons-projects). Data: Supabase project
copnfjaxotrivqukqdlc, tables `impact_lab_*`, rows keyed by `event_slug`
(production `faithtech-socal-2026-10-24`, preview `faithtech-socal-2026-10-24-test`).

## Keys
All keys are in `../organizer-keys-PRIVATE.txt` (outside the repo, mode 600) and in Vercel env.

| Key | Use |
|---|---|
| `JUDGES_KEY` | Required for every judges page, vote, score and data read. |
| `IMPACT_LAB_ORGANIZER_KEY` | Typed into "Organizer tools" on Demo order: lock, reveal, count, deletes, scores CSV. |
| `IMPACT_LAB_ADMIN_KEY` | Submissions CSV (contains contact emails). Also works for everything the organizer key does. |
| `EDIT_CODE_SECRET` | Signs team edit codes (production). Only needed to re-issue a lost code. |

## URLs (replace HOST and KEY)
- Submit form: `https://HOST/#submit` (public).
- Judges link, give to judges only: `https://HOST/judges?key=<JUDGES_KEY>`. Opening it sets a cookie and strips the key from the URL. Without it /judges says "Judges link required" and writes return 401.
- Views: `/judges?view=shortlist`, `?view=order`, `?view=order&present=1` (projector), `?view=score`, `?view=results`.
- Judges tap their name once: Travis, Dana, Holly, Pastor Calin, Jesse (override with env `IMPACT_LAB_JUDGES`, comma list). Only these count.

## Flow
1. Shortlist (after 4:00 PM freeze): judges tap "Want to see this demo".
2. Demo order: finalists by votes, top 2 per track always in. Use Next team during demos.
3. Lock voting: Demo order, Organizer tools, type organizer key, "Close voting and lock finalists" (confirm). "Reopen voting" undoes it.
4. Score: 1 to 5 on Works live end to end 35%, Baptize would adopt it 30%, Usable by a non-technical pastor or new believer 20%, Built the way we said 15%.
5. Results: highest weighted average is Most Redemptive (needs 2 judges to place). Per-judge scores stay private until Organizer tools, "Reveal results". Most Creative and Most Collaborative are picked by hand.

## Lost edit code
Each save shows the team an edit code on its receipt; it is the only way to change a submission (email is not a credential).
If a team loses it: `node ops/reissue-edit-code.cjs "Team Name"` prints the code. Check who is asking first.

## CSV export
Organizer tools, "Submissions CSV (emails)" asks for the admin key. "Scores CSV (with notes)" works with the organizer key. After Reveal, `/judges?format=scores.csv` also works for judges.

## Notes
- The fourth score area ("Built the way we said") has no column in the shared table; it is stored as a `[c4:N] ` prefix in the score `note` and removed on read. Raw SQL on `impact_lab_scores.note` will show the prefix.
- Test: `npm test` (Supabase faked). Live check on a preview: `_qa/e2e-preview.sh https://<preview>.vercel.app` (writes `-test` rows; delete them after). Test rows use event_slug `...-test`; clean up with
  `delete from impact_lab_{votes,scores,submissions,settings} where event_slug='faithtech-socal-2026-10-24-test'`.
- Schema (already applied in the shared project): `ops/sql/`.
