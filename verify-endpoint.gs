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
  const result = handleVerify(e.parameter);
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
  return jsonResponse(handleVerify(params));
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
