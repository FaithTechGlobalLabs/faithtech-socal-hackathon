# Track 1 (top focus): Mobile-first church onboarding
**How might we let a pastor anywhere register their church and report baptisms from the phone they already use, in their own language, so every baptism on Pentecost 2027 gets counted?**

**Short version:** How might we make registering a church and reporting baptisms as easy as sending a text?

**Who it's for:** AI and agent builders, backend, messaging and telephony APIs, internationalization

Pastors in Peru, Brazil and across Asia run their ministries on WhatsApp, not web forms. Registering a church still means a web form, often in a second language, so many never finish. Texting already works: on Pentecost 2026 churches texted in their baptism counts, and when churches were asked to reply "yes" by text, response beat the email-and-form flow by a wide margin. Registration is the step still stuck on a form, and 2027 brings networks of hundreds of pastors in Peru alone, more than the Baptize team can message by hand. This is Baptize The World's highest priority for 2027.

**Angles a team can take**
- How might we onboard a church in one conversation, in the pastor's language, on a weak 2G/3G connection?
- How might we keep the numbers trustworthy when anyone can text in a count?
- How might we reach pastors who don't use WhatsApp?

**Done at 6 PM looks like:** a judge texts a number from their own phone. The agent answers in their language, collects church name, pastor name, email and location, confirms back, and the church appears on a live dashboard within seconds. The same number then texts a baptism count and the dashboard total moves.

**Must also:** reject bad submissions (duplicates, non-numbers, impossible counts) and get the pastor's opt-in before sending anything. The movement reports on these numbers, so a flow that accepts anything is worse than the form it replaces.

---

## Test data

- [`test-data/churches.csv`](test-data/churches.csv): 12 made-up churches in Peru, Brazil, the Philippines and the US, with language and connection quality.
- [`test-data/sample-messages.md`](test-data/sample-messages.md): realistic inbound texts, including messy and invalid ones your flow must handle.

## Good questions for the Baptize team

- What does a pastor need to give us, at minimum, for a church to count?
- What makes a baptism count suspicious?
- Which languages matter most for 2027?

Rules for every track: [ground rules](../../docs/ground-rules.md).
