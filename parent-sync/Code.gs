/**
 * DragonMath — parent progress sync (Google Apps Script).
 *
 *   • Receives a progress snapshot from the app (doPost).
 *   • Emails you a WEEKLY review (HTML): how much she used it, what to practice
 *     more, and which games she has never tried.
 *   • Emails you an ALERT if she hasn't practiced for more than IDLE_DAYS days.
 *
 * The data only ever goes to YOUR Google account.
 *
 * SETUP: see parent-sync/README.md. In short: paste this whole file into a new
 * https://script.google.com project, set PARENT_EMAIL, Run ▸ setup (approve),
 * Deploy ▸ Web app (Execute as Me, access Anyone), paste the /exec URL into the
 * game's ⚙️ Parent area. If you already set it up, re-paste this file, Save, and
 * redeploy (Manage deployments ▸ Edit ▸ New version) to get the new HTML email.
 */

var PARENT_EMAIL = 'amir.horesh@gmail.com'; // <-- your email
var IDLE_DAYS = 3;

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    data.receivedAt = Date.now();
    PropertiesService.getScriptProperties().setProperty('latest', JSON.stringify(data));
    if (data.test) sendWeekly_(data, '🐉 DragonMath — test email (setup works!)');
  } catch (err) { /* ignore malformed posts */ }
  return ContentService.createTextOutput('ok');
}

function getLatest_() {
  var s = PropertiesService.getScriptProperties().getProperty('latest');
  return s ? JSON.parse(s) : null;
}

function weeklyReview() {
  var d = getLatest_();
  if (d) sendWeekly_(d, '🐉 DragonMath — weekly review');
}

function idleCheck() {
  var d = getLatest_();
  if (!d || !d.lastActivityTs) return;
  var idleDays = Math.floor((Date.now() - d.lastActivityTs) / 86400000);
  if (idleDays <= IDLE_DAYS) return;
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('alertedFor') === String(d.lastActivityTs)) return; // once per idle stretch
  props.setProperty('alertedFor', String(d.lastActivityTs));
  var who = d.childName || 'Your child';
  MailApp.sendEmail({ to: PARENT_EMAIL,
    subject: '⚠️ DragonMath — ' + idleDays + ' days without practice',
    htmlBody: '<div style="font-family:Arial,sans-serif;color:#2a2150">' +
      '<h2 style="color:#c0392b">⏰ ' + esc_(who) + " hasn't practiced in " + idleDays + ' days</h2>' +
      '<p>A gentle nudge might help. 🐉</p></div>' });
}

// ---------- HTML weekly email: usage / practice-more / never-tried ----------
function sendWeekly_(d, subject) {
  var who = d.childName || 'Your child';
  var w = d.week || {};
  var totals = d.totals || {};
  var idle = d.lastActivityTs ? Math.floor((Date.now() - d.lastActivityTs) / 86400000) : null;
  var lastTxt = idle === null ? 'never' : (idle === 0 ? 'today' : idle + ' day(s) ago');

  // 1) usage
  var usage = '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    row_('This week', (w.daysPracticed || 0) + ' of 7 days · ' + (w.answered || 0) + ' questions · ' + (w.accuracy || 0) + '% first-try') +
    row_('All-time', (totals.daysPracticed || 0) + ' days · ' + (totals.questions || 0) + ' questions') +
    row_('Last practice', lastTxt) +
    row_('Sparky', d.stage || '—') +
    '</table>';

  // 2) practice more
  var pm = '';
  if (d.struggle && d.struggle.length) {
    pm += '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
      '<tr style="color:#888"><td>Topic</td><td align="center">slips/Q</td><td align="center">first-try</td></tr>';
    d.struggle.forEach(function (t) {
      pm += '<tr><td style="padding:3px 0;font-weight:bold">' + esc_(t.topic) + '</td>' +
        '<td align="center">' + t.missPerQ + '</td><td align="center">' + t.firstTry + '%</td></tr>';
    });
    pm += '</table>';
  } else {
    pm += '<p style="margin:0;color:#888">Not enough data yet.</p>';
  }
  if (d.weakest && d.weakest.length) {
    pm += '<p style="margin:10px 0 0"><b>Hardest facts:</b> ' +
      d.weakest.map(function (f) { return esc_(f.fact) + ' (' + f.acc + '%)'; }).join(', ') + '</p>';
  }

  // 3) never tried
  var av = (d.avoided && d.avoided.length)
    ? d.avoided.map(function (x) {
        return '<span style="display:inline-block;background:#ffe0e0;color:#c0392b;border-radius:8px;padding:3px 10px;margin:3px">' + esc_(x) + '</span>';
      }).join('')
    : '<span style="color:#1aa78f">None — she has tried every game! 🎉</span>';

  var html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#2a2150">' +
    '<h2 style="color:#7b4dff;margin:0 0 2px">🐉 ' + esc_(who) + ' — DragonMath</h2>' +
    '<p style="color:#888;margin:0 0 16px">' + esc_(subject) + '</p>' +
    card_('How much she used it', usage) +
    card_('Areas to practice more', pm) +
    card_('Never tried yet', av) +
    '<p style="color:#aaa;font-size:12px;margin-top:18px">Sent automatically by DragonMath.</p></div>';

  MailApp.sendEmail({ to: PARENT_EMAIL, subject: subject, htmlBody: html });
}

function card_(title, inner) {
  return '<div style="background:#faf8ff;border:1px solid #ece4ff;border-radius:12px;padding:14px 16px;margin:0 0 14px">' +
    '<h3 style="margin:0 0 8px;color:#7b4dff;font-size:16px">' + esc_(title) + '</h3>' + inner + '</div>';
}
function row_(label, val) {
  return '<tr><td style="color:#888;padding:3px 0">' + esc_(label) + '</td>' +
    '<td align="right" style="font-weight:bold">' + esc_(val) + '</td></tr>';
}
function esc_(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ---------- install the two schedules (run once) ----------
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'weeklyReview' || fn === 'idleCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyReview').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(8).create();
  ScriptApp.newTrigger('idleCheck').timeBased().everyDays(1).atHour(8).create();
  Logger.log('DragonMath sync installed: weekly (Sun 8am) + daily idle check (8am).');
}
