# Roadmap

v0.2 ships the MIT growth playbooks and a Content Agent. The agent drafts a post, a comment/reply, or a DM for a platform and a lead or topic, using the matching `skills/*/SKILL.md` as system guidance. Drafts use the app's OpenRouter free-model default and land in Approvals. The app does not post or send them.

The steps below are the next product direction. They are not implemented.

## v0.3 — Sandboxed browser per AI employee

Each AI employee gets its own isolated container and its own browser. Logins live in that sandbox and belong to that agent. They are never the owner's browser profile and never the owner's social accounts. One employee's session cannot read or reuse another's cookies, passwords, or signed-in tabs. If a sandbox is stopped, its browser and logins go with it.

## v0.4 — Named roles

Three roles, each with a job, a budget, a kill switch, and an activity log:

- **Researcher** — gathers public context for a lead or topic and writes it down. Does not draft outbound copy and does not send.
- **Writer** — turns that context into a draft (post, comment/reply, DM, or email) for the approval queue. Does not send.
- **Engager** — prepares the approved draft for a human to send. A human approves before any send. The kill switch stops the role immediately, and the activity log records what it prepared.

Budgets cap how much model and tool usage a role can spend. Crossing the budget pauses the role until a person raises it or the next period starts.

## Further out

These are notes for later. They are not scheduled as a release and they are not implemented.

- **Self-hosted free option.** Run the agent on an Oracle Cloud Always Free Arm server, with Ollama serving `qwen2.5` and Hermes Agent as the local runtime, so a team can draft without a paid model key.
- **ScrapeGraphAI for lead scraping.** Use ScrapeGraphAI when a page is easier to read as a graph of fields than as a fixed scraper recipe. It would feed the same lead intake the app already has.
- **MiroFish-style audience simulation.** Before a draft is approved, simulate how a small stand-in audience might react, and show that as a note next to the draft. It would not post anything.
- **Outreach handoff to sequencers.** After a human approves an email draft, hand it to Smartlead or Instantly instead of sending it from this app. The kill switch and the approval queue stay in front of that handoff.
- **Open-core Growth SDK.** Package the playbooks, the draft-and-approve loop, and the lead model as an open-core Growth SDK. The AGPL app stays the reference product. Paid extras would be optional and separate from the playbooks, which stay MIT.
