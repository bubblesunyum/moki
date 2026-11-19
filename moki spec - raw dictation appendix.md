# Your words

Everything bubbles said in the conversation that shaped this spec, verbatim and in order (dictation errors left as spoken; "GUI" means Gooey, "SciMail" and "Cymail" mean Psymail, "Heavy" means Hevy).

**1 · Nov 14, 6:05 pm**

I'm thinking about taking my content in Notion now that I have several different distinct areas that are storing stuff about my life and my work. And I also have the harness, the code harness on my computer, which I think you might be able to see from here. My computer's on. And it has a dashboard, and I'm just thinking of a way to co-locate these things into one web app. I was thinking the word that came to mind was Life OS, and I was thinking about how Notion could be more or less the database store for this stuff. So the app would use the API to access the data. Or maybe there would be like some sync to an actual database or something. I don't know. I wouldn't want to run out of Notion capacity, API capacity. But it is nice to be able to have Notion be the backing store, because it's still user-friendly enough to browse, but it's not nice enough to provide the UX I'm looking for a lot of this stuff. So I'm just imagining a web app that lets me switch views between my gardening stuff, my exercise stuff, my work stuff, and then have a robust and ever-changing and ever-evolving UX around those things as they evolve themselves. Do you have thoughts on this?

**2 · Nov 14, 6:09 pm**

These are great thoughts. Thank you. I want to clarify that Florets was about watching my screen while I talked so that I could point out areas where things needed to change as I was doing app development. So this is quite a bit different than that. And GUI is similar, but GUI is more about having a canvas where I can co-locate a bunch of different disparate things in one spot on an infinite canvas. It's kind of like an infinite canvas browser. So this is different. I do agree that GUI could somehow maybe integrate in terms of interface building, but it might do so through the underlying design system that GUI ends up building as part of its fundamental structure. But what I'm concerned about with the separate stores is I really don't like the idea of having to keep things in sync. That's a lot of complexity, a lot of space for error, and it just adds more work. If we did just use Notion as this data store, then that would speed things up dramatically. We could just see if that works, and then if API becomes an issue, I mean, I am paying for Notion now, then we can just look at it later.

**3 · Nov 14, 6:10 pm**

I don't plan to do any high-frequency logging right now. I already use the Heavy app for workout training. You could take a look at Notion and give me some thoughts on what you see.

**4 · Nov 14, 6:14 pm**

Oh no, that's a great overview, but no, I don't want to do any work right now. I'm just I want to stay in the brainstorming phase for a while. And so in that vein, I want to add to this that I'd like to incorporate Craft docs from the Craft app, and I'd like my email to live here too, and I'd like my calendar to be here, and it would be great if it had a native extension of some kind where it could hook into things that could run on my computer natively too, like if I wanted to start and stop servers, for example, or trigger some native action like copy text from screen, which is something that Control Center Pro does. And it'd also be cool to show, you know, open code usage, all the things, most of the things that are in Control Center Pro could be pulled over to this. And then I'd probably replace how Control Center Pro, well, let me restate this. I'd probably show this new Life OS thing in place of Control Center Pro via some sort of web view

**5 · Nov 14, 6:36 pm**

Oh yeah, that's a good call. I forgot about that cross app drag and drop thing that I want to do. I definitely want to do that. However, and I agree with everything that you've said, except email. I've already built SciMail. It's a Swift app, but I think porting it over might not be too difficult somehow, or yeah, I think maybe making a web version could make sense.

**6 · Nov 14, 6:38 pm**

Oh yeah, that's a good call. We could consider doing the engine on the Mac because I already used Cymail on my phone natively, so I don't need it to work remotely. Cymail is spelled Cymail is spelled P-S-Y-M-A-I-L, by the way. You should be able to look at it. I mean, you're the one who built most of it.

**7 · Nov 14, 6:39 pm**

Dang, you're making it sound easy. This is exciting. Definitely don't need it to work on another Mac right now because I only have one computer.

**8 · Nov 14, 6:41 pm**

heard on cross app stuff. i’m thinking it could be cool to use sth like jev to dynamically convert one app objects from one format to another so that the system doesn’t have to preamp every possible transfer

**9 · Nov 14, 6:44 pm**

yes those are great instincts. some objects can be different or change even from the same app, think email content diff every time an email is dragged over, so we should think about using the cached stuff from the last time this kind of transfer happened and then still invoke jev to do the smart dynamic matching for stuff that is potentially diff each time

**10 · Nov 14, 6:45 pm**

love these ideas

**11 · Nov 14, 10:50 pm**

i'm back on my computer, can you look into psymail, gooey, ccp, reminders, calendar, and anything else you think is relevant to start to come up with a picture of how this could work together?

**12 · Nov 14, 11:00 pm**

awesome work! craft integration and sync was absolute disaster. once i started just loading craft directly as a webview in ccp, it was so much better. so we'll have to figure out some way to do something similar for lifeos. psymail ui might have to be ported to web, unless we can figure out a way to elegantly make multiple webviews loading multiple diff sites appear to be in the same dashboard space in a way that is more integrated than it currently feels in ccp. we won't use apple's apis for calendar since gmail and icloud calendars are well-supported with basic apis. reminders may have to use native apis. we can work on unexpected connections but its old iteration was pretty useless, so it'll be a later feature

**13 · Nov 14, 11:02 pm**

hmm, interesting. will def need to explore the ux more to get this right. it's not quite there based on what you're saying cuz i can already see how this will be annoying to use in some ways. but the core ideas are worth a deeper look. what was that about a whiteboard? you can do that now?

**14 · Nov 14, 11:04 pm**

sure

**15 · Nov 14, 11:13 pm**

that's cool. We still want to include craft as a data source because I want to be able to create views that pull in information around a topic across several different sources and display some sort of visual or UI for it.

**16 · Nov 14, 11:14 pm**

Okay, yeah, this whiteboard is cool, but let's move to a document for now, since we can iterate more rapidly there and start to draw up a spec for this.

**17 · Nov 14, 11:17 pm**

is there some way to give los access to the tabs i have open in zen browser?

**18 · Nov 14, 11:18 pm**

yes pls

**19 · Nov 14, 11:25 pm**

want to also integrate slack, discord, and apple messages

**20 · Nov 14, 11:28 pm**

gosh that's so annoying

**21 · Nov 14, 11:28 pm**

is there a secure way to add some basic chime data?

**22 · Nov 14, 11:30 pm**

can my hevy app data be integrated too?

**23 · Nov 14, 11:31 pm**

yeah add everything we talked about with the tradeoffs and caveats to the spec

**24 · Nov 15, 12:10 pm**

I think that a GUI canvas will probably be embedded into this app at some point. It'll be a way to view things, or like basically a page type that you can create and browse. But the overall structure, I think, is going to be something like there's going to be a sidebar, and it's going to, I wanted to create connections across different apps that do the same thing. So I want to be able to look at messaging, for example, as one unit. I want all my messaging in one place, and I want to be able to filter it to see the different types. So that means I want email and iMessage and Discord and Slack, all of it to be in the same messages universe. And I want it to be, you know, for one contact like Brooke, I want to be able to see a thread for Brooke and all the latest things from her. So if she just texts me, I'll see that. But then if she then sends me an email, I'll see that above the text or whatever. They're all in one thread. And then I'll be able to filter the view. To cut out emails or cut out a specific source if I really want to get specific. And then since a lot of these don't have API support, if we build this as an Electron app, then as long as we can just read most of the stuff and pull in the content, which I know we can't do for Discord, which sucks, but we can then make it so that when you want to respond, it opens the app in a web view. And maybe we can get even clever with that, where we open the web view in the background, and the UI accepts the input, and then somehow maybe an agent drives the web view in the background to actually send the message.

**25 · Nov 15, 12:12 pm**

Okay, good points. I think if we have Discord in the background, right, and it's just behind the view that I'm working on, and I'm typing in maybe like a native text box, and that typing is sent immediately to the text box behind the visible view where Discord is loaded, how is that different? That's not different. It's just me typing. It shouldn't be botted. That's not a bot. That's me typing and just relaying the types through one native text box into the Discord text box in the web view. So I'm still using it. It's just hidden.

**26 · Nov 15, 12:14 pm**

Okay, nice. Um, Is there an API to read Discord's content? Oh no, you told me that. Oh, there's no way to see private content. That's annoying. So even if I load the web view of Discord in the background, if some part of code tries to scrape that, that's not allowed. That would be detectable.

**27 · Nov 15, 12:15 pm**

Okay, that should generally work, especially if we keep a cache of Discord content and then just sync it when the actual app is open.

**28 · Nov 15, 12:16 pm**

Yeah, you can add it. And I also just want to make a note about what you said about the people thing. We should definitely have a people section of the app. But also, I don't want to rebuild a people database to do it. I just want to use Google Contacts. So we'll just, even if we don't build even if we build an interface that adds this extra data to track contacts across different systems, we can just add that data as fields in Google Contacts. So we're reusing the people API and that whole system rather than building our own.

**29 · Nov 15, 12:21 pm**

Nice, thank you. Let's make a note that Discord support is later. We're not going to focus on that first or early. And then I think as a result of this, we'll have to make sure that Cymail's engine can be used without its UI, because I would rather, I think I would like to integrate all of the messaging stuff in one web UI. And then next, I also want to mention that I would like to have two sidebars that sit next to each other horizontally. They can be both toggled on and off. The leftmost one is the main thing that switches you between looking at messages or people or calendar. And then the secondary one is basically a vertical tab bar for kind of how browsers would have it, like Arc. And then what you can do, I'm not sure exactly how this appears, but you can create workspaces of some kind, and those would be clickable on the far left pane, and they would load different sets of tabs. So that's kind of like Arc's spaces idea. But the cool thing is that this can load and work with content both on the web and on your computer. So native and web content. So we'll have to think about how to lay this out in a way that web views and native views can coexist, maybe? Maybe that's not necessary, but that's an idea.

**30 · Nov 15, 12:23 pm**

Yeah, I hear you, but I think the shell will have to stay native. So these panes might, and like the Chrome will have to be native like it is in GUI, because that's the only way we're going to be able to show full embedded web views without running into the iframe issues that GUI already solved.

**31 · Nov 15, 12:26 pm**

Cool. Yeah, I just reopened my computer for you. Yeah, I love this idea because this basically turns it into a browser, but it allows embedding and creating native views alongside it. So we might even just do custom native views for things like the unified messages list, and that way dragging. Yeah, I'll have to see how it works. I guess I'm not sure exactly how dragging across these different things will work, but that's something that we should note for a spike to see what are some cool ways that we could support dragging between native and web views. But I do like the idea of being able to create native views that are really smooth and fast, and then right alongside them, just like open Notion tabs and craft tabs and any website. And so that's the sort of stuff that would live in the secondary vertical tab bar. And then also in this design, the content part on the right side could be split, so it could be split view, or it could be, like 4 up. And those things are also saved in the workspace.

**32 · Nov 15, 12:28 pm**

Well, no, that's what I'm saying, is that if the Chrome and the app shell are native, then a lot of these things would not be web views. They would just be native Swift views. So like the idea is that, imagine we have a 2-up, and on the left content is a native Swift view, and it's showing me a messages list that is a unified inbox. And on the right side, I just have the craft website open. That's an example of one side having a completely native view that is custom that we built, and then the right side is just craft as it is on the internet.

**33 · Nov 15, 12:33 pm**

Nice, this is awesome. Yeah, I think when we want to do custom things that upload and change in real time, you know, GUI style, where we're using GUI's Mochi editor, for example, that will all be web. So we'll just show that in a web pane. And I also want to mention that I would like to have this also work as a second brain type thing that can work across systems to build a connection space of stuff. So I think what would be cool is to somehow create a shared index that references content across these systems. So that would look like indexing into craft docs and using whatever it does, tags, organization, folders, whatever, to put it into our own organizational system. And it's probably simple, just indexing, or like how agents have memory and connect things with just simple connection keywords or something, you know. And then something similar with Notion, where it does the same sort of indexing, and it allows just mapping these different systems into one shared data space, so that I could work across them seamlessly. And then maybe even, you know, an Obsidian style markdown thing that allows me to save stuff locally. And then on top of that, as part of that system, it would be really cool to integrate either into Notion or Craft and be able to tag anything, any website, any web page, any email, any note, any reminder, any sort of item across any system with a tag or any kind of metadata that this shared network system, this second brain system, could index into and create relationships with across all these systems.

**34 · Nov 15, 12:36 pm**

Nice, that's great. That's not quite what I meant about GUI's editor. I was just saying, for example, because GUI's a native app to its Electron. So I think it's Chrome. Is that true? Yeah, it has to be. It's Chrome is not web. So what I was saying is that if something is built in the GUI editor, which could now just be directly integrated into the app somewhere because its native components can now be just rendered. If something is built with GUI, that creation can appear in a web frame inside LifeOS.

**35 · Nov 15, 1:36 pm**

Another thing I want to do is integrate Claude directly into the tool. I would love to be able to use Claude and have it work across the systems in the same way that I can see them. So using the connections and the indexes, I'm wondering if I integrate Claude via the API like that, does the harness that Claude Desktop uses to have conversations with me also get run? Or is that AI assistant harness only run when I have chats within Claude Desktop?

**36 · Nov 15, 1:38 pm**

Yeah, please add it. But again, just like the other things I'm building, this is for me, so I'm not worried about making it available to the public. So is there an API key I can just use for my personal use on my Claude Pro subscription?

**37 · Nov 15, 1:39 pm**

Prose usage will be enough for now. I already use it to do this work. All I'm saying is that I would bring that work into LifeOS rather than doing it in Claude Desktop.

**38 · Nov 15, 1:43 pm**

Since I'm trying to bring most of my browser work into this tool too, I want to think about bringing a lot of the features over from Arc and from Zen browser. So I just want to make that note and start with some of the must-haves, and one of those is the peek feature, where you can shift click to open a site as an overlay before opening it fully as a new tab. And definitely Command Shift C to copy the current link. And what else? Oh, and certainly pinned tabs feature and the favorites section that turns tabs into little pinned icon squares.

**39 · Nov 15, 1:45 pm**

Oh yes, good call. Definitely want Command T as a omnibar for across the app features. Yeah, I guess history too. Would love to be able to reuse a lot of this work from existing open source packages and not roll our own. That should be sort of a standing principle for a lot of this work. And I certainly, most certainly, definitely want to have custom site boosts where I can turn on and off augmentations that I make to certain sites. Let's leave out auto archiving, and importing tabs can come later.

**40 · Nov 15, 1:46 pm**

Let's add another source for readwise reader. I want that content that I saved and highlighted and all that stuff that's in there to be accessible too.

**41 · Nov 15, 1:48 pm**

Awesome, thank you. Please add to the spec that there will be a right-hand side pane as well. This will be an inspector and a support pane of all kinds that shifts based on the currently focused context. The agent interface might live there too, or it might float in the bottom right. I'm not sure yet.

**42 · Nov 15, 1:49 pm**

Is it possible to get visibility into my Claude conversations also in this view? Could I also bring in my conversations in Claude Code and work with both my Claude Cowork stuff and my Claude Code stuff within LifeOS?

**43 · Nov 15, 1:52 pm**

Well, I could just use Claude in the browser, right? And then as long as the actual Claude desktop app is open, it can do all the things that are accessible or required for computer access.

**44 · Nov 15, 1:53 pm**

Yes, please add both. And also, you just reminded me that I want to have voice be a first-class way to interact with this whole tool. I'm wondering if there's a way to hook into Claude's voice system, since it's so good at dictation, or is there other better ways?

**45 · Nov 15, 1:56 pm**

Oh, interesting. You know what? I think that we need to make this system a little bit more intricate. I definitely do not like Apple's version of dictation. It's not nearly as good as Claude's. So let's look at WhisperKit, if it can be integrated for free locally. And then what I really want to do is think about if Command T is held for more than 1 second, it sort of gets stuck and turns dictation mode on. And then it listens and it takes that input as a prompt and maybe passes it through Jev to figure out what should fulfill the request that was just made. And then it can route to either like a Claude agent or a Notion request or an open code agent or something based on the complexity and the connections that are needed and stuff like that.

**46 · Nov 15, 2:00 pm**

Yeah, that sounds good. One thing I'd like to put a note on just to investigate later with this flow is that I noticed that Claude will often learn certain weird words that I tend to use that are not necessarily common or instantly recognizable. And then as I speak, it just gets them right through dictation a lot more often. I'd love to have something like that built into the system too. And I saw something from Claude recently on a blog post that says they often ask their agents to take any reversible actions by yourself and report to me what any high priority things that you did, but then always check in with me before anything that's potentially irreversible. What do you think about that as a principle?

**47 · Nov 15, 2:07 pm**

I would like to think about how this app can use the same organizational technique as the app Capacities that was just recently launched. And relatedly, being able to build custom views of things based on those organizational tools. I think in Capacities it's called queries. I don't like that term, but I love the idea. And so basically you can assemble views, little windows into ideas based on a bunch of different things. And so rather than having a folder for a project, you can assemble a project's work from its metadata queries, for example. But I want to make this a lot simpler and not a technical interface. It should be a very friendly version of this.

**48 · Nov 15, 2:09 pm**

Yeah, I love this. Great job putting that together and coming up with those ideas. Please add to the spec.

**49 · Nov 15, 2:11 pm**

Oh yeah, another thing. Yeah, I agree that I want to do that about figuring out what the first build will have, but I want to get a very, very, very complete full picture of everything first, so that the architecture can be continued to be refined before we start building. That's a very important step. So another piece I'd like to add now is thinking about how this tool can access my file system and work the same way with tags and the capacities and the lenses and the object types and all of that by indexing into my probably certain folders, or I mean, in the, you know, I can add more as I go just to keep things performant, but indexing into my files so that all of that stuff can be connected into the network also.

**50 · Nov 15, 2:14 pm**

Awesome job with that. Great work laying that all out. One thing I just want to keep in mind too, now that I'm thinking about it, is it would be cool to think about when adding a new source. For example, when adding craft, mapping its organizational structure into how LifeOS has its organization. Or similarly, thinking about when adding Notion, mapping Notion's structure into LifeOS so that no matter what source I add, I could still basically navigate the entirety of those sources via LifeOS's architecture and still get to everything that's in any of those systems, but do it through the structure that LifeOS provides. And so maybe there's some way, there's some fun mapping flow that's AI-driven whenever a source is added to be able to create and verify that mapping.

**51 · Nov 15, 2:17 pm**

That's great. Nice work, thank you. What so far do we have in the main sidebar? We have messages, people, lenses, but lenses are probably going to be its own section with subsections. Calendar. What else should show up in the sidebar?

**52 · Nov 15, 2:26 pm**

Okay. Yes, that's pretty good. With a few tweaks. I want tasks to include linear, so that'll be a source. And then the people I want to hook in with my iCloud stuff too. And let's rename bookmarks. I mean, let's rename reading to bookmarks. And let's, I'm thinking about pulling in the concepts from SciMail here. So let's pull in commerce as a lens and notifications as a lens, since those things span other stuff. And then we can add the current feed that's in SciMail onto the today screen. So now I'm seeing here that email is kind of spanning different places. It's no longer just its isolated thing. Emails can show up in a bunch of different places where they're relevant. So in the messages tab, maybe that's not the place that I'll see emails about orders or app notifications or newsletters. The emails that show up in the messages tab will be stuff that's sent to me from people directly or groups. So that's sort of what messages is about. It's about stuff that I need to respond to or work with individually. And then okay, we have that. Yeah, health will be a thing. Maybe that's a lens. And I, you know, stuff like my job search will probably be a lens.

**53 · Nov 15, 2:29 pm**

Yeah, updates can fold into notifications as, these views will be filterable, so you could see different subsets of them. And the current things that show up in SciMail's notifications can be filtered to see just those, or you can filter just to the what's shown in SciMail's updates tab. Newsletters is just a duplicate of the feed that I haven't gotten rid of yet in SciMail. And also, you mentioned that workspaces appear below everything. And remember, I said that there are two sidebars on the left side. The workspaces is the secondary sidebar to the right of the main one. So that's where the vertical tab list with the workspaces exists.

**54 · Nov 15, 2:30 pm**

Can you copy all of my responses from this conversation into a new tab in the Claude doc so that we can reference the things that I actually said for building the spec?

**55 · Nov 16, 6:33 pm**

Perfect, thank you. Can we add an idea about reminders hooked into an agent in the background that can maybe take specific actions based on my reminders? I think this is something we'd have to explore and see what actions we'd want it to take and when it would do those things and how it would check in with me on how it's responding to reminders. And give me ways to direct it to do different things and yeah,

**56 · Nov 16, 6:37 pm**

might consider having some sort of iOS app that can hook into this system somehow too. And I think a great feature to go along with that would be to add Siri support so that I could say things like the trigger word and then ask, I don't know, my assistant's name, let's say Moki. I could have Siri respond to ask Moki to do something, and then the app could hook into my Life OS and all of its features and capabilities and take action on my behalf. That way I could run Life OS and this agent through Siri.

**57 · Nov 16, 10:44 pm**

can you create a design in this figma page https://www.figma.com/design/EKApBzDoI6hlAwkgJtq4KR/playground?node-id=247-18&p=f&t=UyLZqcxAguVpRq1P-11 for what you think it could look like based on what we've talked about so far? thinking of naming it lenses

**58 · Nov 16, 10:57 pm**

nice! pls put code and people into a more ••• menu at the bottom of the upper list in the lhs sidebar. and put a commerce tab under tasks. create another screen that shows what the commerce tab could look like

**59 · Nov 16, 11:20 pm**

Yeah, you can make that change. I also have just thought of another feature I'd like to add. When when things are added, like a YouTube video to the system, I'd like to be able to attach automations to those kinds of activities. So when a YouTube video is added, for example, one automation will be pulling the transcript and adding the transcript text to my database along with that link to that YouTube video. And relatedly, I'd like to have a browser extension that can capture and highlight websites just like the Readwise Reader extension does, and can accept links via the iOS app too. And then after those updates, can you go back to the design and um, keep in mind that the secondary left pane is about tabs in that universe. It's not about tabs across universes, like, there's no reason to see commerce twice, for example, once in the main side bar and one in the tabs side bar. also, let's swap these to dark mode and get rid of the background on the side bars. and i think you might've been right before that the tab bar might want to exist as this collapsable bottom part of the lhs sidebar. see if you can create a component that brings that to life. when the universe sidebar is expanded the tabs sidebar collapses into just a button that says "Tabs". and when the tabs sidebar is expanded the universes sidebar collapses into just the name of the universe. clicking either of the collapsed buttons expands their sidebar and collapses the other

**60 · Nov 16, 11:39 pm**

looking so good, nice work. yeah you can make the right sidebar bg-less too. can you remove the "Text • Email"-type tags from from the messages view and instead put a smaller icon on the avatar to indicate the type. i rarely like that kind of secondary label unless it's a really technical interface. for the craft pane, let's use craft's logo instead of the globe and get rid of the preamble "docs.craft.do". change the up-down arrows on the sidebar buttons that trigger the diff sidebars to just chevrons. pointing down for the universes button. pointing up for the tabs button. the tabs icon should be a vertical stack since that's how tabs appear. pls also add a sidebar toggle button to both left and right sidebars. and add back/forward navigation to the lhs sidebar right-aligned in the same row as the traffic light buttons. on the lhs, the sidebar toggle should sit just to the left of the button or tab-bar at the bottom of the pane. on the rhs, it should sit to the right of the button at the bottom of the pane. keep search looking consistent across the platform. just a magnifying glass is enough, like on the messages tab. add a bit more imagery to make it feel more realistic

**61 · Nov 16, 11:51 pm**

no that's okay. all of this looks great. can you add what it will look like when i'm looking at brooke's message to the messages frame?

**62 · Nov 17, 11:47 am**

Awesome, thank you. I've been thinking and I want to make a few changes, and I've started designing them out in this area here https://www.figma.com/design/EKApBzDoI6hlAwkgJtq4KR/playground?node-id=282-2125&t=UyLZqcxAguVpRq1P-11 You can see to the left of that frame what should appear in the drop down when you click the everything button at the top of the sidebar. So rather than having two separate tabs like it was before with the lenses and the spaces, now I'm thinking that instead we just have a drop down that basically controls the lens that we're looking at, the lens that we're looking through, you know? And so then everything underneath that is filtered based on the settings of that lens. So for example, if I switch the everything lens to GUI, then the today tab, the messages tab, the calendar tab, all of those things will be filtered to look at GUI related stuff. And then underneath that, there'll be the section underneath that right below the first divider is pinned tabs. And then after that is just tabs. So each space, each lens has its own configuration of this sidebar. So, you know, Cymail might only show the today thing, the messages thing, and the tasks thing, and then any tabs that are related to that lens. And then I switch to everything, and then all the other tab things come back. So then I'll see feed, notes, bookmarks, etc. again. And whatever tabs I had open for the everything space is then there. So the top drop down basically controls what is shown below it, and each they're interrelated in that way. And then there would be a way to change the configuration of these things. So if I picked the GUI project, then there's some settings thing that allows me to control how these views are constructed, like what filters and rules are used to show data in each of these sections. So like what filters are used to show messages, what filters am I looking at for the calendar, what filters on all of my tasks should show me just GUI tasks, stuff like that, you know? And so I can customize that per space. And I want to make one small revision to what I said earlier, where I was saying design changes don't have to be, messages from my design changes don't have to be added to the doc. Let's just update that so that conceptual changes make their way into the doc, just not fine-grained design tuning details. can you create a new Sidebar variant based on the link that I just above, and start to sketch out some of these ideas. I want you to think about the top level stuff like today, messages, calendar, task, commerce. Those are basically dashboards. So I want each of those to be more dashboard style. Not too visually overloaded. Keep it pretty spacious, but give it more grandiosity, more weight, more dynamics in the presentation, you know, especially on the commerce tab. This tab should include, you know, this will be hooked into my bank accounts, and this will be hooked into my, you already have receipts and my deliveries, and, you know, it's giving me an overview of my life with commerce. So think about it that way. And similarly with, you know, notifications, this is giving me notifications across all my different tech systems. So think about a way to present that information, you know? And similarly, like the today view is a dashboard of encompassing everything across this system. So I don't know, maybe sketch a few of those out.

**63 · Nov 17, 12:07 pm**

What do you mean by a lens inside a page? Feed should show at first just what SciMail shows in its feed. Maybe later we can connect if there's a way to connect, you know, what I see on my Google Home view, my Discover tab, And maybe later there'll be other sources too. Can you change the icon for everything to infinity and change the places icon to places, like a location marker? Because that's the places tab is for showing, you know, is for working with Google Maps and for saving and for looking at place data. So maybe it hooks into the Google Maps API and shows me my lists of places, or, and you know, I want to start thinking about every source that's connected having a way to hook into this app's internal database, so that, for example, if I have a Notion doc, a link to a Notion doc, I can put that in the internal database and then tag it with things. And then, similar to how capacities works, I can use those tags to help me build any sort of dynamic view, which includes those Notion docs. But that could be with anything. So I could add a link to a Google Places list and add tags. I could highlight some text on a page, and that highlighted text plus the link to it could have tags. You know, I want to turn everything into an annotatable thing that can be summoned dynamically at any time via these tags.

**64 · Nov 17, 12:17 pm**

Okay, I see now. What? Yeah, I think I'm inverting the idea of lenses a little bit, because what I'm thinking is that I think you're right that it's a higher level version of what we were talking about before. And also, it's also a lower level thing too. So, even if I'm looking at the GUI lens via the top drop down, I can still click new tab and generate a new view that uses rules and filters to give me a new look at data across the system. That's technically what we were talking about as a lens, but now it's like a mini lens, and the bigger ones that exist in the drop-down are higher level pieces that include all of those main categories that are at the top of the sidebar. So that's the shift there, is that I found myself wanting to have all of those categories per lens, and so that's why I inverted it. But the capability should still be there, even in the lower levels. So we might have to rethink the wording and the naming of this stuff. I don't know if it's still working.

**65 · Nov 17, 12:25 pm**

Let's go with space and lens for now. The top sections are also lenses. They're not universes. They're just special lenses that come pre-made. You can also add to them as a user. Create new ones that exist at the top, like that. The idea being that eventually you'll be able to create the interface for that lens. And this is where GUI fits in really nicely too.

**66 · Nov 17, 4:37 pm**

great work, ty. pls continue with the calendar, tasks, docs, files, and feed screens. i'm also not sure what you mean about where claude lives. and yes for a long-running task, the window should shrink and move down into the corner to show that it's been docked as a long-running task.

**67 · Nov 17, 5:30 pm**

Great work. Thank you. Now, can we add to both the spec and the design guide to prefer the morphing style that iOS uses for opening popovers and drop downs and other such emergent things? So, for example, the filter popover you just built, can you redesign that to have a morph animation and style?

**68 · Nov 17, 6:12 pm**

When the sidebar is collapsed, the right-hand side one, the, a Moki icon should appear in its top button area. In the same relative spacing away from the edges as the bottom button. Clicking it opens the sidebar and focuses Moki. You might not be able to do that easily in Figma, but you can just write it in the spec.
