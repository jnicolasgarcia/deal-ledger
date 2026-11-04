# Process log

**Tool:** Claude Code for the whole build, in one session, with Claude in a separate chat as a planning partner and second reviewer. **Live:** https://deal-ledger-seven.vercel.app

## Approach

I treated this as a data problem first and a UI problem second. Before any app code, I asked Claude Code to profile the workbook read-only and report every status spelling, every font color, blank cells, and how `target_weekly_view` related to the client tabs. That surfaced most of what shaped the build. This copy of the sheet has no config tab, so the vertical has to come from the tab name. There are 13 spellings of 8 stages, only one blue cell in the whole workbook (Power = "400A"), and 7 deals with no address. The target view shows only 6 of the 18 deals and has notes edited by hand, so I treated it as a shape to follow, not a list of deals to show. I wrote the rules down in `ASSUMPTIONS.md` before writing any schema, and every later step follows that file.

The order after that was: schema and ingest, then the security boundary, then the operational grid, then the weekly view, then deploy, then logs and admin. I deployed as soon as the two core views worked, behind login from the first public URL.

## How I used the AI

I set the AI up before the first prompt with a `CLAUDE.md`: the non-negotiables (one dataset, never drop or rewrite a source row, permissions enforced in the database, never invent data the source doesn't have), real examples from the workbook, and a definition of done. A task only counted as done once build and lint passed, and the AI had to show me the command output, not just say "done". After that, each step was one prompt with explicit checks, and the AI stopped to ask whenever something was a business rule rather than a technical choice. I made those calls myself: "Under Contract" means In Contract, since the note confirms a closing date and deposit. "Listed" maps to Unknown and is flagged, because it isn't an acquisition stage. Market comes from Metro, not City. Blue text means an assumption, documented as resting on a single cell.

I verified rather than trusted. Every migration has a SQL check script that runs inside a rolled-back transaction. The ingest reconciles rows read against rows written per tab and stays idempotent across repeated runs. `test_rls.py` signs in as each role through the public API and prints a pass/fail matrix. The app also has browser checks for every role. I re-ran the security matrix before building the admin page, to cover everything added since roles were first set up.

## What I fixed or redirected

- **Security came too late in my first plan.** It had the app reading through privileged access until roles were added. A review caught it, so I moved the whole authorization boundary ahead of any UI. RLS is on from the first migration, with explicit grants. Edits go through one audited function with a field allowlist, and not even an admin can update deals directly.
- **Migration 002 failed in Supabase.** PL/pgSQL reads an `IF` condition up to the first `THEN`, so a `CASE` inside it broke the parse. The AI couldn't catch it because it had no database to run against, so I fixed it by hand.
- **The AI only half-built the grid at first.** It skipped editing and history, so I asked again. It also missed that RLS hides other users' names from editors. I asked for a narrow function that returns only display names, instead of widening the profiles policy.
- **I kept the source honest about stage dates.** The sheet has no stage dates, so days in stage starts unknown, never zero, and Days On Market is never used as a substitute.
- **Sign-up and default role.** The AI caught that public sign-ups were still on in Supabase. I turned them off and made new accounts start with no role, so a missed setting can't expose data.
- **Real bugs from manual testing:**
  - Signing in from a stale login tab didn't navigate, because the proxy redirected a server-action POST.
  - After sign-out, the previous user's page stayed in the browser, both in Next.js's route cache and in the back/forward cache. Sign-out is now a full page load.
- **A UI gap I found on the live site.** Walking through the live weekly view, I found that deals without an address all looked identical, and sites outside their search market (Culver City under Atlanta) weren't visible. The cards now show city and state.

## Data assumptions

These are all in `ASSUMPTIONS.md`:
- **Statuses:** a case-insensitive status map, with the raw value always kept in `stage_raw`.
- **Columns:** fields shared by all client tabs are typed columns. Everything vertical-specific is kept raw in `attributes`.
- **Blanks and messy values:** blank or unmappable stages become Unknown and the row is kept. Rows with no address are kept, with a fallback key. Numbers are parsed only when unambiguous, and the original text is kept.
- **Notes:** kept raw. Nothing is extracted from them.
- **Re-imports:** the ingest skips any deal a user has edited in the app, so a re-import never overwrites someone's work.

## Scope calls

**Deliberately skipped:**
- **The rollup and the map:** stretch goals, so they come after the core.
- **Confirming assumptions from the UI and editing vertical-specific attributes:** these two belong together.
- **A third-party design skill:** the download link was dead, so the design rules went into `CLAUDE.md` instead.
- **End-to-end Playwright tests.**

The weekly view was where I spent extra time. I asked for three layouts with their trade-offs before any code, then chose the presenter layout: one screen per vertical with an overview first. It matches how the meeting already runs, market by market, and fits a 720p projector. The other options were a long scroll, which loses your place in a live meeting, and a board with nine stage columns, which is too narrow to keep the deck's numbers.
