# St. Luke Knights of Columbus — Member Portal
### Council 14895 · Indianapolis, Indiana

---

## Overview

A lightweight member self-service portal hosted on GitHub Pages. Members log in with their email address, view and correct their profile, check dues status, and complete an annual data-verification wizard. All data lives in a Google Sheet; writes go through a Cloudflare Worker relay to work around browser CORS restrictions on Apps Script.

---

## Live URLs

| Resource | URL |
|---|---|
| Portal (login) | https://mikesale97-8099.github.io/stluke-koc-memberportal/landing.html |
| GitHub Repo | https://github.com/mikesale97-8099/stluke-koc-memberportal |
| Cloudflare Worker | https://stluke-koc14895-relay.mike-sale97.workers.dev |
| Apps Script | https://script.google.com/macros/s/AKfycbw-wxkf1XzXM-tvhj-tsmDVdHdgI5YcWI63yj7W3RQyee7mrWmi2h88bvIykQq0Jb50FQ/exec |
| Google Sheet | https://docs.google.com/spreadsheets/d/1BXIzmI531yWJA7BYkATFrqED4nxict_pkScKadFNdUI/edit |

---

## Architecture

```
Member's browser
    │
    ├── READS  ──▶  docs.google.com (gviz/CSV — no CORS issues)
    │
    └── WRITES ──▶  Cloudflare Worker (stluke-koc14895-relay)
                         │
                         └──▶  Apps Script Web App (doGet/doPost)
                                    │
                                    └──▶  Google Sheet (Membership DB)
```

**Why the Cloudflare Worker?** Apps Script does not return proper CORS headers for cross-origin browser requests, which caused writes to fail silently on iOS Safari and some other configurations. The Worker accepts POST requests from any origin, forwards them server-to-server to Apps Script (no CORS applies), and returns the result with proper CORS headers.

---

## Pages

| File | Purpose | Login Required |
|---|---|---|
| `landing.html` | Email login; help form for unmatched emails | No |
| `home.html` | Member profile, dues status, self-edit contact info | Yes |
| `membership-card.html` | Digital membership card with tier-based styling | Yes |
| `why-dues.html` | Where dues go — McGivney founding story + breakdown | No |
| `pay-dues.html` | Payment options (Square, check, Venmo) | No |
| `groups.html` | Council positions and member directory | Yes |
| `calendar.html` | Live activity calendar from sheet, theme + month filters | No |
| `events.html` | Activity write-ups by Faith/Family/Community/Life category | No |
| `verify-wizard.html` | Annual data-verification wizard | Yes |

---

## Google Sheet — Tab Reference

| Tab | GID | Purpose |
|---|---|---|
| St Luke KOC Membership DB | 1292747386 | Master member records |
| Assumptions | 753284304 | Payment links, dues amounts, council info |
| Positions | 620591520 | Council officer and committee positions |
| Tier Messages | 1560227874 | Home page and membership card messages by tier |
| Change Log | — | Audit trail of all self-edits, flags, and wizard completions |
| Activity List | 2034915391 | Calendar events with date, type, ways to help, leader |

### Key Columns — Membership DB

| Column | Purpose |
|---|---|
| Member Number | Primary key — used on all pages and write operations |
| Email | Login match on landing.html |
| Membership Tier | Drives tier badge, home message, and card styling |
| Member Last Verify Date | Stamped by "My data looks good" button on Home |
| Login Count | Incremented once per browser session on login |
| Last Login | Timestamp of most recent session |
| Wizard Completed | Date member last completed the verify wizard |
| Wizard Outcome | Confirmed / Flagged / Status Request / Confirmed - Paid |
| Directory Opt-In | Controls appearance in Groups member directory |

---

## Membership Tiers

Tier is computed by a formula in the sheet (column: **Membership Tier**) and drives badge color, home page message, and membership card styling. The **Tier Messages** tab is the authoritative source — Col A = exact tier key, Col B = friendly label, Col C = home page message, Col D = membership card message.

| Tier Key | Friendly Label |
|---|---|
| Core Member, Current | Member In Good Standing |
| Core Member, Payment Due | Active, Payment Due |
| Contributing Member, Payment Past Due | Active, Payment Past Due |
| Contributing Member, Payment Overdue | Active, Payment Overdue |
| Member, Active/Severely Overdue | Member, Severly Overdue |
| Long-time Member, Inactive/Severely Overdue | Long-time Member, Severly Overdue |
| Member, Inactive and Severely Overdue | Associate, Inactive |
| Member, No record of dues payments | Status Unknown |
| Member, No dues data | Records Incomplete |
| Clergy | Clergy |

---

## Apps Script — Actions

All writes go through the Apps Script Web App via the Cloudflare Worker. The `action` parameter routes to the appropriate handler.

| Action | Handler | What it does |
|---|---|---|
| `verify` (default) | `handleVerify` | Stamps Member Last Verify Date |
| `saveContact` | `handleSaveContact` | Writes edited contact fields to DB, logs each change to Change Log |
| `logChange` | `handleLogChange` | Appends a row to Change Log (flags, status requests, etc.) |
| `recordLogin` | `handleRecordLogin` | Increments Login Count and stamps Last Login |
| `completeWizard` | `handleCompleteWizard` | Stamps Wizard Completed date and Wizard Outcome, logs to Change Log |

### Redeployment

Any change to `verify-endpoint.gs` requires a new deployment:
1. Open the script in Apps Script editor
2. **Deploy → Manage deployments → Edit (pencil) → New version → Deploy**
3. Confirm "Who has access" = **Anyone** (not "Anyone with Google account")
4. The deployment URL does **not** change between versions — no portal update needed

---

## Cloudflare Worker

**Account:** mike-sale97.workers.dev  
**Worker name:** stluke-koc14895-relay  
**Purpose:** Accepts POST from any origin, forwards to Apps Script as a server-to-server GET, returns JSON with CORS headers.

To edit: Cloudflare dashboard → Workers & Pages → stluke-koc14895-relay → Edit code.

If the Apps Script URL ever changes (new deployment), update `APPS_SCRIPT_URL` at the top of the Worker code and redeploy.

---

## Admin / Owner Mode

Append `?admin=stluke14895` to any page URL to enable owner mode. This reveals the "Browse as a member" dropdown on `home.html`, allowing a data administrator to view any member's profile without logging in as them.

Example: `https://mikesale97-8099.github.io/stluke-koc-memberportal/home.html?admin=stluke14895`

---

## Verify Data Wizard

Located at `verify-wizard.html`. Accessed via the **Verify Data** nav link on every page, or (future) automatically on login when `Wizard Completed` is blank or more than one year old.

**Flow:**
1. **Welcome** — greets member by name; two paths: Get Started or My circumstances have changed
2. **Dues Purpose** — brief statement on what dues fund (shown to everyone on the Get Started path)
3. **Contact Info** — pre-filled; button says "Data is Correct" until a field is edited, then "Save & Continue"
4. **Dues Check** — skipped if member is current; shows balance, Pay button, and dispute option
5. **Result** — tailored message; "Continue to My Profile" or "Sign Out" depending on outcome

**Changed Circumstances path** (via "My circumstances have changed" on Welcome):
- Shows only a two-option screen: Pause membership (Inactive) or Leave the council
- Logs a status request to Change Log
- Goes directly to Result — skips Contact, Dues Purpose, and Dues Check
- Ends with Sign Out

**On completion:** stamps `Wizard Completed` (today's date) and `Wizard Outcome` in the DB, and logs a summary row to Change Log.

---

## Change Log — Row Format

| Col | Content |
|---|---|
| Timestamp | Date/time of the action |
| Member Number | Member's number from the DB |
| Member Name | Full name |
| Type | Self-edit / Flag / Status Request / Wizard / Contact Request |
| Category | Contact / Membership / Dues / Verification |
| Field | What was changed or flagged |
| Old Value | Previous value (blank for flags/requests) |
| New Value / Notes | New value or note text |
| Date Reconciled | Filled in by DA after reviewing |
| Reconciled By | DA name |

---

## Cleanup Campaign

### Step 1 — Verify Data (current)
Members complete the wizard to self-correct contact info, flag dues disputes, identify themselves as wanting to leave or go inactive, and confirm their record is accurate.

Track progress by filtering the Membership DB on:
- `Wizard Completed` — blank = not yet done
- `Wizard Outcome` — Flagged or Status Request = needs DA follow-up

### Step 2 — Mass Email (planned)
Email campaign explaining dues purpose and encouraging payment. Planned after Step 1 data cleanup is substantially complete.

---

## Known Pending Items

- [ ] Add login gating: redirect to `verify-wizard.html` if `Wizard Completed` is blank or >1 year old
- [ ] Trim Home's verify box once wizard gating is live (Inactive/Leave already removed; consider removing "My data looks good" too)
- [ ] Refresh demo snapshot in `home.html` and `membership-card.html` from latest CSV export
- [ ] Collect emails for 15 members with no email on file (landing.html help form now captures these when they attempt login)
- [ ] Flip repo to private after council buy-in
- [ ] Confirm iPhone Safari write success rate with Cloudflare Worker now in place

---

## File Outputs (local)

Working files are in `/mnt/user-data/outputs/kofc-portal/`. The current deployable zip is `kofc-portal-site.zip` in `/mnt/user-data/outputs/`.

Mockup files (review only, not deployed):
- `verify-wizard-mockup.html` — wizard mockup with static demo data
- `home-with-wizard-mockup.html` — home page mockup showing wizard-adjusted layout
- `calendar-mockup.html` — earlier static calendar mockup (superseded by live calendar.html)
