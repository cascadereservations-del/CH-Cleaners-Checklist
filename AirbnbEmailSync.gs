/**
 * AirbnbEmailSync.gs
 * Cascade Hideaway — Airbnb Gmail Email Sync
 *
 * Trigger: syncAirbnbEmails() — every 6 hours (Hour timer).
 * First run: back-fills 180 days. Subsequent: 1-day lookback (idempotent).
 *
 * Version: 2.1.0
 * Fix from 2.0.0: interleaved parse+POST in thread batches to avoid
 * GAS memory overflow on large back-fills (431 threads caused INTERNAL error).
 */

// ─── Config ───────────────────────────────────────────────────────────────────

const AES_CONFIG = {
  EF_ENDPOINT:            'https://qkgfhsdppslwunarczeq.supabase.co/functions/v1/airbnb-email-sync',
  ANON_KEY:               'sb_publishable_JFuRYZ9csmQULcMRmHXDSg_Abo9UeCj',
  AIRBNB_SENDER:          'automated@airbnb.com',
  FIRST_RUN_KEY:          'AES_FIRST_RUN_DONE',
  SEARCH_DAYS_INITIAL:    180,
  SEARCH_DAYS_SUBSEQUENT:   1,   // 6-hour trigger — 1-day overlap is plenty
  MAX_THREADS:            500,   // paginated ceiling
  THREAD_BATCH:            50,   // parse+POST this many threads at a time
  CHUNK_SIZE:              20,   // events per EF POST within a batch
  TIMEOUT_MS:         240000,   // 4-min warn threshold (GAS limit = 6 min)
};

// ─── Entry point ──────────────────────────────────────────────────────────────

function syncAirbnbEmails() {
  const startMs  = Date.now();
  const props    = PropertiesService.getScriptProperties();
  const firstRun = !props.getProperty(AES_CONFIG.FIRST_RUN_KEY);
  const days     = firstRun
    ? AES_CONFIG.SEARCH_DAYS_INITIAL
    : AES_CONFIG.SEARCH_DAYS_SUBSEQUENT;

  Logger.log(`AirbnbEmailSync v2.1.0: newer_than:${days}d (firstRun=${firstRun})`);

  const query   = `from:${AES_CONFIG.AIRBNB_SENDER} newer_than:${days}d`;
  const threads = searchAllThreads_(query, AES_CONFIG.MAX_THREADS);

  if (threads.length === 0) {
    Logger.log('No Airbnb emails found in window.');
    return;
  }

  Logger.log(`Found ${threads.length} threads. Processing in batches of ${AES_CONFIG.THREAD_BATCH}...`);

  const totals = { inserted: 0, skipped: 0, errors: [] };
  const counts = { booking: 0, payout: 0, cancellation: 0, skipped: 0, errors: 0 };
  let   batchNum = 0;

  // Process THREAD_BATCH threads at a time — parse + POST + discard before next batch
  for (let i = 0; i < threads.length; i += AES_CONFIG.THREAD_BATCH) {
    if (Date.now() - startMs > AES_CONFIG.TIMEOUT_MS) {
      Logger.log('WARNING: 4-min mark reached — stopping early to avoid timeout.');
      break;
    }

    batchNum++;
    const batchThreads = threads.slice(i, i + AES_CONFIG.THREAD_BATCH);
    const events = [];

    // Parse this batch
    for (const thread of batchThreads) {
      for (const msg of thread.getMessages()) {
        try {
          const event = parseMessage_(msg);
          if (event) {
            events.push(event);
            counts[event.email_type]++;
          } else {
            counts.skipped++;
          }
        } catch (e) {
          counts.errors++;
          Logger.log(`Parse error (${msg.getId()}): ${e}`);
        }
      }
    }

    // POST this batch immediately (don't accumulate across batches)
    if (events.length > 0) {
      const batchResult = postInChunks_(events);
      totals.inserted += batchResult.inserted;
      totals.skipped  += batchResult.skipped;
      totals.errors    = totals.errors.concat(batchResult.errors);
      Logger.log(
        `Batch ${batchNum}: threads=${batchThreads.length} events=${events.length} ` +
        `inserted=${batchResult.inserted} skipped=${batchResult.skipped}`
      );
    } else {
      Logger.log(`Batch ${batchNum}: threads=${batchThreads.length} events=0 (all skipped)`);
    }
    // events array goes out of scope here — memory freed before next batch
  }

  Logger.log(
    `Done. Types: booking=${counts.booking} payout=${counts.payout} ` +
    `cancellation=${counts.cancellation} skipped=${counts.skipped} parseErrors=${counts.errors}`
  );
  Logger.log(
    `EF totals: inserted=${totals.inserted} skipped=${totals.skipped} ` +
    `errors=${totals.errors.length > 0 ? JSON.stringify(totals.errors) : 'none'}`
  );
  Logger.log(`Elapsed: ${((Date.now() - startMs) / 1000).toFixed(1)}s`);

  if (firstRun) {
    props.setProperty(AES_CONFIG.FIRST_RUN_KEY, 'true');
    Logger.log('First-run flag set. Future runs use 1-day window.');
  }
}

// ─── Gmail search with pagination ────────────────────────────────────────────

function searchAllThreads_(query, maxThreads) {
  const threads = [];
  const PAGE    = 100;
  let   start   = 0;

  while (start < maxThreads) {
    const limit = Math.min(PAGE, maxThreads - start);
    const batch = GmailApp.search(query, start, limit);
    if (batch.length === 0) break;
    threads.push(...batch);
    if (batch.length < limit) break;
    start += PAGE;
  }

  return threads;
}

// ─── Chunked POST ─────────────────────────────────────────────────────────────

function postInChunks_(events) {
  const totals = { inserted: 0, skipped: 0, errors: [] };

  for (let i = 0; i < events.length; i += AES_CONFIG.CHUNK_SIZE) {
    const chunk = events.slice(i, i + AES_CONFIG.CHUNK_SIZE);
    try {
      const r = postToEF_(chunk);
      totals.inserted += (r.inserted || 0);
      totals.skipped  += (r.skipped  || 0);
      if (Array.isArray(r.errors)) totals.errors = totals.errors.concat(r.errors);
    } catch (e) {
      const label = `chunk[${i}–${i + chunk.length - 1}]`;
      totals.errors.push(`${label}: ${e}`);
      Logger.log(`EF error ${label}: ${e}`);
    }
  }

  return totals;
}

// ─── Message classifier ───────────────────────────────────────────────────────

function parseMessage_(msg) {
  const subject = msg.getSubject();
  // Normalize CRLF → LF so all regexes work consistently
  const body    = msg.getPlainBody().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const date    = msg.getDate();   // JS Date object
  const dateIso = date.toISOString();
  const id      = msg.getId();

  if (/We sent a payout of/i.test(subject))
    return parsePayout_(id, subject, body, dateIso);

  if (/Reservation confirmed/i.test(subject))
    return parseBooking_(id, subject, body, date, dateIso);

  if (/^Canceled: Reservation/i.test(subject))
    return parseCancellation_(id, subject, body, dateIso);

  return null;
}

// ─── Booking parser ───────────────────────────────────────────────────────────

function parseBooking_(id, subject, body, emailDate, dateIso) {
  // Subject: "Reservation confirmed - Carissa Ortiz arrives Jun 12"
  const guestMatch = subject.match(/Reservation confirmed\s*-\s*(.+?)\s+arrives/i);
  if (!guestMatch) return null;
  const guestName = guestMatch[1].trim();

  // Confirmation code: "CONFIRMATION CODE\nHMA2DRKNXH"
  const codeMatch = body.match(/CONFIRMATION CODE\s*\n([A-Z0-9]{10})/);
  if (!codeMatch) return null;
  const confirmationCode = codeMatch[1];

  // Dates: "Fri, Jun 12   Sat, Jun 13"
  const datesMatch = body.match(
    /([A-Z][a-z]{2},\s+[A-Z][a-z]{2,8}\s+\d{1,2})\s{2,}([A-Z][a-z]{2},\s+[A-Z][a-z]{2,8}\s+\d{1,2})/
  );

  // Times: "2:00 PM       12:00 PM"
  const timesMatch = body.match(/(\d{1,2}:\d{2}\s+[AP]M)\s{2,}(\d{1,2}:\d{2}\s+[AP]M)/);

  // Guest count: "2 adults"
  const guestsMatch = body.match(/(\d+)\s+adult/i);

  // "YOU EARN   ₱1,569.33"
  const earnMatch = body.match(/YOU EARN\s+\u20b1([\d,]+\.\d{2})/i);

  // "Host service fee (15.5% + VAT)   -₱329.67"  — same line, no newline
  const feeMatch = body.match(/Host service fee[^\n]+-\u20b1([\d,]+\.\d{2})/i);

  // "TOTAL (PHP)   ₱1,899.00"
  const guestPaidMatch = body.match(/TOTAL\s*\(PHP\)\s+\u20b1([\d,]+\.\d{2})/i);

  return {
    gmail_message_id:  id,
    email_type:        'booking',
    email_date:        dateIso,
    subject,
    guest_name:        guestName,
    confirmation_code: confirmationCode,
    checkin_date:      datesMatch ? parseAirbnbDate_(datesMatch[1], emailDate) : null,
    checkout_date:     datesMatch ? parseAirbnbDate_(datesMatch[2], emailDate) : null,
    checkin_time:      timesMatch ? timesMatch[1].trim() : null,
    checkout_time:     timesMatch ? timesMatch[2].trim() : null,
    guest_count:       guestsMatch ? parseInt(guestsMatch[1], 10) : null,
    guest_paid:        guestPaidMatch ? parseAmount_(guestPaidMatch[1]) : null,
    host_service_fee:  feeMatch      ? parseAmount_(feeMatch[1])       : null,
    host_payout:       earnMatch     ? parseAmount_(earnMatch[1])      : null,
  };
}

// ─── Payout parser ────────────────────────────────────────────────────────────

function parsePayout_(id, subject, body, dateIso) {
  // Subject: "We sent a payout of ₱4,132.00 PHP"
  const totalMatch = subject.match(/We sent a payout of \u20b1([\d,]+\.\d{2})/i);
  if (!totalMatch) return null;

  return {
    gmail_message_id: id,
    email_type:       'payout',
    email_date:       dateIso,
    subject,
    payout_amount:    parseAmount_(totalMatch[1]),
    detail_lines:     parsePayoutDetails_(body),
  };
}

function parsePayoutDetails_(body) {
  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);

  const detailsIdx = lines.findIndex(l => /^Details$/i.test(l));
  if (detailsIdx === -1) return [];

  const totalIdx     = lines.findIndex(l => /^Total paid:/i.test(l));
  const sectionLines = totalIdx > detailsIdx
    ? lines.slice(detailsIdx + 1, totalIdx)
    : lines.slice(detailsIdx + 1);

  const details = [];
  let i = 0;

  while (i < sectionLines.length) {
    // "GuestName   ₱5,198.97 PHP" or "GuestName   -₱5,198.97 PHP"
    const amtMatch = sectionLines[i].match(/^(.+?)\s{2,}(-?\u20b1[\d,]+\.\d{2})\s+PHP$/);
    if (!amtMatch) { i++; continue; }

    const guestName = amtMatch[1].trim();
    const rawAmt    = amtMatch[2];
    const negative  = rawAmt.startsWith('-');
    const amount    = parseAmount_(rawAmt.replace(/^-?\u20b1/, ''));

    // Type + dates: "Home • 5/10/2026 - 5/28/2026"
    let lineType = 'Unknown', checkinDate = null, checkoutDate = null;
    if (i + 1 < sectionLines.length) {
      const typeMatch = sectionLines[i + 1].match(
        /^(Home|Adjustment|Resolution|Co-host)\s*\u2022\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/i
      );
      if (typeMatch) {
        lineType     = typeMatch[1];
        checkinDate  = formatMdyToIso_(typeMatch[2]);
        checkoutDate = formatMdyToIso_(typeMatch[3]);
      }
    }

    // Confirmation code: HM + 8 alphanumeric, within 5 lines ahead
    let confirmationCode = null;
    for (let j = i + 1; j < Math.min(i + 6, sectionLines.length); j++) {
      if (/^HM[A-Z0-9]{8}$/.test(sectionLines[j])) {
        confirmationCode = sectionLines[j];
        break;
      }
    }

    details.push({
      guest_name: guestName,
      amount:     negative ? -amount : amount,
      line_type:  lineType,
      checkin_date:      checkinDate,
      checkout_date:     checkoutDate,
      confirmation_code: confirmationCode,
    });

    i++;
  }

  return details;
}

// ─── Cancellation parser ──────────────────────────────────────────────────────

function parseCancellation_(id, subject, body, dateIso) {
  // Subject: "Canceled: Reservation HMYZC4NWDW for May 28 – 29, 2026"
  const codeMatch = subject.match(/Canceled:\s+Reservation\s+([A-Z0-9]{10})/i);
  if (!codeMatch) return null;

  const datesMatch  = subject.match(/for\s+(.+?),\s+\d{4}/i);
  const guestMatch  = body.match(/your guest\s+(\w+)\s+had to cancel/i);
  const refundMatch = body.match(/a\s+(complete|partial)\s+refund/i);

  return {
    gmail_message_id: id,
    email_type:       'cancellation',
    email_date:       dateIso,
    subject,
    cancelled_code:   codeMatch[1],
    cancelled_dates:  datesMatch  ? datesMatch[1]               : null,
    guest_first_name: guestMatch  ? guestMatch[1]               : null,
    refund_type:      refundMatch ? refundMatch[1].toLowerCase() : 'unknown',
  };
}

// ─── HTTP POST ────────────────────────────────────────────────────────────────

function postToEF_(events) {
  const response = UrlFetchApp.fetch(AES_CONFIG.EF_ENDPOINT, {
    method:             'post',
    contentType:        'application/json',
    headers: {
      'Authorization': `Bearer ${AES_CONFIG.ANON_KEY}`,
      'apikey':         AES_CONFIG.ANON_KEY,
    },
    payload:            JSON.stringify({ events }),
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code !== 200) throw new Error(`HTTP ${code}: ${text}`);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response: ${text}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseAmount_(str) {
  return parseFloat(String(str).replace(/,/g, ''));
}

/**
 * Parse "Fri, Jun 12" → "2026-06-12".
 * emailDate is the JS Date from the email — used for correct year inference.
 * Uses Manila timezone to avoid UTC-offset date shifts.
 */
function parseAirbnbDate_(dateStr, emailDate) {
  try {
    const emailYear  = emailDate.getFullYear();
    const emailMonth = emailDate.getMonth(); // 0-indexed
    const cleaned    = dateStr.replace(/^[A-Z][a-z]{2},\s*/, '');
    const d          = new Date(`${cleaned} ${emailYear}`);
    if (isNaN(d.getTime())) return null;
    // Dec email → Jan checkin: bump year
    if (d.getMonth() < emailMonth - 3) d.setFullYear(emailYear + 1);
    return Utilities.formatDate(d, 'Asia/Manila', 'yyyy-MM-dd');
  } catch {
    return null;
  }
}

/** "5/10/2026" → "2026-05-10" */
function formatMdyToIso_(mdy) {
  try {
    const [m, d, y] = mdy.split('/');
    if (!m || !d || !y) return null;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  } catch {
    return null;
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Dry-run: parse recent emails and log — no EF POST. */
function testSyncDryRun() {
  const query   = `from:${AES_CONFIG.AIRBNB_SENDER} newer_than:30d`;
  const threads = GmailApp.search(query, 0, 20);
  Logger.log(`Found ${threads.length} threads.`);
  for (const thread of threads) {
    for (const msg of thread.getMessages()) {
      const event = parseMessage_(msg);
      if (event) Logger.log(JSON.stringify(event, null, 2));
      else       Logger.log(`Skipped: ${msg.getSubject()}`);
    }
  }
}

/** Reset first-run flag so next sync treats it as a back-fill. */
function resetFirstRunFlag() {
  PropertiesService.getScriptProperties().deleteProperty(AES_CONFIG.FIRST_RUN_KEY);
  Logger.log('First-run flag cleared. Next sync will use 180-day window.');
}