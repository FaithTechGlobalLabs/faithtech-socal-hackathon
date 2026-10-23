# How Baptize The World works today

What exists now, so you build on it instead of guessing. Checked against the Baptize platform code on Oct 23, 2026.

## There is no API you can call today

Baptize has no public API, no sandbox and no test keys. **Mock every Baptize call** and use the test data in each track folder. Build your piece so a real connection could be swapped in later: one function per action (register a church, save a count, save a story), with the mock behind it.

## The platform

| Layer | What Baptize uses |
|---|---|
| App | Next.js and React, TypeScript, in a monorepo |
| Database | PostgreSQL on Supabase (Prisma) |
| Hosting | Vercel |
| Sign-in | Supabase (email code or magic link) |
| Text messages (SMS) | Clearstream |
| Email | Loops |
| Maps | Leaflet with OpenStreetMap |
| Languages | English, Spanish, Portuguese, French |

You don't have to use this stack. "Could it fit into Baptize's tech stack?" is part of the Technical viability score, so it helps to say how your piece would plug in.

## Registering a church (Track 1)

- **Today it is a web form only.** You can't register a church by text or WhatsApp yet. That is the gap Track 1 is about.
- The host gives: their name, email and mobile number; church name; country; language; consent to host and to data processing. Optional: text and WhatsApp opt-in and a preferred channel.
- They confirm with a 6-digit code sent by email or text, then sign in and add locations, service times and the event type (at the church, outdoor or regional).
- WhatsApp is stored as a preference only. Nothing sends WhatsApp messages yet.

## Reporting baptisms (Track 1)

- A signed-in church reports a count per location in the web dashboard. A count must be a whole number from 0 to 10,000, and every change is kept as a revision.
- Churches also get a text asking for their count. Replies are read automatically (numbers, number words, "Irvine 18, SJC 24" for several sites), but **a person on the Baptize team confirms each texted count before it counts**. STOP opts out.
- Unknown phone numbers are held, not counted.

## Testimonies (Track 2)

- Testimonies exist only as stories the Baptize team adds and features by hand (quote, name, church, photo or video).
- **There is no way for a newly baptized person to share their own story yet.** The "Share your story" card on the next-steps page is a placeholder.

## After baptism (Track 3)

- People sign up at "Get baptized" with their name, email, phone and location, and confirm they are 16 or older.
- Baptize tracks each person's status (registered, confirmed, attended, baptized) and their church.
- The next-steps page has three static cards: connect with a church, read the Bible starting with John, share your story. It is in English only.
- Follow-up today is email only. **There is no 30-day journey and nothing by text or WhatsApp.**

## Data rules

Test data only. Never copy a real church, pastor, phone number or story into your project. See the [ground rules](ground-rules.md).
