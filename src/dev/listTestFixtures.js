/**
 * Dev only. Lists the eight fictional fixture messages and nothing else.
 * A client push does not include src/dev (.claspignore).
 *
 * npm run push:dev, then run listTestFixtureMessages in the Apps Script editor.
 * Settings month must be the month those messages were sent (YYYY-MM).
 * A blank month means the previous calendar month.
 */

function listTestFixtureMessages() {
  var subjects = [];
  for (var i = 0; i < TEST_FIXTURE_MESSAGES.length; i++) {
    subjects.push(TEST_FIXTURE_MESSAGES[i].subject);
  }
  var config = getConfig();
  var timeZone = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  var today = Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd');
  var plan = buildFixtureSearchQueries(subjects, {
    month: config.month,
    today: today,
    processed_label: config.processed_label
  });
  var candidates = readFixtureMessages(plan.queries, subjects, timeZone);
  var selected = selectCollectMessages(candidates, {
    month: plan.month,
    processedLabel: config.processed_label,
    allowedSubjects: subjects
  });
  var messages = selected.map(function (message) {
    return {
      id: message.id,
      subject: message.subject,
      from: message.from,
      date: message.dateYmd
    };
  });
  Logger.log(
    'listTestFixtureMessages month=%s count=%s',
    plan.month,
    messages.length
  );
  return { month: plan.month, count: messages.length, messages: messages };
}
