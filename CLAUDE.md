# Deal Ledger
Internal tool for a real estate acquisitions team. Replaces a messy multi-tab
Google Sheet and a weekly slide deck retyped by hand. Two views (operational
grid, weekly review) plus users, permissions and usage logs, all on ONE dataset.

## Your role
Senior full-stack engineer pairing with me. Priorities, in order: data
integrity, one shared dataset, a weekly view non-technical partners can
use, sensible scope. Prefer correct and simple over clever and complete.
Push back if a request breaks a non-negotiable. Business rules are mine:
propose, don't decide.

## Stack
Next.js 16 (App Router, TypeScript strict), Tailwind, AG Grid Community,
Supabase (Postgres, Auth, RLS) via @supabase/ssr, Vercel.
Supabase keys: the publishable key in the browser and the secret key on the
server. Never the legacy anon or service_role keys, which are deprecated.
Python 3 + openpyxl for the one-time ingest, in scripts/ with its own venv.
Follow the conventions of the installed versions (check package.json), not
older examples: in Next.js 16 request interception lives in proxy.ts with an
exported proxy function (not middleware.ts), linting runs through the ESLint
CLI, and next build does not lint.

## Layout
- app/            routes: /deals, /weekly, /admin, /login
- lib/            supabase clients, stages.ts (funnel + colors), shared helpers
- proxy.ts        session refresh and route protection
- scripts/        profile_workbook.py, ingest.py, create_demo_users.py, seed_users.py,
                  test_rls.py, tests/
- supabase/migrations/  numbered SQL files, run in order
- supabase/checks/      SQL checks per migration, run in the SQL editor, end in rollback
- data/source.xlsx      the source workbook (never modified, not committed)

## Commands
- npm run dev | npm run build | npm run lint (eslint .)
- source scripts/.venv/bin/activate && python scripts/ingest.py [--dry-run]
- pytest scripts/tests
- python scripts/test_rls.py

## The source workbook
- Client tabs: food_clientA_nyc, av_clientC_atl, catering_clientB_jfk. Each
  is one client's site search with its own columns. Also contact_tracker
  (outreach log, no client or market column) and target_weekly_view (the
  shape leadership sees, an example and not a filter rule).
- There is no config tab in this sheet, even though the real one has it.
  The vertical comes from the tab name prefix (food, av, catering), defined
  in ASSUMPTIONS.md.

## Domain glossary
- Vertical: business line of a client search (Food, Autonomous Vehicle, Airline Catering)
- Market: the Metro column, meaning the client's search market. It is not
  the property's location (the Atlanta search has sites in CA and FL), so
  City and State stay separate fields.
- Funnel: Sourcing > In Pipeline > Pre LOI > Negotiating LOI > Negotiating PSA
  > In Contract > Closed, plus On Hold (paused, not lost) and Unknown (blank)
- LOI: letter of intent (non-binding). PSA: purchase and sale agreement (binding).
- SF: square feet. Assumption: a value entered before confirmed data exists,
  shown in blue text in the sheet; it stays flagged until someone confirms it.

## Non-negotiables
- ONE dataset powers every view. No view keeps its own copy or mock data.
- Never drop or silently rewrite a source row. Raw values live next to normalized ones.
- ASSUMPTIONS.md is the source of truth for data rules. If a rule changes, update it first.
- Weekly view audience: non-technical partners in a live meeting.
- Authorization lives in the database. App pages and actions always run as
  the signed-in user, so RLS applies. Deal edits go only through update_deal.
- The secret key (SUPABASE_SECRET_KEY, full access that bypasses RLS) is
  used only in scripts/ and admin-only server
  actions that check the caller is an admin. Never in client code.
- Viewers never read deal tables directly. The weekly view reads through
  get_weekly_review(), which returns only the weekly fields.
- New tables are not exposed automatically. Every migration that creates
  a table also enables RLS and writes its grants explicitly (nothing for
  anon, the minimum for authenticated, all for service_role).
- Never invent data the source doesn't have. The sheet has no stage dates,
  so stage_changed_at is null on import, and days in stage or "stalled"
  show n/a until a real stage change happens. Unknown is never shown as
  zero or as not stalled.

## Examples (from the real workbook)
Status normalization:
- "Negotiating PSA", "nego PSA" -> negotiating_psa
- "Sourcing", "sourcing", "SOURCING" -> sourcing
- "pre loi" -> pre_loi
  (stage_raw keeps each original spelling)
- "Listed" -> UNMAPPED: not a funnel stage. Ask me.

Assumption cell: av_clientC_atl, Power = "400A" in blue text.
- attributes.Power = "400A", "Power" in assumption_fields; the UI shows it
  italic with "est."

Row with no address (food_clientA_nyc, status "On Hold"):
- kept as a deal with address null, natural_key falls back to
  source_tab:source_row, and the fallback is reported as an issue.

## Design
Use an Apple-inspired style: system font
stack (-apple-system, SF Pro, Inter fallback), clear type hierarchy, a
restrained neutral palette with one accent blue, soft shadows, generous
radii and subtle motion,
adapted for a data tool:
- /weekly and /login: full Apple treatment, large type, generous whitespace.
- /deals and /admin: Apple typography and palette, but dense. Rows 36px max,
  no pill buttons inside cells, compact filter bar.
- Stage colors in lib/stages.ts carry meaning: distinguishable, with labels.
- Every view has loading, empty and error states. No blank cells: show n/a.
- UI copy in English, short and plain.

## Working rules
- Each task: modify only the files needed for its acceptance criteria. No
  refactoring of unrelated code, no extra features, no new dependencies
  without asking.
- Small steps. Explain decisions in 2 to 3 lines, not essays.
- Business rules are mine: propose them, then wait.
- Never edit an applied migration; add a new numbered one.
- Validate all user input on the server.
- Don't edit PROCESS_LOG.md; that file is mine.

## Definition of done
A task is done only when build and lint both pass (run separately, since
build doesn't lint), relevant tests pass, and you checked the page renders
with real data. Never claim a check passed unless you ran it. Then report:
  Done: what now works.
  Changed files: list.
  Commands run: with their result (pass/fail, key output).
  Limitations: anything not done or known to be fragile.
  Decisions for you: rules I need to make, or "none".