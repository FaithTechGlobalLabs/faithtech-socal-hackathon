# Track 3 (stretch): The first 30 days
**How might we walk a newly baptized person through their first 30 days of following Jesus, on the phone they already use, so they keep growing and get rooted in a local church?**

**Short version:** How might we walk with someone through their first 30 days after baptism?

**Who it's for:** product and UX, messaging, content design, pastors and disciple-makers. This is the stretch track: the hardest of the three to get right in a day.

Baptism happens on one Sunday. What happens in the weeks after depends on whether anyone follows up. Today the platform's answer to "what now?" is a static Next Steps page with three links: find a church, read the Gospel of John, share your story. Nothing on the platform walks with the person after that day, and a church has no simple way to see who needs a call.

**Angles a team can take**
- How might we deliver one small next step a day, in their language, by text or WhatsApp?
- How might we let a local church see who's growing and who's gone quiet, so a real person follows up?
- How might we make it work for a church with no staff, no app and no budget?

**Done at 6 PM looks like:** a judge plays someone baptized that morning. They enroll by text or QR code in their language, get Day 1 on their phone, reply, and get the next step (fast-forward the days for the demo). Their church can see they're active, and can see who has gone quiet.

**Scope note:** this is a build track, not a curriculum track. Use a simple existing plan (the Next Steps page already points people to the Gospel of John) and spend the day on delivery and follow-up. Every message needs opt-in and an easy way to stop.

---

## How Baptize does it today

- People sign up at "Get baptized" (name, email, phone, location, 16 or older), and Baptize tracks their status through to baptized, plus their church.
- After that there are three static next-steps cards (connect with a church, read John, share your story), in English only. Follow-up is email only.
- **There is no 30-day journey and nothing by text or WhatsApp.** That's the gap.
- **There is no Baptize API to call.** Mock the save step and use the test data. Details: [How Baptize works today](../../docs/baptize-today.md).

## Test data

- [`test-data/30-day-outline.md`](test-data/30-day-outline.md): a simple plan built on the Gospel of John, which the Next Steps page already points to. Days 22 to 30 are left for your team or the local church.
- [`test-data/new-believers.csv`](test-data/new-believers.csv): made-up people baptized at made-up churches, with language and how they prefer to be reached.

## Good questions for the Baptize team

- Who at a local church would see the follow-up list, and how often?
- What does "gone quiet" mean: 3 days, a week?

Rules for every track: [ground rules](../../docs/ground-rules.md).
