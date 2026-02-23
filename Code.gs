/**
 * ═══════════════════════════════════════════════════════════════════
 *  CASCADE HIDEAWAY — Cleaning Report Apps Script
 *  Version: 3.2  |  Updated: 2026
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
 *
 *  CHANGELOG v3.2:
 *  - New: Added ⚡ Δ kWh and 💧 Δ m³ delta columns (J, K)
 *  - New: Added ⚡ Month kWh and 💧 Month m³ running totals (L, M)
 *  - New: "Monthly Summary" sheet auto-refreshes on every submission
 *  - New: COL constant map for maintainable column references
 *  - Improved: Header expanded to 19 columns; autoResizeColumns updated
 *  - Maintained: Full backward compatibility — old rows without meter
 *                readings show "—" in delta columns, no errors thrown
 *
 *  CHANGELOG v3.1:
 *  - Fixed: Meter readings now reliably extracted from ALL payload paths
 *  - Fixed: meterReadings.electric.value / meterReadings.water.value path added
 *  - Fixed: Meter readings now appear in BOTH dedicated block AND checklist
 *  - Improved: Spreadsheet now logs numeric values (not "Not recorded" fallback)
 *  - Improved: Email subject reflects urgent status
 *  - Improved: Better calendar event description
 * ═══════════════════════════════════════════════════════════════════
 */

// ─── CONFIGURATION ────────────────────────────────────────────────
const DRIVE_FOLDER_ID  = 'YOUR_DRIVE_FOLDER_ID_HERE';   // ← REPLACE THIS
const RECIPIENT_EMAIL  = 'cascadereservations@gmail.com';
const SHEET_NAME       = 'Cleaning Reports';
const CALENDAR_ID      = 'cascadereservations@gmail.com';
// ──────────────────────────────────────────────────────────────────


// ─── COLUMN MAP (v3.2) ────────────────────────────────────────────
// Update this object if you ever insert/remove columns.
// All other functions reference COL.* — never raw numbers.
//
//  A  Timestamp       B  Cleaning Date   C  Property
//  D  Cleaner         E  Start Time      F  End Time
//  G  Elapsed         H  Electric (kWh)  I  Water (m³)
//  J  ⚡ Δ kWh        K  💧 Δ m³         L  ⚡ Month kWh
//  M  💧 Month m³     N  Completion %    O  Items Done
//  P  Total Items     Q  Urgent Notes    R  General Notes
//  S  Photos Folder
const COL = {
  TIMESTAMP:  1,   // A
  DATE:       2,   // B
  PROPERTY:   3,   // C
  CLEANER:    4,   // D
  START:      5,   // E
  END:        6,   // F
  ELAPSED:    7,   // G
  ELECTRIC:   8,   // H
  WATER:      9,   // I
  DELTA_KWH: 10,   // J
  DELTA_M3:  11,   // K
  MONTH_KWH: 12,   // L
  MONTH_M3:  13,   // M
  RATE:      14,   // N
  DONE:      15,   // O
  TOTAL:     16,   // P
  URGENT:    17,   // Q
  NOTES:     18,   // R
  FOLDER:    19    // S
};
const TOTAL_COLS = 19;
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

    // ── 1. Validate config ────────────────────────────────────
    if (!DRIVE_FOLDER_ID || DRIVE_FOLDER_ID === 'YOUR_DRIVE_FOLDER_ID_HERE') {
      throw new Error('DRIVE_FOLDER_ID is not configured. Please set it in Code.gs and redeploy.');
    }

    // ── 2. Extract all fields ─────────────────────────────────
    const formData         = payload.formData        || {};
    const photos           = payload.photos          || {};
    const sectionNames     = payload.sectionNames    || {};
    const checklistDetails = payload.checklistDetails || [];
    const calendarData     = payload.calendarData    || {};
    const notesArr         = payload.allNotes        || payload.notesArr || [];
    const urgentText       = payload.urgentItems     || payload.urgentText || '';
    const emailSubject     = payload.emailSubject    || 'Cleaning Report – Cascade Bria';
    const meta             = payload.meta            || {};

    // ── 3. Meter readings — read from ALL possible locations ──
    //       Priority order:
    //         1. payload.electricReading      (top-level, set by index.html v3.1)
    //         2. payload.meterReadings.electric.value (structured object)
    //         3. formData.electricMeterReading (inside formData object)
    //         4. 'Not recorded' fallback
    const electricReading = String(
      payload.electricReading
      || (payload.meterReadings && payload.meterReadings.electric && payload.meterReadings.electric.value)
      || formData.electricMeterReading
      || formData['electricMeterReading']
      || ''
    ).trim() || 'Not recorded';

    const waterReading = String(
      payload.waterReading
      || (payload.meterReadings && payload.meterReadings.water && payload.meterReadings.water.value)
      || formData.waterMeterReading
      || formData['waterMeterReading']
      || ''
    ).trim() || 'Not recorded';

    // ── 4. Other core fields ──────────────────────────────────
    const cleaningDate = String(
      payload.cleaningDate
      || formData.cleaningDate
      || ''
    ).trim() || formatDate(new Date());

    const cleanerName  = formData.cleanerName  || '—';
    const unitName     = formData.unitName     || 'Cascade Bria';
    const startTime    = formData.startTime    || '—';
    const endTime      = formData.endTime      || '—';
    const elapsedTime  = formData.elapsedTime  || '—';

    // ── 5. Compute completion rate ────────────────────────────
    const completionRate = Number(
      payload.completionRate
      || meta.rate
      || meta.completionRate
      || 0
    );
    const doneItems  = meta.doneItems  || 0;
    const totalItems = meta.totalItems || 0;

    // ── 6. Log everything for debugging ──────────────────────
    Logger.log('=== CLEANING REPORT RECEIVED ===');
    Logger.log('Cleaner:          ' + cleanerName);
    Logger.log('Unit:             ' + unitName);
    Logger.log('Date:             ' + cleaningDate);
    Logger.log('Start Time:       ' + startTime);
    Logger.log('End Time:         ' + endTime);
    Logger.log('Electric Reading: ' + electricReading + ' kWh');
    Logger.log('Water Reading:    ' + waterReading + ' m³');
    Logger.log('Completion:       ' + completionRate + '%');
    Logger.log('Subject:          ' + emailSubject);
    Logger.log('Urgent text:      ' + (urgentText ? urgentText.substring(0, 100) : 'none'));
    Logger.log('Photo sections:   ' + Object.keys(photos).join(', '));
    Logger.log('FormData keys:    ' + Object.keys(formData).join(', '));

    // ── 7. Upload photos to Google Drive ─────────────────────
    const driveFolder  = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const dateStamp    = cleaningDate.replace(/-/g, '');
    const reportFolder = driveFolder.createFolder(
      dateStamp + '_' + cleanerName.replace(/\s+/g, '_')
    );

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
          Logger.log('Photo upload error (section ' + sectionId + ', photo ' + i + '): ' + photoErr.toString());
        }
      });
    }

    // ── 8. Log to spreadsheet ─────────────────────────────────
    logToSheet(
      cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
      electricReading, waterReading,
      completionRate,
      doneItems, totalItems,
      urgentText,
      notesArr.map(function(n) {
        var prefix = n.isUrgent ? '[URGENT] ' : '';
        return '[' + (n.section || '') + ']: ' + prefix + (n.text || '');
      }).join('\n'),
      reportFolder.getUrl()
    );

    // ── 9. Build and send email ───────────────────────────────
    const htmlEmail = buildEmailHtml({
      cleaningDate:     cleaningDate,
      cleanerName:      cleanerName,
      unitName:         unitName,
      startTime:        startTime,
      endTime:          endTime,
      elapsedTime:      elapsedTime,
      electricReading:  electricReading,
      waterReading:     waterReading,
      rate:             completionRate,
      done:             doneItems,
      total:            totalItems,
      urgentText:       urgentText,
      notesArr:         notesArr,
      photoLinks:       photoLinks,
      sectionNames:     sectionNames,
      checklistDetails: checklistDetails,
      reportFolderUrl:  reportFolder.getUrl()
    });

    MailApp.sendEmail({
      to:       RECIPIENT_EMAIL,
      subject:  emailSubject,
      htmlBody: htmlEmail,
      name:     'Cascade Hideaway'
    });

    Logger.log('Email sent to ' + RECIPIENT_EMAIL);

    // ── 10. Add calendar event ────────────────────────────────
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
          Logger.log('Calendar event created: ' + (calendarData.summary || 'Cleaning Report'));
        }
      }
    } catch (calErr) {
      Logger.log('Calendar error (non-fatal): ' + calErr.toString());
    }

    Logger.log('=== REPORT PROCESSED SUCCESSFULLY ===');
    return jsonResponse({ status: 'success', message: 'Report submitted successfully.' });

  } catch (err) {
    Logger.log('FATAL ERROR: ' + err.toString() + '\n' + (err.stack || ''));
    return jsonResponse({ status: 'error', message: err.toString() });
  }
}


// ═══════════════════════════════════════════════════════════════════
//  SPREADSHEET LOGGING  (v3.2)
// ═══════════════════════════════════════════════════════════════════
function logToSheet(
  cleaningDate, unitName, cleanerName, startTime, endTime, elapsedTime,
  electricReading, waterReading, rate, done, total,
  urgentText, notesText, folderUrl
) {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    // ── Create sheet + header if it doesn't exist ─────────────
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        'Timestamp',     'Cleaning Date',  'Property',       'Cleaner',
        'Start Time',    'End Time',       'Elapsed',
        'Electric (kWh)','Water (m³)',
        '⚡ Δ kWh',      '💧 Δ m³',        '⚡ Month kWh',   '💧 Month m³',
        'Completion %',  'Items Done',     'Total Items',
        'Urgent Notes',  'General Notes',  'Photos Folder'
      ]);
      const hdr = sheet.getRange(1, 1, 1, TOTAL_COLS);
      hdr.setFontWeight('bold')
         .setBackground('#22333B')
         .setFontColor('#FFFFFF');
      sheet.setFrozenRows(1);
    }

    // ── Parse current meter values to numbers (or null) ───────
    const elecVal  = (electricReading !== 'Not recorded')
      ? (parseFloat(electricReading) || null)
      : null;
    const waterVal = (waterReading !== 'Not recorded')
      ? (parseFloat(waterReading) || null)
      : null;

    // ── Compute Δ from the previous data row ──────────────────
    // Falls back to '—' if either side is non-numeric.
    const lastRow = sheet.getLastRow();   // row 1 = header
    let deltaKwh  = '—';
    let deltaM3   = '—';

    if (lastRow >= 2) {
      const prevElec  = sheet.getRange(lastRow, COL.ELECTRIC).getValue();
      const prevWater = sheet.getRange(lastRow, COL.WATER).getValue();

      if (elecVal  !== null && typeof prevElec  === 'number') {
        // toFixed(2) then *1 strips trailing zeros and keeps it a number
        deltaKwh = +(Math.max(0, elecVal  - prevElec).toFixed(2));
      }
      if (waterVal !== null && typeof prevWater === 'number') {
        deltaM3  = +(Math.max(0, waterVal - prevWater).toFixed(3));
      }
    }

    // ── Compute running monthly totals ────────────────────────
    // Determine the month-year bucket for this new row.
    let rowYear, rowMonth;
    try {
      const parts = String(cleaningDate).split('-');
      rowYear  = parseInt(parts[0]);
      rowMonth = parseInt(parts[1]);
    } catch(parseErr) {
      const now = new Date();
      rowYear   = now.getFullYear();
      rowMonth  = now.getMonth() + 1;
    }

    let monthKwh = '—';
    let monthM3  = '—';

    // Sum Δ values from existing rows that share the same month-year,
    // then add the current row's delta on top.
    if (lastRow >= 2) {
      const allData = sheet.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();
      let sumKwh = 0, sumM3 = 0;

      allData.forEach(function(row) {
        const cellDate = row[COL.DATE      - 1];   // col B (0-indexed)
        const dKwh     = row[COL.DELTA_KWH - 1];   // col J
        const dM3      = row[COL.DELTA_M3  - 1];   // col K

        let yr, mo;
        if (cellDate instanceof Date) {
          yr = cellDate.getFullYear();
          mo = cellDate.getMonth() + 1;
        } else if (typeof cellDate === 'string' && cellDate.includes('-')) {
          const p = cellDate.split('-');
          yr = parseInt(p[0]);
          mo = parseInt(p[1]);
        } else {
          return;   // skip rows with unparseable dates
        }

        if (yr === rowYear && mo === rowMonth) {
          if (typeof dKwh === 'number') sumKwh += dKwh;
          if (typeof dM3  === 'number') sumM3  += dM3;
        }
      });

      if (typeof deltaKwh === 'number') monthKwh = +(sumKwh + deltaKwh).toFixed(2);
      if (typeof deltaM3  === 'number') monthM3  = +(sumM3  + deltaM3).toFixed(3);

    } else {
      // First ever data row — the delta IS the monthly total
      if (typeof deltaKwh === 'number') monthKwh = deltaKwh;
      if (typeof deltaM3  === 'number') monthM3  = deltaM3;
    }

    // ── Append the new row ─────────────────────────────────────
    sheet.appendRow([
      new Date(),                                          // A  Timestamp
      cleaningDate,                                        // B  Cleaning Date
      unitName,                                            // C  Property
      cleanerName,                                         // D  Cleaner
      startTime,                                           // E  Start Time
      endTime,                                             // F  End Time
      elapsedTime,                                         // G  Elapsed
      elecVal  !== null ? elecVal  : electricReading,      // H  Electric (kWh)
      waterVal !== null ? waterVal : waterReading,         // I  Water (m³)
      deltaKwh,                                            // J  ⚡ Δ kWh
      deltaM3,                                             // K  💧 Δ m³
      monthKwh,                                            // L  ⚡ Month kWh
      monthM3,                                             // M  💧 Month m³
      rate + '%',                                          // N  Completion %
      done,                                                // O  Items Done
      total,                                               // P  Total Items
      urgentText || '—',                                   // Q  Urgent Notes
      notesText  || '—',                                   // R  General Notes
      folderUrl  || '—'                                    // S  Photos Folder
    ]);

    // ── Auto-resize all columns ────────────────────────────────
    try { sheet.autoResizeColumns(1, TOTAL_COLS); } catch(e) {}

    Logger.log('Sheet row added to "' + SHEET_NAME + '"');

    // ── Refresh Monthly Summary tab ────────────────────────────
    updateMonthlySummary();

  } catch (sheetErr) {
    Logger.log('Sheet error (non-fatal): ' + sheetErr.toString());
  }
}


// ═══════════════════════════════════════════════════════════════════
//  MONTHLY SUMMARY TAB  (v3.2)
// ═══════════════════════════════════════════════════════════════════
function updateMonthlySummary() {
  try {
    const ss  = SpreadsheetApp.getActiveSpreadsheet();
    const src = ss.getSheetByName(SHEET_NAME);
    if (!src) return;

    const SUMMARY_NAME = 'Monthly Summary';
    let sum = ss.getSheetByName(SUMMARY_NAME);
    if (!sum) {
      sum = ss.insertSheet(SUMMARY_NAME);
    }
    sum.clearContents();

    // ── Header ─────────────────────────────────────────────────
    sum.appendRow([
      'Month',
      '⚡ kWh Consumed',
      '💧 m³ Consumed',
      '# of Cleans',
      'Avg Completion %',
      '🚨 Urgent Flags'
    ]);
    const hdr = sum.getRange(1, 1, 1, 6);
    hdr.setFontWeight('bold')
       .setBackground('#22333B')
       .setFontColor('#FFFFFF');
    sum.setFrozenRows(1);

    // ── Pull all data rows from Cleaning Reports ───────────────
    const lastRow = src.getLastRow();
    if (lastRow < 2) {
      Logger.log('Monthly Summary: no data rows yet.');
      return;
    }

    const data = src.getRange(2, 1, lastRow - 1, TOTAL_COLS).getValues();

    // ── Aggregate by YYYY-MM key ───────────────────────────────
    // Structure: { 'YYYY-MM': { kwh, m3, cleans, rateSum, urgent } }
    const months = {};

    data.forEach(function(row) {
      const cellDate  = row[COL.DATE     - 1];    // B
      const dKwh      = row[COL.DELTA_KWH - 1];   // J
      const dM3       = row[COL.DELTA_M3  - 1];   // K
      const rateRaw   = String(row[COL.RATE   - 1] || '0').replace('%', '');
      const urgentVal = String(row[COL.URGENT - 1] || '');

      // Parse date into year + month
      let yr, mo;
      if (cellDate instanceof Date && !isNaN(cellDate)) {
        yr = cellDate.getFullYear();
        mo = cellDate.getMonth() + 1;
      } else if (typeof cellDate === 'string' && cellDate.includes('-')) {
        const p = cellDate.split('-');
        yr = parseInt(p[0]);
        mo = parseInt(p[1]);
      } else {
        return;   // skip unparseable rows
      }

      const key = yr + '-' + String(mo).padStart(2, '0');

      if (!months[key]) {
        months[key] = { kwh: 0, m3: 0, cleans: 0, rateSum: 0, urgent: false };
      }

      const m = months[key];
      if (typeof dKwh === 'number') m.kwh += dKwh;
      if (typeof dM3  === 'number') m.m3  += dM3;
      m.cleans++;
      m.rateSum += parseFloat(rateRaw) || 0;
      if (urgentVal && urgentVal !== '—' && urgentVal.trim() !== '') {
        m.urgent = true;
      }
    });

    // ── Write rows in chronological order ─────────────────────
    Object.keys(months).sort().forEach(function(key) {
      const m      = months[key];
      const parts  = key.split('-');
      const label  = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1)
        .toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const avgPct = m.cleans > 0
        ? (m.rateSum / m.cleans).toFixed(1) + '%'
        : '—';

      sum.appendRow([
        label,                                     // Month
        +m.kwh.toFixed(2),                         // ⚡ kWh Consumed
        +m.m3.toFixed(3),                          // 💧 m³ Consumed
        m.cleans,                                  // # of Cleans
        avgPct,                                    // Avg Completion %
        m.urgent ? '⚠️ Yes' : '✅ None'           // 🚨 Urgent Flags
      ]);
    });

    // ── Style: alternating row colours ────────────────────────
    const dataRows = Object.keys(months).length;
    if (dataRows > 0) {
      for (let r = 2; r <= dataRows + 1; r++) {
        const bg = (r % 2 === 0) ? '#F5F3EF' : '#FFFFFF';
        sum.getRange(r, 1, 1, 6).setBackground(bg);
      }
    }

    try { sum.autoResizeColumns(1, 6); } catch(e) {}

    Logger.log('Monthly Summary refreshed — ' + dataRows + ' month(s).');

  } catch(summaryErr) {
    Logger.log('Monthly Summary error (non-fatal): ' + summaryErr.toString());
  }
}


// ═══════════════════════════════════════════════════════════════════
//  EMAIL HTML BUILDER
// ═══════════════════════════════════════════════════════════════════
function buildEmailHtml(d) {
  var rateColor = d.rate === 100 ? '#006B54' : d.rate >= 80 ? '#e07b00' : '#C1414D';
  var dateStr   = d.cleaningDate ? formatReadableDate(d.cleaningDate) : d.cleaningDate;

  // ── Urgent block ──────────────────────────────────────────────
  var urgentBlock = '';
  if (d.urgentText) {
    var urgentLines = d.urgentText.split('\n').filter(function(l) { return l.trim(); });
    urgentBlock = '<div style="background:#fef0f1;border:2px solid #C1414D;border-radius:12px;'
      + 'padding:1rem 1.25rem;margin-bottom:1.5rem;">'
      + '<p style="font-weight:700;color:#C1414D;font-size:1.05em;margin:0 0 0.75rem;">🚨 URGENT — Action Required</p>'
      + urgentLines.map(function(line) {
          return '<div style="padding:0.35rem 0;border-bottom:1px solid #fde2e4;color:#5E503F;">'
            + esc(line) + '</div>';
        }).join('')
      + '</div>';
  }

  // ── Notes block ───────────────────────────────────────────────
  var notesBlock = '';
  var regularNotes = (d.notesArr || []).filter(function(n) { return !n.isUrgent; });
  if (regularNotes.length) {
    notesBlock = '<div style="background:#f9f8f5;border:1px solid #DCD4CA;border-radius:10px;'
      + 'padding:1rem 1.25rem;margin-bottom:1.5rem;">'
      + '<p style="font-weight:700;color:#22333B;margin:0 0 0.6rem;">📝 Notes</p>'
      + regularNotes.map(function(n) {
          return '<div style="padding:0.35rem 0;border-bottom:1px solid #eee;">'
            + '<strong style="color:#22333B;">[' + esc(n.section || '') + ']:</strong> '
            + '<span style="color:#5E503F;">' + esc(n.text || '') + '</span></div>';
        }).join('')
      + '</div>';
  }

  // ── Photos block ──────────────────────────────────────────────
  var photosBlock = '';
  var hasSomePhotos = false;
  for (var sid in d.photoLinks) {
    var links = d.photoLinks[sid];
    if (!links || !links.length) continue;
    hasSomePhotos = true;
    var label = (d.sectionNames[sid] || sid).replace(/[⚡💧🔍🛏️💧✨🧹👤📋⏳]/g, '').trim();
    photosBlock += '<div style="margin-bottom:1.25rem;">'
      + '<p style="font-weight:700;color:#22333B;font-size:0.82em;text-transform:uppercase;'
      +    'letter-spacing:1px;margin:0 0 0.4rem;border-bottom:2px solid #EAE0D5;padding-bottom:0.3rem;">'
      + '📂 ' + esc(label) + '</p>'
      + '<ul style="list-style:none;padding:0;margin:0;">';
    links.forEach(function(photo, i) {
      photosBlock += '<li style="margin-bottom:6px;">'
        + '<a href="' + photo.url + '" style="color:#22333B;font-weight:600;text-decoration:underline;">'
        + '📷 Photo ' + (i + 1) + ' — ' + esc(photo.name) + '</a></li>';
    });
    photosBlock += '</ul></div>';
  }
  if (!hasSomePhotos) {
    photosBlock = '<p style="color:#888;font-size:0.9em;">No photos were attached to this report.</p>';
  }

  // ── Checklist block ───────────────────────────────────────────
  var checklistBlock = '';
  (d.checklistDetails || []).forEach(function(section) {
    checklistBlock += '<h4 style="margin:1.2rem 0 0.4rem;color:#1e4739;font-size:0.95em;'
      + 'border-bottom:1px solid #EAE0D5;padding-bottom:3px;">'
      + esc(section.icon || '') + ' ' + esc(section.title) + '</h4>'
      + '<ul style="list-style:none;padding-left:8px;margin:0;">';
    (section.items || []).forEach(function(item) {
      var isUrgent = (item.text || '').indexOf('[URGENT]') !== -1;
      var rowStyle = isUrgent
        ? 'margin-bottom:4px;background:#fff5f5;padding:2px 6px;border-radius:4px;'
        : 'margin-bottom:4px;';
      checklistBlock += '<li style="' + rowStyle + '">'
        + (item.checked ? '✅' : '<span style="color:#C1414D;">☐</span>')
        + ' <span style="color:#333;">' + esc(item.text || '') + '</span></li>';
    });
    checklistBlock += '</ul>';
  });

  // ── Full email HTML ───────────────────────────────────────────
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
    + '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;background:#f9f8f5;'
    +         'border-radius:10px;overflow:hidden;border:1px solid #EAE0D5;">'
    + '<tr>'
    + '  <td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;width:50%;">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
    +          'text-transform:uppercase;letter-spacing:1px;">Property</span>'
    + '    <strong style="color:#22333B;font-size:1em;">' + esc(d.unitName) + '</strong>'
    + '  </td>'
    + '  <td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;width:50%;">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
    +          'text-transform:uppercase;letter-spacing:1px;">Cleaning Date</span>'
    + '    <strong style="color:#22333B;font-size:1em;">' + esc(dateStr) + '</strong>'
    + '  </td>'
    + '</tr>'
    + '<tr>'
    + '  <td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
    +          'text-transform:uppercase;letter-spacing:1px;">Cleaner</span>'
    + '    <strong style="color:#22333B;font-size:1em;">' + esc(d.cleanerName) + '</strong>'
    + '  </td>'
    + '  <td style="padding:12px 14px;border-bottom:1px solid #EAE0D5;">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
    +          'text-transform:uppercase;letter-spacing:1px;">Time</span>'
    + '    <strong style="color:#22333B;font-size:1em;">'
    +          esc(d.startTime) + ' → ' + esc(d.endTime)
    +          (d.elapsedTime && d.elapsedTime !== '—' ? ' (' + esc(d.elapsedTime) + ')' : '')
    +       '</strong>'
    + '  </td>'
    + '</tr>'
    + '<tr>'
    + '  <td style="padding:12px 14px;" colspan="2">'
    + '    <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
    +          'text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">Completion</span>'
    + '    <strong style="color:' + rateColor + ';font-size:1.3em;">' + d.rate + '%</strong>'
    + '    <span style="color:#888;font-size:0.85em;margin-left:6px;">'
    +          '(' + d.done + ' / ' + d.total + ' items)'
    +       '</span>'
    + '  </td>'
    + '</tr>'
    + '</table>'

    // Meter Readings
    + '<div style="background:linear-gradient(135deg,#eaf4f0,#e4f2ea);border:2px solid #006B54;'
    +             'border-radius:12px;padding:16px 20px;margin-bottom:20px;">'
    + '  <p style="font-weight:700;color:#006B54;margin:0 0 12px;font-size:1em;">⚡💧 Meter Readings</p>'
    + '  <table width="100%" cellpadding="0" cellspacing="0">'
    + '  <tr>'
    + '    <td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;'
    +                'text-align:center;vertical-align:middle;">'
    + '      <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
    +              'text-transform:uppercase;letter-spacing:1px;">⚡ Electric</span>'
    + '      <span style="display:block;font-size:1.6em;font-weight:700;color:'
    +              (d.electricReading === 'Not recorded' ? '#C1414D' : '#22333B')
    +              ';margin-top:4px;">' + esc(d.electricReading) + '</span>'
    + '      <span style="font-size:0.8em;color:#888;">kWh</span>'
    + '    </td>'
    + '    <td width="4%"></td>'
    + '    <td width="48%" style="background:#ffffff;border-radius:8px;padding:10px 14px;'
    +                'text-align:center;vertical-align:middle;">'
    + '      <span style="display:block;font-size:0.72em;font-weight:700;color:#5E503F;'
    +              'text-transform:uppercase;letter-spacing:1px;">💧 Water</span>'
    + '      <span style="display:block;font-size:1.6em;font-weight:700;color:'
    +              (d.waterReading === 'Not recorded' ? '#C1414D' : '#22333B')
    +              ';margin-top:4px;">' + esc(d.waterReading) + '</span>'
    + '      <span style="font-size:0.8em;color:#888;">m³</span>'
    + '    </td>'
    + '  </tr>'
    + '  </table>'
    + '</div>'

    // Urgent alerts
    + urgentBlock

    // Notes
    + notesBlock

    // Photos
    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;'
    +     'margin:20px 0 12px;font-size:1.05em;">📸 Photos by Section</h3>'
    + photosBlock

    // Full checklist
    + '<h3 style="color:#22333B;border-top:1px solid #EAE0D5;padding-top:16px;'
    +     'margin:20px 0 6px;font-size:1.05em;">📋 Full Checklist Details</h3>'
    + checklistBlock

    // Report folder link
    + '<p style="margin-top:20px;font-size:0.82em;color:#888;">'
    + '  <a href="' + (d.reportFolderUrl || '#') + '" style="color:#22333B;">'
    +       '📁 View All Photos in Drive</a>'
    + '</p>'

    + '</div>'

    // Footer
    + '<div style="background:#22333B;padding:16px;text-align:center;">'
    + '  <p style="color:rgba(255,255,255,0.7);margin:0;font-size:0.8em;">'
    +       '✨ Cascade Hideaway Automated Report ✨</p>'
    + '  <p style="color:rgba(255,255,255,0.4);margin:6px 0 0;font-size:0.72em;">'
    +       'Generated: '
    +       Utilities.formatDate(new Date(), 'Asia/Manila', "MMMM d, yyyy 'at' h:mm a z")
    + '  </p>'
    + '</div>'

    + '</div></body></html>';
}


// ═══════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════
function esc(str) {
  return String(str || '—')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function formatDate(d) {
  return Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd');
}

function formatReadableDate(iso) {
  try {
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
//  MANUAL TRIGGER — run once to backfill headers if you already
//  have a "Cleaning Reports" sheet from v3.1 with only 15 columns.
//
//  HOW TO USE:
//    1. Open Apps Script editor
//    2. Select this function from the dropdown
//    3. Click Run → it adds the 4 new column headers in place
//    4. Existing data rows will show "—" in the new columns (expected)
//    5. Run updateMonthlySummary() next to build the summary tab
// ═══════════════════════════════════════════════════════════════════
function migrateHeadersV32() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) { Logger.log('Sheet "' + SHEET_NAME + '" not found.'); return; }

  const lastCol = sheet.getLastColumn();
  Logger.log('Current column count: ' + lastCol);

  if (lastCol >= TOTAL_COLS) {
    Logger.log('Headers already at v3.2 width (' + lastCol + ' cols). Nothing to do.');
    return;
  }

  // Current v3.1 layout has 15 cols:
  //   A-I same, J=Completion%, K=Items Done, L=Total Items,
  //   M=Urgent Notes, N=General Notes, O=Photos Folder
  //
  // We need to INSERT 4 new cols after col I (Water) and shift J-O right.
  // insertColumnAfter inserts a single blank column to the right of the given col.
  // Insert from right-to-left so indices don't shift as we go.

  if (lastCol === 15) {
    // Insert 4 blank columns after column I (index 9) — do it 4 times
    for (var i = 0; i < 4; i++) {
      sheet.insertColumnAfter(9);
    }

    // Now write the new headers into J, K, L, M
    sheet.getRange(1, COL.DELTA_KWH).setValue('⚡ Δ kWh');
    sheet.getRange(1, COL.DELTA_M3 ).setValue('💧 Δ m³');
    sheet.getRange(1, COL.MONTH_KWH).setValue('⚡ Month kWh');
    sheet.getRange(1, COL.MONTH_M3 ).setValue('💧 Month m³');

    // Re-style the full header row
    const hdr = sheet.getRange(1, 1, 1, TOTAL_COLS);
    hdr.setFontWeight('bold')
       .setBackground('#22333B')
       .setFontColor('#FFFFFF');

    // Fill existing data rows with '—' for the 4 new cols
    const dataRows = sheet.getLastRow() - 1;
    if (dataRows > 0) {
      const blankRange = sheet.getRange(2, COL.DELTA_KWH, dataRows, 4);
      blankRange.setValue('—');
    }

    try { sheet.autoResizeColumns(1, TOTAL_COLS); } catch(e) {}
    Logger.log('Migration complete. 4 new columns inserted. Existing rows filled with "—".');

    // Build the Monthly Summary tab (will only have data if Δ cols are numeric — they won't be yet)
    updateMonthlySummary();
    Logger.log('Run updateMonthlySummary() again after new submissions to see monthly data.');

  } else {
    Logger.log('Unexpected column count: ' + lastCol + '. Inspect sheet manually before migrating.');
  }
}


// ═══════════════════════════════════════════════════════════════════
//  TEST FUNCTION — run manually from Apps Script editor
//  Verifies: meter readings appear in BOTH email blocks
// ═══════════════════════════════════════════════════════════════════
function testReport() {
  var mockPayload = {
    electricReading: '12345.6',
    waterReading:    '789.1',
    cleaningDate:    '2026-02-23',
    completionRate:  100,
    emailSubject:    '🧹 TEST Cleaning Report: Cascade Bria — Test Cleaner (2026-02-23)',
    formData: {
      unitName:             'Cascade Bria',
      cleanerName:          'Test Cleaner',
      cleaningDate:         '2026-02-23',
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
    photos: {},
    sectionNames: {
      'section_1': '⚡💧 Record Meter Readings',
      'section_2': '🔍 Get Ready & Check'
    },
    checklistDetails: [
      {
        title: 'Record Meter Readings', icon: '⚡💧',
        items: [
          { text: '⚡ Electric Meter Reading: 12345.6 kWh', checked: true },
          { text: '💧 Water Meter Reading: 789.1 m³',      checked: true },
          { text: 'Verify readings match the photos',       checked: true }
        ]
      },
      {
        title: 'Get Ready & Check', icon: '🔍',
        items: [
          { text: 'Gather all cleaning supplies',        checked: true },
          { text: 'Open windows and turn on lights',     checked: true }
        ]
      }
    ],
    allNotes:    [],
    urgentItems: '',
    meta: { rate: 100, doneItems: 5, totalItems: 5 }
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
  Logger.log('✅ Verify email shows:');
  Logger.log('   1. Meter Readings block: Electric=12345.6 kWh, Water=789.1 m³');
  Logger.log('   2. Checklist section: Electric and Water items with actual values');
}
