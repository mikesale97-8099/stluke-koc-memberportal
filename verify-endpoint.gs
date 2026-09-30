/**
 * Deploy this as a Web App (Extensions > Apps Script, from inside the
 * St Luke KOC Membership DB spreadsheet).
 *
 * Deploy > New deployment > Type: Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * Then copy the Web App URL it gives you and paste it into
 * VERIFY_ENDPOINT_URL near the top of home.html's <script> block.
 */

/**
 * Handles CORS preflight OPTIONS requests from browsers (Safari, Chrome, etc.).
 * Without this, cross-origin POST requests are blocked before they even start.
 */
function doOptions(e) {
  return ContentService.createTextOutput('')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doGet(e) {
  const params = Object.assign({}, e.parameter || {});
  const result = route(params.action || 'verify', params);
  const callback = params.callback;
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(result) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return jsonResponse(result);
}

function doPost(e) {
  let params;
  try {
    params = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonResponse({ success: false, error: 'Invalid request body' });
  }
  return jsonResponse(route(params.action || 'verify', params));
}

/**
 * Every request comes through here.
 * - Sign-in actions are open to anyone.
 * - The "no email on file" help form is open (that member can't sign in yet).
 * - Everything else needs a valid session pass, and uses the member number
 *   from the pass, not whatever the page sent. The Data Administrator may
 *   act on another member's record (admin view).
 */
function route(action, params) {
  if (action === 'requestCode') return handleRequestCode(params);
  if (action === 'verifyCode') return handleVerifyCode(params);
  if (action === 'session') return handleSession(params);
  if (action === 'logChange' && isAddEmailRequest(params)) return handleLogChange(params);

  const auth = authenticate(params);
  if (!auth.ok) return { success: false, error: auth.error };
  const requested = String(params.memberNumber || '').trim();
  if (!auth.admin || !requested) params.memberNumber = auth.memberNumber;

  if (action === 'logChange') return handleLogChange(params);
  if (action === 'saveContact') return handleSaveContact(params);
  if (action === 'recordLogin') return handleRecordLogin(params);
  if (action === 'completeWizard') return handleCompleteWizard(params);
  if (action === 'reportCircumstance') return handleReportCircumstance(params);
  if (action === 'verify') return handleVerify(params);
  return { success: false, error: 'Unknown action: ' + action };
}

function isAddEmailRequest(params) {
  return !String(params.memberNumber || '').trim() && params.type === 'Contact Request' && params.field === 'Add Email';
}

/**
 * Writes self-edited Contact fields directly to the member's row (so the portal
 * reflects the correction immediately), while also logging each real change to
 * the Change Log tab for reconciliation against the true source later.
 * Columns that don't exist yet in the sheet (e.g. Nickname, before it's added)
 * are skipped and reported back rather than failing the whole save.
 */
function handleSaveContact(params) {
  const SHEET_NAME = 'St Luke KOC Membership DB';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const memberNumberCol = headers.indexOf('Member Number');
  const lastVerifyCol = headers.indexOf('Member Last Verify Date');
  const lastChangeDateCol = headers.indexOf('Last Change Date');
  const lastChangeNameCol = headers.indexOf('Last Change Name');

  const memberNumber = String(params.memberNumber || '').replace(/^0+/, '');
  const memberName = String(params.memberName || '').trim();
  let fields;
  try {
    fields = JSON.parse(params.fields || '{}');
  } catch (err) {
    return { success: false, error: 'Invalid fields payload' };
  }

  if (!memberNumber || !memberName) {
    return { success: false, error: 'Missing memberNumber or memberName' };
  }

  // field key -> [sheet column name, friendly label for the log]
  const FIELD_MAP = {
    nickname:  ['Preferred Name', 'Preferred Name'],
    wifeName:  ["Wife's Name", "Wife's Name"],
    address1:  ['Street Address', 'Address 1'],
    city:      ['City', 'City'],
    stateAbbr: ['State', 'State'],
    zip:       ['Postal Code', 'Zip Code'],
    phone:     ['phone', 'Phone'],
    email:     ['email', 'Email'],
    directoryOptIn: ['Directory Opt-In', 'Member Directory'],
  };

  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][memberNumberCol]).replace(/^0+/, '') === memberNumber) { rowIdx = i; break; }
  }
  if (rowIdx === -1) return { success: false, error: 'Member not found' };

  const rowNum = rowIdx + 1;
  const changed = [];
  const skipped = [];

  Object.keys(fields).forEach(key => {
    const mapping = FIELD_MAP[key];
    if (!mapping) { skipped.push('Unknown field: ' + key); return; }
    const [colName, label] = mapping;
    const colIdx = headers.map(h => String(h).trim().replace(/[\u2018\u2019]/g, "'")).indexOf(colName);   // tolerate a curly apostrophe
    if (colIdx === -1) { skipped.push(label); return; }

    const newValue = String(fields[key] || '').trim();
    const oldValue = String(sheet.getRange(rowNum, colIdx + 1).getValue() || '').trim();
    if (newValue.toLowerCase() === oldValue.toLowerCase()) return; // no real change, just display-casing formatting

    sheet.getRange(rowNum, colIdx + 1).setValue(newValue);
    logSheet().appendRow([new Date(), memberNumber, memberName, 'Self-edit', 'Contact', label, oldValue, newValue, '', '']);
    changed.push(label);
  });

  // Editing counts as reviewing your info — stamp the same verify columns as the Confirm button
  if (lastVerifyCol !== -1 && lastChangeDateCol !== -1 && lastChangeNameCol !== -1) {
    const today = new Date();
    sheet.getRange(rowNum, lastVerifyCol + 1).setValue(today);
    sheet.getRange(rowNum, lastChangeDateCol + 1).setValue(today);
    sheet.getRange(rowNum, lastChangeNameCol + 1).setValue(memberName);
  }

  return { success: true, changed: changed, skipped: skipped, verifiedDate: new Date().toISOString() };
}

/**
 * Increments Login Count and stamps Last Login for a member. Uses a short
 * script lock so two near-simultaneous logins don't clobber each other's
 * increment. Both columns are optional — if either is missing from the
 * sheet, that part is silently skipped rather than failing the whole call.
 */
function handleRecordLogin(params) {
  const memberNumber = String(params.memberNumber || '').replace(/^0+/, '').trim();
  if (!memberNumber) return { success: false, error: 'Missing memberNumber' };

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
  } catch (e) {
    return { success: false, error: 'Could not acquire lock \u2014 try again' };
  }

  try {
    const SHEET_NAME = 'St Luke KOC Membership DB';
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const memberNumberCol = headers.indexOf('Member Number');
    const loginCountCol = headers.indexOf('Login Count');
    const lastLoginCol = headers.indexOf('Last Login');
    if (memberNumberCol === -1) return { success: false, error: 'Member Number column not found' };

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][memberNumberCol]).replace(/^0+/, '').trim() === memberNumber) {
        const rowNum = i + 1;
        if (loginCountCol !== -1) {
          const current = parseInt(data[i][loginCountCol], 10) || 0;
          sheet.getRange(rowNum, loginCountCol + 1).setValue(current + 1);
        }
        if (lastLoginCol !== -1) {
          sheet.getRange(rowNum, lastLoginCol + 1).setValue(new Date());
        }
        return { success: true };
      }
    }
    return { success: false, error: 'Member not found' };
  } finally {
    lock.releaseLock();
  }
}

function logSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Change Log');
  if (!sheet) throw new Error('Change Log tab not found');
  return sheet;
}

function handleLogChange(params) {
  const LOG_SHEET_NAME = 'Change Log';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    return { success: false, error: 'Change Log tab not found — create it with headers: Timestamp, Member Number, Member Name, Type, Category, Field, Old Value, New Value / Notes, Date Reconciled, Reconciled By' };
  }

  const memberNumber = String(params.memberNumber || '').trim();
  const memberName = String(params.memberName || '').trim();
  const type = String(params.type || '').trim();       // 'Self-edit', 'Flag', or 'Contact Request'
  const category = String(params.category || '').trim(); // 'Contact' / 'Membership' / 'Dues'
  const field = String(params.field || '').trim();
  const oldValue = params.oldValue !== undefined ? String(params.oldValue) : '';
  const newValue = String(params.newValue || '').trim();

  if (!type || !newValue) {
    return { success: false, error: 'Missing required fields for change log entry' };
  }

  sheet.appendRow([new Date(), memberNumber, memberName, type, category, field, oldValue, newValue, '', '']);
  return { success: true };
}

function handleVerify(params) {
  const SHEET_NAME = 'St Luke KOC Membership DB';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const memberNumberCol = headers.indexOf('Member Number');
  const lastVerifyCol = headers.indexOf('Member Last Verify Date');
  const lastChangeDateCol = headers.indexOf('Last Change Date');
  const lastChangeNameCol = headers.indexOf('Last Change Name');

  if ([memberNumberCol, lastVerifyCol, lastChangeDateCol, lastChangeNameCol].includes(-1)) {
    return { success: false, error: 'One or more expected columns not found' };
  }

  const memberNumber = String((params && params.memberNumber) || '').replace(/^0+/, '');
  const confirmerName = String((params && params.confirmerName) || '').trim();

  if (!memberNumber || !confirmerName) {
    return { success: false, error: 'Missing memberNumber or confirmerName' };
  }

  for (let i = 1; i < data.length; i++) {
    const rowMemberNumber = String(data[i][memberNumberCol]).replace(/^0+/, '');
    if (rowMemberNumber === memberNumber) {
      const rowNum = i + 1;
      const today = new Date();
      sheet.getRange(rowNum, lastVerifyCol + 1).setValue(today);
      sheet.getRange(rowNum, lastChangeDateCol + 1).setValue(today);
      sheet.getRange(rowNum, lastChangeNameCol + 1).setValue(confirmerName);
      return { success: true, verifiedDate: today.toISOString() };
    }
  }

  return { success: false, error: 'Member not found' };
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* NOTE on CORS: Apps Script Web Apps automatically include
 * Access-Control-Allow-Origin: * on responses when deployed as
 * "Anyone" access. The doOptions() above handles the preflight.
 * If writes are still blocked after redeployment, verify the
 * deployment is set to "Anyone" (not "Anyone with Google account").
 */

/**
 * Stamps Wizard Completed date and Wizard Outcome on the member's row,
 * then logs a summary entry to the Change Log.
 * outcome: 'Confirmed' | 'Flagged' | 'Status Request'
 * notes: optional detail (dispute text, inactive/leave request, etc.)
 */
function handleCompleteWizard(params) {
  const SHEET_NAME = 'St Luke KOC Membership DB';
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const memberNumberCol = headers.indexOf('Member Number');
  const wizardCompletedCol = headers.indexOf('Wizard Completed');
  const wizardOutcomeCol = headers.indexOf('Wizard Outcome');

  if (memberNumberCol === -1) return { success: false, error: 'Member Number column not found' };

  const memberNumber = String(params.memberNumber || '').replace(/^0+/, '').trim();
  const memberName = String(params.memberName || '').trim();
  const outcome = String(params.outcome || 'Confirmed').trim();
  const notes = String(params.notes || '').trim();

  if (!memberNumber) return { success: false, error: 'Missing memberNumber' };

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][memberNumberCol]).replace(/^0+/, '').trim() === memberNumber) {
      const rowNum = i + 1;
      const today = new Date();

      if (wizardCompletedCol !== -1) sheet.getRange(rowNum, wizardCompletedCol + 1).setValue(today);
      if (wizardOutcomeCol !== -1) sheet.getRange(rowNum, wizardOutcomeCol + 1).setValue(outcome);

      // Log to Change Log
      const logNote = notes ? outcome + ': ' + notes : outcome;
      logSheet().appendRow([today, memberNumber, memberName, 'Wizard', 'Verification', 'Wizard Completed', '', logNote, '', '']);

      return { success: true, completedDate: today.toISOString() };
    }
  }
  return { success: false, error: 'Member not found' };
}


/* ================================================================
 * "My circumstances have changed" — member-reported changes
 * ================================================================
 * One call does everything for a report:
 *   1. Address update (moved only), reusing handleSaveContact
 *   2. Council Member Status (withdrawal only)
 *   3. Circumstance column, if the sheet ever gets one
 *   4. Change Log entry (Notes column records who was emailed)
 *   5. Wizard stamp (withdrawal only, so he isn't asked to verify again)
 *   6. Notification email to the right officers
 *
 * Email addresses come from the Assumptions tab, so they follow whoever
 * holds each role with no code changes.
 */

const WITHDRAWAL_PENDING_STATUS = 'Withdrawal Pending';
const MOVE_ALERT_STATUS = 'Move Alert';

const CIRCUMSTANCE_TYPES = {
  moved:    { label: 'Moved out of area',     circumstance: 'Moved Away',         logType: 'Circumstance',   status: MOVE_ALERT_STATUS, onlyOverBlank: true, roles: ['retention', 'financialSecretary'], stampWizard: false },
  stepback: { label: 'Stepping back',         circumstance: 'Stepping Back', logType: 'Circumstance',   status: null,                      roles: ['retention'],                       stampWizard: false },
  withdraw: { label: 'Withdrawal requested',  circumstance: null,            logType: 'Status Request', status: WITHDRAWAL_PENDING_STATUS, roles: ['grandKnight', 'retention'],         stampWizard: true  },
  other:    { label: 'Circumstances changed', circumstance: null,            logType: 'Circumstance',   status: null,                      roles: ['retention', 'dataAdmin'],          stampWizard: false },
};

const EMAIL_ROLES = {
  grandKnight:        { label: 'Grand Knight',        labels: ['grand knight email'] },
  retention:          { label: 'Retention Chair',     labels: ['retention committee email', 'retention chair email'] },
  financialSecretary: { label: 'Financial Secretary', labels: ['financial secretary email'], fallback: 'dataAdmin' },
  dataAdmin:          { label: 'Data Administrator',  labels: ['data administrator email'] },
};

/** Value (column B) of the Assumptions row whose label (column A) starts with any of `labels`. */
function readAssumption(labels) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Assumptions');
  if (!sh) return '';
  const rows = sh.getDataRange().getValues();
  for (let i = 0; i < rows.length; i++) {
    const label = String(rows[i][0] || '').trim().toLowerCase().replace(/:$/, '');
    if (labels.some(l => label.indexOf(l) === 0)) return String(rows[i][1] || '').trim();
  }
  return '';
}

/** Email address for a role, following its fallback if the role has no address on file. */
function roleEmail(roleKey) {
  const role = EMAIL_ROLES[roleKey];
  const addr = readAssumption(role.labels);
  if (addr) return { address: addr, label: role.label };
  if (role.fallback) {
    const fb = roleEmail(role.fallback);
    if (fb) return { address: fb.address, label: fb.label + ' standing in for ' + role.label };
  }
  return null;
}

function handleReportCircumstance(params) {
  const type = String(params.type || '').trim();
  const cfg = CIRCUMSTANCE_TYPES[type];
  if (!cfg) return { success: false, error: 'Unknown circumstance type' };

  const memberNumber = String(params.memberNumber || '').replace(/^0+/, '').trim();
  if (!memberNumber) return { success: false, error: 'Missing memberNumber' };
  let d = {};
  try { d = JSON.parse(params.details || '{}'); } catch (err) { d = {}; }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('St Luke KOC Membership DB');
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const col = name => headers.indexOf(name);
  let rowIdx = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][col('Member Number')]).replace(/^0+/, '') === memberNumber) { rowIdx = i; break; }
  }
  if (rowIdx === -1) return { success: false, error: 'Member not found' };
  const rowNum = rowIdx + 1;
  const get = name => col(name) === -1 ? '' : String(data[rowIdx][col(name)] || '').trim();
  const memberName = String(params.memberName || '').trim() || (get('First Name') + ' ' + get('Last Name')).trim();

  // 1. Address update (moved)
  let addressChanged = [];
  if (type === 'moved' && params.fields) {
    let fields = {};
    try { fields = JSON.parse(params.fields); } catch (err) { fields = {}; }
    if (Object.keys(fields).some(k => String(fields[k] || '').trim())) {
      const r = handleSaveContact({ memberNumber: memberNumber, memberName: memberName, fields: JSON.stringify(fields) });
      addressChanged = (r && r.changed) || [];
    }
  }

  // 2. Council Member Status (withdrawal: always; move: only over a blank or Active status,
  //    so it never overwrites something further along like Transfer Pending)
  let statusSet = '';
  if (cfg.status && col('Council Member Status') !== -1) {
    const oldStatus = get('Council Member Status');
    const replaceable = !cfg.onlyOverBlank || ['', 'active', 'current'].indexOf(oldStatus.toLowerCase()) !== -1;
    if (oldStatus !== cfg.status && replaceable) {
      sheet.getRange(rowNum, col('Council Member Status') + 1).setValue(cfg.status);
      logSheet().appendRow([new Date(), memberNumber, memberName, 'Status Request', 'Membership', 'Council Member Status', oldStatus, cfg.status, '', '']);
      statusSet = cfg.status;
    }
  }

  // 3. Circumstance column, only if the sheet has one
  if (cfg.circumstance && col('Circumstance') !== -1) {
    sheet.getRange(rowNum, col('Circumstance') + 1).setValue(cfg.circumstance);
  }

  // 4. Notification email (before the log entry, so the log can record the result)
  const summary = circumstanceSummary(type, d);
  const recipients = [];
  const seen = {};
  cfg.roles.forEach(k => {
    const r = roleEmail(k);
    if (!r) return;
    recipients.push(r.label);
    r.address.split(/[,;]/).map(a => a.trim()).filter(Boolean).forEach(a => { seen[a.toLowerCase()] = a; });
  });
  const addresses = Object.keys(seen).map(k => seen[k]);
  let emailNote;
  if (!addresses.length) {
    emailNote = 'No email sent: no officer email on the Assumptions tab';
  } else {
    try {
      MailApp.sendEmail({
        to: addresses.join(','),
        subject: '[Member Center] ' + cfg.label + ': ' + memberName + ' (#' + String(params.memberNumber || memberNumber) + ')',
        body: circumstanceEmailBody(type, d, memberName, get('phone'), get('email'), statusSet),
        name: 'St. Luke Member Center'
      });
      emailNote = 'Emailed ' + recipients.join(', ');
    } catch (err) {
      emailNote = 'Email FAILED: ' + err.message;
    }
  }

  // 5. Change Log entry
  logSheet().appendRow([new Date(), memberNumber, memberName, cfg.logType, 'Membership', cfg.label, '', summary, emailNote, '']);

  // 6. Wizard stamp (withdrawal)
  if (cfg.stampWizard) {
    if (col('Wizard Completed') !== -1) sheet.getRange(rowNum, col('Wizard Completed') + 1).setValue(new Date());
    if (col('Wizard Outcome') !== -1) sheet.getRange(rowNum, col('Wizard Outcome') + 1).setValue(WITHDRAWAL_PENDING_STATUS);
  }

  return { success: true, emailed: emailNote, addressChanged: addressChanged };
}

/** One-line summary for the Change Log. */
function circumstanceSummary(type, d) {
  if (type === 'moved') {
    let s = 'New address: ' + (d.newAddress || '(not provided yet)') + '. Wants to join a council near new home: ' + (d.transfer || 'Not answered');
    if (d.transfer === 'Yes' && d.where) s += ' (' + d.where + ')';
    return s + '.';
  }
  if (type === 'stepback') {
    const reasons = (d.reasons || []).join(', ') || 'none given';
    let s = 'Reasons: ' + reasons;
    if ((d.reasons || []).indexOf('Dues or cost') !== -1) s += ' · DUES BARRIER';
    if (d.note) s += ' · Note: ' + d.note;
    return s + ' · Follow-up: Retention Chair call';
  }
  if (type === 'withdraw') {
    const chose = [d.letter ? 'printed letter to sign and return' : '', d.contact ? 'council to contact him' : ''].filter(Boolean).join(' and ');
    return 'Signature pending. Member chose: ' + (chose || 'no option') + '.';
  }
  return d.note || '(no note)';
}

/** Plain-text email body for the officers. */
function circumstanceEmailBody(type, d, name, phone, email, statusSet) {
  let lines;
  if (type === 'moved') {
    const transfer = d.transfer || 'Not answered';
    lines = [
      name + ' reports he has moved out of the St. Luke area.',
      'New address: ' + (d.newAddress || '(not provided yet)'),
      'Wants to join a council near his new home: ' + transfer + (transfer === 'Yes' && d.where ? ' (' + d.where + ')' : ''),
      '',
      'Financial Secretary: please update his address in Member Management.',
      statusSet ? 'His Council Member Status is now ' + statusSet + '. Change it to Transfer Pending, or back to Active, once his plans are clear.' : null,
      transfer === 'Yes'
        ? 'Retention Chair: he may want help finding a council. The receiving council initiates the transfer.'
        : 'Retention Chair: for your awareness.'
    ].filter(line => line !== null);
  } else if (type === 'stepback') {
    const reasons = d.reasons || [];
    lines = [name + ' told us he needs to step back for a while.', 'Reasons: ' + (reasons.join(', ') || 'none given')];
    if (reasons.indexOf('Dues or cost') !== -1) lines.push('** He indicated dues or cost is a barrier. **');
    if (d.note) lines.push('His note: ' + d.note);
    lines.push('', 'He was told the Retention Chair will call in the next few weeks.');
  } else if (type === 'withdraw') {
    lines = [
      name + ' has asked to withdraw from the Knights of Columbus.',
      'Supreme requires his personal, signed request. His Council Member Status is now ' + WITHDRAWAL_PENDING_STATUS + '.',
      '',
      d.letter ? 'He printed the pre-filled withdrawal letter to sign and return.' : 'He did not print the letter.',
      d.contact ? 'He asked for someone from the council to contact him about the signed request.' : 'He did not ask to be contacted.'
    ];
  } else {
    lines = [name + ' says his circumstances have changed:', '', '"' + (d.note || '') + '"', '', 'He was told someone from the council will follow up.'];
  }
  lines.push('', 'Phone: ' + (phone || 'not on file'), 'Email: ' + (email || 'not on file'), '',
             'Logged in the Change Log. Sent automatically by the St. Luke Member Center.');
  return lines.join('\n');
}

/**
 * Run this ONCE from the Apps Script editor (select it in the function
 * dropdown, click Run). It grants the script permission to send email and
 * sends a test message listing the officer addresses it found.
 */
function testMemberCenterEmail() {
  const lines = Object.keys(EMAIL_ROLES).map(k => {
    const r = roleEmail(k);
    return EMAIL_ROLES[k].label + ': ' + (r ? r.address + (r.label !== EMAIL_ROLES[k].label ? '  [' + r.label + ']' : '') : '(no address on file)');
  });
  const da = roleEmail('dataAdmin');
  const to = da ? da.address : Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: to,
    subject: '[Member Center] Test email: setup check',
    body: 'Member Center email notifications are working.\n\nAddresses found on the Assumptions tab:\n' + lines.join('\n'),
    name: 'St. Luke Member Center'
  });
  Logger.log('Sent test email to ' + to + '\n' + lines.join('\n'));
}


/* ================================================================
 * Sign-in with an emailed code
 * ================================================================ */

const CODE_TTL_SECONDS = 60 * 60;   // a code works for an hour (some providers deliver slowly)
const CODE_MAX_TRIES = 5;           // wrong guesses before the code is locked
const CODE_RESEND_SECONDS = 30;     // wait between code emails
const CODE_MAX_PER_HOUR = 5;        // code emails per member per hour
const REMEMBER_DAYS = 90;           // "Keep me signed in": 90 days from the last visit
const SESSION_HOURS = 12;           // otherwise the pass lasts 12 hours (and ends when the browser closes)

function normEmail(s) { return String(s || '').trim().toLowerCase(); }
function titleCaseName(s) { return String(s || '').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
function stripZeros(n) { return String(n || '').trim().replace(/^0+/, ''); }

function maskEmail(email) {
  const parts = String(email).split('@');
  if (parts.length !== 2) return email;
  return parts[0].charAt(0) + '\u2022'.repeat(Math.max(parts[0].length - 1, 3)) + '@' + parts[1];
}

/** The member row for an email address or member number, with the fields sign-in needs. */
function findMember(by, value) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('St Luke KOC Membership DB');
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).trim());
  const col = name => headers.indexOf(name);
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const get = name => col(name) === -1 ? '' : String(row[col(name)] == null ? '' : row[col(name)]).trim();
    const match = by === 'email'
      ? get('email').toLowerCase().split(/[,;\s]+/).filter(Boolean).indexOf(value) !== -1
      : stripZeros(get('Member Number')) === stripZeros(value);
    if (match) {
      return {
        number: get('Member Number'), email: get('email').split(/[,;\s]+/)[0],
        first: get('First Name'), preferred: get('Preferred Name'), wave: get('Rollout Wave')
      };
    }
  }
  return null;
}

function isAdminEmail(email) {
  const admins = readAssumption(['data administrator email']).toLowerCase().split(/[,;\s]+/).filter(Boolean);
  return admins.indexOf(normEmail(email)) !== -1;
}

/** Staged rollout: a number N on "Open rollout waves through" lets in waves 1..N; anything else lets everyone in. */
function isInvited(member) {
  const open = parseInt(readAssumption(['open rollout waves through']), 10);
  if (isNaN(open) || isAdminEmail(member.email)) return true;
  const wave = parseInt(member.wave, 10);
  return !isNaN(wave) && wave <= open;
}

function sessionSecret() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('SESSION_SECRET', s); }
  return s;
}

function hashCode(code) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, code + '|' + sessionSecret()));
}

/** A signed pass: base64(payload) + '.' + base64(HMAC). Pages can read the payload; only this script can sign it. */
function makeToken(memberNumber, remember) {
  const exp = Date.now() + (remember ? REMEMBER_DAYS * 864e5 : SESSION_HOURS * 36e5);
  const payload = Utilities.base64EncodeWebSafe(JSON.stringify({ n: String(memberNumber), exp: exp, r: remember ? 1 : 0 }));
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, sessionSecret()));
  return payload + '.' + sig;
}

function readToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], sessionSecret()));
  if (parts[1] !== expected) return null;
  let data;
  try { data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString()); }
  catch (err) { return null; }
  if (!data || !data.n || Date.now() > data.exp) return null;
  return data;
}

function authenticate(params) {
  const pass = readToken(params.token);
  if (!pass) return { ok: false, error: 'not_signed_in' };
  const m = findMember('number', pass.n);
  if (!m) return { ok: false, error: 'not_signed_in' };
  return { ok: true, memberNumber: m.number, admin: isAdminEmail(m.email) };
}

function signedInReply(m, remember) {
  return {
    success: true,
    token: makeToken(m.number, remember),
    memberNumber: m.number,
    firstName: titleCaseName(m.preferred || m.first),
    admin: isAdminEmail(m.email),
    remember: !!remember
  };
}

function handleRequestCode(params) {
  const email = normEmail(params.email);
  if (!email) return { success: false, error: 'missing_email' };
  const m = findMember('email', email);
  if (!m) return { success: false, error: 'not_found' };
  if (!isInvited(m)) return { success: false, error: 'not_yet', firstName: titleCaseName(m.preferred || m.first) };

  const cache = CacheService.getScriptCache();
  const key = stripZeros(m.number);
  if (cache.get('cool:' + key)) return { success: false, error: 'wait', seconds: CODE_RESEND_SECONDS };
  const sentThisHour = parseInt(cache.get('hour:' + key) || '0', 10);
  if (sentThisHour >= CODE_MAX_PER_HOUR) return { success: false, error: 'too_many_codes' };

  const code = String(Math.floor(100000 + Math.random() * 900000));
  // Keep every code sent in the last hour: email can arrive slowly and out of order,
  // so whichever code he types still works. A fresh code resets the wrong-guess count.
  const prior = liveCodes(JSON.parse(cache.get('code:' + key) || '{"codes":[]}'));
  prior.push({ h: hashCode(code), c: Date.now() });
  cache.put('code:' + key, JSON.stringify({ codes: prior, t: 0 }), CODE_TTL_SECONDS);
  cache.put('cool:' + key, '1', CODE_RESEND_SECONDS);
  cache.put('hour:' + key, String(sentThisHour + 1), 3600);

  const name = titleCaseName(m.preferred || m.first);
  MailApp.sendEmail({
    to: m.email,
    subject: 'Your St. Luke Member Center sign-in code',
    body: 'Hi ' + (name || 'Brother') + ',\n\n' +
          'Here is your sign-in code for the St. Luke Knights of Columbus Member Center:\n\n' +
          '    ' + code + '\n\n' +
          'Enter it on the sign-in page to finish signing in. The code works for the next hour.\n\n' +
          "If you didn't ask to sign in, you can safely ignore this email. No one can sign in without this code.\n\n" +
          'Fraternally,\nSt. Luke Knights of Columbus\nCouncil 14895, Indianapolis',
    name: 'St. Luke Member Center'
  });
  return { success: true, masked: maskEmail(m.email), firstName: name };
}

/** Codes from the last hour, newest last. */
function liveCodes(rec) {
  const cutoff = Date.now() - CODE_TTL_SECONDS * 1000;
  return (rec && rec.codes ? rec.codes : []).filter(x => x.c > cutoff);
}

function handleVerifyCode(params) {
  const m = findMember('email', normEmail(params.email));
  if (!m) return { success: false, error: 'not_found' };
  const cache = CacheService.getScriptCache();
  const key = 'code:' + stripZeros(m.number);
  const rec = JSON.parse(cache.get(key) || '{"codes":[]}');
  const codes = liveCodes(rec);
  if (!codes.length) return { success: false, error: 'expired' };
  if (rec.t >= CODE_MAX_TRIES) return { success: false, error: 'too_many_tries' };

  const hashed = hashCode(String(params.code || '').replace(/\D/g, ''));
  if (!codes.some(x => x.h === hashed)) {
    rec.codes = codes;
    rec.t = (rec.t || 0) + 1;
    const newest = codes[codes.length - 1].c;
    const secondsLeft = Math.max(1, CODE_TTL_SECONDS - Math.floor((Date.now() - newest) / 1000));
    cache.put(key, JSON.stringify(rec), secondsLeft);   // keep the existing expiry
    const left = CODE_MAX_TRIES - rec.t;
    return { success: false, error: left > 0 ? 'wrong_code' : 'too_many_tries', triesLeft: left };
  }
  cache.remove(key);
  const remember = params.remember === true || String(params.remember) === 'true';
  return signedInReply(m, remember);
}

/** A returning visit: confirm the pass is still good and, if remembered, restart its 90 days. */
function handleSession(params) {
  const pass = readToken(params.token);
  if (!pass) return { success: false, error: 'not_signed_in' };
  const m = findMember('number', pass.n);
  if (!m) return { success: false, error: 'not_signed_in' };
  return signedInReply(m, pass.r === 1);
}

/**
 * Emergency use: signs out every member on every device (they'll need a new code).
 * Run from the Apps Script editor if you ever need it.
 */
function signEveryoneOut() {
  PropertiesService.getScriptProperties().deleteProperty('SESSION_SECRET');
  Logger.log('Everyone is signed out. Members will be asked for a new code.');
}
