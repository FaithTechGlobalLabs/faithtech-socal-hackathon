# Text-agent kit

Ways to reach a phone over WhatsApp or text today, without waiting on Meta's business
verification. Checked October 24, 2026. Use any of these, or something else.

| Tool | Best for | What to know |
|---|---|---|
| [Twilio WhatsApp Sandbox](https://www.twilio.com/docs/whatsapp/sandbox) | The fastest start | Each tester sends `join <your code>` to Twilio's shared sandbox number first. A join lasts 3 days. One message every 3 seconds. [Quickstart](https://www.twilio.com/docs/whatsapp/quickstart) |
| [Kapso sandbox](https://docs.kapso.ai/docs/how-to/whatsapp/use-sandbox-for-testing.md) | Coders, and non-coders using its flows | Add each tester's number. They send a 6-character code within 15 minutes. No templates, and only registered numbers can receive. [Chat SDK adapter](https://docs.kapso.ai/docs/whatsapp/chat-sdk.md) |
| [Meta WhatsApp Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started) test number | Closest to how Baptize would run it for real | Needs a Meta developer app and a temporary token. Vercel's Chat SDK has a [WhatsApp adapter](https://chat-sdk.dev/adapters/official/whatsapp) (`@chat-adapter/whatsapp`) |

**Poke, for a demo.** [Poke](https://poke.com/docs/mcp-servers) can call your tool as a custom MCP
server, so people can reach it by texting Poke. Poke's WhatsApp has been temporarily unavailable
since February 2, 2026, except in Italy and Brazil
([release notes](https://poke.com/docs/release-notes)). It works over iMessage and Telegram.
Baptize could not own this channel.

## Before you build

- **The 24-hour window.** On WhatsApp you can reply freely for 24 hours after the person's last
  message. After that you need an approved template. In a demo, have the person text first.
- **Keep it to a task.** Since January 15, 2026, Meta bars general-purpose AI chatbots from the
  WhatsApp Business API. Bots that serve a business's own people are allowed
  ([TechCrunch](https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform)).
  Build for a Baptize job, not "ask me anything".
- **No unofficial WhatsApp libraries.** They break Meta's terms.
- **Test with your own team's phones.** See the [ground rules](ground-rules.md).
