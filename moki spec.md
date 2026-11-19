# Moki spec

Nov 14, 2026 · @bubbles

## Overview

Moki is one desktop app that brings the areas of bubbles' life and work together: gardening, body, work, mail, calendar, reminders, notes and the code harness. Each area gets its own evolving UX, without the data moving out of where it already lives.

It's a macOS desktop app built on Electron, with a sidebar organized by lens (what things are), not by app. Its own views are web UI, websites load as full web views right next to them, and a small Swift helper does what only the Mac can do. Moki is for one person on one computer. Away from the Mac, Psymail on the phone covers mail. The assistant inside the app is also called Moki.

## Glossary

- **Moki.** The app, and the assistant inside it (Ask Moki).
- **Space.** A set of lenses with the rules that filter them, plus its own pinned tabs, tabs and split layout. Everything is the space with no rules.
- **Lens.** A live view that gathers things by type, tag, person, source, date or text. Built-in lenses sit at the top of the sidebar, and you can make your own anywhere.
- **Source.** A connected service or kind of Mac data, like Notion, Slack or Apple Messages. Each has one adapter.
- **Adapter.** The code that reads and writes one source. Web adapters run in the app; native ones run in the Swift helper.
- **Swift helper.** A small Mac process for what only the Mac can do: the Messages database, Psymail's engine, Reminders, files, screen text, servers, Keychain secrets and WhisperKit.
- **Local index.** Moki's local database. Mostly a rebuildable cache of what's in the sources, plus your annotations.
- **Annotation.** A tag, note, type or link you add to any item. Annotations are original data, kept in the local index and mirrored into Notion.
- **Item address.** A stable link to any item in any source, so the index can point at it and open it.
- **Jev.** The fast local decision layer: it picks, says yes or no, or scores, and never writes text.
- **Claude.** The model behind Moki's longer requests, run through Claude Code.
- **Inspector.** The right-hand pane: details for whatever has focus, Ask Moki at the top and Moki's request stack at the bottom.
- **Peek.** Shift-click a link to open it over the current view. Not the same as sidebar hover, where hovering the collapsed sidebar floats the full one over it.

## Principles

These are decided. Change them only on purpose.

- **Sources stay the source of truth.** Moki reads and writes each source, and every edit goes to the source first. It keeps a local index built from the sources (metadata, short snippets, thread keys, read state) so merged message threads, ⌘T search and Day's counts stay fast. The index never wins over a source and can be thrown away and rebuilt at any time. Two kinds of local data are not throwaway: a Discord cache, since Discord has no API for your own messages, and the annotations you add (tags, notes, types, links), which are original data and are mirrored into Notion.
- **Notion is the main store for life areas.** If rate limits become a problem, revisit it then.
- **Embed where an app's own UI is better.** Craft loads as a web view rather than syncing, which worked badly in CCP.
- **Native work stays native.** Anything that needs the Mac goes through Moki's Swift helper: Apple Messages, mail through Psymail's engine, contacts, reminders, files, servers, screen text and usage. The helper takes over what CCP's bridge used to do.
- **No app silos.** Items move between sources by drag and drop and keep a link back to where they came from.
- **Everything is annotatable.** Any item from any connected source can be saved to the index, tagged and annotated, then summoned anywhere through its tags.
- **One computer.** Native features live on the Mac. A possible iPhone app (see iPhone and Siri) would reach them through the Mac, so the Mac would need to be reachable when used remotely.

Secrets (API keys, tokens) live in the macOS Keychain, held by the Swift helper, never in the app's web code or a config file. Financial data is read-only and fetched only when a view needs it, and the Moki assistant never reads it.

**Reuse before building.** Wherever a solid open-source package exists (browser features, Markdown vault, search, contact matching, adapters), use it instead of rolling our own. Building from scratch is the exception and needs a reason.

**Act on what's reversible, ask before what isn't.** Agents (Claude, OpenCode, Jev's direct actions) take reversible actions on their own and report the notable ones afterward. Anything that can't be undone gets a check-in first. Two things count as irreversible even when the software allows undo: anything that reaches another person (a sent message, an accepted invite, a shared link), and large changes that would be costly to undo by hand (bulk retagging, moving many items).

## Architecture

&#91;embedded content: Moki architecture · 22 sources, 2 adapter layers\]

Web adapters call each service's API from the app, and native adapters run in the Swift helper, using the Mac's own frameworks and local data. Both feed the local index and the app's lenses. The shell is Electron, so the app's own views and websites are siblings in the same layout.

Jev is the fast decision layer: it answers typed questions (pick one, yes or no, a score) with a probability, in tens to hundreds of milliseconds, without generating text. It routes requests, matches handles to people, lines up tags, suggests types and picks where dragged fields go. Where a job needs new text or values pulled out of content (a due date in an email, a lens built from plain words), Jev picks the shape and Claude fills it in. Decided: Jev runs locally as Laya (Apache-2.0, a 421M-parameter model that runs on Apple silicon) served through Ollaya, which speaks the same API as TypeSafe's hosted Jev. Code talks only to that API, so the model can be swapped for Kev, another open model, or hosted Jev without changing the app.

## Sources

Each source gets one adapter. Web adapters run in the app, and native ones run in the Swift helper.

| Source | Reached through | Runs in | Read | Write | Notes |
| --- | --- | --- | --- | --- | --- |
| Notion | Notion API | App | Yes | Yes | About 3 requests per second per integration, on every plan; ask only for the rows a view shows. Text in page bodies loads block by block, so keep view data in database fields |
| Craft | Craft API + web view | App + pane | Yes | Through the pane only | Topic views read from it; editing stays in the embedded view, since two-way sync went badly in CCP |
| Google Calendar | Calendar API | App | Yes | Yes |  |
| iCloud Calendar | CalDAV | App | Yes | Yes | Needs an app-specific password |
| Linear | Linear API with your own API key | App | Yes | Yes | Issues, projects and cycles feed Tasks and project spaces. Checked for changes by polling, since webhooks need a public web address the Mac doesn't have |
| Contacts (Google, iCloud) | Google People API; iCloud through CardDAV later | App | Yes | Yes | Slack and Discord handles go in contacts' custom fields |
| Hevy | Hevy API with your API key | App | Yes | Yes | Needs Hevy Pro. Workouts, routines, exercise templates, body measurements. Checked for new workouts by polling, since webhooks need a public web address the Mac doesn't have |
| Readwise Reader | Reader API with your Readwise access token | App | Yes | Save, tag, add highlights | Saved documents with tags, notes and location (new, later, archive, feed); highlights and their notes come back as items linked to their document. Rate limits are tight (listing at 20 per minute), so read only what changed since the last check. Its tags map into the second-brain index |
| Slack | Slack Web API with your own user token, live events over Socket Mode | App | Yes | Yes, as you | One token per workspace; some workspaces block installing your own app |
| Discord | Hidden Discord web view: its live connection for reading, a typing relay for replies | Hidden web view | What loads while it runs, cached locally | Your own typing, relayed | No API for your own DMs. The relay and reading are a gray area under Discord's terms; keep it human-paced with no bulk history loads. See Messages |
| Gmail via Psymail | PsymailKit engine | Helper | Yes | Yes | Existing engine, multiple accounts and cache. Works only while the Mac is on, which is fine since Psymail covers the phone |
| Reminders | Apple's native framework | Helper | Yes | Yes | The one native-only source |
| Apple Messages | Messages database on the Mac; sending through the Messages app | Helper | Yes | Send only | No official API. Reading needs Full Disk Access; new messages show up by watching the database; newer message text needs extra decoding |
| Chime | Chime's transaction and balance alert emails, through Psymail | Helper | Balances, recent transactions | No | Chime has no public API, so spending and balances are read from its alert emails, which need to stay turned on. No aggregator and no bank login. Plaid or SimpleFIN remain options if emails fall short |
| Files | Folders you choose, through Spotlight's index and file-change events | Helper | Yes | Tags, open, move | Only folders you add, so indexing stays fast. Skips build output, dependencies and anything in .gitignore. Cloud-only files are indexed by name and metadata without downloading. See Files |
| Zen tabs | Small Zen extension + native messaging | Helper | Yes | Open, focus, close, move | Live tabs with title, URL, favicon and workspace; page text or selection with permission. Native messaging keeps the bridge port closed to web pages. Fallback: read Zen's session file (read-only, about 15 seconds behind) |
| Portside | Portside on this Mac | Helper | Yes | Start, stop | Servers with stable names |
| OpenCode and Claude usage | CCP's adapters, moved into the helper | Helper | Yes | No |  |
| Harness dashboards | Local dashboard servers | Helper | Yes | Run buttons | Launched from the helper |
| Screen text | Helper action | Helper | Yes | No |  |

Notion areas that are still long pages, like Gardening, will need databases before they can get rich views.

## Interfaces

Every lens's interface is code that Claude can rewrite as needs change, and eventually you can design it yourself (see Lenses).

The app's own views are web UI, so Claude can rewrite one and reload it live, without a rebuild. Anything built with Gooey uses the same engine, so a Gooey creation can appear in a pane inside Moki as-is. The first release is "one window, one inbox": the sidebar, tabs, split view and the inspector with Moki, plus Day, Messages (email, Apple Messages, Slack), Calendar, Tasks and Docs. The Body space, built on Notion's Exercises and Body Log databases and Hevy, follows in a later phase.

## Built-in lenses

The top of the sidebar lists lenses, not apps. Each one gathers a kind of thing from every source that has it, and the sources become filters inside it. These come pre-made, and you can add your own beside them. The space picked at the top of the sidebar decides which lenses show and filters what's inside each one (see Layout). A Gooey canvas is one more page type you can create and browse alongside them.

The built-in lenses, in their default order:

- **Day.** The home screen, a dashboard across everything the current space covers: the date and weather; counts that jump to each lens (events, due tasks, replies, notifications that need you, deliveries); the day on a timeline with a now marker; replies waiting on you; what's due; and a few things worth a look. Its cards carry game-style names: Path (the day's timeline), Party (people waiting on you), Quests (what's due) and Loot (deliveries, purchases and updates worth a look).
- **Messages.** Things people or groups sent you directly, which you respond to or work with individually: email from people, Apple Messages, Slack, later Discord.
- **Docs.** Craft, Notion pages and vault notes.
- **Tasks.** Reminders, Linear, Notion task databases, and anything flagged elsewhere.
- **Calendar.** Google and iCloud.
- **Feed.** Starts as exactly what Psymail shows in its feed. Google's Discover feed (what the Google app and Google Home show) could join later, but Google offers no public API for it, so it would need a web view or an unofficial route. Other sources can join after that.
- **Notifications.** Alerts and updates from your tech systems (GitHub, Linear, Figma, Notion, Google, Vercel, TestFlight and so on), borrowed from Psymail's bundles. The overview puts what needs you first, then a tile per system with its count and recent activity, activity by hour with quiet hours, and routine updates rolled up per system. Psymail's newsletters bundle duplicates the feed, so it isn't carried over.
- **Commerce.** An overview of money and shopping: account balances and spending (read-only, from Chime's alert emails through Psymail), this month's spending against a budget with a daily chart, where it went by category, deliveries on a week strip, renewing subscriptions and recent receipts. Orders, receipts, shipping and returns are borrowed from Psymail's commerce bundle, and each has its own tab next to the overview.
- **Library****.** Readwise saves and highlights, plus web pages you've saved or tagged.
- **Files.** Your indexed folders.
- **Places.** Working with Google Maps: your saved lists, details about places, and saving new ones. Place details come from Google's Places API. Saved lists have no public API; Google Takeout can export them, and any list's link can be saved to the index and tagged.
- **People.** Google and iCloud contacts with linked identities.
- **Code.** Claude Code sessions, harness dashboards, Portside servers, OpenCode and Claude usage.

This order is a default. Each space can hide lenses, reorder them, or tuck less-used ones under a ••• More item. The top lenses (Day, Messages, Calendar, Tasks, Commerce, Notifications) open as dashboards: spacious, with a few large figures and charts and some movement, and their full lists one tab away.

Email is no longer one place. Each email shows up wherever it's relevant: personal mail in Messages, orders in Commerce, app alerts in Notifications, and newsletters and the rest in Feed.

## Layout

The sidebar on the left is shaped by the space you're in, and an inspector pane sits on the right. The sidebar and the inspector can each be toggled on or off.

- **Space menu.** The button at the top of the sidebar picks the space: Everything, a project (Gooey, Psymail, QWELL, fusebox) or a life area (Body, Garden, Health, Money, Job search), plus New space and Edit spaces. Everything below it follows that choice.
- **Lenses.** The lenses this space shows, each filtered to it. Choosing Gooey filters Today, Messages, Calendar and the rest to Gooey. Psymail might show only Today, Messages and Tasks. Switching back to Everything brings every lens back.
- **Pinned tabs, then tabs.** Below the lenses come this space's pinned tabs, then its open tabs. Each space keeps its own tabs, like Arc's spaces, so spaces replace workspaces.
- **Space settings.** Each space has a settings page listing which lenses it shows and the rules each one filters by: people and channels for Messages, calendars or titles for Calendar, Linear projects or Notion areas for Tasks, Craft folders or tags for Docs, folders for Files, repos for Code. Rules show as chips. Moki can suggest new ones, such as a Slack channel that keeps coming up, and they apply only once you accept them. A Look tab sets the space's icon and name.
- **Tabs hold anything.** A web page, a Moki view, a Gooey canvas, or content from the Mac, side by side in the same tab bar.

* **Inspector (right side).** A support pane that changes with whatever has focus: details and tags for a selected item, a person's identities, a page's highlights, a site's Boosts, and so on. Ask Moki sits at its top.
* **Asking Moki.** Type in the Ask Moki field and press Enter: the whole box flies down to the bottom of the inspector to process, while a fresh Ask Moki field scales and fades in at the top. Requests stack at the bottom. Tap one to expand it in place for Moki's answer, its steps or a confirmation ("Send this to Brooke?"). With the inspector collapsed, the stack shrinks to a small badge on its rail.
* **Collapsed inspector.** Hiding the inspector leaves a narrow column with its toggle in the bottom corner, in the same spot as when it's open, with equal space on either side of it. A Moki button sits at the top of the column, the same distance from the edges. Clicking it opens the inspector and puts focus on Moki, ready to type or talk.

The shell is Electron, like Gooey: its chrome (both sidebars and the tabs) and Moki's own views are web UI, and websites load as full web views, never iframes, so sites that refuse to be framed still work. Both sit side by side as equals: a 2-up can show the unified Messages list on the left and the Craft website on the right.

In effect, Moki is a browser that can also hold its own views. The tab sidebar mixes both: fast custom views sit right next to Notion, Craft or any website.

- **Custom views for speed.** Core surfaces such as the Messages list, People and Calendar are Moki's own views, built for speed and smooth dragging.
- **Split content area.** The content area on the right can show one tab, a split view, or four up, mixing native views and websites freely.
- **Narrow windows.** As the window shrinks, the inspector collapses to its rail first. The left sidebar never collapses on its own; only you collapse it. When the window gets really thin, split panes stack instead of sitting side by side.
- **Keyboard shortcuts.** The implementer proposes the initial set (switching lenses and spaces, toggling the sidebar and inspector, focusing Moki, tabs), built around ⌘T as the omnibar.
- **Saved in the space.** Each space remembers its tabs and its split layout.
- **Menus float above everything.** Popovers and menus are drawn by the shell, so they can overlap any view, web or not.
- **Things morph out of what opened them.** Popovers, dropdowns, menus and other things that appear grow out of the control that opened them, the way iOS does it: the button's shape stretches into the panel on a spring, its contents fade in as it settles, and closing reverses back into the button. A request flying down into the inspector's stack works the same way. With reduced motion on, they fade instead.

Gooey already shows this works: it hosts full web views inside Electron. CCP's Website widget showed the other half, with logins that survive relaunch and Craft working far better embedded than synced. Gooey's canvas joins as one more page type.

## Browser features

Most browsing moves into Moki, so it borrows the best of Arc and Zen.

Must-haves:

- **⌘T omnibar.** One bar that searches and acts across the whole app: tabs, history, Moki items (messages, people, notes, index) and app actions.
- **Peek.** Shift-click a link to open it as an overlay over the current view, then promote it to a full tab or dismiss it.
- **Copy link.** ⌘⇧C copies the current tab's URL.
- **Pinned tabs.** Tabs that stay put in the tab sidebar across sessions.
- **Favorites.** Tabs turned into small pinned icon squares at the top of the tab sidebar.
- **Boosts.** Your own per-site augmentations (custom CSS and scripts), each one toggled on or off per site. Built on the same injection used for embedded sites.
- **History.** Browsing history across all web views, searchable from the omnibar.

Left out on purpose: auto-archiving unused tabs. Importing tabs and workspaces from Zen comes later.

## Messages

Messages is for things people or groups send you directly, which you respond to or work with individually: email from people, Apple Messages, Slack and Discord, all in one view. Email about orders, app notifications and newsletters lives elsewhere (see the sidebar). Discord comes later; it isn't part of the first versions.

- **One thread per person.** Everything from Brooke, whether a text, an email or a Slack message, appears in one thread ordered by time, chat-style with the newest at the bottom. The list of threads puts the most recent conversation on top.
- **Replies go where she last wrote.** The Reply box sends on the channel of the person's last message. A small source icon in the box shows which one, and tapping it switches channel.
- **Read state syncs where it can.** Opening a thread marks it read in Gmail and Slack too. Apple Messages can't be marked read by another app, so texts stay unread on the phone.
- **Filters by source.** Chips hide email, or any one app, when you want to narrow down. Discord's chip shows from the start, as a placeholder for what's coming.
- **Group chats and channels** stay their own conversations in the same list, since they don't belong to one person.
- **Replies go out the right way per source.** Email goes through Psymail's engine, Slack through its API, and Messages through the Messages app. Psymail's engine runs without its own UI in the Swift helper, since all messaging is drawn in Moki's own UI.
- **Discord replies are relayed.** Discord runs in a hidden web view. You type in Moki's own text box, and each keystroke goes into Discord's box in the hidden web view as real input. Every message is yours, sent when you press send, one at a time, with no agent writing or queuing messages.
- **Discord reading uses the live connection.** Moki listens to the stream of messages the hidden client already receives, so it makes no extra requests. It never scrolls back through history in bulk or opens conversations faster than a person would.
- **Discord cache.** What arrives is kept locally on the Mac (author, text, time, channel, link back; no media), so threads include Discord even when it's closed. It fills in whenever the hidden view runs.
- **Sent means sent.** A reply shows as sent only once Moki sees it land in the thread.

The Discord relay and reading count as an unofficial client modification under Discord's terms. It's a gray area, rarely enforced for personal use that behaves like a person, but the risk is real and the choice is deliberate.

## People

People live in your Google contacts, not in a database of Moki's own. Moki reads and writes them through Google's People API, which keeps the custom fields for Slack and Discord handles reliable. iCloud contacts can join later through CardDAV if needed.

- **Linking identities.** Handles from other apps (Slack, Discord) are stored on the contact as extra fields, using Google's custom fields and messaging handles. Phone numbers and emails already cover Apple Messages and email.
- **Matching.** Jev suggests which handles belong to which person, and you confirm before anything is saved.
- **Threads.** Per-person message threads come from these linked identities.

## Second brain

A shared index connects everything across systems: one place that knows what exists in Craft, Notion, mail, messages, the web and the Mac, and how it all relates. It stores references, tags and links, not copies of the content.

- **Every item gets an address.** A stable link for any Notion page, Craft doc or block, email, message, reminder, web page or local note, so the index can point at anything and open it.
- **Each system's own organization maps in.** Craft folders and tags, and Notion databases, relations and tags, are read into one shared vocabulary. Jev suggests how their tags line up, and you confirm.
- **Tag anything, from anywhere.** Every connected source has a way into the index: a link to a Notion doc, a Google Maps list, a passage highlighted on a page along with its link. A single tag action in the chrome works on whatever is in front of you. Tags, notes and other metadata live in the index, so this works even where a source has no tags of its own, and lenses gather items by those tags, the way Capacities does.
- **Simple connections first.** Links come from shared tags and keywords, like agent memory, plus links you make by hand. Smarter matching (semantic search, suggested links) can come later.
- **Annotations live in the local database.** Tags, notes, types and links you add are stored in Moki's local database next to the index, and mirrored into a Notion database so they're backed up and browsable. Unlike the rest of the index they're original data, so they're never thrown away. Markdown files are only for your own notes and documents that don't exist in another system.

This is what topic views draw from, and later what unexpected connections would build on.

## Lenses

Inspired by Capacities: no folders, just typed things and live views that gather them, which Capacities calls queries. Here they're lenses, and they work at every size: the built-in ones at the top of the sidebar, one you build in a new tab, or one embedded in a page. A space is the level above: a set of lenses plus its own tabs.

- **Things have types.** Every item in the index can have a type: Person, Project, Book, Plant, Place, Idea and so on. A type is just a few friendly fields. Many types come from the source (an email is a message, a Hevy workout is a workout); others you assign, or Jev suggests.
- **A lens is a live window.** It gathers whatever matches and stays up to date: by type, tag, person, source, date or text. A project is no longer a folder; its page is a few lenses: "messages with people on this project," "notes tagged with it," "tabs and pages about it."
- **Lenses can be relative.** A lens on a type's page can mean "this one," so every project page or person page gets the same lenses for free, the way Capacities' variable queries work.
- **Made by talking, not by building queries.** You describe a lens in plain words, typed or spoken through ⌘T ("everything about the garden from this month"), and Jev turns it into one. It shows as a short sentence of tappable chips, like "Messages and notes · tagged Gooey · this month," and you tap a chip to change it. There's no filter grid or query language.
- **It picks a good shape.** A lens shows as a list, cards, a board, a calendar or a gallery depending on what's in it, and you can switch.
- **Lenses live anywhere.** A lens can be a tab, a pinned tab or a split pane, part of a space, or embedded in a page.
- **Make your own at any level.** Even inside the Gooey space, New tab can build a new lens from rules. A lens you use often can join the built-in ones at the top of the sidebar.
- **Lenses get their own interface.** Eventually you can design how a lens looks and works, not just what it gathers. This is where Gooey fits in.

## Files

Your files join the same network: types, tags, lenses and links all work on them, within folders you choose.

- **Folders you choose.** You add folders one at a time (dev, design, Documents and so on), with ignore rules for build output, dependencies and anything a .gitignore excludes. More can be added later, so indexing stays fast.
- **Spotlight does the heavy lifting.** macOS already indexes file names, metadata and text. Moki reads that index instead of building its own, following the reuse-before-building principle, and listens for file changes to stay current.
- **Tags are Finder tags.** Tagging a file in Moki writes a real Finder tag, and tags added in Finder show up in Moki, so the two never disagree.
- **Links survive moves.** Each file is tracked by a macOS bookmark rather than its path, so renaming or moving it doesn't break its links in the index.
- **Files get types.** A type comes from the file kind (PDF, image, Markdown, design file), and a whole folder can be one thing. For example, \~/dev/gooey can be the Gooey project, linked to its Notion page, Craft notes, harness dashboard and Claude Code sessions.
- **Files are first-class in lenses.** "Everything about Gooey" includes the repo, its design files and the PDF of the brief next to messages and notes.

## Adding a source

Every new source gets mapped into Moki's structure, so you can reach everything in it through Moki's types, tags, people and lenses rather than the source's own folders. An AI-driven flow builds the mapping and checks it with you.

1. **Survey.** The adapter reads the source's structure: Craft's spaces, folders, docs and tags; Notion's teamspaces, databases, properties and relations.
2. **Propose.** Claude drafts a mapping: which things become which types (a Notion "Exercises" database becomes Exercise items), which properties become type fields, which folders or databases are projects or areas, which tags merge with tags you already have, and which entries are people.
3. **Review.** A friendly side-by-side: the source's structure on one side, how it lands in Moki on the other, with a few real items shown as they'll appear. You adjust by tapping chips. Low-confidence guesses are flagged, and nothing is applied until you confirm, since remapping a whole source is a large change.
4. **Verify.** A coverage check counts what's reachable from Moki against everything in the source. Anything left over goes into an Unsorted lens to sort later, so nothing quietly disappears.
5. **Keep up.** When the source's structure changes, like a new database or folder, Moki proposes a small update to the mapping rather than redoing it.

Each mapping is saved as a readable file in the vault, so you can see and edit it by hand. Each source's own structure also stays browsable as-is, as a fallback.

## Automations

Automations run when something happens to an item, so the system does follow-up work for you.

- **Triggered by kind of item.** For example, when a YouTube video is added, an automation pulls its transcript and saves the transcript text and the video's link into your database.
- **Same rules as agents.** Automations act on their own when what they do is reversible and report the notable results; anything irreversible waits for your OK.
- **You set them up per kind.** Pick the trigger (a YouTube video, a PDF, an email from a store, a new reminder) and the steps, in plain words or by voice, and Jev and Claude turn that into the automation.
- **The reminder agent is one case.** Reminders are just one trigger among many.

## Capture

Things come in from anywhere, the way Readwise Reader works.

- **Browser extension.** Save and highlight any website from the browser, with highlights and notes stored in the second brain and the page added to Library.
- **iPhone.** The iOS app accepts links from the share sheet, so anything you share from your phone lands in Moki.
- **Captures trigger automations.** A captured YouTube link runs the transcript automation, a captured article can be summarized, and so on.

## Claude

Claude works inside Moki and sees the same systems you do, through the same adapters, People and second-brain index.

- **Moki is an MCP server.** Its adapters, the index and People are exposed as MCP tools. Claude inside Moki uses them, and the same server also plugs into Claude Desktop and Claude Code. Those apps can read, search and make reversible changes like tagging; anything that sends or can't be undone stays inside Moki, where it can be confirmed.
- **Runs through Claude Code.** Moki runs the official Claude Code CLI headless (`claude -p` with JSON output), signed in with your own plan, which gives it Claude Code's agent loop: tools, MCP, sessions, permissions, subagents and skills. It doesn't use the Agent SDK directly, since Anthropic expects apps built on the SDK to use an API key rather than a subscription.
- **The API is only the model.** The Claude apps' own harness (memory, chat history, account connectors, artifacts) doesn't come along. Moki supplies its own instructions, tools and context.
- **Billing for personal use.** Moki runs the official Claude Code CLI (`claude -p`) that you're already signed into with your own Claude plan. Anthropic's terms don't let an app handle that sign-in itself, so Moki never touches Claude credentials. Decided: everything, including automations and the reminder agent, runs on your plan's usage limits, which assume ordinary individual use.

Your existing Claude work comes in too:

- **Claude Code sessions are a source.** Claude Code saves every session on the Mac (under `~/.claude/projects`). Moki lists them by project, shows their history, and can resume or fork one through the Agent SDK. Sessions are indexed and tagged in the second brain like anything else.
- **Claude app chats are a tab.** claude.ai runs in a web view tab. Work that touches the Mac still goes through the Claude desktop app, so it keeps working as long as that app is open and online. Notes for the web view: Google sign-in can be refused in embedded views (email-code sign-in works), and the microphone and notifications need permission passed through.
- **No reading chats as data.** There's no API for Claude app conversations, and scraping the tab isn't allowed. An occasional data export (from Claude's settings) can be imported into the index instead.

## Safety rules

Moki and every agent it runs follow a small set of named safety rules. They're tracked as a set, so we can see how well each one works and change it easily.

- **One place.** The rules live in a single readable file. Every action from the UI, Moki, automations and outside apps goes through the one layer that applies them. Changing a rule means editing that file, with no rebuild.
- **Every decision is logged.** Each time a rule applies, the log records which rule, what was proposed, and what happened: done on its own, confirmed, declined, or blocked.
- **A view to watch them.** A Safety lens shows each rule with how often it fired and how often you approved or declined, and flags any action that slipped past without the check it should have had. That's how we judge whether a rule is too loose or too fussy.

The starting rules:

1. **Reversible acts, irreversible asks.** Reversible actions happen on their own and notable ones are reported. Anything that reaches another person, spends money, deletes, or changes many items at once asks first.
2. **Confirmations show exactly what will happen.** The recipient, the channel and the full text, not a summary.
3. **Other people's words are data, not instructions.** Text from emails, messages, web pages and documents never tells Moki what to do, however it's phrased.
4. **Drift stops and asks.** If a task heads toward an action you didn't ask for, Moki stops and checks with you.
5. **No bank data for Moki.** Commerce data is never in Moki's context.
6. **Outside apps read and tag only.** Claude Desktop and Claude Code, through MCP, can read, search and make reversible changes; nothing that sends or can't be undone.
7. **Secrets stay in the helper.** Tokens and keys never appear in prompts, logs or the web side of the app.

## Reminder agent (to explore)

An idea to explore: a background agent that watches your reminders and acts on them where it can, following the reversible-first principle.

- **What it could do.** Prepare ("call the dentist" pulls up the number and your last emails with them), do what's reversible ("buy potting soil" adds it to a shopping list or drafts an order), or just nudge at a better moment.
- **When it acts.** Possibly when a reminder is created, some time before it's due, and when it comes due. Which of these is right is part of the exploration.
- **How it checks in.** A running log of what it did and what it proposes, perhaps a card in Today and in the inspector on each reminder. Anything irreversible waits for your OK.
- **How you direct it.** A few candidate ways: a short instruction in the reminder's notes, standing rules per Reminders list (for example, everything in Groceries goes to a shopping list), corrections that it learns from, and voice through ⌘T.

Open threads: which actions are worth automating, the timing, how quiet or chatty its check-ins should be, and how you turn it off for a reminder or a whole list.

## iPhone and Siri (to explore)

A companion iPhone app that reaches the same system, with Siri as a way in: say the trigger word, ask Moki to do something, and the app acts on your behalf.

- **Siri through App Intents.** iOS lets apps add phrases to Siri. Apple requires each phrase to include the app's name, and the app is named Moki, so "ask Moki…" works.
- **Free-form requests take one extra turn.** Siri phrases can't capture an arbitrary sentence inline, so the likely flow is "Hey Siri, ask Moki," then Siri asks what you want and passes your words through. Worth checking against current iOS.
- **Same brain as ⌘T.** Requests from Siri go through the same Jev routing as voice on the Mac: direct action, Claude agent or OpenCode agent, with the same reversible-first check-ins.
- **Reaching the Mac.** Mac-only abilities (Messages, files, Psymail's engine) need the Mac awake and reachable, for example over Tailscale. Web sources like Notion, Linear and calendars could be called straight from the phone. Requests that need the Mac while it's asleep could be queued and confirmed later.
- **Beyond Siri.** The same app could hold notifications from the reminder agent, quick capture into the second brain, and a small Today view.

Open threads: how much the phone does on its own versus through the Mac, whether a small always-on piece is needed, and what Siri's limits allow in practice.

## Voice

Voice is a first-class way to use the whole app: dictating into any text field, commanding through the ⌘T omnibar, and talking with Claude.

- **Claude's own voice mode isn't available to other apps.** It lives inside the Claude apps, so it works in the claude.ai tab but can't power Moki's own fields.
- **Speech-to-text on the Mac.** Decided: WhisperKit, open source (MIT) and free, running locally on Apple silicon in the Swift helper (now part of Argmax's open-source SDK). Large v3 Turbo is the model to start with. Apple's dictation isn't good enough.
- **Claude does the understanding.** The transcript goes to Claude, which turns it into actions across sources: "text Brooke I'm running late" or "tag this page with Gooey."
- **Speaking back.** The Mac's built-in voices to start. Argmax's open-source SDK also includes an on-device text-to-speech kit worth trying later.

### Hold ⌘T to talk

Pressing ⌘T opens the omnibar. Holding it for more than a second locks it into voice mode. Enter sends what you said, and Esc cancels.

1. **Listen.** WhisperKit transcribes live while you speak, and the transcript shows in the omnibar as you go.
2. **Route.** When you stop, Jev reads the request with what's in focus (the current tab, selection, space) and decides who should fulfil it.
3. **Fulfil.** It goes to the cheapest thing that can do it well:
   - **A direct action** for simple, single-source requests: open a tab, add a reminder, tag this page, query Notion.
   - **A Claude agent** (Agent SDK) for requests that need reasoning or several sources: "what did Brooke and I decide about the trip, and add it to the calendar."
   - **An OpenCode agent** for code and project work in a repo.
4. **Confirm when it matters.** Reversible actions just happen and notable ones are reported afterward. Anything irreversible (sending to another person, deleting, spending money, large bulk changes) shows a quick confirmation first, per the principle above.

**Long tasks join Moki's stack.** When a request takes more than a few seconds, the ⌘T panel shrinks and flies into the stack at the bottom of the inspector, the same place Ask Moki requests go (see Layout), so you can keep working. Each shows the task and its progress. Tap one to expand it in place: the request, each step, the answer, suggested next actions and a reply field with a mic. A finished task shows a check until you dismiss it.

Jev's routing choices are logged, so wrong turns can be corrected and the router improves over time.

## Transfers

Dragging an item from one source to another creates a new item in the destination, using a mapping learned once per pair of item types and filled in fresh for each item.

1. **Common item shape.** Every adapter turns its items into title, date, body and a link back. This always transfers, even before a smarter mapping exists.
2. **Cached structure.** The first time a pair is used (say, email to Notion task), Jev works out where fields go and which ones need extracting from content. That rule is saved and reused.
3. **Live smart fields.** On every drop, Jev fills only the fields the rule marks as dynamic, like a due date in an email body or which project it concerns.
4. **Create first, enrich after.** The item appears at once with its structural fields filled; the smart fields land a moment later.
5. **Blank when unsure.** If Jev isn't confident, it leaves the field empty rather than guessing.
6. **Preview and learn.** A new pair shows a quick preview. Corrections update the saved rule, and fields you keep fixing are a signal to change it.

## Embedded panes

Sites like Craft and Discord load as full web views beside Moki's own views, not iframes. Mail is drawn in the Messages lens rather than Psymail's own screen.

What it would allow:

- Injected CSS can hide an embedded site's chrome and match Moki's type, color and spacing.
- An injected script can read what's selected or dragged inside a site and hand it to transfers.
- A view can run hidden, as Discord does for reading and relayed replies.
- Moki owns focus and shortcuts across views, so ⌘T works the same everywhere.

Remaining downsides: hidden views have to stay signed in and running, Electron uses more memory than a native app, and injected CSS and scripts break when sites change their markup.

## States

Every lens, and the ⌘T panel, handles these states. Each needs a design before handoff, and each uses an icon or other quiet cue rather than extra labels.

- **First run.** The lens says what it gathers and offers to connect the sources it needs.
- **Loading.** The layout appears at once. Items from the local index show first, and fresh ones replace them as sources answer.
- **Empty.** A short line says nothing matches. In a filtered space it names the space doing the filtering.
- **Partial.** One source failed or hit a rate limit. Everything else still shows, the late source's icon marks it, and tapping retries.
- **Signed out.** A source's sign-in expired. Its icon shows it, and tapping reconnects.
- **Permission missing.** A macOS permission isn't granted yet. One tap opens the right pane in System Settings.
- **Offline.** The local index shows read-only, marked stale since a time. Reversible actions (tags, reminders) wait and go out when back online. Sends and anything else irreversible are turned off, never queued.
- **Filtered by space.** Whenever a space filters a lens, the lens shows which space is doing it, so nothing seems missing.
- **No results in ⌘T.** It says so and offers to ask Moki instead.

## Permissions and distribution

Moki ships outside the Mac App Store, signed with a Developer ID and notarized. It isn't sandboxed, since reading the Messages database, sending through the Messages app and running Psymail's engine all need that.

- **Asked when needed.** Each macOS permission is asked for the first time a source needs it, not all at once: Full Disk Access for Apple Messages (a manual step in System Settings, with a guided prompt), Automation for sending through Messages, Reminders, Microphone for voice, Location for Day's weather, and folder access for Files.
- **Sign-ins.** Google sign-in for Calendar and Contacts. A Slack token per workspace, set up as a private app in each workspace so Slack's tighter limits for unlisted apps don't apply. API keys for Notion, Linear, Hevy and Readwise. An app-specific password for iCloud Calendar.
- **Kept in the Keychain.** The Swift helper holds every token and key. Signing a source out removes them.
- **App and helper.** They talk over a local channel only Moki can use (see Native layer security in Open questions).

## Open questions

- [ ] **Pane UX**\
With Electron web views, what's the right layout for embedded apps inside a lens?
- [ ] **Home screen**\
What shows first when Moki opens: a dashboard across lenses, the last one used, or Day?
- [ ] **Native layer security**\
Mac-only work runs in Moki's Swift helper. How does the helper make sure only Moki, and outside pieces like the Zen extension, can talk to it?
- [ ] **Psymail engine as a service**\
Psymail's engine must run without its UI, inside the Swift helper. How much work is it to separate PsymailKit's mail logic from its screen so Moki can call it?
- [ ] **Craft reading**\
How complete is Craft's API for topic views?
- [ ] **Gooey timing**\
When does Moki take on Gooey's spec and renderer, and what does it use until then?
- [x] **Chime route**\
Decided: read Chime's alert emails through Psymail.
- [ ] **Discord risk**\
Is the gray area of the relay and live reading acceptable, knowing the account is at stake?
- [ ] **Hevy and Notion**\
Should Notion's Exercises days and Hevy routines stay linked, and which one leads?
- [ ] **Contact fields**\
Which Google Contacts fields hold Slack and Discord handles, custom fields or messaging handles?
- [x] **Jev's engine**\
Decided: Laya served through Ollaya, behind the Jev-compatible API (see Architecture). Spike: measure speed on your Mac and calibrate Laya's confidence on real routing and matching examples, since it ships over-confident.
- [ ] **Long tasks (later)**\
How many run at once, whether they survive a restart, how cancelling partway works, and what a failure looks like. Consider using bubbles' harness starter package to answer these.

* [x] **One contacts adapter or two**\
Decided: Google People API, with iCloud through CardDAV later if needed.

- [ ] **Which folders first**\
Which folders get indexed at the start, and should Moki show Finder tags it didn't create, or only its own?

* [ ] **Investigate: a personal vocabulary for dictation**\
Dictation should learn your unusual words (Psymail, Gooey, Jev, Moki, people's names) and get them right more often over time. Two layers to explore: feeding a vocabulary list to Whisper as a prompt, and a cleanup pass where Claude fixes the transcript using names from People and the second-brain index. Corrections you make would add words to the list.

- [ ] **Spike: dragging across views**\
How does an item drag from a Moki view into a website's view and back, and between split panes? Try drag and drop across web views, a drag preview drawn by the chrome, and injected drop handlers in embedded sites.

* [ ] **Tag write-back**\
Should tags stay only in the index, or also be written back where a source supports them, like Notion properties or Gmail labels?
* [ ] **Vault and Obsidian**\
Should the vault stay fully Obsidian-compatible so Obsidian can open it, or just borrow the format?

## Later

- **Discord in Messages.** The relay, live reading and cache come after the other messaging sources work.

* **Importing from Zen.** Bring over existing tabs and workspaces.

- **Unexpected connections.** It's worth revisiting, but the bubbleboard version wasn't useful, so it needs a fresh idea.
- **Gooey canvases for area views.**
- **Psymail web port**, if panes fall short.
- **Light mode.** v1 is dark-only; the tokens already have light values.
- **Body space.** Notion's Exercises and Body Log plus Hevy, after the first release.
