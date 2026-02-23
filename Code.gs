/**
 * ═══════════════════════════════════════════════════════════════════
 *  CASCADE HIDEAWAY — Cleaning Report Apps Script
 *  Version: 3.0  |  Updated: 2026
 * ═══════════════════════════════════════════════════════════════════
 *
 *  SETUP STEPS:
 *  1. Paste this entire file into your Apps Script editor.
 *  2. Set DRIVE_FOLDER_ID below to your Google Drive folder ID.
 *  3. Set RECIPIENT_EMAIL to where reports should be sent.
 *  4. Deploy → New deployment → Web app:
 *       Execute as: Me
 *       Who has access: Anyone
 *  5. Copy the deployment URL into SCRIPT_URL in index.html.
 *  6. On the first run, authorise the script when prompted.
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURATION ────────────────────────────────────────────────
const DRIVE_FOLDER_ID  = 'YOUR_DRIVE_FOLDER_ID_HERE';   // ← REPLACE THIS
const RECIPIENT_EMAIL  = 'cascadereservations@gmail.com';
const SHEET_NAME       = 'Cleaning Reports';
const CALENDAR_ID      = 'cascadereservations@gmail.com';
// ──────────────────────────────────────────────────────────────────


// ═══════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════════════
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('No POST data received');
    }

    const payload = JSON.parse(e.postData.contents);

    // ── 1. Validate config ────────────────────────────────────────
    if (!DRIVE_FOLDER_ID || DRIVE_FOLDER_ID === 'YOUR_DRIVE_FOLDER_ID_HERE') {
      throw new Error('DRIVE_FOLDER_ID is not configured. Please set it in Code.gs and redeploy.');
    }

    // ── 2. Extract all fields ─────────────────────────────────────
    const formData        = payload.formData        || {};
    const photos          = payload.photos          || {};
    const sectionNames    = payload.sectionNames    || {};
    const checklistDetails= payload.checklistDetails|| [];
    const calendarData    = payload.calendarData    || {};
    const notesArr        = payload.notesArr        || payload.allNotes || [];
    const urgentText      = payload.urgentText      || payload.urgentItems || '';
    const emailSubject    = payload.emailSubject    || 'Cleaning Report – Cascade Bria';
    const meta            = payload.meta            || {};

    // ── 3. Meter readings — read from MULTIPLE locations for safety
    //       The frontend sends them in formData AND as top-level fields.
    const electricReading = String(
      payload.electricReading           ||
      formData.electricMeterReading     ||
      formData['electricMeterReading']  ||
      ''
    ).trim() || 'Not recorded';

    const waterReading = String(
      payload.waterReading              ||
      formData.waterMeterReading        ||
      formData['waterMeterReading']     ||
      ''
    ).trim() || 'Not recorded';

    const cleaningDate = String(
      payload.cleaningDate              ||
      formData.cleaningDate             ||
      ''
    ).trim() || formatDate(new Date());

    const cleanerName  = formData.cleanerName  || '—';
    const unitName     = formData.unitName     || 'Cascade Bria';
    const startTime    = formData.startTime    || '—';
    const endTime      = formData.endTime      || '—';
    const elapsedTime  = formData.elapsedTime  || '—';

    // ── 4. Log everything for debugging ──────────────────────────
    Logger.log('=== CLEANING REPORT RECEIVED ===');
    Logger.log('Cleaner:  ' + cleanerName);
    Logger.log('Date:     ' + cleaningDate);
    Logger.log('Electric: ' + electricReading + ' kWh');
    Logger.log('Water:    ' + waterReading + ' m³');
    Logger.log('Subject:  ' + emailSubject);
    Logger.log('Photos object keys: ' + Object.keys(photos).join(', '));
    Logger.log('FormData keys: ' + Object.keys(formData).join(', '));

    // ── 5. Upload photos to Google Drive ─────────────────────────
    const driveFolder  = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const dateStamp    = cleaningDate.replace(/-/g, '');
    const reportFolder = driveFolder.createFolder(
      dateStamp + '_' + cleanerName.replace(/\s+/g, '_')
    );

    // photoLinks = { sectionId: [ {name, url, sectionLabel}, … ] }
    const photoLinks = {};

    for (const sectionId in photos) {
      const sectionPhotos = photos[sectionId];
      if (!sectionPhotos || !sectionPhotos.length) continue;

      const sectionLabel = (sectionNames[sectionId] || sectionId)
        .replace(/[^\w\s\-]/g, '').replace(/\s+/g, '_').trim();

      const sectionFolder = reportFolder.createFolder(sectionLabel || sectionId);
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
            name: photo.name || ('Photo ' + (i + 1)),
            url:  file.getUrl(),
            sectionLabel: sectionNames[sectionId] || sectionId
          });
        } catch (photoErr) {
          Logger.log('Photo upload error: ' + photoErr.toString());
        }
      });
    }

    // ── 6. Log to spreadsheet ─────────────────────────────────────
    logToSheet(
      cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
      electricReading, waterReading,
      meta.rate || meta.completionRate || 0,
      meta.doneItems || 0, meta.totalItems || 0,
      urgentText,
      notesArr.map(function(n) { return '[' + n.section + ']: ' + n.text; }).join('\n'),
      reportFolder.getUrl()
    );

    // ── 7. Build and send email ───────────────────────────────────
    const htmlEmail = buildEmailHtml({
      cleaningDate: cleaningDate,
      cleanerName:  cleanerName,
      unitName:     unitName,
      startTime:    startTime,
      endTime:      endTime,
      elapsedTime:  elapsedTime,
      electricReading: electricReading,
      waterReading:    waterReading,
      rate:    meta.rate || meta.completionRate || 0,
      done:    meta.doneItems  || 0,
      total:   meta.totalItems || 0,
      urgentText:      urgentText,
      notesArr:        notesArr,
      photoLinks:      photoLinks,
      sectionNames:    sectionNames,
      checklistDetails:checklistDetails,
      reportFolderUrl: reportFolder.getUrl()
    });

    MailApp.sendEmail({
      to:       RECIPIENT_EMAIL,
      subject:  emailSubject,
      htmlBody: htmlEmail,
      name:     'Cascade Hideaway'
    });

    // ── 8. Add calendar event ─────────────────────────────────────
    try {
      if (calendarData && calendarData.startDateTime) {
        const cal = CalendarApp.getCalendarById(CALENDAR_ID);
        if (cal) {
          cal.createEvent(
            calendarData.summary || '🧹 Cleaning Report',
            new Date(calendarData.startDateTime),
            new Date(calendarData.endDateTime   || calendarData.startDateTime),
            { description: calendarData.description || '' }
          );
        }
      }
    } catch (calErr) {
      Logger.log('Calendar error (non-fatal): ' + calErr.toString());
    }

    Logger.log('=== REPORT PROCESSED SUCCESSFULLY ===');
    return jsonResponse({ status: 'success', message: 'Report submitted successfully.' });

  } catch (err) {
    Logger.log('FATAL ERROR: ' + err.toString() + '\n' + err.stack);
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}


// ═══════════════════════════════════════════════════════════════════
//  SPREADSHEET LOGGING
// ═══════════════════════════════════════════════════════════════════
function logToSheet(
  cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
  electricReading, waterReading, rate, done, total,
  urgentText, notesText, folderUrl
) {
  try {
    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    let sheet   = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        'Timestamp', 'Cleaning Date', 'Property', 'Cleaner',
        'Start Time', 'End Time', 'Elapsed',
        'Electric Reading (kWh)', 'Water Reading (m³)',
        'Completion %', 'Items Done', 'Total Items',
        'Urgent Notes', 'General Notes', 'Photos Folder'
      ]);
      sheet.getRange(1, 1, 1, 15).setFontWeight('bold').setBackground('#22333B').setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }

    sheet.appendRow([
      new Date(),
      cleaningDate,
      unitName,
      cleanerName,
      startTime,
      endTime,
      elapsedTime,
      electricReading,
      waterReading,
      rate + '%',
      done,
      total,
      urgentText   || '—',
      notesText    || '—',
      folderUrl    || '—'
    ]);

    // Auto-resize columns
    try { sheet.autoResizeColumns(1, 15); } catch(e) {}

    Logger.log('Sheet logged: row added to "' + SHEET_NAME + '"');
  } catch (sheetErr) {
    Logger.log('Sheet error (non-fatal): ' + sheetErr.toString());
  }
}


// ═══════════════════════════════════════════════════════════════════
//  EMAIL HTML BUILDER (server-side, with real Drive URLs)
// ═══════════════════════════════════════════════════════════════════
function buildEmailHtml(d) {
  var rateColor = d.rate === 100 ? '#006B54' : d.rate >= 80 ? '#e07b00' : '#C1414D';
  var dateStr   = d.cleaningDate ? formatReadableDate(d.cleaningDate) : d.cleaningDate;

  // ── Urgent block ──
  var urgentBlock = '';
  if (d.urgentText) {
    var urgentLines = d.urgentText.split('\n').filter(function(l) { return l.trim(); });
    urgentBlock = '<div style="background:#fef0f1;border:2px solid #C1414D;border-radius:12px;padding:1rem 1.25rem;margin-bottom:1.5rem;">'
      + '<p style="font-weight:700;color:#C1414D;font-size:1.05em;margin:0 0 0.6rem;">🚨 URGENT — Action Required</p>'
      + urgentLines.map(function(line) {
          return '<div style="padding:0.35rem 0;border-bottom:1px solid #fde2e4;color:#5E503F;">' + esc(line) + '</div>';
        }).join('')
      + '</div>';
  }

  // ── Notes block ──
  var notesBlock = '';
  var regularNotes = (d.notesArr || []).filter(function(n) { return !n.isUrgent; });
  if (regularNotes.length) {
    notesBlock = '<div style="background:#f9f8f5;border:1px solid #DCD4CA;border-radius:10px;padding:1rem 1.25rem;margin-bottom:1.5rem;">'
      + '<p style="font-weight:700;color:#22333B;margin:0 0 0.6rem;">📝 Notes</p>'
      + regularNotes.map(function(n) {
          return '<div style="padding:0.35rem 0;border-bottom:1px solid #eee;">'
            + '<strong style="color:#22333B;">[' + esc(n.section) + ']:</strong> '
            + '<span style="color:#5E503F;">' + esc(n.text) + '</span></div>';
        }).join('')
      + '</div>';
  }

  // ── Photos block (labeled, with real Drive URLs) ──
  var photosBlock = '';
  var hasSomePhotos = false;
  for (var sid in d.photoLinks) {
    var links = d.photoLinks[sid];
    if (!links || !links.length) continue;
    hasSomePhotos = true;
    var label = (d.sectionNames[sid] || sid).replace(/[⚡💧🔍🛏️💧✨🧹👤📋]/g, '').trim();
    photosBlock += '<div style="margin-bottom:1.25rem;">'
      + '<p style="font-weight:700;color:#22333B;font-size:0.82em;text-transform:uppercase;'
      +    'letter-spacing:1px;margin:0 0 0.4rem;border-bottom:2px solid #EAE0D5;padding-bottom:0.3rem;">'
      + '📂 ' + esc(label) + '</p>'
      + '<ul style="list-style:none;padding:0;margin:0;">';
    links.forEach(function(photo, i) {
      photosBlock += '<li style="margin-bottom:6px;">'
        + '<a href="' + photo.url + '" style="color:#22333B;font-weight:600;text-decoration:underline;">'
        + '📷 Photo ' + (i+1) + ' — ' + esc(photo.name) + '</a></li>';
    });
    photosBlock += '</ul></div>';
  }
  if (!hasSomePhotos) {
    photosBlock = '<p style="color:#888;font-size:0.9em;">No photos were attached to this report.</p>';
  }

  // ── Checklist block ──
  var checklistBlock = '';
  (d.checklistDetails || []).forEach(function(section) {
    checklistBlock += '<h4 style="margin:1.2rem 0 0.4rem;color:#1e4739;font-size:0.95em;'
      + 'border-bottom:1px solid #EAE0D5;padding-bottom:3px;">'
      + esc(section.icon || '') + ' ' + esc(section.title) + '</h4>'
      + '<ul style="list-style:none;padding-left:8px;margin:0;">';
    (section.items || []).forEach(function(item) {
      checklistBlock += '<li style="margin-bottom:4px;">'
        + (item.checked ? '✅' : '<span style="color:#C1414D;">☐</span>')
        + ' <span style="color:#333;">' + esc(item.text) + '</span></li>';
    });
    checklistBlock += '</ul>';
  });

  // ── Assemble full email ──
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
    + '<body style="font-family:Arial,Helvetica,sans-serif;background:#f5f4f0;margin:0;padding:16px;">'
    + '<div style="max-width:660px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;'
    +             'box-shadow:0 4px 18px rgba(0,0,0,0.1);">'

    // Header
    + '<div style="background:linear-gradient(135deg,#22333B 0%,#5E503F 100%);padding:28px 24px;text-align:center;">'
    + '<h1 style="font-family:Georgia,serif;color:#ffffff;margin:0;font-size:1.7rem;letter-spacing:1px;">CASCADE HIDEAWAY</h1>'
    + '<p style="color:#EAE0D5;margin:6px 0 0;font-size:0.82rem;text-transform:uppercase;letter-spacing:2px;">Cleaning &amp; Turn-over Report</p>'
    + '</div>'

    + '<div style="padding:24px 28px;">'

    // Summary table
    + '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#f9f8f5;border-radius:10px;overflow:hidden;border:1px solid #EAE0D5;">'
    + '<tr>'
    + '  <td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;width:50%;">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">Property</span>'
    + '    <strong style="color:#22333B;font-size:1em;">' + esc(d.unitName) + '</strong>'
    + '  </td>'
    + '  <td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;width:50%;">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">Cleaning Date</span>'
    + '    <strong style="color:#22333B;font-size:1em;">' + esc(dateStr) + '</strong>'
    + '  </td>'
    + '</tr>'
    + '<tr>'
    + '  <td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">Cleaner</span>'
    + '    <strong style="color:#22333B;font-size:1em;">' + esc(d.cleanerName) + '</strong>'
    + '  </td>'
    + '  <td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">Time</span>'
    + '    <strong style="color:#22333B;font-size:1em;">' + esc(d.startTime) + ' → ' + esc(d.endTime) + ' (' + esc(d.elapsedTime) + ')</strong>'
    + '  </td>'
    + '</tr>'
    + '<tr>'
    + '  <td style="padding:12px 14px;" colspan="2">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Completion</span>'
    + '    <strong style="color:' + rateColor + ';font-size:1.3em;">' + d.rate + '%</strong>'
    + '    <span style="color:#888;font-size:0.85em;margin-left:6px;">(' + d.done + ' / ' + d.total + ' items)</span>'
    + '  </td>'
    + '</tr>'
    + '</table>'

    // ═══════════════════════════════════════════════════
    // METER READINGS  ← Most important section
    // ═══════════════════════════════════════════════════
    + '<div style="background:linear-gradient(135deg,#eaf4f0,#e4f2ea);border:2px solid #006B54;'
    +             'border-radius:12px;padding:16px 20px;margin-bottom:20px;">'
    + '  <p style="font-weight:700;color:#006B54;margin:0 0 12px;font-size:1em;">⚡💧 Meter Readings</p>'
    + '  <table width="100%" cellpadding="0" cellspacing="0">'
    + '  <tr>'
    + '    <td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;text-align:center;vertical-align:middle;">'
    + '      <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">⚡ Electric</span>'
    + '      <span style="display:block;font-size:1.6em;font-weight:700;color:#22333B;margin-top:4px;">' + esc(d.electricReading) + '</span>'
    + '      <span style="font-size:0.8em;color:#888;">kWh</span>'
    + '    </td>'
    + '    <td width="4%"></td>'
    + '    <td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;text-align:center;vertical-align:middle;">'
    + '      <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;text-transform:uppercase;letter-spacing:1px;">💧 Water</span>'
    + '      <span style="display:block;font-size:1.6em;font-weight:700;color:#22333B;margin-top:4px;">' + esc(d.waterReading) + '</span>'
    + '      <span style="font-size:0.8em;color:#888;">m³</span>'
    + '    </td>'
    + '  </tr>'
    + '  </table>'
    + '</div>'

    // Urgent
    + urgentBlock

    // Notes
    + notesBlock

    // Photos (labeled by section, real Drive URLs)
    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;margin:20px 0 12px;font-size:1.05em;">📸 Photos by Section</h3>'
    + photosBlock

    // Full checklist
    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;margin:20px 0 6px;font-size:1.05em;">📋 Full Checklist</h3>'
    + checklistBlock

    // Report folder link
    + '<p style="margin-top:20px;font-size:0.82em;color:#888;">'
    + '  <a href="' + (d.reportFolderUrl || '#') + '" style="color:#22333B;">📁 View All Photos in Drive</a>'
    + '</p>'

    + '</div>'

    // Footer
    + '<div style="background:#22333B;padding:16px;text-align:center;">'
    + '  <p style="color:rgba(255,255,255,0.7);margin:0;font-size:0.8em;">✨ Cascade Hideaway Automated Report ✨</p>'
    + '  <p style="color:rgba(255,255,255,0.4);margin:6px 0 0;font-size:0.72em;">'
    +      'Generated: ' + Utilities.formatDate(new Date(), 'Asia/Manila', 'MMMM d, yyyy \'at\' h:mm a z')
    + '  </p>'
    + '</div>'

    + '</div></body></html>';
}


// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
function esc(str) {
  return String(str || '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  return Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd');
}

function formatReadableDate(iso) {
  try {
    // iso = "2026-02-23" → parse as local date
    var parts = iso.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return Utilities.formatDate(d, 'Asia/Manila', 'EEEE, MMMM d, yyyy');
  } catch(e) {
    return iso;
  }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ═══════════════════════════════════════════════════════════════════
//  TEST FUNCTION — run manually from Apps Script editor to verify
// ═══════════════════════════════════════════════════════════════════
function testReport() {
  var mockPayload = {
    electricReading: '12345.6',
    waterReading:    '789.1',
    cleaningDate:    '2026-02-23',
    emailSubject:    '🧹 TEST Cleaning Report: Cascade Bria — Test Cleaner (2026-02-23)',
    formData: {
      unitName:              'Cascade Bria',
      cleanerName:           'Test Cleaner',
      cleaningDate:          '2026-02-23',
      startTime:             '09:00',
      endTime:               '12:30',
      elapsedTime:           '03:30:00',
      electricMeterReading:  '12345.6',
      waterMeterReading:     '789.1'
    },
    photos: {},
    sectionNames: {
      'section_1': '⚡💧 Record Meter Readings',
      'section_2': '🔍 Get Ready & Check'
    },
    checklistDetails: [
      { title: 'Record Meter Readings', icon: '⚡💧',
        items: [{ text: 'Verify readings match the photos', checked: true }] },
      { title: 'Get Ready & Check', icon: '🔍',
        items: [
          { text: 'Gather all cleaning supplies', checked: true },
          { text: 'Knock & open windows',         checked: true }
        ]
      }
    ],
    notesArr:   [],
    urgentText: '',
    meta: { rate: 100, doneItems: 3, totalItems: 3 }
  };

  Logger.log('--- TEST MODE ---');
  Logger.log('Electric: ' + mockPayload.electricReading);
  Logger.log('Water:    ' + mockPayload.waterReading);

  var html = buildEmailHtml({
    cleaningDate:     mockPayload.cleaningDate,
    cleanerName:      mockPayload.formData.cleanerName,
    unitName:         mockPayload.formData.unitName,
    startTime:        mockPayload.formData.startTime,
    endTime:          mockPayload.formData.endTime,
    elapsedTime:      mockPayload.formData.elapsedTime,
    electricReading:  mockPayload.electricReading,
    waterReading:     mockPayload.waterReading,
    rate:             mockPayload.meta.rate,
    done:             mockPayload.meta.doneItems,
    total:            mockPayload.meta.totalItems,
    urgentText:       '',
    notesArr:         [],
    photoLinks:       {},
    sectionNames:     mockPayload.sectionNames,
    checklistDetails: mockPayload.checklistDetails,
    reportFolderUrl:  ''
  });

  MailApp.sendEmail({
    to:       RECIPIENT_EMAIL,
    subject:  mockPayload.emailSubject,
    htmlBody: html,
    name:     'Cascade Hideaway (TEST)'
  });

  Logger.log('TEST EMAIL SENT to ' + RECIPIENT_EMAIL);
  Logger.log('Check that it shows Electric=12345.6 kWh and Water=789.1 m³');
}
