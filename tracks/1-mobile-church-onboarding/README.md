# Track 1: Mobile-first church onboarding (primary focus)

> How might we help a pastor anywhere register their church, get resources and report baptisms
> from the phone they already use, on any connection and in their own language, so every baptism
> on Pentecost 2027 gets counted?

**Who it's for.** A pastor anywhere. In Peru, Brazil and across Asia, pastors run their ministries
on WhatsApp, not web forms.

**Today.** Registering a church means a web form, often in a second language, so many never
finish. Counts come in through a web dashboard or as a reply to a text. Texted counts are read
automatically, but a person on the Baptize team confirms each one. WhatsApp is saved as a
preference only. Texting already works: on Pentecost 2026, when churches were asked to reply
"yes" by text, response beat the email-and-form flow by a wide margin.

**If you crack it.** Networks of hundreds of pastors, in Peru alone, register without the Baptize
team messaging each one by hand, and every baptism on Pentecost 2027 gets counted. This is Baptize
The World's highest priority for 2027.

**What good looks like.**

| Mark | What it means |
|---|---|
| **In their language** | A pastor registers in the language they pray in. |
| **On the phone they have** | Inside apps churches already use, like WhatsApp. |
| **Done in one sitting** | A busy pastor finishes in one conversation. |
| **Ready by Pentecost** | Something real churches could try before May 16, 2027. |

**Reach people where they are.** We would love your tool to reach people on WhatsApp, where many
of Baptize's churches already are. It does not have to be built around WhatsApp. A texting agent
like [Poke](https://poke.com) that people can also reach on WhatsApp is the kind of thing we mean.
That is a hope, not a rule. Tools that help: [text-agent kit](../../docs/text-agent-kit.md).

## Why it's hard

- One conversation, in the pastor's language, on a weak 2G or 3G connection.
- Anyone can text in a count. The movement reports on these numbers, so a flow that accepts
  anything is worse than the form it replaces.
- Some pastors don't use WhatsApp.

## Guardrail

Reject duplicates, non-numbers and impossible counts (a count is a whole number from 0 to 10,000),
and get the pastor's opt-in before sending anything.

## What's in this folder

| Path | What it is |
|---|---|
| [`test-data/churches.csv`](test-data/churches.csv) | 12 made-up churches in Peru, Brazil, the Philippines and the US, with language and connection quality |
| [`test-data/sample-messages.md`](test-data/sample-messages.md) | Realistic inbound texts, including messy and invalid ones |

There is no Baptize API to call. Mock the save step. See [how Baptize works today](../../docs/baptize-today.md).

**Ask the Baptize team:** What does a pastor need to give, at minimum, for a church to count? What
makes a count suspicious? Which languages matter most for 2027?

Test data only. See the [ground rules](../../docs/ground-rules.md).
