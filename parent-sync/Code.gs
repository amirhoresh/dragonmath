/**
 * DragonMath — parent progress sync (Google Apps Script).
 *
 * What it does:
 *   • Receives a tiny progress snapshot from the DragonMath app (doPost).
 *   • Emails you a WEEKLY review (days practiced, accuracy, struggles, hardest facts).
 *   • Emails you an ALERT if she hasn't practiced for more than IDLE_DAYS days.
 *
 * The data only ever goes to YOUR Google account. No third party.
 *
 * ONE-TIME SETUP (see parent-sync/README.md for screenshots-level detail):
 *   1. Go to https://script.google.com  →  New project.
 *   2. Delete the sample code, paste THIS whole file.
 *   3. Edit PARENT_EMAIL below to your address.
 *   4. Run the function `setup` once (Run ▸ setup) and approve the permissions.
 *   5. Deploy ▸ New deployment ▸ type "Web app":
 *        - Execute as: Me
 *        - Who has access: Anyone
 *      Copy the Web app URL (ends with /exec).
 *   6. Paste that URL into DragonMath → ⚙️ Parent area → "Parent sync URL" → Save.
 *   7. Tap "Send test" in the app — you should get a test email within a minute.
 */

var PARENT_EMAIL = 'amir.horesh@gmail.com'; // <-- change to your email
var IDLE_DAYS = 3;

// ---- receive a snapshot from the app ----
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    data.receivedAt = Date.now();
    PropertiesService.getScriptProperties().setProperty('latest', JSON.stringify(data));
    if (data.test) sendWeekly_(data, '🐉 DragonMath — test email (setup works!)');
  } catch (err) {
    // ignore malformed posts
  }
  return ContentService.createTextOutput('ok');
}

function getLatest_() {
  var s = PropertiesService.getScriptProperties().getProperty('latest');
  return s ? JSON.parse(s) : null;
}

// ---- weekly review (runs every Sunday morning) ----
function weeklyReview() {
  var d = getLatest_();
  if (d) sendWeekly_(d, '🐉 DragonMath — weekly review');
}

// ---- idle alert (runs daily) ----
function idleCheck() {
  var d = getLatest_();
  if (!d || !d.lastActivityTs) return;
  var idleDays = Math.floor((Date.now() - d.lastActivityTs) / 86400000);
  if (idleDays <= IDLE_DAYS) return;
  // only alert once per idle stretch (until she practices again)
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('alertedFor') === String(d.lastActivityTs)) return;
  props.setProperty('alertedFor', String(d.lastActivityTs));
  var who = d.childName || 'your child';
  MailApp.sendEmail(PARENT_EMAIL,
    '⚠️ DragonMath — ' + idleDays + ' days without practice',
    who + " hasn't practiced DragonMath in " + idleDays + ' days.\n\nA gentle nudge might help. 🐉');
}

// ---- build + send the review email ----
function sendWeekly_(d, subject) {
  var w = d.week || {};
  var who = d.childName || 'Your child';
  var lines = [];
  lines.push(who + "'s DragonMath — last 7 days");
  lines.push('');
  lines.push('Practiced: ' + (w.daysPracticed || 0) + ' of 7 days');
  lines.push('Questions: ' + (w.answered || 0) + '   First-try correct: ' + (w.accuracy || 0) + '%');
  lines.push('Slip-ups (wrong taps): ' + (w.mistakes || 0) + '   Stars earned: ' + (w.stars || 0));
  lines.push('Dragon: ' + (d.stage || '—'));

  if (d.lastActivityTs) {
    var idle = Math.floor((Date.now() - d.lastActivityTs) / 86400000);
    lines.push('Last practice: ' + (idle === 0 ? 'today' : idle + ' day(s) ago'));
  }

  if (d.struggle && d.struggle.length) {
    lines.push('');
    lines.push('Where she struggles most (slips per question):');
    d.struggle.forEach(function (t) {
      lines.push('  • ' + t.topic + ' — ' + t.missPerQ + ' slips/q, ' + t.firstTry + '% first-try (' + t.q + ' questions)');
    });
  }
  if (d.weakest && d.weakest.length) {
    lines.push('');
    lines.push('Hardest individual facts:');
    d.weakest.forEach(function (f) {
      lines.push('  • ' + f.fact + ' — ' + f.acc + '% first-try, ' + f.miss + ' total slips');
    });
  }
  lines.push('');
  lines.push('(Sent automatically by DragonMath. Reply-to-self only.)');
  MailApp.sendEmail(PARENT_EMAIL, subject, lines.join('\n'));
}

// ---- install the two schedules (run once) ----
function setup() {
  // clear any old triggers for these functions
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'weeklyReview' || fn === 'idleCheck') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyReview').timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(8).create();
  ScriptApp.newTrigger('idleCheck').timeBased()
    .everyDays(1).atHour(8).create();
  Logger.log('DragonMath sync installed: weekly (Sun 8am) + daily idle check (8am).');
}
