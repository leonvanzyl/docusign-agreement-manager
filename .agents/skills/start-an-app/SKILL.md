---
name: start-an-app
description: Interview the user in depth about what they actually want to build, then scaffold a working full-stack web app around it. Use when the user wants to start a new app, website, prototype, or SaaS; when they don't know what tech stack to pick; or when they want a solid working starting point fast. Covers requirements discovery, project setup, database (SQLite or Postgres in Docker), sign-in, file uploads, payments, AI features, and a real landing page and dashboard.
---

# Start an App

Turn an idea into a running web app. Understand the idea properly first, then build. The result is the user's actual app from the first commit — their name, their pages, their data model, only the infrastructure they need. It should never feel like a template.

**Understanding comes before scaffolding.** The interview is the most valuable part of this skill, not a formality to get through. Ten minutes of good questions produces an app the user recognises; skipping them produces a generic CRUD shell they have to rewrite. Do not run a single command until Step 2 is agreed.

## Ground rules

- Explain every choice like you would to a smart friend who doesn't code. Say "a place to store your data" before saying "database". Introduce each technical term once, briefly, then use it normally.
- **Dig until it's clear.** Follow up on vague answers rather than filling the gap with an assumption. "A site for my club" is not yet a spec — what does a member *do* there?
- Ask about one topic at a time. During discovery, follow the conversation rather than reading from a list; for the technical choices, one question at a time with a recommended default so the user can just say "whatever you recommend".
- Surface gaps as suggestions, not interrogation. "Most apps like this need a way to edit an entry after posting it — want that in the first version?" is better than a checklist, and it's where the user learns what they actually want.
- Recommend, then respect. If the user picks the non-recommended option, go with it without relitigating.
- **Never `drizzle-kit push`.** Schema changes always go through `db:generate` then `db:migrate`, every time, from the very first table.
- The app is scaffolded **in the current working directory** — that folder is the project root. Never create a subfolder for it and never `cd` into one; the user already chose where the app goes by being there.
- The stack is fixed: Next.js, TypeScript, Tailwind, shadcn/ui, Drizzle, Better Auth. The interview chooses *within* it (which database, what kind of sign-in, uploads, payments, AI) — it never swaps out these pieces.
- **Better Auth owns anything that belongs to a user.** Where Better Auth has a plugin for an integration — payments above all — use the plugin, never the provider's standalone SDK wired in beside it. One source of truth for the user, one place customer ids and webhooks live.
- Prefer choices that survive deployment. Where a feature works differently in production (uploads, Postgres), the local setup and the deployed setup must be the same code switched by an environment variable — never a second code path the user has to remember to change.
- All commands, package names, and config live in the reference files, never in this file. Load only the references for the branches the user chose.
- If a reference command fails because a tool changed (renamed flag, different init flow), check that tool's official docs, use the current equivalent, finish the job, and tell the user at the end that this skill's reference file needs a refresh.

## Step 1a — Understand the idea

Start here and stay here until the picture is sharp.

> **"What are you building? Describe it like you'd describe it to a friend."**

Then *follow up*. Listen for the **nouns** (the things the app keeps track of) and the **verbs** (what people do with them) — those become the database tables and the pages. Keep pulling until both are concrete:

- "Walk me through it — someone opens the app for the first time. What do they do?"
- "And then what? What brings them back the next day?"
- "When you say *[their vague word]* — what does that actually look like on screen?"
- "Is there anything like this you already use, that this is better than?"

**Then say the data model back to them in plain words** and let them correct it. This is the highest-value question in the whole skill, because people who can't design a schema can absolutely tell you what's wrong with one:

> So the app keeps a list of **hikes** — each with a date, a trail name, distance, how it felt, and some photos. They're all yours; nobody else sees them. Have I got that right, or is there something else it needs to remember?

## Step 1b — Find the gaps

The user has told you the happy path. Your job is the rest. Run through these silently, and **raise only the ones that genuinely apply** — as a suggestion with a recommendation, not a quiz:

- **Whose data is it?** Private to each user, shared with a team, or public? This decides every query in the app, and it's the one people forget to say.
- **Can things be changed?** Most descriptions only cover creating. Editing and deleting are usually wanted and almost never mentioned.
- **Is anyone special?** An admin, a moderator, an owner who sees more than everyone else.
- **What does day one look like?** The app opens with zero data. What should be on that screen?
- **Anything time-based?** Due dates, reminders, recurring items, "this week" views.
- **Does anyone need telling?** Email on signup, on invite, when something happens.
- **Phone or desktop?** Changes layout decisions early and is cheap to ask.
- **What is deliberately *not* in version one?** Ask directly. Naming what's out is what keeps a first version shippable, and it gives you permission to leave things out instead of guessing.

Two or three of these usually matter. Raising all eight is an interrogation — pick the ones that would change what you build.

## Step 1c — Technical choices

Now the branches. One at a time, each with a recommendation. **Don't ask what they've already told you** — if the description made an answer obvious ("a paid newsletter", "a photo journal"), confirm it in passing instead: *"Sounds like people will be paying for this — I'll set that up."*

1. **"Who's going to use it — just you for now, or other people / the public?"**
   → Just me / trying an idea: recommend **SQLite** ("your data lives in a simple file inside the project — nothing extra to install or run").
   → Other people / production ambitions: recommend **Postgres** ("the database most real apps use — it runs in Docker on your machine, so it's one command to start and nothing is installed permanently, and it's the same database you'll use in production").
   → Postgres needs Docker Desktop installed and running. Check before promising it; if they don't have it and don't want it, offer SQLite or a free hosted Postgres instead.

2. **"Do people need to sign in?"**
   → No accounts: skip auth entirely.
   → Yes: recommend **email + password** as the default ("works immediately, nothing to configure").
   → If they want "Sign in with Google": say yes, and set expectations — it needs a free Google Cloud setup with a few copy-paste steps; offer to walk through it together or add it later.

3. **"Will people upload anything — photos, documents, a profile picture?"**
   → No: skip file storage entirely.
   → Yes: no decision to make, so don't offer one. Say what happens: "While you're building, uploads save into a folder in the project. When you deploy, they'll go to proper cloud storage automatically — same code, you just connect a store." Only mention Vercel Blob by name if they ask.

4. **"Will people pay for anything — a subscription, or a one-off purchase?"**
   → No: skip payments entirely.
   → Yes: recommend **Polar** ("they handle sales tax and VAT worldwide for you, which is the part that usually bites"), with **Stripe** as the option if they already use it or need it.
   → Payments need accounts. If they said no to sign-in, say so plainly and add it: "we'll need accounts too, so the app knows whose subscription is whose."
   → Set expectations: everything is set up in test mode, no real money, and going live is a key swap later.

5. **"Should the app have any AI features — like a chat, or generating text or content?"**
   → Only include AI plumbing if yes. If yes, mention they'll need an OpenRouter API key (free to create) and you'll show them where to get it — one key, many models.

6. **"When someone lands on the app signed out, what should they see?"**
   → Decides the front door: a real landing page for something other people will sign up for, or straight into the app for a personal tool. Don't assume a marketing page — `references/pages.md` has the call.

## Step 2 — Build sheet

Restate the plan in plain words before touching anything. Example shape:

> Here's what I'll set up: **"TrailLog"** — a hiking journal, just for you.
>
> **What it remembers:** hikes — date, trail, distance, how it felt, and photos.
> **What you can do:** log a hike, edit it later, delete one, see them newest-first.
> **Signing in:** email and password, so it's yours alone.
> **Photos:** saved in the project while you build; they move to cloud storage when you deploy.
> **Not in version one:** sharing hikes with friends, maps, and the stats page — easy to add once the basics feel right.
>
> Sound right?

Include the data model and the explicit **not in version one** list — those two lines are what stop a rewrite later. Also mention anything that needs something from them before it can work (Docker running, an API key, a provider account), so there are no surprises mid-build.

Get a clear go-ahead. Adjust anything they push back on. If the answer reopens what the app *is* rather than tweaking a detail, go back to Step 1a — that's cheaper now than after the schema exists.

## Step 3 — Scaffold

Work through these in order. Each reference has a **Verify** section — complete it before moving on. Every path in them is relative to the current working directory.

1. Base project → `references/stack.md`
2. Database (SQLite or Postgres-in-Docker branch) → `references/database.md`
3. Sign-in, if chosen (email+password, optionally Google) → `references/auth.md`
4. File uploads, if chosen → `references/storage.md`
5. Payments, if chosen → `references/payments.md` (requires step 3)
6. AI features, if chosen → `references/ai.md`
7. Landing page and dashboard → `references/pages.md`

The order matters: payments and uploads both extend what step 3 built, and step 7 needs all of it in place. Anything that changes `src/lib/auth.ts` means regenerating the Better Auth schema and running `db:generate` + `db:migrate` again — the reference files say where.

## Step 4 — Make it theirs

This is not a polish pass; it is most of the value. The scaffold in Step 3 is infrastructure — here the app becomes recognisably theirs.

- Name the project after their idea (package name, page titles, visible branding).
- The schema tables are the **nouns** from Step 1a, with the ownership rule from Step 1b applied — a `userId` column and every query scoped to it if data is private.
- Build the real pages: the front door and dashboard from `references/pages.md`, real navigation, and the **verbs** from Step 1a wired up — including editing and deleting if the gap-check said so.
- Seed nothing generic: every visible string should make sense for *their* app. No "Item", no "Welcome to Next.js", no lorem ipsum.
- Done when: someone opening the app would know what it is without being told, and the user can do the main thing the app exists for, end to end.

## Step 5 — Verify and hand off

- The dev server starts cleanly and the home page renders.
- `drizzle/` contains generated migration files, `pnpm db:migrate` has been run, and creating one real record works end to end. No schema was ever pushed.
- If sign-in was chosen: signing up, signing out, and signing back in works; `/dashboard` redirects when signed out and shows their own data when signed in.
- If uploads were chosen: uploading a file through the app's own UI saves it and it renders after a refresh.
- If payments were chosen: the test-mode checkout completes and the paid state is visible server-side.
- **Missing keys degrade, never crash.** With `.env` values absent, the app still starts and the affected feature shows a friendly "not configured yet" notice.
- Close with a plain-language summary: how to start the app (including `pnpm db:up` if Postgres is in Docker), what each entry in `.env` is for, and two or three sensible next steps.
- Where local and production differ, spell out the one-time switch: connect a Blob store for uploads, point `POSTGRES_URL` at a hosted database, swap payment keys out of test mode. Each is a setting on the host, not a code change — say that, because it's the part people expect to be hard.
