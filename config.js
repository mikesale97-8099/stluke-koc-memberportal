/*
 * St. Luke KoC #14895 Member Center - the ONE place for every address the portal reads from.
 *
 * To move the portal's data or relay, change the values here and upload this one file.
 * Nothing else in the pages needs to change.
 *
 * Load order on every page:  config.js  ->  session.js  ->  nav-toggle.js  ->  the page's own script.
 *
 * Never put member data in this file or in any page: this file is public.
 */
const KOC_CONFIG = {

    // The Google Sheet that holds the Membership DB, Assumptions, Tier Messages, Positions,
    // Photos and Announcements tabs. This is the ID between /d/ and /edit in the sheet's address.
    sheetId: '1BXIzmI531yWJA7BYkATFrqED4nxict_pkScKadFNdUI',

    // The Google Sheet that holds the Assumptions tab (dues amounts, officer emails, dates, messages).
    // Until Assumptions is moved into its own file this is the SAME ID as sheetId above.
    // After the move, paste the new file's ID here and set gids.assumptions to that file's tab ID.
    // The Apps Script has its own copy of this setting (ASSUMPTIONS_SHEET_ID in verify-endpoint.gs): change both.
    assumptionsSheetId: '1BXIzmI531yWJA7BYkATFrqED4nxict_pkScKadFNdUI',

    // The Google Sheet that holds the Announcements tab shown on the Home page.
    // It lives in its own file so the people who post announcements never need to open the membership data.
    announcementsSheetId: '1uG6AAwzEaaGcuUAZrygeG29GwHMKm7Vx7iTUqxUMyv0',

    // Tab IDs (the number after gid= in the address when that tab is open).
    // A copied sheet may get different tab IDs: check each one after copying.
    gids: {
        membership:   '1292747386',   // St Luke KOC Membership DB
        assumptions:  '753284304',    // Assumptions (a tab ID inside the assumptionsSheetId file)
        tierMessages: '1560227874',   // Tier Messages
        positions:    '620591520',    // Positions (Groups)
        announcements: '1133674898'   // Announcements (a tab ID inside the announcementsSheetId file)
    },
    // Tab read by name rather than by number: Photos.
    // If you rename that tab in the sheet, the portal stops finding it.

    // Calendar feed: the sheet's "Publish to web" link, set to CSV for the Activity tab.
    // Publishing a copied sheet creates a NEW link; paste it here.
    calendarCsvUrl: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRQDS_b-fdZjWOcOZ4OUD7TkNLLaCaXt-AN2cOHyltxZRwOOlcGICvdTd2JXGLpzoAx3fPFKq5SgNjd/pub?gid=2034915391&single=true&output=csv',

    // The relay the pages talk to (sign-in, saves, photos). The relay forwards to the Apps Script.
    // The Apps Script address itself lives in the relay's own code (cloudflare-worker.js), not here.
    endpoint: 'https://stluke-koc14895-relay.mike-sale97.workers.dev',

    // Email addresses shown to members. Change them here and nowhere else.
    //   council: the public council contact (page footer, "Questions?" lines, error messages).
    //            It is also the last-resort recipient for the Help / Problem / Idea buttons.
    // The Help / Problem / Idea buttons normally send to the "Help email" row on the Assumptions tab,
    // then the first "Data Administrator email" row; this address is used only if both are empty.
    // To add another address: add a line here, then tag a page element with data-koc-email="thatName".
    emails: {
        council: 'council14895@gmail.com'
    }
};

/* Fills every  <a data-koc-email>  or  <span data-koc-email="name">  on the page from KOC_CONFIG.emails.
   A link gets its mailto address and its text; any other element gets the address as text.
   With no value after data-koc-email, the "council" address is used. */
(function () {
    function fillEmails() {
        document.querySelectorAll('[data-koc-email]').forEach(function (el) {
            var addr = KOC_CONFIG.emails[el.getAttribute('data-koc-email') || 'council'];
            if (!addr) return;
            if (el.tagName === 'A') el.setAttribute('href', 'mailto:' + addr);
            el.textContent = addr;
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillEmails);
    else fillEmails();
})();
