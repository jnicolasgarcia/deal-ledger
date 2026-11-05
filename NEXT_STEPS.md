# What I'd do next

Roughly in order of impact. The first group is what it would take to replace the real spreadsheet, not just this sample of it.

## 1. Replace the real sheet

* **Give every deal a stable ID.** Right now deals are matched by client and address, with a fallback to the row number for the seven deals without an address. Inserting a row or fixing an address in the sheet can break that.
* **Retire the sheet.** Make the app the source of truth. During a transition, the import can keep running on a schedule. It already skips deals edited in the app, so it only needs a report of those conflicts.
* **Give contacts a client and market.** `contact_tracker` has neither, so contacts can't be linked to deals yet.

## 2. Finish the assumptions workflow

* **Let editors confirm an assumed value**, like the blue "400A" in Power, with an audit entry, so it stops showing "est.".
* **Make the fields specific to each vertical editable** (Power, Zoning, Clear height and so on). They can only be viewed today, because editing one has to update its assumption flag, so both changes should ship together.
* **Add a data quality page** for unmapped statuses, missing addresses, unrecognized font colors and assumptions that have sat unconfirmed too long.

## 3. Richer weekly history

* **Take a snapshot every Monday.** "Moved in the last 7 days" comes from the edit history today. That works going forward, but it can't show what a past week looked like.
* **Let stage age fill in.** The sheet never recorded stage dates, so days in stage starts unknown. It fills in as deals move in the app, and flagging stalled deals becomes useful after a few weeks.
* **Email partners the weekly PDF** and a link to the weekly view automatically.

## 4. The stretch goals I skipped

* **Rollup:** deal counts by stage, time in stage, and outreach activity per market.
* **Map:** geocode each address once, show pins colored by stage, and pull census tract demographics on hover. Deals without an address go in a "couldn't place" list.

## 5. Access and security

* **Scope editors** to their own verticals or clients, enforced in the database. Today any editor can edit any deal.
* **Move signing in to company accounts.** Demo accounts with a shared password were fine for the case study. With Entra ID (see below), password resets, invites and removing people who leave are handled by the company's identity setup.
* **Handle simultaneous edits.** Today two editors can overwrite each other. A save should be rejected if the deal changed since it was loaded.
* **Protect the last admin account from deletion.** The app already blocks demoting the last admin, but deleting that account directly in the identity provider would still leave no admin.

## 6. Production readiness

* **A real deployment pipeline.** Vercel and Supabase's free tiers were the right choice for a fast demo, not for production. I'd move to the company's cloud, for example Azure, with:
  * **Separate environments** for development, staging and production, each with its own database, so nothing is ever tested against live deal data.
  * **CI/CD** (GitHub Actions or Azure DevOps) that builds the app as a container and deploys it to Azure Container Apps or App Service. Every change runs lint, type checks, the SQL checks, the role tests and full browser tests, and a failure blocks the deploy.
  * **Promotion by approval:** a change goes to staging automatically, and to production only after a review.
  * **Secrets in Azure Key Vault**, never in environment files, plus monitoring and alerts in Application Insights.
  * **Signing in with Microsoft Entra ID** (company accounts, single sign on, access removed automatically when someone leaves) and **Azure Database for PostgreSQL**, with daily backups and restores to any point in time. Because the access rules and the audit trail live in Postgres, they move with the database unchanged. The server validates the Entra ID token and passes the user's ID to Postgres on each request, in place of Supabase's `auth.uid()`.
* **Database tooling.** Migrations are applied by hand in the SQL editor today. The pipeline would apply them in order to each environment, and generate TypeScript types from the schema so every query is typed.
* **Scale.** Filter and paginate on the server once there are thousands of deals instead of 18.
* **Notes.** They mix structured facts (prices, due diligence dates, closing dates) with free text. An AI pass could suggest fields for a person to approve, always keeping the original note.
