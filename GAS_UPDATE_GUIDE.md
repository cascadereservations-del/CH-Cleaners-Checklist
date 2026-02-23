# Google Apps Script Update Guide
## For Cascade Hideaway Cleaning Report — doPost() Handler

The updated checklist now sends an enriched payload. Your `doPost()` function needs
these small updates to take full advantage:

---

## 1. Use the Pre-Built Email HTML (Most Important)

The frontend now builds the complete email HTML and sends it as `payload.emailHtml`.
Your GAS can use it directly — no need to rebuild HTML in the script:

```javascript
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const { formData, emailHtml, emailSubject, meterReadings, photos, calendarData } = payload;

    // ── Send email using the pre-built HTML ──────────────────
    MailApp.sendEmail({
      to:       'cascadereservations@gmail.com',
      subject:  emailSubject,   // e.g. "🧹 Cleaning Report: Cascade Bria — Hazel Ann (2026-02-23)"
                                // or  "🚨 [URGENT] Cleaning Report: ..." if urgent notes exist
      htmlBody: emailHtml,      // Complete styled HTML with meter readings, labeled photos, etc.
      name:     'Cascade Hideaway'
    });

    // ── Write to Sheet ────────────────────────────────────────
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Reports') 
                  || SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    sheet.appendRow([
      new Date(),
      formData.cleaningDate,           // ← NEW: actual cleaning date
      formData.unitName,
      formData.cleanerName,
      formData.startTime,
      formData.endTime,
      meterReadings.electric.value,    // ← NEW: electric reading (kWh)
      meterReadings.water.value,       // ← NEW: water reading (m³)
      payload.urgentItems || '',       // ← NEW: urgent notes summary
      payload.allNotes.map(n => `[${n.section}]: ${n.text}`).join('\n') || ''
    ]);

    // ── Upload photos to Drive ────────────────────────────────
    // Photos are in payload.photos[sectionId][].data (base64)
    // payload.sectionNames[sectionId] gives the human-readable section name
    // Use this to create labeled subfolders in Drive

    const folderId = DRIVE_FOLDER_ID; // your existing constant
    const folder   = DriveApp.getFolderById(folderId);
    const dateStr  = formData.cleaningDate || Utilities.formatDate(new Date(), 'Asia/Manila', 'yyyy-MM-dd');
    const reportFolder = folder.createFolder(`${dateStr} — ${formData.cleanerName}`);

    for (const [sid, sectionPhotos] of Object.entries(payload.photos || {})) {
      if (!sectionPhotos || !sectionPhotos.length) continue;
      const sectionLabel = (payload.sectionNames[sid] || sid).replace(/[^\w\s\-–]/g, '').trim();
      const sectionFolder = reportFolder.createFolder(sectionLabel);
      sectionPhotos.forEach((photo, i) => {
        if (!photo || !photo.data) return;
        const base64 = photo.data.replace(/^data:image\/\w+;base64,/, '');
        const blob   = Utilities.newBlob(Utilities.base64Decode(base64), 'image/jpeg', `photo_${i+1}.jpg`);
        const file   = sectionFolder.createFile(blob);
        // Make it viewable by link for the email
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      });
    }

    // ── Calendar event ────────────────────────────────────────
    CalendarApp.getCalendarById(calendarData.calendarId)
      .createEvent(calendarData.summary, new Date(calendarData.startDateTime), new Date(calendarData.endDateTime), {
        description: calendarData.description
      });

    return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
                         .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    Logger.log(err);
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
                         .setMimeType(ContentService.MimeType.JSON);
  }
}
```

---

## 2. New Spreadsheet Columns to Add

If you want to track meter readings and dates properly in the sheet,
add these columns (insert after your existing columns):

| Column | Field | Notes |
|--------|-------|-------|
| Cleaning Date | `formData.cleaningDate` | ISO format: 2026-02-23 |
| Electric (kWh) | `meterReadings.electric.value` | Numeric |
| Water (m³) | `meterReadings.water.value` | Numeric |
| Urgent Notes | `payload.urgentItems` | Blank if none |

---

## 3. What Changed in the Payload

| Field | Before | After |
|-------|--------|-------|
| `emailHtml` | Not sent | Full styled HTML email — just pass to `MailApp.sendEmail()` |
| `emailSubject` | Script built its own | Pre-built, includes date + 🚨 URGENT prefix if needed |
| `meterReadings` | Buried in formData | Explicit `{ electric: {value, unit}, water: {value, unit} }` |
| `formData.cleaningDate` | Not included | ISO date string (e.g. "2026-02-23") |
| `allNotes` | Plain text string | Array of `{section, text, isUrgent}` objects |
| `urgentItems` | Not included | Newline-joined string of urgent notes |
| `sectionNames` | Not included | Map of sectionId → human-readable section name |
| Photos | Flat array | Organized by sectionId with section names available |

