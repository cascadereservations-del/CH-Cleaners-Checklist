/**
 * ═══════════════════════════════════════════════════════════════════
 *  CASCADE HIDEAWAY — Cleaning Report Web App Backend
 *  Version: 3.2  |  Updated: 2026
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
 *  ── If upgrading from the original script ──────────────────────
 *  Run migrateSheetV32() ONCE from the editor before going live.
 *  This safely adds the 4 new columns without losing existing data.
 *  ────────────────────────────────────────────────────────────────
 *
 *  ACTIONS (POST — accepts BOTH raw JSON body AND FormData):
 *    action=init   → create dated subfolder in ROOT_PHOTOS_FOLDER_ID
 *                    params: unitName, cleanerName
 *    action=upload → save one photo (dataURL) into that subfolder
 *                    params: folderId, fileName, mimeType, fileData
 *    (default)     → full cleaning report → Sheet + Drive + Email
 *                    body: raw JSON (from index.html v3.x)
 *                    — or — FormData with payload= key (legacy)
 *
 *  CHANGELOG v3.2:
 *  - Fixed: uses openById(SHEET_ID) — correct for standalone scripts
 *  - Fixed: supports BOTH raw JSON body and FormData payload param
 *  - New:   4 extra sheet columns — ⚡ Δ kWh, 💧 Δ m³, ⚡ Month kWh, 💧 Month m³
 *  - New:   "Monthly Summary" sheet auto-refreshes on every submit
 *  - New:   COL constant map — maintainable column references
 *  - New:   migrateSheetV32() — safe in-place column insertion
 *  - New:   testSubmit() writes a real test row + sends test email
 *  - Kept:  init / upload actions (backward compatible)
 *  - Kept:  calendar event creation
 *  - Kept:  full branded HTML email
 *
 *  CHANGELOG v3.1 (prior):
 *  - Meter readings extracted from all possible payload paths
 *  - Numeric values stored in sheet (not "Not recorded" strings)
 *  - Email subject reflects urgent status
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


// ─── COLUMN MAP  (v3.2 — 19 columns) ─────────────────────────────
//
//  A  Timestamp       B  Cleaning Date   C  Property
//  D  Cleaner         E  Start Time      F  End Time
//  G  Elapsed         H  Electric (kWh)  I  Water (m³)
//  J  ⚡ Δ kWh        K  💧 Δ m³         L  ⚡ Month kWh
//  M  💧 Month m³     N  Completion %    O  Items Done
//  P  Total Items     Q  Urgent Notes    R  General Notes
//  S  Photos Folder
//
//  To restructure: change numbers here only — all functions use COL.*
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
  return _json({ ok: true, msg: 'Cascade Hideaway Web App v3.2 — online' });
}

function doPost(e) {
  try {
    // ── Detect content type ────────────────────────────────────
    // index.html v3.x sends a raw JSON body (no action param).
    // Legacy / init / upload calls send FormData with an action param.
    const rawBody  = (e && e.postData && e.postData.contents) ? e.postData.contents.trim() : '';
    const isJson   = rawBody.startsWith('{') || rawBody.startsWith('[');
    const actionParam = _getParam(e, 'action');

    if (!isJson && actionParam === 'init')   return _handleInit(e);
    if (!isJson && actionParam === 'upload') return _handleUpload(e);

    // Full report submit ─────────────────────────────────────────
    // Accept raw JSON body (current index.html) OR FormData payload= (legacy)
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
//  ACTION: INIT — create dated photo subfolder in Drive
// ═══════════════════════════════════════════════════════════════════
function _handleInit(e) {
  const unitName    = _sanitizeName(_getParam(e, 'unitName')    || 'Unknown Unit');
  const cleanerName = _sanitizeName(_getParam(e, 'cleanerName') || 'Unknown Cleaner');

  const root    = DriveApp.getFolderById(ROOT_PHOTOS_FOLDER_ID);
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const base    = dateStr + ' cleaning report photos - ' + unitName + ' - ' + cleanerName;

  // Ensure unique folder name
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
  const fileData = _getParam(e, 'fileData');   // dataURL or raw base64

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

  // ── Meter readings — check every possible payload path ────
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

  // ── Core form fields ───────────────────────────────────────
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

  // ── Debug log ──────────────────────────────────────────────
  Logger.log('=== CLEANING REPORT RECEIVED ===');
  Logger.log('Cleaner:    ' + cleanerName + ' | Unit: ' + unitName);
  Logger.log('Date:       ' + cleaningDate);
  Logger.log('Electric:   ' + electricReading + ' kWh');
  Logger.log('Water:      ' + waterReading + ' m³');
  Logger.log('Completion: ' + completionRate + '%');
  Logger.log('Photos:     ' + Object.keys(photos).length + ' section(s)');

  // ── Upload base64 photos to Drive ──────────────────────────
  const driveRoot    = DriveApp.getFolderById(ROOT_PHOTOS_FOLDER_ID);
  const dateStamp    = cleaningDate.replace(/-/g, '');
  const reportFolder = driveRoot.createFolder(
    dateStamp + '_' + _sanitizeName(cleanerName).replace(/\s+/g, '_')
  );

  const photoLinks = {};
  for (const sectionId in photos) {
    const sectionPhotos = photos[sectionId];
    if (!sectionPhotos || !sectionPhotos.length) continue;

    const rawLabel     = (sectionNames[sectionId] || sectionId).replace(/[^\w\s\-]/g, '').replace(/\s+/g, '_').trim();
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

  // ── Build notes text for the sheet cell ───────────────────
  const notesText = notesArr.map(function(n) {
    return '[' + (n.section || '') + ']: ' + (n.isUrgent ? '[URGENT] ' : '') + (n.text || '');
  }).join('\n');

  // ── Log to spreadsheet (includes delta + monthly tally) ───
  _logToSheet(
    cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
    electricReading, waterReading,
    completionRate, doneItems, totalItems,
    urgentText, notesText,
    reportFolder.getUrl()
  );

  // ── Build and send HTML email ──────────────────────────────
  const htmlEmail = _buildEmailHtml({
    cleaningDate, cleanerName, unitName, startTime, endTime, elapsedTime,
    electricReading, waterReading,
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

  // ── Calendar event ─────────────────────────────────────────
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

  Logger.log('=== REPORT PROCESSED SUCCESSFULLY ===');
  // Return both "result" and "status" keys for compatibility with all index.html versions
  return _json({ result: 'success', status: 'success', message: 'Report submitted successfully.' });
}


// ═══════════════════════════════════════════════════════════════════
//  SPREADSHEET LOGGING  (v3.2)
// ═══════════════════════════════════════════════════════════════════
function _logToSheet(
  cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
  electricReading, waterReading, rate, done, total,
  urgentText, notesText, folderUrl
) {
  try {
    // openById — required for standalone (non-bound) scripts
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    let   sheet = ss.getSheetByName(SHEET_NAME);

    // ── Auto-create sheet with v3.2 headers if absent ─────────
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        'Timestamp',      'Cleaning Date',  'Property',      'Cleaner',
        'Start Time',     'End Time',       'Elapsed',
        'Electric (kWh)', 'Water (m³)',
        '⚡ Δ kWh',       '💧 Δ m³',        '⚡ Month kWh',  '💧 Month m³',
        'Completion %',   'Items Done',     'Total Items',
        'Urgent Notes',   'General Notes',  'Photos Folder'
      ]);
      sheet.getRange(1, 1, 1, TOTAL_COLS)
           .setFontWeight('bold')
           .setBackground('#22333B')
           .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }

    // ── Parse meter readings to numbers (null if unavailable) ─
    const elecVal  = (electricReading !== 'Not recorded') ? (parseFloat(electricReading)  || null) : null;
    const waterVal = (waterReading    !== 'Not recorded') ? (parseFloat(waterReading)     || null) : null;

    // ── Compute Δ vs the previous data row ────────────────────
    // Produces '—' if either side is non-numeric (backwards-compat
    // with old rows that have no meter data).
    const lastRow = sheet.getLastRow();    // row 1 = header
    let deltaKwh  = '—';
    let deltaM3   = '—';

    if (lastRow >= 2) {
      const prevElec  = sheet.getRange(lastRow, COL.ELECTRIC).getValue();
      const prevWater = sheet.getRange(lastRow, COL.WATER).getValue();
      if (elecVal  !== null && typeof prevElec  === 'number') {
        deltaKwh = +(Math.max(0, elecVal  - prevElec ).toFixed(2));
      }
      if (waterVal !== null && typeof prevWater === 'number') {
        deltaM3  = +(Math.max(0, waterVal - prevWater).toFixed(3));
      }
    }

    // ── Determine the month-year bucket ───────────────────────
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

    // ── Compute running monthly totals ────────────────────────
    // Sum Δ values from all existing rows in the same month-year,
    // then add the current row's Δ on top.
    let monthKwh = '—';
    let monthM3  = '—';

    if (lastRow >= 2) {
      const allData = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();
      let sumKwh = 0, sumM3 = 0;

      allData.forEach(function(row) {
        const cellDate = row[COL.DATE      - 1];
        const dKwh     = row[COL.DELTA_KWH - 1];
        const dM3      = row[COL.DELTA_M3  - 1];

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
      // Very first data row — Δ equals monthly total
      if (typeof deltaKwh === 'number') monthKwh = deltaKwh;
      if (typeof deltaM3  === 'number') monthM3  = deltaM3;
    }

    // ── Append the new row ─────────────────────────────────────
    sheet.appendRow([
      new Date(),                                        // A  Timestamp
      cleaningDate,                                      // B  Cleaning Date
      unitName,                                          // C  Property
      cleanerName,                                       // D  Cleaner
      startTime,                                         // E  Start Time
      endTime,                                           // F  End Time
      elapsedTime,                                       // G  Elapsed
      elecVal  !== null ? elecVal  : electricReading,    // H  Electric (kWh)
      waterVal !== null ? waterVal : waterReading,       // I  Water (m³)
      deltaKwh,                                          // J  ⚡ Δ kWh
      deltaM3,                                           // K  💧 Δ m³
      monthKwh,                                          // L  ⚡ Month kWh
      monthM3,                                           // M  💧 Month m³
      rate + '%',                                        // N  Completion %
      done,                                              // O  Items Done
      total,                                             // P  Total Items
      urgentText || '—',                                 // Q  Urgent Notes
      notesText  || '—',                                 // R  General Notes
      folderUrl  || '—'                                  // S  Photos Folder
    ]);

    try { sheet.autoResizeColumns(1, TOTAL_COLS); } catch(e) {}
    Logger.log('Sheet row appended.');

    // ── Refresh Monthly Summary tab ────────────────────────────
    _updateMonthlySummary(ss);

  } catch (sheetErr) {
    Logger.log('Sheet error (non-fatal): ' + sheetErr.toString());
  }
}


// ═══════════════════════════════════════════════════════════════════
//  MONTHLY SUMMARY TAB  (v3.2)
// ═══════════════════════════════════════════════════════════════════
function _updateMonthlySummary(ssParam) {
  try {
    const ss  = ssParam || SpreadsheetApp.openById(SHEET_ID);
    const src = ss.getSheetByName(SHEET_NAME);
    if (!src) return;

    let sum = ss.getSheetByName(MONTHLY_SUMMARY_NAME);
    if (!sum) sum = ss.insertSheet(MONTHLY_SUMMARY_NAME);
    sum.clearContents();

    // Header
    sum.appendRow([
      'Month', '⚡ kWh Consumed', '💧 m³ Consumed',
      '# of Cleans', 'Avg Completion %', '🚨 Urgent Flags'
    ]);
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

    // Write rows chronologically with alternating row colours
    Object.keys(months).sort().forEach(function(key, i) {
      const m     = months[key];
      const parts = key.split('-');
      const label = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1)
        .toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const avgPct = m.cleans > 0 ? (m.rateSum / m.cleans).toFixed(1) + '%' : '—';

      sum.appendRow([label, +m.kwh.toFixed(2), +m.m3.toFixed(3), m.cleans, avgPct, m.urgent ? '⚠️ Yes' : '✅ None']);
      sum.getRange(i + 2, 1, 1, 6).setBackground(i % 2 === 0 ? '#F5F3EF' : '#FFFFFF');
    });

    try { sum.autoResizeColumns(1, 6); } catch(e) {}
    Logger.log('Monthly Summary: ' + Object.keys(months).length + ' month(s) written.');

  } catch(e) {
    Logger.log('Monthly Summary error (non-fatal): ' + e.toString());
  }
}

// Public wrapper — run from the editor at any time to force a rebuild
function updateMonthlySummary() {
  _updateMonthlySummary(null);
}


// ═══════════════════════════════════════════════════════════════════
//  MIGRATION — run ONCE to upgrade an existing sheet safely
//
//  Handles three starting states automatically:
//    7 cols  (original schema)  → adds 12 cols, rewrites header
//    15 cols (v3.1 schema)      → inserts 4 cols after Water, shifts right
//    19 cols (v3.2 schema)      → nothing to do
//
//  HOW TO RUN:
//    1. Open this script in the Apps Script editor
//    2. Select "migrateSheetV32" in the function dropdown
//    3. Click Run — check the Execution log for results
// ═══════════════════════════════════════════════════════════════════
function migrateSheetV32() {
  const ss    = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    Logger.log('Sheet "' + SHEET_NAME + '" not found — will be created on first submission.');
    return;
  }

  const colCount = sheet.getLastColumn();
  const rowCount = sheet.getLastRow();
  Logger.log('Detected: ' + colCount + ' columns, ' + rowCount + ' rows.');

  // Already at v3.2
  if (colCount >= TOTAL_COLS) {
    Logger.log('Already at v3.2 width (' + colCount + ' cols). Running Monthly Summary refresh only.');
    _updateMonthlySummary(ss);
    return;
  }

  // ── Original 7-column schema ──────────────────────────────
  // Cols: Timestamp | Cleaner Name | Unit Name | Start Time | End Time | Report Summary | Photo Folder URL
  if (colCount <= 8) {
    Logger.log('Original schema detected. Expanding to 19 cols and rewriting header.');
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

    // Fill all new columns in existing data rows with '—'
    if (rowCount > 1) {
      sheet.getRange(2, colCount + 1, rowCount - 1, toAdd).setValue('—');
    }
    Logger.log('Original schema migrated. Columns A–G preserved; new columns ' + (colCount + 1) + '–19 added.');
  }

  // ── v3.1 15-column schema ─────────────────────────────────
  // Old J–O = Completion%, Items Done, Total Items, Urgent, Notes, Folder
  // Insert 4 cols after col I → shifts old J–O to N–S automatically
  else if (colCount === 15) {
    Logger.log('v3.1 schema detected. Inserting 4 new columns after Water (col I).');
    for (let i = 0; i < 4; i++) sheet.insertColumnAfter(9);

    sheet.getRange(1, COL.DELTA_KWH).setValue('⚡ Δ kWh');
    sheet.getRange(1, COL.DELTA_M3 ).setValue('💧 Δ m³');
    sheet.getRange(1, COL.MONTH_KWH).setValue('⚡ Month kWh');
    sheet.getRange(1, COL.MONTH_M3 ).setValue('💧 Month m³');

    if (rowCount > 1) {
      sheet.getRange(2, COL.DELTA_KWH, rowCount - 1, 4).setValue('—');
    }
    Logger.log('v3.1 schema migrated. 4 new columns inserted after col I; old J–O shifted to N–S.');
  }

  else {
    Logger.log('Unexpected column count: ' + colCount + '. Please inspect the sheet manually.');
    return;
  }

  // Re-style header row
  sheet.getRange(1, 1, 1, TOTAL_COLS)
       .setFontWeight('bold')
       .setBackground('#22333B')
       .setFontColor('#FFFFFF');

  try { sheet.autoResizeColumns(1, TOTAL_COLS); } catch(e) {}

  _updateMonthlySummary(ss);
  Logger.log('✅ Migration complete. Deploy a NEW VERSION of this script before the next submission.');
}


// ═══════════════════════════════════════════════════════════════════
//  EMAIL HTML BUILDER
// ═══════════════════════════════════════════════════════════════════
function _buildEmailHtml(d) {
  const rateColor = d.rate === 100 ? '#006B54' : d.rate >= 80 ? '#e07b00' : '#C1414D';
  const dateStr   = d.cleaningDate ? _formatReadableDate(d.cleaningDate) : d.cleaningDate;

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

    // ── Header ────────────────────────────────────────────────
    + '<div style="background:linear-gradient(135deg,#22333B 0%,#5E503F 100%);padding:28px 24px;text-align:center;">'
    + '<h1 style="font-family:Georgia,serif;color:#ffffff;margin:0;font-size:1.7rem;letter-spacing:1px;">CASCADE HIDEAWAY</h1>'
    + '<p style="color:#EAE0D5;margin:6px 0 0;font-size:0.82rem;text-transform:uppercase;letter-spacing:2px;">Cleaning &amp; Turn-over Report</p>'
    + '</div>'
    + '<div style="padding:24px 28px;">'

    // ── Summary strip ─────────────────────────────────────────
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

    // ── Meter readings ────────────────────────────────────────
    + '<div style="background:linear-gradient(135deg,#eaf4f0,#e4f2ea);border:2px solid #006B54;border-radius:12px;padding:16px 20px;margin-bottom:20px;">'
    + '<p style="font-weight:700;color:#006B54;margin:0 0 12px;font-size:1em;">⚡💧 Meter Readings</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;text-align:center;">'
    + '<span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">⚡ Electric</span>'
    + '<span style="display:block;font-size:1.6em;font-weight:700;color:' + (d.electricReading === 'Not recorded' ? '#C1414D' : '#22333B') + ';margin-top:4px;">' + _esc(d.electricReading) + '</span>'
    + '<span style="font-size:0.8em;color:#888;">kWh</span></td>'
    + '<td width="4%"></td>'
    + '<td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;text-align:center;">'
    + '<span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">💧 Water</span>'
    + '<span style="display:block;font-size:1.6em;font-weight:700;color:' + (d.waterReading === 'Not recorded' ? '#C1414D' : '#22333B') + ';margin-top:4px;">' + _esc(d.waterReading) + '</span>'
    + '<span style="font-size:0.8em;color:#888;">m³</span></td>'
    + '</tr></table></div>'

    + urgentBlock + notesBlock

    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;margin:20px 0 12px;font-size:1.05em;">📸 Photos by Section</h3>'
    + photosBlock

    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;margin:20px 0 6px;font-size:1.05em;">📋 Full Checklist Details</h3>'
    + checklistBlock

    + '<p style="margin-top:20px;font-size:0.82em;color:#888;"><a href="' + (d.reportFolderUrl || '#') + '" style="color:#22333B;">📁 View All Photos in Drive</a></p>'
    + '</div>'

    // ── Footer ────────────────────────────────────────────────
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
    electricReading:  '12345.6',
    waterReading:     '789.1',
    cleaningDate:     today,
    completionRate:   100,
    emailSubject:     '🧹 TEST Report — Cascade Bria — ' + today,
    formData: {
      unitName:             'Cascade Bria',
      cleanerName:          'Test Cleaner',
      cleaningDate:         today,
      startTime:            '09:00',
      endTime:              '12:30',
      elapsedTime:          '03:30:00',
      electricMeterReading: '12345.6',
      waterMeterReading:    '789.1'
    },
    meterReadings: {
      electric: { value: '12345.6', unit: 'kWh' },
      water:    { value: '789.1',   unit: 'm³'  }
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
