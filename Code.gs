/**
 * ═══════════════════════════════════════════════════════════════════
 *  CASCADE HIDEAWAY — Cleaning Report Web App Backend
 *  Version: 3.8  |  Updated: 2026-06-07
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
 *  6. Copy the deployment URL into GAS_SCRIPT_URL secret in the
 *     Supabase Edge Function (submit-cleaning).
 *  7. Authorise the script when prompted on the first run.
 *
 *  CHANGELOG v3.8:
 *  - FIX:  Photo upload loop now supports Supabase Storage URLs in
 *          addition to legacy base64.  Since frontend v6.6 photos are
 *          uploaded to Storage first; the payload carries photo.url
 *          (an https:// Storage URL) with no photo.data.  GAS now calls
 *          UrlFetchApp.fetch(photo.url) to pull the image and writes the
 *          blob to the Drive section subfolder.  This restores the
 *          per-section Drive folders and the email "Photos by Section"
 *          links that had been silently empty since v6.6.
 *          Legacy base64 (photo.data) path preserved for backwards compat.
 *  - NEW:  _handleSubmit success response now includes folderUrl and
 *          folderId so callers can link directly to the Drive archive.
 *  - FIX:  doGet status message updated to v3.8.
 *  - FIX:  _handleSubmit success log updated to v3.8.
 *
 *  CHANGELOG v3.7:
 *  - NEW:  Server-side submissionId dedup via PropertiesService.
 *  - FIX:  doGet() status message updated to v3.7.
 *  - FIX:  _handleSubmit() success log updated to v3.7.
 *  - FIX:  _handleInit() now uses 'Asia/Manila' for folder date stamp.
 *  - FIX:  reportFolder creation now includes a collision guard.
 *  - FIX:  criticalTableBlock rewritten to plain concatenation.
 *  - NEW:  Success response now echoes back submissionId.
 *
 *  CHANGELOG v3.6:
 *  - NEW:  _buildEmailHtml() renders a Critical Items Summary table.
 *
 *  CHANGELOG v3.5:
 *  - FIX:  Last Guest Name and Number of Nights Stayed in summary table.
 *  - NEW:  _cell() helper for consistent table cell markup.
 *
 *  CHANGELOG v3.4:
 *  - NEW:  GET ?action=lastReadings — backwards scan for previous readings.
 *  - FIX:  _handleSubmit accepts pre-calculated deltaKwh, deltaM3.
 *
 *  CHANGELOG v3.3:
 *  - FIXED: All appendRow() replaced with getRange().setValues([[]]).
 *  - NEW:   fixNamedTable() — removes Named Table format from log sheet.
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
//  DEDUP HELPERS  (v3.7 — unchanged in v3.8)
// ═══════════════════════════════════════════════════════════════════
var DEDUP_TTL_MS = 72 * 60 * 60 * 1000;

function _dedupKey(submissionId) {
  return 'seen_' + submissionId;
}

function _isDuplicate(submissionId) {
  if (!submissionId) return false;
  var stored = PropertiesService.getScriptProperties().getProperty(_dedupKey(submissionId));
  if (!stored) return false;
  var storedMs = parseInt(stored, 10);
  if (isNaN(storedMs)) return false;
  return (Date.now() - storedMs) < DEDUP_TTL_MS;
}

function _markSeen(submissionId) {
  if (!submissionId) return;
  PropertiesService.getScriptProperties().setProperty(_dedupKey(submissionId), String(Date.now()));
}

function pruneDedup() {
  var props = PropertiesService.getScriptProperties();
  var all   = props.getProperties();
  var now   = Date.now();
  for (var k in all) {
    if (k.indexOf('seen_') !== 0) continue;
    var ms = parseInt(all[k], 10);
    if (isNaN(ms) || (now - ms) >= DEDUP_TTL_MS) {
      props.deleteProperty(k);
    }
  }
  Logger.log('pruneDedup: sweep complete.');
}


// ═══════════════════════════════════════════════════════════════════
//  ROUTER
// ═══════════════════════════════════════════════════════════════════
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
  if (action === 'lastReadings') return _handleLastReadings();
  return _json({ ok: true, msg: 'Cascade Hideaway Web App v3.8 — online' });
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

    const subId = String(payload.submissionId || payload.submission_id || '').trim();
    if (subId && _isDuplicate(subId)) {
      Logger.log('[doPost] Duplicate rejected: ' + subId);
      return _json({ result: 'duplicate', status: 'duplicate', submissionId: subId });
    }
    if (subId) _markSeen(subId);

    return _handleSubmit(payload, subId);

  } catch (err) {
    Logger.log('FATAL ERROR: ' + err.toString() + '\n' + (err.stack || ''));
    return _json({ result: 'error', message: String(err.message || err), stack: err.stack || '' });
  }
}


// ═══════════════════════════════════════════════════════════════════
//  ACTION: LAST READINGS  (v3.4 — unchanged in v3.8)
// ═══════════════════════════════════════════════════════════════════
function _handleLastReadings() {
  try {
    const ss    = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet || sheet.getLastRow() < 2) {
      return _json({ electric: null, water: null });
    }

    const lastRow   = sheet.getLastRow();
    const elecData  = sheet.getRange(2, COL.ELECTRIC, lastRow - 1, 1).getValues();
    const waterData = sheet.getRange(2, COL.WATER,    lastRow - 1, 1).getValues();

    let electric = null;
    let water    = null;

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
//  DRIVE FOLDER SCHEMA (2026-09-12)
//
//  The root was a flat pile because two handlers invented two different
//  names for the same report: init made
//    "2026-09-08 cleaning report photos - Cascade Bria - Honey"
//  and submit made
//    "20260908_Honey"
//  so every turnover left two folders, one of them usually empty — and the
//  empty one was the link the sheet recorded (FD-003).
//
//  One report, one folder, filed by the CLEANING date rather than the day
//  it happened to be uploaded:
//
//    <root>/2026/2026-09/2026-09-08_Cascade-Bria_Honey/
//        01_pre-clean/  02_meters/  03_bedroom/  04_kitchen/
//        05_after-clean/  06_issues/
//
//  Sorting by name now sorts by time, a month is one folder to archive,
//  and a meter photo is named for the number it proves.
// ═══════════════════════════════════════════════════════════════════

function _childFolder(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

function _reportFolder(cleaningDate, unitName, cleanerName) {
  const root = DriveApp.getFolderById(ROOT_PHOTOS_FOLDER_ID);

  // Fall back to today only if the caller sent no cleaning date.
  const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(cleaningDate || '')
    ? cleaningDate
    : Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');

  const year  = dateStr.slice(0, 4);
  const month = dateStr.slice(0, 7);

  const slug = function (t) {
    return _sanitizeName(t || '').replace(/\s+/g, '-').replace(/-+/g, '-') || 'Unknown';
  };

  const base        = dateStr + '_' + slug(unitName) + '_' + slug(cleanerName);
  const monthFolder = _childFolder(_childFolder(root, year), month);

  // A second turnover on one day is real (mid-stay, or a re-clean).
  let name = base, idx = 2;
  while (monthFolder.getFoldersByName(name).hasNext()) {
    name = base + '_' + idx;
    idx++;
  }
  return monthFolder.createFolder(name);
}

// Sections are numbered so Drive lists them in the order they were done.
var SECTION_FOLDER_NAMES = {
  meterPhotos:      '02_meters',
  precleanPhotos:   '01_pre-clean',
  bedroomPhotos:    '03_bedroom',
  kitchenPhotos:    '04_kitchen',
  aftercleanPhotos: '05_after-clean',
  issuePhotos:      '06_issues'
};

function _sectionFolderName(sectionId, fallbackLabel) {
  return SECTION_FOLDER_NAMES[sectionId]
      || (fallbackLabel || sectionId).replace(/[^\w\s\-]/g, '').replace(/\s+/g, '_').trim()
      || sectionId;
}

// A meter photo should carry the number it is evidence for, so the pair can
// be checked later without opening the sheet.
function _photoFileName(sectionId, index, reading) {
  if (sectionId === 'meterPhotos') {
    const which = index === 0 ? 'electric' : 'water';
    const value = (reading === null || reading === undefined || reading === '')
      ? 'no-reading'
      : String(reading).replace(/[^0-9.]/g, '');
    return which + '_' + value + '.jpg';
  }
  return 'photo_' + (index + 1) + '.jpg';
}

// ═══════════════════════════════════════════════════════════════════
//  ACTION: INIT — create dated photo subfolder in Drive (v3.7)
// ═══════════════════════════════════════════════════════════════════
function _handleInit(e) {
  const unitName     = _sanitizeName(_getParam(e, 'unitName')    || 'Unknown Unit');
  const cleanerName  = _sanitizeName(_getParam(e, 'cleanerName') || 'Unknown Cleaner');
  const cleaningDate = _getParam(e, 'cleaningDate') || '';

  const folder = _reportFolder(cleaningDate, unitName, cleanerName);
  Logger.log('Init: created folder "' + folder.getName() + '"');
  return _json({
    result:     'success',
    folderId:   folder.getId(),
    folderUrl:  folder.getUrl(),
    folderName: folder.getName()
  });
}


// ═══════════════════════════════════════════════════════════════════
//  ACTION: UPLOAD — save one base64 photo into a Drive subfolder
//  (legacy path — used only if the frontend sends directly to GAS)
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
//  ACTION: SUBMIT — full report → Sheet + Drive + Email + Calendar
//
//  v3.8: Photo upload loop now supports Supabase Storage URLs.
//        When photo.url is present (and photo.data is absent), GAS
//        fetches the image via UrlFetchApp and saves it to the Drive
//        section subfolder.  This restores the per-section Drive
//        folders and the email photo links that had been silently
//        empty since frontend v6.6.
//        Success response now includes folderUrl + folderId.
// ═══════════════════════════════════════════════════════════════════
function _handleSubmit(payload, subId) {

  const formData         = payload.formData        || {};
  const photos           = payload.photos          || {};
  const sectionNames     = payload.sectionNames    || {};
  const checklistDetails = payload.checklistDetails || [];
  const calendarData     = payload.calendarData    || {};
  const notesArr         = payload.allNotes        || payload.notesArr || [];
  const urgentText       = payload.urgentItems     || payload.urgentText || '';
  const emailSubject     = payload.emailSubject    || 'Cleaning Report – Cascade Bria';
  const meta             = payload.meta            || {};

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

  const rawDeltaKwh = payload.deltaKwh;
  const rawDeltaM3  = payload.deltaM3;
  const deltaKwh = (typeof rawDeltaKwh === 'number' && !isNaN(rawDeltaKwh))
    ? +(rawDeltaKwh.toFixed(2)) : '—';
  const deltaM3  = (typeof rawDeltaM3  === 'number' && !isNaN(rawDeltaM3))
    ? +(rawDeltaM3.toFixed(3))  : '—';

  const lastGuestName  = String(payload.lastGuestName  || formData.lastGuestName  || '—').trim() || '—';
  const numberOfNights = Number(payload.numberOfNights || formData.numberOfNights || 0);
  const avgKwhPerDay   = (typeof rawDeltaKwh === 'number' && !isNaN(rawDeltaKwh) && numberOfNights > 0)
    ? +(rawDeltaKwh / numberOfNights).toFixed(2) : null;
  const avgM3PerDay    = (typeof rawDeltaM3  === 'number' && !isNaN(rawDeltaM3)  && numberOfNights > 0)
    ? +(rawDeltaM3  / numberOfNights).toFixed(3) : null;

  const cleaningDate = String(
    payload.cleaningDate || formData.cleaningDate || ''
  ).trim() || Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');

  const cleanerName  = formData.cleanerName  || payload.cleanerName  || '—';
  // The client has sent this since v6; Code.gs never read it (FD-003).
  const sessionFolderId = String(
    payload.sessionFolderId || formData.sessionFolderId || ''
  ).trim();
  const unitName     = formData.unitName     || payload.unitName     || 'Cascade Bria';
  const startTime    = formData.startTime    || '—';
  const endTime      = formData.endTime      || '—';
  const elapsedTime  = formData.elapsedTime  || '—';

  const completionRate = Number(payload.completionRate || meta.rate || 0);
  const doneItems      = Number(meta.doneItems  || 0);
  const totalItems     = Number(meta.totalItems || 0);

  Logger.log('=== CLEANING REPORT RECEIVED (v3.8) ===');
  Logger.log('Cleaner:    ' + cleanerName + ' | Unit: ' + unitName);
  Logger.log('Date:       ' + cleaningDate);
  Logger.log('Last Guest: ' + lastGuestName + ' | Nights: ' + numberOfNights);
  Logger.log('Electric:   ' + electricReading + ' kWh  |  Δ: ' + deltaKwh);
  Logger.log('Water:      ' + waterReading    + ' m³    |  Δ: ' + deltaM3);
  Logger.log('Completion: ' + completionRate + '%');
  Logger.log('Photos:     ' + Object.keys(photos).length + ' section(s)');
  if (subId) Logger.log('SubID:      ' + subId);

  // ── Create report folder ──────────────────────────────────────
  // FD-003: the client created a folder at action=init and has been uploading
  // into it. Reuse it rather than making a second, usually-empty folder and
  // linking the sheet to that one.
  var reportFolder = null;
  if (sessionFolderId) {
    try { reportFolder = DriveApp.getFolderById(sessionFolderId); }
    catch (folderErr) { Logger.log('sessionFolderId unusable: ' + folderErr); }
  }
  if (!reportFolder) {
    reportFolder = _reportFolder(cleaningDate, unitName, cleanerName);
  }

  // ── Upload photos to Drive (v3.8: supports Storage URL + legacy base64) ──
  const photoLinks = {};
  for (const sectionId in photos) {
    const sectionPhotos = photos[sectionId];
    if (!sectionPhotos || !sectionPhotos.length) continue;

    const sectionFolder = _childFolder(
      reportFolder, _sectionFolderName(sectionId, sectionNames[sectionId]));
    photoLinks[sectionId] = [];

    sectionPhotos.forEach(function(photo, i) {
      if (!photo) return;
      try {
        var blob;
        var meterValue = (sectionId === 'meterPhotos')
          ? (i === 0 ? electricReading : waterReading)
          : null;
        var fileName = _photoFileName(sectionId, i, meterValue);

        if (photo.data) {
          // ── Legacy path: base64 embedded in payload ──────────
          var base64 = photo.data.replace(/^data:image\/\w+;base64,/, '');
          blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', fileName);

        } else if (photo.url && photo.url.indexOf('http') === 0) {
          // ── v3.8 path: Supabase Storage URL ──────────────────
          // The Storage bucket is public-read; no auth header required.
          var resp = UrlFetchApp.fetch(photo.url, { muteHttpExceptions: true });
          if (resp.getResponseCode() !== 200) {
            Logger.log('Photo fetch failed (' + sectionId + ' #' + i + '): HTTP ' + resp.getResponseCode() + ' — ' + photo.url);
            return;
          }
          blob = resp.getBlob();
          blob.setName(fileName);

        } else {
          return; // no data and no url — skip
        }

        var file = sectionFolder.createFile(blob);
        // Share so email recipients can open each photo link directly.
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

  // ── Build notes ───────────────────────────────────────────────
  const notesText = notesArr.map(function(n) {
    return '[' + (n.section || '') + ']: ' + (n.isUrgent ? '[URGENT] ' : '') + (n.text || '');
  }).join('\n');

  const _guestInfoNote = (lastGuestName !== '—' || numberOfNights > 0)
    ? 'Last Guest: ' + lastGuestName +
      (numberOfNights > 0
        ? ' (' + numberOfNights + ' night' + (numberOfNights !== 1 ? 's' : '') + ')'
        : '')
    : '';
  const _fullNotesText = [_guestInfoNote, notesText].filter(Boolean).join('\n');

  // ── Log to spreadsheet ────────────────────────────────────────
  _logToSheet(
    cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
    electricReading, waterReading,
    deltaKwh, deltaM3,
    completionRate, doneItems, totalItems,
    urgentText, _fullNotesText,
    reportFolder.getUrl()
  );

  // ── Send HTML email ───────────────────────────────────────────
  const htmlEmail = _buildEmailHtml({
    cleaningDate, cleanerName, unitName, startTime, endTime, elapsedTime,
    electricReading, waterReading,
    deltaKwh:     deltaKwh,     deltaM3:     deltaM3,
    avgKwhPerDay: avgKwhPerDay, avgM3PerDay: avgM3PerDay,
    lastGuestName: lastGuestName, numberOfNights: numberOfNights,
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

  // ── Calendar event (non-fatal) ────────────────────────────────
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

  Logger.log('=== REPORT PROCESSED SUCCESSFULLY (v3.8) ===');

  // v3.8: return folderUrl + folderId so callers can link to the Drive archive.
  return _json({
    result:       'success',
    status:       'success',
    message:      'Report submitted successfully.',
    submissionId: subId || null,
    folderId:     reportFolder.getId(),
    folderUrl:    reportFolder.getUrl()
  });
}


// ═══════════════════════════════════════════════════════════════════
//  SPREADSHEET LOGGING  (v3.4 — unchanged in v3.8)
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

    const elecVal  = (electricReading !== 'Not recorded') ? (parseFloat(electricReading)  || null) : null;
    const waterVal = (waterReading    !== 'Not recorded') ? (parseFloat(waterReading)     || null) : null;

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
      if (typeof deltaKwh === 'number') monthKwh = deltaKwh;
      if (typeof deltaM3  === 'number') monthM3  = deltaM3;
    }

    const newRow = lastRow + 1;
    sheet.getRange(newRow, 1, 1, TOTAL_COLS).setValues([[
      new Date(),
      cleaningDate,
      unitName,
      cleanerName,
      startTime,
      endTime,
      elapsedTime,
      elecVal  !== null ? elecVal  : electricReading,
      waterVal !== null ? waterVal : waterReading,
      deltaKwh,
      deltaM3,
      monthKwh,
      monthM3,
      rate + '%',
      done,
      total,
      urgentText || '—',
      notesText  || '—',
      folderUrl  || '—'
    ]]);

    try { sheet.autoResizeColumns(1, TOTAL_COLS); } catch(e) {}
    Logger.log('Sheet row written to row ' + newRow + '.');

    _updateMonthlySummary(ss);

  } catch (sheetErr) {
    Logger.log('Sheet error (non-fatal): ' + sheetErr.toString());
  }
}


// ═══════════════════════════════════════════════════════════════════
//  MONTHLY SUMMARY TAB  (v3.3 — unchanged in v3.8)
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
      const rows = sortedKeys.map(function(key) {
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

function updateMonthlySummary() {
  _updateMonthlySummary(null);
}


// ═══════════════════════════════════════════════════════════════════
//  FIX NAMED TABLE  (v3.3 — unchanged in v3.8)
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
//  EMAIL HTML BUILDER  (v3.7 fix preserved in v3.8)
// ═══════════════════════════════════════════════════════════════════
function _buildEmailHtml(d) {
  const rateColor = d.rate === 100 ? '#006B54' : d.rate >= 80 ? '#e07b00' : '#C1414D';
  const dateStr   = d.cleaningDate ? _formatReadableDate(d.cleaningDate) : d.cleaningDate;

  const fmtDeltaKwh = (typeof d.deltaKwh === 'number') ? '+' + d.deltaKwh.toFixed(2) + ' kWh' : '—';
  const fmtDeltaM3  = (typeof d.deltaM3  === 'number') ? '+' + d.deltaM3.toFixed(3)  + ' m³'  : '—';
  const fmtAvgKwh   = (typeof d.avgKwhPerDay === 'number') ? d.avgKwhPerDay.toFixed(2) + ' kWh/night' : null;
  const fmtAvgM3    = (typeof d.avgM3PerDay  === 'number') ? d.avgM3PerDay.toFixed(3)  + ' m³/night'  : null;

  const nightsLabel = (d.numberOfNights && d.numberOfNights > 0)
    ? d.numberOfNights + ' night' + (d.numberOfNights !== 1 ? 's' : '')
    : '—';

  function _cell(label, value) {
    return '<td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;width:50%;vertical-align:top;">'
      + '<span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
      + 'text-transform:uppercase;letter-spacing:1px;">' + label + '</span>'
      + '<strong style="color:#22333B;">' + value + '</strong>'
      + '</td>';
  }

  let criticalTableBlock = '';
  const criticalItems = [];
  (d.checklistDetails || []).forEach(function(section) {
    (section.items || []).forEach(function(item) {
      if (item.critical) criticalItems.push({ text: item.text, checked: item.checked });
    });
  });

  if (criticalItems.length) {
    const allCritOk  = criticalItems.every(function(i) { return i.checked; });
    const headerBg   = allCritOk ? '#e6f4ee' : '#fef0f1';
    const headerCol  = allCritOk ? '#006B54' : '#C1414D';
    const headerIcon = allCritOk ? '✅' : '⚠️';

    var critRows = criticalItems.map(function(item, i) {
      var rowBg  = i % 2 === 0 ? '#ffffff' : '#f9f8f5';
      var status = item.checked
        ? '<span style="color:#006B54;font-weight:700;">✅ All Good</span>'
        : '<span style="color:#C1414D;font-weight:700;">⚠️ Issue</span>';
      return '<tr style="background:' + rowBg + ';border-top:1px solid #EAE0D5;">'
        + '<td style="padding:9px 12px;color:#22333B;">' + _esc(item.text) + '</td>'
        + '<td style="padding:9px 12px;text-align:center;">' + status + '</td>'
        + '</tr>';
    }).join('');

    criticalTableBlock =
      '<div style="margin-bottom:20px;">'
      + '<p style="font-weight:700;color:' + headerCol + ';font-size:1em;margin:0 0 8px;">'
      + headerIcon + ' Critical Items Summary</p>'
      + '<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;'
      + 'border:1px solid #EAE0D5;border-radius:10px;overflow:hidden;font-size:0.88em;">'
      + '<tr style="background:' + headerBg + ';">'
      + '<th style="padding:8px 12px;text-align:left;font-size:0.75em;font-weight:700;'
      + 'text-transform:uppercase;letter-spacing:0.8px;color:#5E503F;width:70%;">Item</th>'
      + '<th style="padding:8px 12px;text-align:center;font-size:0.75em;font-weight:700;'
      + 'text-transform:uppercase;letter-spacing:0.8px;color:#5E503F;width:30%;">Status</th>'
      + '</tr>'
      + critRows
      + '</table></div>';
  }

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

    + '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#f9f8f5;'
    +   'border-radius:10px;overflow:hidden;border:1px solid #EAE0D5;">'
    + '<tr>'
    + _cell('Property',      _esc(d.unitName))
    + _cell('Cleaning Date', _esc(dateStr))
    + '</tr>'
    + '<tr>'
    + _cell('Cleaner', _esc(d.cleanerName))
    + _cell('Time',    _esc(d.startTime) + ' → ' + _esc(d.endTime)
                       + (d.elapsedTime && d.elapsedTime !== '—'
                          ? ' (' + _esc(d.elapsedTime) + ')' : ''))
    + '</tr>'
    + '<tr>'
    + _cell('Last Guest',    _esc(d.lastGuestName || '—'))
    + _cell('Nights Stayed', _esc(nightsLabel))
    + '</tr>'
    + '<tr>'
    + '<td style="padding:12px 14px;" colspan="2">'
    + '<span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
    +   'text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Completion</span>'
    + '<strong style="color:' + rateColor + ';font-size:1.3em;">' + d.rate + '%</strong>'
    + '<span style="color:#888;font-size:0.85em;margin-left:6px;">(' + d.done + ' / ' + d.total + ' items)</span>'
    + '</td>'
    + '</tr>'
    + '</table>'

    + '<div style="background:linear-gradient(135deg,#eaf4f0,#e4f2ea);border:2px solid #006B54;'
    +   'border-radius:12px;padding:16px 20px;margin-bottom:20px;">'
    + '<p style="font-weight:700;color:#006B54;margin:0 0 12px;font-size:1em;">⚡💧 Meter Readings</p>'
    + '<table width="100%" cellpadding="0" cellspacing="0"><tr>'
    + '<td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;text-align:center;vertical-align:top;">'
    + '<span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">⚡ Electric</span>'
    + '<span style="display:block;font-size:1.6em;font-weight:700;color:'
    +   (d.electricReading === 'Not recorded' ? '#C1414D' : '#22333B') + ';margin-top:4px;">'
    +   _esc(d.electricReading) + '</span>'
    + '<span style="font-size:0.8em;color:#888;">kWh</span>'
    + '<div style="margin-top:6px;font-size:0.82em;color:#006B54;font-weight:700;">' + _esc(fmtDeltaKwh) + ' this session</div>'
    + (fmtAvgKwh ? '<div style="margin-top:3px;font-size:0.78em;color:#5E503F;font-weight:600;">⌀ avg ' + _esc(fmtAvgKwh) + '</div>' : '')
    + '</td>'
    + '<td width="4%"></td>'
    + '<td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;text-align:center;vertical-align:top;">'
    + '<span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">💧 Water</span>'
    + '<span style="display:block;font-size:1.6em;font-weight:700;color:'
    +   (d.waterReading === 'Not recorded' ? '#C1414D' : '#22333B') + ';margin-top:4px;">'
    +   _esc(d.waterReading) + '</span>'
    + '<span style="font-size:0.8em;color:#888;">m³</span>'
    + '<div style="margin-top:6px;font-size:0.82em;color:#006B54;font-weight:700;">' + _esc(fmtDeltaM3) + ' this session</div>'
    + (fmtAvgM3 ? '<div style="margin-top:3px;font-size:0.78em;color:#5E503F;font-weight:600;">⌀ avg ' + _esc(fmtAvgM3) + '</div>' : '')
    + '</td>'
    + '</tr></table></div>'

    + criticalTableBlock
    + urgentBlock
    + notesBlock

    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;margin:20px 0 12px;font-size:1.05em;">📸 Photos by Section</h3>'
    + photosBlock

    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;margin:20px 0 6px;font-size:1.05em;">📋 Full Checklist Details</h3>'
    + checklistBlock

    + '<p style="margin-top:20px;font-size:0.82em;color:#888;">'
    +   '<a href="' + (d.reportFolderUrl || '#') + '" style="color:#22333B;">📁 View All Photos in Drive</a>'
    + '</p>'
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
//  TEST — writes a real row + sends test email
//  Select "testSubmit" and click Run from the editor.
// ═══════════════════════════════════════════════════════════════════
function testSubmit() {
  const today = Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');
  const result = _handleSubmit({
    submissionId:             'test-' + Date.now(),
    electricReading:          '12350.0',
    waterReading:             '790.5',
    previousElectricReading:  12345.6,
    previousWaterReading:     789.1,
    deltaKwh:                 4.4,
    deltaM3:                  1.4,
    cleaningDate:             today,
    completionRate:           100,
    lastGuestName:            'Juan Dela Cruz',
    numberOfNights:           2,
    emailSubject:             '🧹 TEST Report — Cascade Bria — ' + today,
    formData: {
      unitName:             'Cascade Bria',
      cleanerName:          'Test Cleaner',
      cleaningDate:         today,
      startTime:            '09:00',
      endTime:              '12:30',
      elapsedTime:          '03:30:00',
      electricMeterReading: '12350.0',
      waterMeterReading:    '790.5',
      lastGuestName:        'Juan Dela Cruz',
      numberOfNights:       2
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
          { text: 'Test item 1', checked: true,  critical: true },
          { text: 'Test item 2', checked: false, critical: true }
        ]
      }
    ],
    allNotes:    [],
    urgentItems: '',
    meta: { rate: 100, doneItems: 2, totalItems: 2 }
  }, 'test-manual');
  Logger.log('testSubmit result: ' + result.getContent());
  Logger.log('✅ Check sheet and email inbox for the test row.');
}
