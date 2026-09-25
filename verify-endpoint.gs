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
  const action = (e.parameter && e.parameter.action) || 'verify';
  let result;
  if (action === 'logChange') result = handleLogChange(e.parameter);
  else if (action === 'saveContact') result = handleSaveContact(e.parameter);
  else if (action === 'recordLogin') result = handleRecordLogin(e.parameter);
  else if (action === 'completeWizard') result = handleCompleteWizard(e.parameter);
  else if (action === 'reportCircumstance') result = handleReportCircumstance(e.parameter);
  else if (action === 'verify') result = handleVerify(e.parameter);
  else result = { success: false, error: 'Unknown action: ' + action };

  const callback = e.parameter && e.parameter.callback;
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
  const action = params.action || 'verify';
  let result;
  if (action === 'logChange') result = handleLogChange(params);
  else if (action === 'saveContact') result = handleSaveContact(params);
  else if (action === 'recordLogin') result = handleRecordLogin(params);
  else if (action === 'completeWizard') result = handleCompleteWizard(params);
  else if (action === 'reportCircumstance') result = handleReportCircumstance(params);
  else if (action === 'verify') result = handleVerify(params);
  else result = { success: false, error: 'Unknown action: ' + action };
  return jsonResponse(result);
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
    const colIdx = headers.indexOf(colName);
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
