/**
 * ═══════════════════════════════════════════════════════════════════
 *  CASCADE HIDEAWAY — Cleaning Report Web App Backend
 *  Version: 3.4  |  Updated: 2026
 * ═══════════════════════════════════════════════════════════════════
 *
 *  SETUP STEPS:
 *  1. Paste this entire file into your standalone Apps Script editor.
 *  2. Confirm SHEET_ID matches your Google Sheet.
 *  3. Confirm ROOT_PHOTOS_FOLDER_ID matches your Drive folder.
 *  4. Set EMAIL_RECIPIENTS.
 *  5. Deploy → New deployment → Web app:
 *       Execute as: Me
 *       Who has access: Anyone
 *  6. Copy the deployment URL into SCRIPT_URL in index.html.
 *  7. Authorise the script when prompted on the first run.
 *
 *  ── If upgrading from v3.3 ──────────────────────────────────────
 *  Simply deploy a new version after pasting this file.
 *  Run testSubmit() once from the editor to re-authorise if needed.
 *  ────────────────────────────────────────────────────────────────
 *
 *  ACTIONS:
 *    GET  ?action=lastReadings
 *         → Scans sheet backwards for the most recent numeric electric
 *           and water readings. Returns:
 *           { electric: 12345.6, water: 789.1 }
 *           Front-end uses these to display Previous reading and
 *           compute Consumption = Current − Previous client-side.
 *
 *    POST action=init   → create dated subfolder
 *    POST action=upload → save one photo
 *    POST (default)     → full cleaning report → Sheet + Drive + Email
 *
 *  CHANGELOG v3.4:
 *  - NEW:  GET ?action=lastReadings — fast backwards scan for previous
 *          electric and water readings, returned as JSON to front-end.
 *  - FIX:  _handleSubmit now accepts pre-calculated deltaKwh, deltaM3,
 *          previousElectricReading, previousWaterReading directly from
 *          the payload. No sheet scanning at submit time.
 *  - FIX:  _logToSheet signature updated; backwards-scan delta block
 *          entirely removed. Delta values come in as parameters.
 *  - KEPT: Monthly tally (_updateMonthlySummary) unchanged — it sums
 *          the DELTA_KWH / DELTA_M3 columns, which now contain the
 *          pre-calculated client-side values.
 *  - KEPT: All v3.3 fixes (setValues, fixNamedTable, migrateSheetV32).
 *
 *  CHANGELOG v3.3 (prior):
 *  - FIXED: Replaced ALL sheet.appendRow() calls with
 *           sheet.getRange(...).setValues([[]]) to bypass the
 *           Named Table restriction that caused TypeError on appendRow.
 *  - New:   fixNamedTable() — removes Named Table format from the
 *           log sheet so the sheet behaves normally again.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURATION ────────────────────────────────────────────────
const SHEET_ID              = '1fyc-XslpoVoPF27zYcxTcZfqk-rDGbLDGtJeRI0KH4I';
const SHEET_NAME            = 'Cleaning Report Log';
const MONTHLY_SUMMARY_NAME  = 'Monthly Summary';
const ROOT_PHOTOS_FOLDER_ID = '1TFeTSTJ15lZys3zMRTpplrHCioFQ4QCu';
const EMAIL_RECIPIENTS      = 'cascadereservations@gmail.com';
const CALENDAR_ID           = 'cascadereservations@gmail.com';
// ──────────────────────────────────────────────────────────────────


// ─── COLUMN MAP  (v3.2+ — 19 columns) ────────────────────────────
//
//  A  Timestamp       B  Cleaning Date   C  Property
//  D  Cleaner         E  Start Time      F  End Time
//  G  Elapsed         H  Electric (kWh)  I  Water (m³)
//  J  ⚡ Δ kWh        K  💧 Δ m³         L  ⚡ Month kWh
//  M  💧 Month m³     N  Completion %    O  Items Done
//  P  Total Items     Q  Urgent Notes    R  General Notes
//  S  Photos Folder
const COL = {
  TIMESTAMP:  1,
  DATE:       2,
  PROPERTY:   3,
  CLEANER:    4,
  START:      5,
  END:        6,
  ELAPSED:    7,
  ELECTRIC:   8,
  WATER:      9,
  DELTA_KWH: 10,
  DELTA_M3:  11,
  MONTH_KWH: 12,
  MONTH_M3:  13,
  RATE:      14,
  DONE:      15,
  TOTAL:     16,
  URGENT:    17,
  NOTES:     18,
  FOLDER:    19
};
const TOTAL_COLS = 19;
// ──────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════
//  ROUTER
// ═══════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

  // ── v3.4: lastReadings — fetch previous meter values for front-end ──
  if (action === 'lastReadings') {
    return _handleLastReadings();
  }

  return _json({ ok: true, msg: 'Cascade Hideaway Web App v3.4 — online' });
}

function doPost(e) {
  try {
    const rawBody     = (e && e.postData && e.postData.contents) ? e.postData.contents.trim() : '';
    const isJson      = rawBody.startsWith('{') || rawBody.startsWith('[');
    const actionParam = _getParam(e, 'action');

    if (!isJson && actionParam === 'init')   return _handleInit(e);
    if (!isJson && actionParam === 'upload') return _handleUpload(e);

    let payload;
    if (isJson) {
      payload = JSON.parse(rawBody);
    } else {
      const payloadStr = _getParam(e, 'payload');
      if (!payloadStr) return _json({ result: 'error', message: 'No payload received' });
      payload = JSON.parse(payloadStr);
    }

    return _handleSubmit(payload);

  } catch (err) {
    Logger.log('FATAL ERROR: ' + err.toString() + '\n' + (err.stack || ''));
    return _json({ result: 'error', message: String(err.message || err), stack: err.stack || '' });
  }
}


// ═══════════════════════════════════════════════════════════════════
//  ACTION: LAST READINGS  (v3.4 — NEW)
//
//  GET ?action=lastReadings
//
//  Scans the Cleaning Report Log sheet backwards from the last row,
//  looking for the most recent row that contains a numeric value in
//  the Electric (col H) and Water (col I) columns.
//
//  Returns JSON:
//    { electric: 12345.6, water: 789.1 }
//
//  If no prior reading exists for a meter, that field is null:
//    { electric: null, water: null }
//
//  The front-end uses these values to:
//    1. Display "Previous Reading" (readonly)
//    2. Compute Consumption = Current − Previous (live, client-side)
//    3. Send previousElectricReading, previousWaterReading, deltaKwh,
//       deltaM3 in the submit payload so Code.gs never needs to scan.
// ═══════════════════════════════════════════════════════════════════
function _handleLastReadings() {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet || sheet.getLastRow() < 2) {
      return _json({ electric: null, water: null });
    }

    const lastRow = sheet.getLastRow();
    // Read all data rows in one call for efficiency (cols H and I only)
    const elecData  = sheet.getRange(2, COL.ELECTRIC, lastRow - 1, 1).getValues();
    const waterData = sheet.getRange(2, COL.WATER,    lastRow - 1, 1).getValues();

    let electric = null;
    let water    = null;

    // Scan backwards — most recent row with a numeric value wins
    for (let i = elecData.length - 1; i >= 0; i--) {
      if (electric === null) {
        const v = elecData[i][0];
        if (typeof v === 'number' && !isNaN(v)) electric = v;
      }
      if (water === null) {
        const v = waterData[i][0];
        if (typeof v === 'number' && !isNaN(v)) water = v;
      }
      if (electric !== null && water !== null) break;
    }

    Logger.log('lastReadings: electric=' + electric + ', water=' + water);
    return _json({ electric: electric, water: water });

  } catch (err) {
    Logger.log('lastReadings error: ' + err.toString());
    return _json({ electric: null, water: null, error: err.message });
  }
}


// ═══════════════════════════════════════════════════════════════════
//  ACTION: INIT — create dated photo subfolder in Drive
// ═══════════════════════════════════════════════════════════════════
function _handleInit(e) {
  const unitName    = _sanitizeName(_getParam(e, 'unitName')    || 'Unknown Unit');
  const cleanerName = _sanitizeName(_getParam(e, 'cleanerName') || 'Unknown Cleaner');

  const root    = DriveApp.getFolderById(ROOT_PHOTOS_FOLDER_ID);
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const base    = dateStr + ' cleaning report photos - ' + unitName + ' - ' + cleanerName;

  let name = base, idx = 2;
  while (root.getFoldersByName(name).hasNext()) { name = base + ' (' + idx + ')'; idx++; }

  const folder = root.createFolder(name);
  Logger.log('Init: created folder "' + folder.getName() + '"');
  return _json({
    result:     'success',
    folderId:   folder.getId(),
    folderUrl:  folder.getUrl(),
    folderName: folder.getName()
  });
}


// ═══════════════════════════════════════════════════════════════════
//  ACTION: UPLOAD — save one photo into an existing Drive subfolder
// ═══════════════════════════════════════════════════════════════════
function _handleUpload(e) {
  const folderId = _getParam(e, 'folderId');
  const fileName = _getParam(e, 'fileName') || 'photo';
  const mimeType = _getParam(e, 'mimeType') || _guessMimeType(fileName);
  const fileData = _getParam(e, 'fileData');

  if (!folderId || !fileData) {
    return _json({ result: 'error', message: 'Missing folderId or fileData' });
  }

  const base64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
  const bytes  = Utilities.base64Decode(base64);
  const blob   = Utilities.newBlob(bytes, mimeType, fileName);
  const folder = DriveApp.getFolderById(folderId);
  const file   = folder.createFile(blob);

  Logger.log('Upload: saved "' + file.getName() + '" to folder ' + folderId);
  return _json({
    result:   'success',
    fileId:   file.getId(),
    fileUrl:  file.getUrl(),
    fileName: file.getName()
  });
}


// ═══════════════════════════════════════════════════════════════════
//  ACTION: SUBMIT — full report → Sheet + Photos + Email + Calendar
//
//  v3.4 CHANGE: Delta values are now sent from the front-end.
//  The payload should include:
//    electricReading           — current reading (string or number)
//    waterReading              — current reading (string or number)
//    previousElectricReading   — previous reading (number | null)
//    previousWaterReading      — previous reading (number | null)
//    deltaKwh                  — pre-calculated Δ (number | null)
//    deltaM3                   — pre-calculated Δ (number | null)
//
//  No sheet scanning occurs during submission.
// ═══════════════════════════════════════════════════════════════════
function _handleSubmit(payload) {

  const formData         = payload.formData        || {};
  const photos           = payload.photos          || {};
  const sectionNames     = payload.sectionNames    || {};
  const checklistDetails = payload.checklistDetails || [];
  const calendarData     = payload.calendarData    || {};
  const notesArr         = payload.allNotes        || payload.notesArr || [];
  const urgentText       = payload.urgentItems     || payload.urgentText || '';
  const emailSubject     = payload.emailSubject    || 'Cleaning Report – Cascade Bria';
  const meta             = payload.meta            || {};

  // ── Current meter readings ──────────────────────────────────
  const electricReading = String(
    payload.electricReading
    || (payload.meterReadings && payload.meterReadings.electric && payload.meterReadings.electric.value)
    || formData.electricMeterReading
    || ''
  ).trim() || 'Not recorded';

  const waterReading = String(
    payload.waterReading
    || (payload.meterReadings && payload.meterReadings.water && payload.meterReadings.water.value)
    || formData.waterMeterReading
    || ''
  ).trim() || 'Not recorded';

  // ── v3.4: Accept pre-calculated deltas from front-end ───────
  // deltaKwh / deltaM3 arrive as numbers or null from the client.
  // Fall back to '—' if missing (e.g. no previous reading exists).
  const rawDeltaKwh = payload.deltaKwh;
  const rawDeltaM3  = payload.deltaM3;
  const deltaKwh = (typeof rawDeltaKwh === 'number' && !isNaN(rawDeltaKwh))
    ? +(rawDeltaKwh.toFixed(2)) : '—';
  const deltaM3  = (typeof rawDeltaM3  === 'number' && !isNaN(rawDeltaM3))
    ? +(rawDeltaM3.toFixed(3))  : '—';

  // ── Core form fields ────────────────────────────────────────
  const cleaningDate = String(
    payload.cleaningDate || formData.cleaningDate || ''
  ).trim() || Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');

  const cleanerName  = formData.cleanerName  || payload.cleanerName  || '—';
  const unitName     = formData.unitName     || payload.unitName     || 'Cascade Bria';
  const startTime    = formData.startTime    || '—';
  const endTime      = formData.endTime      || '—';
  const elapsedTime  = formData.elapsedTime  || '—';

  const completionRate = Number(payload.completionRate || meta.rate || 0);
  const doneItems      = Number(meta.doneItems  || 0);
  const totalItems     = Number(meta.totalItems || 0);

  Logger.log('=== CLEANING REPORT RECEIVED (v3.4) ===');
  Logger.log('Cleaner:    ' + cleanerName + ' | Unit: ' + unitName);
  Logger.log('Date:       ' + cleaningDate);
  Logger.log('Electric:   ' + electricReading + ' kWh  |  Δ: ' + deltaKwh);
  Logger.log('Water:      ' + waterReading + ' m³    |  Δ: ' + deltaM3);
  Logger.log('Completion: ' + completionRate + '%');
  Logger.log('Photos:     ' + Object.keys(photos).length + ' section(s)');

  // ── Upload base64 photos to Drive ───────────────────────────
  const driveRoot    = DriveApp.getFolderById(ROOT_PHOTOS_FOLDER_ID);
  const dateStamp    = cleaningDate.replace(/-/g, '');
  const reportFolder = driveRoot.createFolder(
    dateStamp + '_' + _sanitizeName(cleanerName).replace(/\s+/g, '_')
  );

  const photoLinks = {};
  for (const sectionId in photos) {
    const sectionPhotos = photos[sectionId];
    if (!sectionPhotos || !sectionPhotos.length) continue;

    const rawLabel      = (sectionNames[sectionId] || sectionId).replace(/[^\w\s\-]/g, '').replace(/\s+/g, '_').trim();
    const sectionFolder = reportFolder.createFolder(rawLabel || sectionId);
    photoLinks[sectionId] = [];

    sectionPhotos.forEach(function(photo, i) {
      if (!photo || !photo.data) return;
      try {
        const base64 = photo.data.replace(/^data:image\/\w+;base64,/, '');
        const bytes  = Utilities.base64Decode(base64);
        const blob   = Utilities.newBlob(bytes, 'image/jpeg', 'photo_' + (i + 1) + '.jpg');
        const file   = sectionFolder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        photoLinks[sectionId].push({
          name:         photo.name || ('Photo ' + (i + 1)),
          url:          file.getUrl(),
          sectionLabel: sectionNames[sectionId] || sectionId
        });
      } catch (photoErr) {
        Logger.log('Photo error (' + sectionId + ' #' + i + '): ' + photoErr.toString());
      }
    });
  }

  // ── Build notes text ────────────────────────────────────────
  const notesText = notesArr.map(function(n) {
    return '[' + (n.section || '') + ']: ' + (n.isUrgent ? '[URGENT] ' : '') + (n.text || '');
  }).join('\n');

  // ── Log to spreadsheet ──────────────────────────────────────
  _logToSheet(
    cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
    electricReading, waterReading,
    deltaKwh, deltaM3,
    completionRate, doneItems, totalItems,
    urgentText, notesText,
    reportFolder.getUrl()
  );

  // ── Send HTML email ─────────────────────────────────────────
  const htmlEmail = _buildEmailHtml({
    cleaningDate, cleanerName, unitName, startTime, endTime, elapsedTime,
    electricReading, waterReading,
    deltaKwh: deltaKwh, deltaM3: deltaM3,
    rate: completionRate, done: doneItems, total: totalItems,
    urgentText, notesArr, photoLinks, sectionNames, checklistDetails,
    reportFolderUrl: reportFolder.getUrl()
  });

  if (EMAIL_RECIPIENTS && EMAIL_RECIPIENTS.trim()) {
    MailApp.sendEmail({
      to:       EMAIL_RECIPIENTS,
      subject:  emailSubject,
      htmlBody: htmlEmail,
      name:     'Cascade Hideaway'
    });
    Logger.log('Email sent to ' + EMAIL_RECIPIENTS);
  }

  // ── Calendar event ──────────────────────────────────────────
  try {
    if (calendarData && calendarData.startDateTime) {
      const cal = CalendarApp.getCalendarById(CALENDAR_ID);
      if (cal) {
        cal.createEvent(
          calendarData.summary || '🧹 Cleaning Report',
          new Date(calendarData.startDateTime),
          new Date(calendarData.endDateTime || calendarData.startDateTime),
          { description: calendarData.description || '' }
        );
        Logger.log('Calendar event: ' + (calendarData.summary || 'Cleaning Report'));
      }
    }
  } catch (calErr) {
    Logger.log('Calendar error (non-fatal): ' + calErr.toString());
  }

  Logger.log('=== REPORT PROCESSED SUCCESSFULLY (v3.4) ===');
  return _json({ result: 'success', status: 'success', message: 'Report submitted successfully.' });
}


// ═══════════════════════════════════════════════════════════════════
//  SPREADSHEET LOGGING  (v3.4)
//
//  v3.4 CHANGE:
//    - Signature now receives deltaKwh and deltaM3 as direct params.
//    - The entire backwards-scan block has been removed.
//    - Monthly totals (_updateMonthlySummary) are unchanged — they
//      still SUM the delta columns, which now hold client-calculated
//      values attributed to the month of cleaningDate.
//
//  v3.3 FIX (retained):
//    - ALL appendRow() replaced with getRange().setValues() to bypass
//      the Named Table restriction.
// ═══════════════════════════════════════════════════════════════════
function _logToSheet(
  cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
  electricReading, waterReading,
  deltaKwh, deltaM3,
  rate, done, total,
  urgentText, notesText, folderUrl
) {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    let   sheet = ss.getSheetByName(SHEET_NAME);

    // ── Auto-create sheet with v3.2 headers if absent ──────────
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.getRange(1, 1, 1, TOTAL_COLS).setValues([[
        'Timestamp',      'Cleaning Date',  'Property',      'Cleaner',
        'Start Time',     'End Time',       'Elapsed',
        'Electric (kWh)', 'Water (m³)',
        '⚡ Δ kWh',       '💧 Δ m³',        '⚡ Month kWh',  '💧 Month m³',
        'Completion %',   'Items Done',     'Total Items',
        'Urgent Notes',   'General Notes',  'Photos Folder'
      ]]);
      sheet.getRange(1, 1, 1, TOTAL_COLS)
           .setFontWeight('bold')
           .setBackground('#22333B')
           .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }

    // ── Parse meter readings to numeric if possible ─────────────
    const elecVal  = (electricReading !== 'Not recorded') ? (parseFloat(electricReading)  || null) : null;
    const waterVal = (waterReading    !== 'Not recorded') ? (parseFloat(waterReading)     || null) : null;

    // ── Determine the month-year bucket for monthly totals ──────
    let rowYear, rowMonth;
    try {
      const p  = String(cleaningDate).split('-');
      rowYear  = parseInt(p[0]);
      rowMonth = parseInt(p[1]);
    } catch(_) {
      const now = new Date();
      rowYear   = now.getFullYear();
      rowMonth  = now.getMonth() + 1;
    }

    // ── Compute running monthly totals ──────────────────────────
    // Sum the DELTA_KWH / DELTA_M3 columns for the same month.
    // This is a simple forward sum — no backwards scan needed.
    let monthKwh = '—';
    let monthM3  = '—';
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      const allData = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();
      let sumKwh = 0, sumM3 = 0;

      allData.forEach(function(row) {
        const cellDate  = row[COL.DATE      - 1];
        const dKwh      = row[COL.DELTA_KWH - 1];
        const dM3       = row[COL.DELTA_M3  - 1];

        let yr, mo;
        if (cellDate instanceof Date && !isNaN(cellDate)) {
          yr = cellDate.getFullYear();
          mo = cellDate.getMonth() + 1;
        } else if (typeof cellDate === 'string' && cellDate.includes('-')) {
          const p = cellDate.split('-');
          yr = parseInt(p[0]); mo = parseInt(p[1]);
        } else { return; }

        if (yr === rowYear && mo === rowMonth) {
          if (typeof dKwh === 'number') sumKwh += dKwh;
          if (typeof dM3  === 'number') sumM3  += dM3;
        }
      });

      if (typeof deltaKwh === 'number') monthKwh = +(sumKwh + deltaKwh).toFixed(2);
      if (typeof deltaM3  === 'number') monthM3  = +(sumM3  + deltaM3 ).toFixed(3);

    } else {
      // First ever row — monthly total equals the delta itself
      if (typeof deltaKwh === 'number') monthKwh = deltaKwh;
      if (typeof deltaM3  === 'number') monthM3  = deltaM3;
    }

    // ── Write the new row ───────────────────────────────────────
    const newRow = lastRow + 1;
    sheet.getRange(newRow, 1, 1, TOTAL_COLS).setValues([[
      new Date(),                                        // A  Timestamp
      cleaningDate,                                      // B  Cleaning Date
      unitName,                                          // C  Property
      cleanerName,                                       // D  Cleaner
      startTime,                                         // E  Start Time
      endTime,                                           // F  End Time
      elapsedTime,                                       // G  Elapsed
      elecVal  !== null ? elecVal  : electricReading,    // H  Electric (kWh)
      waterVal !== null ? waterVal : waterReading,       // I  Water (m³)
      deltaKwh,                                          // J  ⚡ Δ kWh  (from client)
      deltaM3,                                           // K  💧 Δ m³   (from client)
      monthKwh,                                          // L  ⚡ Month kWh
      monthM3,                                           // M  💧 Month m³
      rate + '%',                                        // N  Completion %
      done,                                              // O  Items Done
      total,                                             // P  Total Items
      urgentText || '—',                                 // Q  Urgent Notes
      notesText  || '—',                                 // R  General Notes
      folderUrl  || '—'                                  // S  Photos Folder
    ]]);

    try { sheet.autoResizeColumns(1, TOTAL_COLS); } catch(e) {}
    Logger.log('Sheet row written to row ' + newRow + ' (delta pre-calculated by client).');

    // ── Refresh Monthly Summary tab ─────────────────────────────
    _updateMonthlySummary(ss);

  } catch (sheetErr) {
    Logger.log('Sheet error (non-fatal): ' + sheetErr.toString());
  }
}


// ═══════════════════════════════════════════════════════════════════
//  MONTHLY SUMMARY TAB  (v3.3 / unchanged in v3.4)
//  FIX: All appendRow() replaced with getRange().setValues()
// ═══════════════════════════════════════════════════════════════════
function _updateMonthlySummary(ssParam) {
  try {
    const ss  = ssParam || SpreadsheetApp.openById(SHEET_ID);
    const src = ss.getSheetByName(SHEET_NAME);
    if (!src) return;

    let sum = ss.getSheetByName(MONTHLY_SUMMARY_NAME);
    if (!sum) sum = ss.insertSheet(MONTHLY_SUMMARY_NAME);
    sum.clearContents();

    sum.getRange(1, 1, 1, 6).setValues([[
      'Month', '⚡ kWh Consumed', '💧 m³ Consumed',
      '# of Cleans', 'Avg Completion %', '🚨 Urgent Flags'
    ]]);
    sum.getRange(1, 1, 1, 6)
       .setFontWeight('bold')
       .setBackground('#22333B')
       .setFontColor('#FFFFFF');
    sum.setFrozenRows(1);

    const lastRow = src.getLastRow();
    if (lastRow < 2) return;

    const data = src.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();

    // Aggregate by YYYY-MM
    const months = {};
    data.forEach(function(row) {
      const cellDate  = row[COL.DATE      - 1];
      const dKwh      = row[COL.DELTA_KWH - 1];
      const dM3       = row[COL.DELTA_M3  - 1];
      const rateRaw   = String(row[COL.RATE   - 1] || '0').replace('%', '');
      const urgentVal = String(row[COL.URGENT  - 1] || '');

      let yr, mo;
      if (cellDate instanceof Date && !isNaN(cellDate)) {
        yr = cellDate.getFullYear(); mo = cellDate.getMonth() + 1;
      } else if (typeof cellDate === 'string' && cellDate.includes('-')) {
        const p = cellDate.split('-'); yr = parseInt(p[0]); mo = parseInt(p[1]);
      } else { return; }

      const key = yr + '-' + String(mo).padStart(2, '0');
      if (!months[key]) months[key] = { kwh: 0, m3: 0, cleans: 0, rateSum: 0, urgent: false };
      const m = months[key];
      if (typeof dKwh === 'number') m.kwh += dKwh;
      if (typeof dM3  === 'number') m.m3  += dM3;
      m.cleans++;
      m.rateSum += parseFloat(rateRaw) || 0;
      if (urgentVal && urgentVal !== '—' && urgentVal.trim()) m.urgent = true;
    });

    const sortedKeys = Object.keys(months).sort();
    if (sortedKeys.length > 0) {
      const rows = sortedKeys.map(function(key, i) {
        const m     = months[key];
        const parts = key.split('-');
        const label = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1)
          .toLocaleString('en-US', { month: 'long', year: 'numeric' });
        const avgPct = m.cleans > 0 ? (m.rateSum / m.cleans).toFixed(1) + '%' : '—';
        return [label, +m.kwh.toFixed(2), +m.m3.toFixed(3), m.cleans, avgPct, m.urgent ? '⚠️ Yes' : '✅ None'];
      });

      sum.getRange(2, 1, rows.length, 6).setValues(rows);

      sortedKeys.forEach(function(_, i) {
        sum.getRange(i + 2, 1, 1, 6).setBackground(i % 2 === 0 ? '#F5F3EF' : '#FFFFFF');
      });
    }

    try { sum.autoResizeColumns(1, 6); } catch(e) {}
    Logger.log('Monthly Summary: ' + sortedKeys.length + ' month(s) written.');

  } catch(e) {
    Logger.log('Monthly Summary error (non-fatal): ' + e.toString());
  }
}

// Public wrapper — run from the editor at any time to force a rebuild
function updateMonthlySummary() {
  _updateMonthlySummary(null);
}


// ═══════════════════════════════════════════════════════════════════
//  FIX NAMED TABLE  (v3.3 — unchanged)
//
//  Run ONCE from the editor if the log sheet was formatted as a
//  Named Table (Format > Table in Google Sheets), which blocks writes.
//
//  HOW TO RUN:
//    1. Open Apps Script editor
//    2. Select "fixNamedTable" in the function dropdown
//    3. Click Run — check Execution log
//    4. Deploy a NEW VERSION of the web app after success
// ═══════════════════════════════════════════════════════════════════
function fixNamedTable() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    Logger.log('Sheet "' + SHEET_NAME + '" not found. Nothing to fix.');
    return;
  }

  let bandingCount = 0;
  sheet.getBandings().forEach(function(banding) {
    try { banding.remove(); bandingCount++; } catch(e) {
      Logger.log('Banding remove error (non-fatal): ' + e.toString());
    }
  });
  Logger.log('Removed ' + bandingCount + ' banding(s) from "' + SHEET_NAME + '".');

  try {
    const filter = sheet.getFilter();
    if (filter) { filter.remove(); Logger.log('Removed existing filter.'); }
    else Logger.log('No filter present.');
  } catch(e) { Logger.log('Filter removal error (non-fatal): ' + e.toString()); }

  const colCount = Math.max(sheet.getLastColumn(), TOTAL_COLS);
  try {
    sheet.getRange(1, 1, 1, colCount)
         .setFontWeight('bold').setBackground('#22333B').setFontColor('#FFFFFF');
    Logger.log('Header row formatting re-applied.');
  } catch(e) { Logger.log('Header re-style error (non-fatal): ' + e.toString()); }

  try {
    const testRow = sheet.getLastRow() + 1;
    sheet.getRange(testRow, 1).setValue('__test__');
    sheet.getRange(testRow, 1).clearContent();
    Logger.log('✅ Write test passed — setValues() is now functional on "' + SHEET_NAME + '".');
  } catch(e) {
    Logger.log('⚠️ Write test FAILED: ' + e.toString());
  }

  Logger.log('✅ fixNamedTable() complete. Deploy a NEW VERSION of the script.');
}


// ═══════════════════════════════════════════════════════════════════
//  MIGRATION — run ONCE to upgrade an existing sheet safely
// ═══════════════════════════════════════════════════════════════════
function migrateSheetV32() {
  const ss = SpreadsheetApp.openById(SHEET_ID);

  // Delete orphan Sheet2 if empty (v3.3 addition)
  const orphan = ss.getSheetByName('Sheet2');
  if (orphan) {
    const hasData = orphan.getLastRow() > 0 || orphan.getLastColumn() > 0;
    if (!hasData) {
      try { ss.deleteSheet(orphan); Logger.log('Deleted empty orphan "Sheet2".'); }
      catch(e) { Logger.log('Could not delete Sheet2: ' + e.toString()); }
    } else {
      Logger.log('Sheet2 has data — skipping deletion.');
    }
  }

  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { Logger.log('Sheet not found — will be created on first submission.'); return; }

  const colCount = sheet.getLastColumn();
  const rowCount = sheet.getLastRow();
  Logger.log('Detected: ' + colCount + ' columns, ' + rowCount + ' rows.');

  if (colCount >= TOTAL_COLS) {
    Logger.log('Already at v3.2+ width. Refreshing Monthly Summary only.');
    _updateMonthlySummary(ss);
    return;
  }

  if (colCount <= 8) {
    Logger.log('Original schema. Expanding to 19 cols.');
    const toAdd = TOTAL_COLS - colCount;
    for (let i = 0; i < toAdd; i++) sheet.insertColumnAfter(colCount + i);
    sheet.getRange(1, 1, 1, TOTAL_COLS).setValues([[
      'Timestamp',      'Cleaning Date',  'Property',      'Cleaner',
      'Start Time',     'End Time',       'Elapsed',
      'Electric (kWh)', 'Water (m³)',
      '⚡ Δ kWh',       '💧 Δ m³',        '⚡ Month kWh',  '💧 Month m³',
      'Completion %',   'Items Done',     'Total Items',
      'Urgent Notes',   'General Notes',  'Photos Folder'
    ]]);
    if (rowCount > 1) sheet.getRange(2, colCount + 1, rowCount - 1, toAdd).setValue('—');
    Logger.log('Original schema migrated.');

  } else if (colCount === 15) {
    Logger.log('v3.1 schema. Inserting 4 new columns after Water (col I).');
    for (let i = 0; i < 4; i++) sheet.insertColumnAfter(9);
    sheet.getRange(1, COL.DELTA_KWH).setValue('⚡ Δ kWh');
    sheet.getRange(1, COL.DELTA_M3 ).setValue('💧 Δ m³');
    sheet.getRange(1, COL.MONTH_KWH).setValue('⚡ Month kWh');
    sheet.getRange(1, COL.MONTH_M3 ).setValue('💧 Month m³');
    if (rowCount > 1) sheet.getRange(2, COL.DELTA_KWH, rowCount - 1, 4).setValue('—');
    Logger.log('v3.1 schema migrated.');

  } else {
    Logger.log('Unexpected column count: ' + colCount + '. Inspect manually.');
    return;
  }

  sheet.getRange(1, 1, 1, TOTAL_COLS)
       .setFontWeight('bold').setBackground('#22333B').setFontColor('#FFFFFF');
  try { sheet.autoResizeColumns(1, TOTAL_COLS); } catch(e) {}
  _updateMonthlySummary(ss);
  Logger.log('✅ Migration complete. Run fixNamedTable() if needed, then deploy a NEW VERSION.');
}


// ═══════════════════════════════════════════════════════════════════
//  EMAIL HTML BUILDER
// ═══════════════════════════════════════════════════════════════════
function _buildEmailHtml(d) {
  const rateColor = d.rate === 100 ? '#006B54' : d.rate >= 80 ? '#e07b00' : '#C1414D';
  const dateStr   = d.cleaningDate ? _formatReadableDate(d.cleaningDate) : d.cleaningDate;

  // Delta display helpers
  const fmtDeltaKwh = (typeof d.deltaKwh === 'number') ? '+' + d.deltaKwh.toFixed(2) + ' kWh' : '—';
  const fmtDeltaM3  = (typeof d.deltaM3  === 'number') ? '+' + d.deltaM3.toFixed(3)  + ' m³'  : '—';

  // Urgent block
  let urgentBlock = '';
  if (d.urgentText) {
    const lines = d.urgentText.split('\n').filter(function(l) { return l.trim(); });
    urgentBlock =
      '<div style="background:#fef0f1;border:2px solid #C1414D;border-radius:12px;padding:1rem 1.25rem;margin-bottom:1.5rem;">'
      + '<p style="font-weight:700;color:#C1414D;font-size:1.05em;margin:0 0 0.75rem;">🚨 URGENT — Action Required</p>'
      + lines.map(function(l) {
          return '<div style="padding:0.35rem 0;border-bottom:1px solid #fde2e4;color:#5E503F;">' + _esc(l) + '</div>';
        }).join('')
      + '</div>';
  }

  // Notes block
  let notesBlock = '';
  const regularNotes = (d.notesArr || []).filter(function(n) { return !n.isUrgent; });
  if (regularNotes.length) {
    notesBlock =
      '<div style="background:#f9f8f5;border:1px solid #DCD4CA;border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.5rem;">'
      + '<p style="font-weight:700;color:#22333B;margin:0 0 0.6rem;">📝 Notes</p>'
      + regularNotes.map(function(n) {
          return '<div style="padding:0.35rem 0;border-bottom:1px solid #eee;">'
            + '<strong style="color:#22333B;">[' + _esc(n.section || '') + ']:</strong> '
            + '<span style="color:#5E503F;">' + _esc(n.text || '') + '</span></div>';
        }).join('')
      + '</div>';
  }

  // Photos block
  let photosBlock = '';
  let hasPhotos   = false;
  for (const sid in d.photoLinks) {
    const links = d.photoLinks[sid];
    if (!links || !links.length) continue;
    hasPhotos = true;
    const label = (d.sectionNames[sid] || sid).replace(/[⚡💧🔍🛏️✨🧹👤📋⏳]/g, '').trim();
    photosBlock +=
      '<div style="margin-bottom:1.25rem;">'
      + '<p style="font-weight:700;color:#22333B;font-size:0.82em;text-transform:uppercase;letter-spacing:1px;'
      +   'margin:0 0 0.4rem;border-bottom:2px solid #EAE0D5;padding-bottom:0.3rem;">📂 ' + _esc(label) + '</p>'
      + '<ul style="list-style:none;padding:0;margin:0;">';
    links.forEach(function(photo, i) {
      photosBlock += '<li style="margin-bottom:6px;"><a href="' + photo.url
        + '" style="color:#22333B;font-weight:600;text-decoration:underline;">📷 Photo '
        + (i + 1) + ' — ' + _esc(photo.name) + '</a></li>';
    });
    photosBlock += '</ul></div>';
  }
  if (!hasPhotos) photosBlock = '<p style="color:#888;font-size:0.9em;">No photos were attached.</p>';

  // Checklist block
  let checklistBlock = '';
  (d.checklistDetails || []).forEach(function(section) {
    checklistBlock +=
      '<h4 style="margin:1.2rem 0 0.4rem;color:#1e4739;font-size:0.95em;border-bottom:1px solid #EAE0D5;padding-bottom:3px;">'
      + _esc(section.icon || '') + ' ' + _esc(section.title) + '</h4>'
      + '<ul style="list-style:none;padding-left:8px;margin:0;">';
    (section.items || []).forEach(function(item) {
      const urgent = (item.text || '').indexOf('[URGENT]') !== -1;
      const s = urgent
        ? 'margin-bottom:4px;background:#fff5f5;padding:2px 6px;border-radius:4px;'
        : 'margin-bottom:4px;';
      checklistBlock += '<li style="' + s + '">'
        + (item.checked ? '✅' : '<span style="color:#C1414D;">☐</span>')
        + ' <span style="color:#333;">' + _esc(item.text || '') + '</span></li>';
    });
    checklistBlock += '</ul>';
  });

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;background:#f5f4f0;margin:0;padding:16px;">'
    + '<div style="max-width:660px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;'
    +   'box-shadow:0 4px 18px rgba(0,0,0,0.1);">'

    + '<div style="background:linear-gradient(135deg,#22333B 0%,#5E503F 100%);padding:28px 24px;text-align:center;">'
    + '<h1 style="font-family:Georgia,serif;color:#ffffff;margin:0;font-size:1.7rem;letter-spacing:1px;">CASCADE HIDEAWAY</h1>'
    + '<p style="color:#EAE0D5;margin:6px 0 0;font-size:0.82rem;text-transform:uppercase;letter-spacing:2px;">Cleaning &amp; Turn-over Report</p>'
    + '</div>'
    + '<div style="padding:24px 28px;">'

    // Summary table
    + '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#f9f8f5;border-radius:10px;overflow:hidden;border:1px solid #EAE0D5;">'
    + '<tr>'
    + '<td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;width:50%;"><span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">Property</span><strong style="color:#22333B;">' + _esc(d.unitName) + '</strong></td>'
    + '<td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;"><span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">Cleaning Date</span><strong style="color:#22333B;">' + _esc(dateStr) + '</strong></td>'
    + '</tr><tr>'
    + '<td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;"><span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">Cleaner</span><strong style="color:#22333B;">' + _esc(d.cleanerName) + '</strong></td>'
    + '<td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;"><span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">Time</span><strong style="color:#22333B;">' + _esc(d.startTime) + ' → ' + _esc(d.endTime) + (d.elapsedTime && d.elapsedTime !== '—' ? ' (' + _esc(d.elapsedTime) + ')' : '') + '</strong></td>'
    + '</tr><tr>'
    + '<td style="padding:12px 14px;" colspan="2"><span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Completion</span><strong style="color:' + rateColor + ';font-size:1.3em;">' + d.rate + '%</strong><span style="color:#888;font-size:0.85em;margin-left:6px;">(' + d.done + ' / ' + d.total + ' items)</span></td>'
    + '</tr></table>'

    // Meter readings — now includes delta row
    + '<div style="background:linear-gradient(135deg,#eaf4f0,#e4f2ea);border:2px solid #006B54;border-radius:12px;padding:16px 20px;margin-bottom:20px;">'
    + '<p style="font-weight:700;color:#006B54;margin:0 0 12px;font-size:1em;">⚡💧 Meter Readings</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;text-align:center;vertical-align:top;">'
    + '<span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">⚡ Electric</span>'
    + '<span style="display:block;font-size:1.6em;font-weight:700;color:' + (d.electricReading === 'Not recorded' ? '#C1414D' : '#22333B') + ';margin-top:4px;">' + _esc(d.electricReading) + '</span>'
    + '<span style="font-size:0.8em;color:#888;">kWh</span>'
    + '<div style="margin-top:6px;font-size:0.82em;color:#006B54;font-weight:700;">' + _esc(fmtDeltaKwh) + ' this session</div>'
    + '</td>'
    + '<td width="4%"></td>'
    + '<td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;text-align:center;vertical-align:top;">'
    + '<span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">💧 Water</span>'
    + '<span style="display:block;font-size:1.6em;font-weight:700;color:' + (d.waterReading === 'Not recorded' ? '#C1414D' : '#22333B') + ';margin-top:4px;">' + _esc(d.waterReading) + '</span>'
    + '<span style="font-size:0.8em;color:#888;">m³</span>'
    + '<div style="margin-top:6px;font-size:0.82em;color:#006B54;font-weight:700;">' + _esc(fmtDeltaM3) + ' this session</div>'
    + '</td>'
    + '</tr></table></div>'

    + urgentBlock + notesBlock

    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;margin:20px 0 12px;font-size:1.05em;">📸 Photos by Section</h3>'
    + photosBlock

    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;margin:20px 0 6px;font-size:1.05em;">📋 Full Checklist Details</h3>'
    + checklistBlock

    + '<p style="margin-top:20px;font-size:0.82em;color:#888;"><a href="' + (d.reportFolderUrl || '#') + '" style="color:#22333B;">📁 View All Photos in Drive</a></p>'
    + '</div>'

    + '<div style="background:#22333B;padding:16px;text-align:center;">'
    + '<p style="color:rgba(255,255,255,0.7);margin:0;font-size:0.8em;">✨ Cascade Hideaway Automated Report ✨</p>'
    + '<p style="color:rgba(255,255,255,0.4);margin:6px 0 0;font-size:0.72em;">Generated: '
    + Utilities.formatDate(new Date(), 'Asia/Manila', "MMMM d, yyyy 'at' h:mm a z")
    + '</p></div>'
    + '</div></body></html>';
}


// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
function _getParam(e, name) {
  if (e && e.parameter  && name in e.parameter)  return e.parameter[name];
  if (e && e.parameters && name in e.parameters && e.parameters[name].length)
    return e.parameters[name][0];
  return '';
}

function _guessMimeType(name) {
  const n = (name || '').toLowerCase();
  if (n.endsWith('.png'))  return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function _sanitizeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|]/g, '').trim();
}

function _formatReadableDate(iso) {
  try {
    const p = iso.split('-');
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return Utilities.formatDate(d, 'Asia/Manila', 'EEEE, MMMM d, yyyy');
  } catch(e) { return iso; }
}

function _esc(s) {
  return String(s || '—').replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ═══════════════════════════════════════════════════════════════════
//  TEST — writes a real row to the sheet + sends test email
//  Select "testSubmit" and click Run from the editor
// ═══════════════════════════════════════════════════════════════════
function testSubmit() {
  const today = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');
  const result = _handleSubmit({
    electricReading:          '12350.0',
    waterReading:             '790.5',
    previousElectricReading:  12345.6,
    previousWaterReading:     789.1,
    deltaKwh:                 4.4,
    deltaM3:                  1.4,
    cleaningDate:             today,
    completionRate:           100,
    emailSubject:             '🧹 TEST Report — Cascade Bria — ' + today,
    formData: {
      unitName:             'Cascade Bria',
      cleanerName:          'Test Cleaner',
      cleaningDate:         today,
      startTime:            '09:00',
      endTime:              '12:30',
      elapsedTime:          '03:30:00',
      electricMeterReading: '12350.0',
      waterMeterReading:    '790.5'
    },
    meterReadings: {
      electric: { value: '12350.0', unit: 'kWh' },
      water:    { value: '790.5',   unit: 'm³'  }
    },
    photos:          {},
    sectionNames:    {},
    checklistDetails: [
      {
        title: 'Test Section', icon: '🧪',
        items: [
          { text: 'Test item 1', checked: true },
          { text: 'Test item 2', checked: true }
        ]
      }
    ],
    allNotes:    [],
    urgentItems: '',
    meta: { rate: 100, doneItems: 2, totalItems: 2 }
  });
  Logger.log('testSubmit result: ' + result.getContent());
  Logger.log('✅ Check sheet and email inbox for the test row.');
}
