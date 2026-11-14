/**
 * Gmail search for one month.
 * Query text is built here and tested without Gmail.
 * The only GmailApp call refuses to run unless every query is limited
 * to the eight fixture subjects sent from this account.
 */

var FIXTURE_SEARCH_PAGE = 20;
var FIXTURE_SEARCH_MAX_THREADS = 40;

function pad2_(value) {
  var text = String(value);
  return text.length < 2 ? '0' + text : text;
}

function pad4_(value) {
  var text = String(value);
  while (text.length < 4) text = '0' + text;
  return text;
}

function addMonths_(year, month, delta) {
  var index = year * 12 + (month - 1) + delta;
  var nextYear = Math.floor(index / 12);
  var nextMonth = index % 12;
  if (nextMonth < 0) {
    nextMonth += 12;
    nextYear -= 1;
  }
  return pad4_(nextYear) + '-' + pad2_(nextMonth + 1);
}

/**
 * @param {string} month Settings month, YYYY-MM. Blank uses the previous month.
 * @param {string} today YYYY-MM-DD in the script timezone.
 * @return {string}
 */
function resolveCollectMonth(month, today) {
  var text = month == null ? '' : String(month).trim();
  if (!text) return previousCollectMonth_(today);
  if (!/^\d{4}-\d{2}$/.test(text)) throw new Error('month must be YYYY-MM');
  var monthNumber = Number(text.slice(5, 7));
  if (monthNumber < 1 || monthNumber > 12) throw new Error('month must be YYYY-MM');
  return text;
}

function previousCollectMonth_(today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today || '')) throw new Error('today must be YYYY-MM-DD');
  var year = Number(today.slice(0, 4));
  var monthNumber = Number(today.slice(5, 7));
  var day = Number(today.slice(8, 10));
  if (monthNumber < 1 || monthNumber > 12 || day < 1 || day > 31) {
    throw new Error('today must be YYYY-MM-DD');
  }
  return addMonths_(year, monthNumber, -1);
}

/**
 * Gmail after: is exclusive and before: is exclusive.
 * November is after:YYYY/10/31 before:YYYY/12/01.
 * @param {string} month YYYY-MM
 * @return {{after: string, before: string}}
 */
function gmailMonthBounds(month) {
  var resolved = resolveCollectMonth(month, '2000-01-01');
  var year = Number(resolved.slice(0, 4));
  var monthNumber = Number(resolved.slice(5, 7));
  var previous = addMonths_(year, monthNumber, -1);
  var next = addMonths_(year, monthNumber, 1);
  var previousYear = Number(previous.slice(0, 4));
  var previousMonth = Number(previous.slice(5, 7));
  var lastDay = new Date(Date.UTC(previousYear, previousMonth, 0)).getUTCDate();
  return {
    after: previousYear + '/' + pad2_(previousMonth) + '/' + pad2_(lastDay),
    before: Number(next.slice(0, 4)) + '/' + next.slice(5, 7) + '/01'
  };
}

/** Nested labels are searched with a hyphen: invoices/processed → invoices-processed. */
function labelSearchName(labelName) {
  return String(labelName || '')
    .trim()
    .replace(/"/g, '')
    .replace(/\//g, '-')
    .replace(/\s+/g, '-');
}

function excludeProcessedTerm(labelName) {
  var name = labelSearchName(labelName);
  if (!name) throw new Error('processed_label is empty');
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return '-label:"' + name + '"';
  return '-label:' + name;
}

function quoteGmailAtom_(value) {
  var text = String(value || '').trim().replace(/"/g, '');
  if (!text) return '';
  if (/[\s()]/.test(text)) return '"' + text + '"';
  return text;
}

function monthWindowTerm_(month) {
  var bounds = gmailMonthBounds(month);
  return 'after:' + bounds.after + ' before:' + bounds.before;
}

/**
 * One Gmail query per Settings search line, plus one query for the vendor whitelist.
 * An empty query list does not search the mailbox.
 * @param {Object} config
 * @return {{month: string, queries: string[]}}
 */
function buildCollectQueries(config) {
  var source = config || {};
  var month = resolveCollectMonth(source.month, source.today);
  var windowTerm = monthWindowTerm_(month);
  var skip = excludeProcessedTerm(source.processed_label || 'invoices/processed');
  var queries = [];
  var searchQueries = source.search_queries || [];
  var i;
  for (i = 0; i < searchQueries.length; i++) {
    var line = String(searchQueries[i] || '').trim();
    if (!line) continue;
    queries.push('(' + line + ') ' + windowTerm + ' ' + skip);
  }
  var fromTerms = [];
  var vendors = source.vendor_whitelist || [];
  for (i = 0; i < vendors.length; i++) {
    var term = quoteGmailAtom_(vendors[i]);
    if (term) fromTerms.push(term);
  }
  if (fromTerms.length) {
    queries.push('from:(' + fromTerms.join(' OR ') + ') ' + windowTerm + ' ' + skip);
  }
  return { month: month, queries: queries };
}

/**
 * Dev search. Settings queries are ignored. The mailbox is limited to
 * mail this account sent with one of the fixture subjects.
 * @param {string[]} subjects
 * @param {Object} options month, today, processed_label
 * @return {{month: string, queries: string[]}}
 */
function buildFixtureSearchQueries(subjects, options) {
  var list = fixtureSubjects_(subjects);
  var source = options || {};
  var month = resolveCollectMonth(source.month, source.today);
  var subjectQuery = list
    .map(function (subject) {
      return 'subject:"' + String(subject).replace(/"/g, '') + '"';
    })
    .join(' OR ');
  var query =
    'in:anywhere from:me (' +
    subjectQuery +
    ') ' +
    monthWindowTerm_(month) +
    ' ' +
    excludeProcessedTerm(source.processed_label || 'invoices/processed');
  assertFixtureQueries_([query], list);
  return { month: month, queries: [query] };
}

function fixtureSubjects_(subjects) {
  var list = [];
  var seen = {};
  var source = subjects || [];
  for (var i = 0; i < source.length; i++) {
    var subject = String(source[i] || '').trim();
    if (!subject || seen[subject]) continue;
    seen[subject] = true;
    list.push(subject);
  }
  if (list.length !== 8) throw new Error('Fixture search needs the 8 test subjects.');
  return list;
}

function assertFixtureQueries_(queries, allowedSubjects) {
  var list = fixtureSubjects_(allowedSubjects);
  var joined = (queries || []).join('\n');
  if (!queries || !queries.length) throw new Error('Refusing an empty Gmail search');
  if (joined.indexOf('from:me') === -1) throw new Error('Refusing Gmail search without from:me');
  if (joined.indexOf('has:attachment') !== -1) {
    throw new Error('Refusing inbox-wide attachment search');
  }
  for (var i = 0; i < list.length; i++) {
    if (joined.indexOf(list[i]) === -1) {
      throw new Error('Refusing Gmail search that is missing a fixture subject');
    }
  }
}

function labelsMatch_(left, right) {
  var a = labelSearchName(left).toLowerCase();
  var b = labelSearchName(right).toLowerCase();
  return a !== '' && a === b;
}

function hasProcessedLabel_(labelNames, processedLabel) {
  var names = labelNames || [];
  for (var i = 0; i < names.length; i++) {
    if (labelsMatch_(names[i], processedLabel)) return true;
  }
  return false;
}

/**
 * Drops processed messages, messages outside the month, duplicates,
 * and any subject that is not one of the allowed fixture subjects.
 * @param {Array<Object>} candidates
 * @param {Object} options month, processedLabel, allowedSubjects
 * @return {Array<Object>}
 */
function selectCollectMessages(candidates, options) {
  var source = options || {};
  var month = source.month;
  var allowed = null;
  var rank = {};
  if (source.allowedSubjects) {
    allowed = {};
    for (var s = 0; s < source.allowedSubjects.length; s++) {
      allowed[source.allowedSubjects[s]] = true;
      rank[source.allowedSubjects[s]] = s;
    }
  }
  var seen = {};
  var kept = [];
  var rows = candidates || [];
  for (var i = 0; i < rows.length; i++) {
    var item = rows[i];
    if (!item || !item.id || seen[item.id]) continue;
    if (allowed && !allowed[item.subject]) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.dateYmd || '')) continue;
    if (item.dateYmd.slice(0, 7) !== month) continue;
    if (hasProcessedLabel_(item.labelNames, source.processedLabel)) continue;
    seen[item.id] = true;
    kept.push(item);
  }
  kept.sort(function (a, b) {
    var aRank = Object.prototype.hasOwnProperty.call(rank, a.subject) ? rank[a.subject] : 1000;
    var bRank = Object.prototype.hasOwnProperty.call(rank, b.subject) ? rank[b.subject] : 1000;
    if (aRank !== bRank) return aRank - bRank;
    if (a.dateYmd !== b.dateYmd) return a.dateYmd < b.dateYmd ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });
  return kept;
}

/**
 * Reads Gmail threads for fixture queries only. Subjects outside the
 * allow-list are discarded before anything else is read from the message.
 * @param {string[]} queries
 * @param {string[]} allowedSubjects
 * @param {string} timeZone
 * @return {Array<Object>}
 */
function readFixtureMessages(queries, allowedSubjects, timeZone) {
  assertFixtureQueries_(queries, allowedSubjects);
  var allowed = {};
  for (var s = 0; s < allowedSubjects.length; s++) allowed[allowedSubjects[s]] = true;
  var zone = timeZone || 'Asia/Jerusalem';
  var found = [];
  var seenThreads = {};
  for (var q = 0; q < queries.length; q++) {
    var start = 0;
    while (start < FIXTURE_SEARCH_MAX_THREADS) {
      var threads = GmailApp.search(queries[q], start, FIXTURE_SEARCH_PAGE);
      if (!threads.length) break;
      for (var t = 0; t < threads.length; t++) {
        var thread = threads[t];
        if (seenThreads[thread.getId()]) continue;
        seenThreads[thread.getId()] = true;
        found = found.concat(fixtureMessagesFromThread_(thread, allowed, zone));
      }
      if (threads.length < FIXTURE_SEARCH_PAGE) break;
      start += FIXTURE_SEARCH_PAGE;
    }
  }
  return found;
}

function fixtureMessagesFromThread_(thread, allowed, timeZone) {
  var labels = [];
  var labelObjects = thread.getLabels();
  for (var i = 0; i < labelObjects.length; i++) labels.push(labelObjects[i].getName());
  var messages = thread.getMessages();
  var rows = [];
  for (var m = 0; m < messages.length; m++) {
    var message = messages[m];
    var subject = message.getSubject();
    if (!allowed[subject]) continue;
    rows.push({
      id: message.getId(),
      threadId: thread.getId(),
      subject: subject,
      from: message.getFrom(),
      dateYmd: Utilities.formatDate(message.getDate(), timeZone, 'yyyy-MM-dd'),
      labelNames: labels
    });
  }
  return rows;
}

if (typeof module !== 'undefined') {
  module.exports = {
    resolveCollectMonth: resolveCollectMonth,
    gmailMonthBounds: gmailMonthBounds,
    labelSearchName: labelSearchName,
    excludeProcessedTerm: excludeProcessedTerm,
    buildCollectQueries: buildCollectQueries,
    buildFixtureSearchQueries: buildFixtureSearchQueries,
    assertFixtureQueries_: assertFixtureQueries_,
    selectCollectMessages: selectCollectMessages,
    readFixtureMessages: readFixtureMessages
  };
}
