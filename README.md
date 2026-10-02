# St. Luke Knights of Columbus — Member Center
### Council 14895 · Indianapolis, Indiana

A member self-service site hosted on GitHub Pages. Members sign in with an emailed code, see and correct their profile, add a profile photo, view their membership card(s), pay dues, browse the member directory, pray the Rosary, and complete an annual data-verification wizard. Member data lives in a Google Sheet; every change goes through an Apps Script (via a Cloudflare Worker relay) that checks the member's sign-in.

---

## Admin Tools & Demo Mode (read this first)

Admin tools — the **Browse as a member** dropdown (Profile, Membership Card, Pay Dues) and the technical status strip on **Groups** — are **hidden by default, even for admins.** A signed-in admin sees exactly what any member sees, which makes the site safe to demo.

| To… | Add this to the end of any Member Center address |
|---|---|
| **Show** admin tools | `?admin=on` — e.g. `https://mikesale97-8099.github.io/stluke-koc-memberportal/home.html?admin=on` |
| **Hide** admin tools | `?admin=off` |

- The setting is remembered **on that device** as you move between pages; the address tidies itself so the switch isn't left showing.
- **Signing out turns the tools off**, so every demo starts clean. If the setting is ever reset (on iPhones, Safari may clear it after a week without visiting), it falls back to **off**.
- Viewing another member by number (`home.html?member=…`) **only works while the tools are on** — a stray link can't show someone else's data during a demo.
- **Who is an admin:** the member whose email matches the **Data Administrator email** row on the Assumptions tab. A regular member typing `?admin=on` sees no change.
- **Tip:** bookmark both links on your phone and computer.

> The old `?admin=stluke14895` key no longer does anything.

---

## Live URLs

| Resource | URL |
|---|---|
| Member Center (sign in) | https://mikesale97-8099.github.io/stluke-koc-memberportal/landing.html |
| GitHub Repo | https://github.com/mikesale97-8099/stluke-koc-memberportal |
| Cloudflare Worker | https://stluke-koc14895-relay.mike-sale97.workers.dev |
| Apps Script (web app) | https://script.google.com/macros/s/AKfycbw-wxkf1XzXM-tvhj-tsmDVdHdgI5YcWI63yj7W3RQyee7mrWmi2h88bvIykQq0Jb50FQ/exec |
| Google Sheet | https://docs.google.com/spreadsheets/d/1BXIzmI531yWJA7BYkATFrqED4nxict_pkScKadFNdUI/edit |

---

## How Members Sign In

1. Member enters the email address on file and taps **Email Me a Code**.
2. The Apps Script emails a **6-digit code** (sent from the script owner's Gmail, shown as "St. Luke Member Center").
3. Member enters the code. With **Keep me signed in on this device** checked (the default), he stays signed in as long as he visits at least once every **90 days**; otherwise the sign-in ends when the browser closes.
4. Returning on a remembered device shows **Welcome back → Continue to My Profile** — no code.

| Rule | Setting |
|---|---|
| Code works for | 60 minutes (AT&T/Yahoo can deliver slowly) |
| Any code sent in the last hour works | Yes — delayed or out-of-order emails still sign him in |
| Wrong tries before a code locks | 5 (asking for a new code clears the lock) |
| Wait between code emails | 30 seconds |
| Code emails per member per hour | 5 |
| "Keep me signed in" | 90 days **from the last visit** (renews automatically, at most once a day) |
| Not kept signed in | Ends when the browser closes (12-hour limit) |

**Sign out** is deliberately out of the way: there's no Sign out in the top bar (members tapped it out of habit, forcing a new code each visit). A small gray **Sign out of this device** link sits at the very bottom of the Profile page and asks for confirmation (*Stay signed in* is the main button). Signing out forgets the device — the sign-in, the remembered email, and admin tools. Closing the browser or restarting the phone does **not** sign a member out. To switch people on a device, the sign-in page's **Not you? Sign in as someone else** link does the same.

**Emails not on file** — the login page offers a help form that logs a "Contact Request / Add Email" row in the Change Log for a data administrator.

**iPhone notes**
- The email field is set up for Safari AutoFill (Settings → Apps → Safari → AutoFill → *Use Contact Info*), with no auto-capitalize/autocorrect; the keyboard's **Go** key submits. After a kept sign-in, the device also remembers the email address for next time.
- Safari erases a site's saved data after **7 days of Safari use without visiting that site**, so a monthly visitor on an iPhone will usually need a new code. Members who **Add to Home Screen** (Share → Add to Home Screen) aren't affected by that rule.
- Codes may take several minutes to reach AT&T/Yahoo addresses; the "Check your email" screen says so.

**Maintenance functions** (run from the Apps Script editor's function dropdown):
- `testMemberCenterEmail` — sends a test email to the Data Administrator listing every officer email found on the Assumptions tab. Also grants the script permission to send email the first time.
- `signEveryoneOut` — emergency use: signs every member out on every device.

---

## Architecture

```
Member's browser
    │
    ├── READS  ──▶  docs.google.com (gviz / published CSV)
    │
    └── SIGN-IN & CHANGES ──▶  Cloudflare Worker (stluke-koc14895-relay)
                                   │
                                   └──▶  Apps Script web app (verify-endpoint.gs)
                                             │   checks the member's signed session pass
                                             ├──▶  Google Sheet (Membership DB, Change Log)
                                             └──▶  Gmail (sign-in codes, officer notifications)
```

- **Why the Worker?** Apps Script doesn't return browser-friendly (CORS) replies, which broke writes on iPhones. The Worker relays requests server-to-server and passes replies through unchanged. (Its code is kept in `cloudflare-worker.js`; the live copy is edited in the Cloudflare dashboard.)
- **Large requests:** the Worker normally passes a request to the Apps Script in the web address. A request over about 1,500 characters (a member photo) can't fit there, so the Worker sends it as a POST body instead. Small requests are unchanged.
- **Session pass:** after a correct code, the script issues a pass signed with a secret only it knows. Pages read the member number from the pass; the script re-checks the signature on every change and uses **the pass's** member number, never one supplied by the page.

---

## Pages

Menu order on every page: **Profile · Calendar · Prayers · Membership Card · Groups · Why Dues? · Verify Data**

| File | Purpose | Sign-in required |
|---|---|---|
| `landing.html` | Emailed-code sign-in; welcome back; help form for emails not on file | — |
| `home.html` (Profile) | Tier badge and message; Membership Profile (Member Status, degree, years, role); Dues Profile with **Thanks for Clicking to Pay →**; Contact Profile edit (incl. Wife's Name, Directory opt-in); *My circumstances have changed* link; quiet *Sign out of this device* link (with confirmation) at the very bottom. The identity card shows the member's **photo** (initials until one is added) with *Add my photo / Change photo / Remove photo* | Yes |
| `membership-card.html` | Council card (degrees 1st–3rd) and, for Sir Knights, the Fourth Degree card | Yes |
| `pay-dues.html` | Square (card), Venmo (for members who already use it), mail a check | Yes |
| `groups.html` | Council positions and the member directory (opted-in members only), each with a photo or initials circle, and a **search box** above the list | Yes |
| `verify-wizard.html` | Annual data-verification wizard and the circumstances flow | Yes |
| `calendar.html` | Live activity calendar with theme and month filters; events with a **Sign-up Link** show a *Sign up* button | No |
| `prayers.html` | Knights Prayers: Rosary (top), McGivney prayer, prayers for a Brother Knight / deceased Brother, resource links | No |
| `rosary.html` | Sub-page of Prayers: how to pray, prayers, the four sets of mysteries with USCCB Scripture links, today's mysteries tagged | No |
| `why-dues.html` | Where dues go | No |
| `events.html` | Older activity write-ups (not in the menu; reachable by direct link) | No |

**Shared files:** `session.js` (sign-in pass, admin-tools switch, sign-out) and `nav-toggle.js` (Why Dues menu toggle) load on every menu page. `council-logo.png` is the KofC emblem used on the wizard welcome and the council card.

---

## Deploying Changes

0. **Cloudflare Worker** (only when `cloudflare-worker.js` changes): open the Worker in the Cloudflare dashboard → **Edit code**, paste the whole file, **Save and deploy**. The Worker URL doesn't change.
1. **Apps Script** (`verify-endpoint.gs`): paste the full file into the editor, save, then **Deploy → Manage deployments → pencil → Version: New version → Deploy.**
   - Keep **Execute as: Me** and **Who has access: Anyone.** ("User accessing the web app" would make every member sign in to Google.)
   - The web-app URL doesn't change between versions, so the Worker needs no update.
2. **Pages:** upload the changed files to the repo root. Watch for browsers adding "(1)" to downloaded file names.
3. When the Worker, script and pages all change (e.g. member photos), deploy in this order, back to back: **Worker → Apps Script → pages**. The Worker and script changes are backward-compatible, so the old pages keep working until the new ones go up.
4. Hard refresh (Ctrl+Shift+R) when testing; GitHub Pages can take a minute or two to update.

> ⚠️ **Never upload `*-mockup.html` files to the repo.** Several contain an old built-in copy of all members' names, numbers, and dues balances.

---

## Google Sheet

### Tabs

| Tab | GID | Purpose |
|---|---|---|
| St Luke KOC Membership DB | 1292747386 | Master member records |
| Assumptions | 753284304 | Settings: payment info, officer emails, toggles, rollout waves |
| Positions | 620591520 | Council officers and committee positions |
| Tier Messages | 1560227874 | Friendly tier labels and Profile/card messages |
| Change Log | — | Audit trail of every change, flag, request, and notification |
| Photos | — | Member photos, one row per member. **Created automatically** when the first photo is saved. Columns: Member Number (text, no leading zeros) · Photo (small JPEG as text) · Updated. Don't edit by hand |
| Activity List (separate published sheet) | 2034915391 | Calendar events |

### Key Columns — Membership DB

| Column | Used for |
|---|---|
| Member Number | Primary key |
| email | Sign-in match (the code is sent here) |
| Membership Tier | Tier badge, Profile message, card styling |
| Council Member Status | Shown on Profile as **Member Status** (blank = Active). Set by the site only to **Withdrawal Pending** or **Move Alert**; everything else is set by the data administrator |
| Outstanding Dues | Dues step in the wizard, Pay button, **EXPIRED** stamp on the council card. Amounts in parentheses, e.g. `($25.00)`, are credits |
| Last Yr Paid | "Paid through" / Dues Paid To |
| Degree Level | Council card degree (shown as 1st, 2nd, or 3rd — never higher) |
| Forth Degree | *(sic)* Any date here marks a **Sir Knight** and shows the Fourth Degree card |
| Preferred Name | Greetings |
| Wife's Name | Profile, wizard, and a **Wife** column in the directory (straight or curly apostrophe both work) |
| Directory Opt-In | Yes/No — appears in the Groups directory |
| Rollout Wave | 1, 2, 3… for staged rollout (blank = not invited while waves are numbered) |
| Wizard Completed / Wizard Outcome | Date and result of the last wizard run (Confirmed, Confirmed - Paid, Flagged, Withdrawal Pending) |
| Login Count / Last Login | Engagement |
| Member Last Verify Date | Last "data looks good" confirmation |
| *Circumstance* (optional) | If added, the site fills in **Moved Away** / **Stepping Back** |

### Assumptions Rows (column A label → column B value)

| Label | Effect |
|---|---|
| Dues Check Payable to: | Pay Dues check instructions |
| Dues Check Mail to: | Pay Dues mailing address; withdrawal-letter return address |
| Financial Secretary VENMO | Venmo handle (blank hides the Venmo option) |
| Data last refreshed on: | "Data last updated" footer |
| Include Why Dues quicklink | **Yes** shows *Why Dues?* in the menu; anything else hides it |
| Grand Knight email | Withdrawal-request emails |
| Retention Committee email | Move / step-back / withdrawal / other emails |
| Data Administrator email | Admin rights; "something else" emails; stands in for the Financial Secretary if that row is missing |
| Financial Secretary email *(optional)* | Move-out-of-area emails (address update in Member Management) |
| Open rollout waves through | A number *N* lets in waves 1..N; **All** (or no row) lets in everyone with an email on file |
| 4th Degree Assembly No. *(optional)* | Overrides **2850** on the Fourth Degree card |
| 4th Degree Assembly City *(optional)* | Overrides **Indianapolis, IN** (write as "City, ST") |

---

## Membership Cards

**Council card** (every member): certificate style with the KofC emblem and an **Active** ribbon. Degree shows **1st, 2nd, or 3rd** — Sir Knights show 3rd here.
- **EXPIRED** diagonal stamp when Outstanding Dues is above $0 (clergy exempt; credits don't count).
- **UNVERIFIED** stamp when there's no dues record.
- Note under the title: *facsimile, not officially recognized; official card from the Financial Secretary at a monthly meeting.*

**Fourth Degree card** (only members with a *Forth Degree* date): Sir Knight name (with middle initial and suffix), member number, **IS A 4th DEGREE MEMBER OF**, Assembly **2850, Indianapolis, IN**, **Dues Paid To 12/31** *current year* (assembly dues aren't in our records, so current is assumed), the Supreme Knight signature line, and the Fourth Degree emblem. Its own note explains it's a facsimile and assumes current assembly dues.
- The "Council Card" / "Fourth Degree Card" titles appear **only** for Sir Knights; other members see no reference to a second card.

---

## Member Photos

- **Who sees it:** signed-in members, on the member's **Profile** and the **Groups** page. In the **Member Directory** a photo shows only for members who are opted in (the directory's existing rule). **Council officer** rows show the officer's photo regardless. A member with no photo shows an initials circle, so lists stay even.
- **How a member adds one:** Profile → **Add my photo** → **Take a photo** (camera) or **Choose from my photos** → preview → **Use this photo**. The phone shrinks the picture to a 160-pixel square (tall photos are cropped toward the top so faces aren't cut off) before sending, so each photo is only about 5–12 KB. **Remove photo** asks first; *Keep my photo* is the main button.
- **Where it lives:** the **Photos** tab (see Tabs). Pages read it the same way as everything else, so the directory loads without extra requests. Groups shows initials immediately and fills in photos as they arrive.
- **Admin:** a Data Administrator browsing another member (`?admin=on`) can't add or change that member's photo, but can **Remove photo** (logged as *Admin edit*).
- **Change Log:** every add, change and removal writes a row (Category *Profile*, Field *Photo*; Type *Self-edit*, or *Admin edit* when an administrator acts on someone else).
- **Rest of this visit:** after a member saves or removes a photo, that device shows the change right away even if the sheet is a moment behind.
- **Limits:** JPEG only (phone photos convert automatically); a file the phone can't read shows a friendly "That photo didn't work" screen. Photos are not on the membership card yet.

---

## Groups Search

- A search box sits above the list and narrows it as the member types (no Search button needed; Enter just closes the phone keyboard). A line under it shows "Showing 4 of 150"; the **×** clears it.
- It searches the list on screen: **name, wife's name, position, phone and email**. Several words must all match ("tom kow"). Capitals and accents are ignored ("renee" finds Renée). A phone number works with or without spaces, dashes and parentheses.
- It also matches the member's **Preferred Name** (nickname) — "bob" finds Robert — but the nickname itself isn't shown in the list.
- Switching groups clears the search. Photos loading later don't disturb it.
- It only shows or hides rows already on the page, so it is instant and makes no extra requests.

---

## Calendar Sign-up Links

- **Where the link comes from:** a column named **Sign-up Link** on the Activity List tab (the published sheet the calendar reads). Paste the sign-up address (SurveyMonkey or any `https://` link) into that row. Leave it blank for events with no sign-up — those cards show no button.
- **What members see:** a large **Sign up** button at the bottom of that event's card, with "Opens in a new tab" beside it. It opens the link in a new tab, so the Member Center stays open behind it.
- **Forgiving about what's pasted:** stray spaces are trimmed; a link typed without `https://` gets it added; an `http://` link is upgraded to `https://`. Anything that isn't a real web address (words like "coming soon", a link with a space in it, `javascript:` etc.) is ignored and shows no button.
- **Timing:** the calendar reads the *published* copy of the sheet, so a new or changed link appears after Google republishes it (usually a few minutes). The column header is matched loosely ("Sign-up Link", "Signup link", "Sign-Up Link" all work).
- **Check it worked:** the calendar's status line (admin view) says how many events have a link, or that no Sign-up Link column was found.
- **Remember:** the calendar page doesn't require sign-in, and the published sheet is readable by anyone with its address, so sign-up links aren't hidden from non-members.
- **Cleanup:** the calendar hides past months by default; clear a link from the sheet once its sign-up has closed.

---

## Verify Data Wizard

Reached from **Verify Data** in the menu.

1. **Welcome** — greets by preferred name; **Get Started** or **My circumstances have changed**.
2. **A quick refresher before we begin** — what dues support.
3. **Verify your Contact Info** — incl. Preferred Name and Wife's Name; **Data is Correct** becomes **Save & Continue** once anything is edited.
4. **Member Directory Option** — Yes (default) / No.
5. **Verify your Dues Balance** — only if Outstanding Dues > 0: **Data is Correct**, **Thanks for Clicking to Pay →** (returns straight to the last step after paying), or *Something looks wrong with my dues*.
6. **Result** — stamps **Wizard Completed** and **Wizard Outcome**.

### My Circumstances Have Changed
Reached from the wizard's Welcome screen or the link at the bottom of the Profile. Nothing is pre-selected.

| Choice | Sheet | Emails |
|---|---|---|
| **I've moved out of the area** (moves within the area are handled by a Profile address update — the screen offers a button for that) | Saves any new address; **Council Member Status → Move Alert** (only if blank/Active) | Retention Chair + Financial Secretary |
| **I need to step back for a while** — reasons: Family or work, Health, Dues or cost, Other | Change Log (flags **DUES BARRIER**) | Retention Chair, who calls within a few weeks |
| **I want to withdraw from the Knights** — print a signed letter (to the Grand Knight, cc Retention Chair) and/or ask to be contacted | **Council Member Status → Withdrawal Pending**; wizard stamped so he isn't asked to verify again | Grand Knight + Retention Chair |
| **Something else** — free text | Change Log | Retention Chair + Data Administrator |

Every report writes a Change Log row whose **Notes** column records who was emailed (or why not).

---

## Staged Rollout (Waves)

1. Put 1, 2, 3… in **Rollout Wave** for each member.
2. Set **Open rollout waves through** to 1, then raise it as each wave is invited; set it to **All** when finished.
3. Members not yet invited get a friendly "we're opening in stages" note instead of a code. The data administrator can always sign in. This check runs in the Apps Script, so it's enforced.

---

## Apps Script — Actions

| Action | Needs sign-in | What it does |
|---|---|---|
| `requestCode` | No | Checks the email and rollout wave; emails a code |
| `verifyCode` | No | Checks the code; returns a signed session pass |
| `session` | Pass | Confirms and renews a remembered pass |
| `logChange` | Pass* | Appends a Change Log row (*the "Add Email" help request needs no pass) |
| `saveContact` | Pass | Saves contact fields (incl. Wife's Name, Directory Opt-In); logs each change |
| `recordLogin` | Pass | Login Count and Last Login |
| `completeWizard` | Pass | Wizard Completed / Wizard Outcome |
| `reportCircumstance` | Pass | Moved / step back / withdraw / other: address, status, Change Log, emails |
| `verify` | Pass | Member Last Verify Date |
| `savePhoto` | Pass | Saves the member's photo to the Photos tab (JPEG only, under ~45,000 characters), logs it |
| `removePhoto` | Pass | Removes the member's photo row, logs it. The Data Administrator may remove anyone's (admin view) |

Unknown actions return an "Unknown action" error. A member can only change his own record; the data administrator may act on another member's record from the admin view.

---

## Change Log — Row Format

Timestamp · Member Number · Member Name · Type · Category · Field · Old Value · New Value · Notes · Date Reconciled · Reconciled By

---

## Security Notes & Known Limitations

- **Sign-in and all changes are protected** (emailed code, signed pass, member number taken from the pass).
- **The member sheet itself is still link-readable** (the pages read it directly for speed). Anyone who digs the link out of a page's source could download it. This was a deliberate trade-off: keeping the sheet private would require routing all reads through Apps Script, adding a second or two to every page. The directory wording promises only what's true under this setup ("only signed-in members can see the directory").
- **Photos are on the sheet, not in the repo.** The Photos tab is link-readable like the rest of the sheet, so the same caveat applies: only the pages limit photos to signed-in members. The upload screen says photos are shown to signed-in members of the council. No photo is ever stored in the repo.
- **Repository history:** older versions of `membership-card.html` and `pay-dues.html` (and all mockups) contained every member's name, number, and dues balance. They're removed from the current pages, but remain in the public repo's history until the repo is made private (requires GitHub Pro to keep Pages) or recreated fresh.
- **Emails come from a personal Gmail account**, which some providers (notably AT&T/Yahoo) may delay. Sending from the council's own domain with proper email records would help.

---

## Cleanup Campaign

- **Step 1 — Verify Data (current):** members confirm or correct their data, flag dues questions, and report changed circumstances. Track with **Wizard Completed** (blank = not done) and **Wizard Outcome** / **Council Member Status** (Flagged, Move Alert, Withdrawal Pending = follow-up).
- **Step 2 — Mass email (planned):** after Step 1 is substantially complete.

---

## Pending / Open Items

- [ ] Fill in **Forth Degree** dates for Sir Knights (and reconcile anyone with Degree Level "4th" but no date)
- [ ] Fill in **Rollout Wave** values; set **Open rollout waves through**
- [ ] Optional: **Financial Secretary email** row; **Circumstance** column
- [ ] Automatic wizard prompt on sign-in when Wizard Completed is blank or over a year old
- [ ] Home-screen icon and one-time "Add to Home Screen" tip for iPhones
- [ ] Decide on member numbers with a leading zero on the cards (printed cards show none)
- [ ] Clean up repository history (private repo or fresh repo)
- [ ] Send code emails from the council's own domain once it's set up
- [ ] Collect emails for members with none on file
- [ ] Member photo on the council card / Fourth Degree card (not built)
- [ ] After deploying photos: add one real photo on your own profile and confirm the **Photos** tab gets a row, then see it on Groups from another device

---

## Files

**Deployed (repo root):** `landing.html`, `home.html`, `calendar.html`, `prayers.html`, `rosary.html`, `membership-card.html`, `groups.html`, `why-dues.html`, `pay-dues.html`, `verify-wizard.html`, `events.html`, `session.js`, `nav-toggle.js`, `council-logo.png`, `README.md`

**Kept for reference (not served as pages):** `verify-endpoint.gs` (Apps Script source), `cloudflare-worker.js` (Worker source)

**Never deploy:** any `*-mockup.html` (review-only files; some contain old member data)
