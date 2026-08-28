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

function doGet(e) {
  const action = (e.parameter && e.parameter.action) || 'verify';
  let result;
  if (action === 'logChange') result = handleLogChange(e.parameter);
  else if (action === 'saveContact') result = handleSaveContact(e.parameter);
  else result = handleVerify(e.parameter);

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
  else result = handleVerify(params);
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
    nickname:  ['Nickname', 'Nickname'],
    address1:  ['Street Address', 'Address 1'],
    city:      ['City', 'City'],
    stateAbbr: ['State', 'State'],
    zip:       ['Postal Code', 'Zip Code'],
    phone:     ['phone', 'Phone'],
    email:     ['email', 'Email'],
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
    if (!mapping) return;
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
  const type = String(params.type || '').trim();       // 'Self-edit' or 'Flag'
  const category = String(params.category || '').trim(); // 'Contact' / 'Membership' / 'Dues'
  const field = String(params.field || '').trim();
  const oldValue = params.oldValue !== undefined ? String(params.oldValue) : '';
  const newValue = String(params.newValue || '').trim();

  if (!memberNumber || !type || !newValue) {
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
