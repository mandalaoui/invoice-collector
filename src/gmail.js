/**
 * Gmail search for one month.
 * Query text is built here and tested without Gmail.
 * Client runs search Settings lines plus the month window and processed label.
 * Fixture subjects are a dev-only search and are not applied to client runs.
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

/** One log line: the exact string passed to Gmail, then the thread count. */
function formatGmailQueryLog(query, count) {
  var hits = Number(count);
  if (!isFinite(hits) || hits < 0) hits = 0;
  return 'gmail query=' + String(query == null ? '' : query) + ' count=' + String(hits);
}

var CLIENT_SEARCH_PAGE = 50;
var CLIENT_SEARCH_MAX_THREADS = 500;

function searchClientThreads_(query) {
  var threads = [];
  var seen = {};
  var start = 0;
  while (start < CLIENT_SEARCH_MAX_THREADS) {
    var batch = GmailApp.search(query, start, CLIENT_SEARCH_PAGE);
    for (var i = 0; i < batch.length; i++) {
      var id = batch[i].getId();
      if (seen[id]) continue;
      seen[id] = true;
      threads.push(batch[i]);
    }
    if (batch.length < CLIENT_SEARCH_PAGE) break;
    start += CLIENT_SEARCH_PAGE;
  }
  return threads;
}

function clientAttachmentList_(message) {
  var files;
  try {
    files = message.getAttachments({ includeInlineImages: false, includeAttachments: true });
  } catch (ignore) {
    files = message.getAttachments();
  }
  var rows = [];
  var list = files || [];
  for (var i = 0; i < list.length; i++) {
    rows.push({
      index: i,
      name: list[i].getName(),
      mime: list[i].getContentType()
    });
  }
  return rows;
}

function textWithLinks(plain, html) {
  var source = String(html || '');
  var hrefs = [];
  var re = /href\s*=\s*["']([^"']+)["']/gi;
  var match;
  while ((match = re.exec(source))) hrefs.push(match[1]);
  var stripped = source.replace(/<[^>]+>/g, ' ');
  return (String(plain || '') + '\n' + stripped + '\n' + hrefs.join('\n')).trim();
}

function messageBodyText_(message) {
  var plain = '';
  var html = '';
  try {
    plain = message.getPlainBody ? message.getPlainBody() : '';
  } catch (ignore) {
    plain = '';
  }
  try {
    html = message.getBody ? message.getBody() : '';
  } catch (ignore) {
    html = '';
  }
  return textWithLinks(plain, html);
}

function mergeClientMessages(primary, extra) {
  var seen = {};
  var out = [];
  var lists = [primary || [], extra || []];
  var a;
  var i;
  for (a = 0; a < lists.length; a++) {
    for (i = 0; i < lists[a].length; i++) {
      var item = lists[a][i];
      if (!item || !item.id || seen[item.id]) continue;
      seen[item.id] = true;
      out.push(item);
    }
  }
  return out;
}

function fetchMessagesById(ids, timeZone) {
  var zone = timeZone || 'Asia/Jerusalem';
  var out = [];
  var seen = {};
  var list = ids || [];
  var i;
  for (i = 0; i < list.length; i++) {
    var id = String(list[i] || '');
    if (!id || seen[id]) continue;
    seen[id] = true;
    var message = null;
    try {
      message = GmailApp.getMessageById(id);
    } catch (ignore) {
      message = null;
    }
    if (!message) continue;
    var labels = [];
    var threadId = '';
    try {
      var thread = message.getThread();
      threadId = thread.getId();
      var labelObjects = thread.getLabels();
      for (var n = 0; n < labelObjects.length; n++) labels.push(labelObjects[n].getName());
    } catch (ignore) {
      labels = [];
    }
    var body = messageBodyText_(message);
    out.push({
      id: message.getId(),
      threadId: threadId,
      subject: message.getSubject(),
      from: message.getFrom(),
      dateYmd: Utilities.formatDate(message.getDate(), zone, 'yyyy-MM-dd'),
      labelNames: labels,
      attachments: clientAttachmentList_(message),
      body: body,
      hasBody: body.length > 0
    });
  }
  return out;
}

function clientMessagesFromThread_(thread, timeZone) {
  var labels = [];
  var labelObjects = thread.getLabels();
  for (var i = 0; i < labelObjects.length; i++) labels.push(labelObjects[i].getName());
  var messages = thread.getMessages();
  var rows = [];
  for (var m = 0; m < messages.length; m++) {
    var message = messages[m];
    var body = messageBodyText_(message);
    rows.push({
      id: message.getId(),
      threadId: thread.getId(),
      subject: message.getSubject(),
      from: message.getFrom(),
      dateYmd: Utilities.formatDate(message.getDate(), timeZone, 'yyyy-MM-dd'),
      labelNames: labels,
      attachments: clientAttachmentList_(message),
      body: body,
      hasBody: body.length > 0
    });
  }
  return rows;
}

/**
 * Settings queries only. No fixture subject list and no from:me requirement.
 * Logs each final query and the number of threads it returned.
 * @param {string[]} queries
 * @param {string} timeZone
 * @return {{messages: Array<Object>, queryLogs: string[], queryCounts: number[]}}
 */
function readClientMessages(queries, timeZone) {
  var list = queries || [];
  var zone = timeZone || 'Asia/Jerusalem';
  var queryLogs = [];
  var queryCounts = [];
  var found = [];
  var seenThreads = {};
  if (!list.length) {
    var emptyLine = 'gmail queries=0 count=0';
    queryLogs.push(emptyLine);
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log(emptyLine);
    return { messages: found, queryLogs: queryLogs, queryCounts: queryCounts };
  }
  for (var q = 0; q < list.length; q++) {
    var threads = searchClientThreads_(list[q]);
    var line = formatGmailQueryLog(list[q], threads.length);
    queryLogs.push(line);
    if (typeof Logger !== 'undefined' && Logger.log) Logger.log(line);
    var candidates = 0;
    for (var t = 0; t < threads.length; t++) {
      var thread = threads[t];
      var rows = clientMessagesFromThread_(thread, zone);
      candidates += rows.length;
      if (seenThreads[thread.getId()]) continue;
      seenThreads[thread.getId()] = true;
      found = found.concat(rows);
    }
    queryCounts.push(candidates);
  }
  return { messages: found, queryLogs: queryLogs, queryCounts: queryCounts };
}

/**
 * One RunLog cell: candidates per query, messages scanned, skips by reason.
 * @param {number[]} queryCounts
 * @param {Object<string, number>} skipped
 * @param {number} scanned
 * @return {string}
 */
function formatRunCoverage(queryCounts, skipped, scanned) {
  var bits = [];
  var counts = queryCounts || [];
  var i;
  for (i = 0; i < counts.length; i++) bits.push('q' + (i + 1) + '=' + (Number(counts[i]) || 0));
  var reasons = Object.keys(skipped || {}).sort();
  var skipBits = [];
  var total = 0;
  for (i = 0; i < reasons.length; i++) {
    var count = Number(skipped[reasons[i]]) || 0;
    total += count;
    skipBits.push(reasons[i] + '=' + count);
  }
  var scannedCount = Number(scanned);
  if (!isFinite(scannedCount) || scannedCount < 0) scannedCount = 0;
  return (
    'candidates ' +
    (bits.join(' ') || '0') +
    '; scanned ' +
    scannedCount +
    '; skipped ' +
    total +
    (skipBits.length ? ' (' + skipBits.join(', ') + ')' : '')
  );
}

/**
 * Adds processed_label to the given threads. Subjects are not checked.
 * @return {number} threads labeled
 */
function labelClientThreads(threadIds, labelName) {
  var name = String(labelName || '').trim();
  if (!name) throw new Error('processed_label is empty');
  var ids = [];
  var seen = {};
  var list = threadIds || [];
  var i;
  for (i = 0; i < list.length; i++) {
    var id = String(list[i] || '');
    if (!id || seen[id]) continue;
    seen[id] = true;
    ids.push(id);
  }
  if (!ids.length) return 0;
  var label = gmailLabel_(name);
  for (i = 0; i < ids.length; i++) {
    var thread = GmailApp.getThreadById(ids[i]);
    if (!thread) throw new Error('Gmail thread was not found');
    thread.addLabel(label);
  }
  return ids.length;
}

/**
 * Dev search. Settings queries are ignored. The mailbox is limited to
 * mail this account sent with one of the fixture subjects.
 * @param {string[]} subjects
 * @param {Object} options month, today, processed_label, includeProcessed
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
  var query = 'in:anywhere from:me (' + subjectQuery + ') ' + monthWindowTerm_(month);
  if (!source.includeProcessed) {
    query += ' ' + excludeProcessedTerm(source.processed_label || 'invoices/processed');
  }
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
function bumpSkip_(skipped, reason) {
  skipped[reason] = (skipped[reason] || 0) + 1;
}

/**
 * Same filter as selectCollectMessages, plus a count per skip reason.
 * @return {{kept: Array<Object>, skipped: Object<string, number>}}
 */
function partitionCollectMessages(candidates, options) {
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
  var skipped = {};
  var rows = candidates || [];
  for (var i = 0; i < rows.length; i++) {
    var item = rows[i];
    if (!item || !item.id || seen[item.id]) {
      bumpSkip_(skipped, 'duplicate');
      continue;
    }
    seen[item.id] = true;
    if (allowed && !allowed[item.subject]) {
      bumpSkip_(skipped, 'not a fixture subject');
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.dateYmd || '')) {
      bumpSkip_(skipped, 'no date');
      continue;
    }
    if (item.dateYmd.slice(0, 7) !== month) {
      bumpSkip_(skipped, 'outside month');
      continue;
    }
    if (!source.includeProcessed && hasProcessedLabel_(item.labelNames, source.processedLabel)) {
      bumpSkip_(skipped, 'processed label');
      continue;
    }
    kept.push(item);
  }
  kept.sort(function (a, b) {
    var aRank = Object.prototype.hasOwnProperty.call(rank, a.subject) ? rank[a.subject] : 1000;
    var bRank = Object.prototype.hasOwnProperty.call(rank, b.subject) ? rank[b.subject] : 1000;
    if (aRank !== bRank) return aRank - bRank;
    if (a.dateYmd !== b.dateYmd) return a.dateYmd < b.dateYmd ? -1 : 1;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });
  return { kept: kept, skipped: skipped, rank: rank };
}

function selectCollectMessages(candidates, options) {
  return partitionCollectMessages(candidates, options).kept;
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

/**
 * Counts messages handled in this run and files newly created.
 * A run with no unlabeled messages creates nothing.
 * @param {number} messageCount
 * @param {Array<{created?: boolean}>} files
 * @return {{processed: number, created: number}}
 */
function collectRunTotals(messageCount, files) {
  var created = 0;
  var rows = files || [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i] && rows[i].created) created++;
  }
  return { processed: messageCount || 0, created: created };
}

/**
 * Threads to label. Every subject must be one of the eight fixtures.
 * @param {Array<{threadId: string, subject: string}>} messages
 * @param {string[]} allowedSubjects
 * @param {string} labelName
 * @return {Array<{threadId: string, label: string, messageCount: number}>}
 */
function planProcessedLabels(messages, allowedSubjects, labelName) {
  var name = String(labelName || '').trim();
  if (!name) throw new Error('processed_label is empty');
  var allowed = {};
  var list = fixtureSubjects_(allowedSubjects);
  var i;
  for (i = 0; i < list.length; i++) allowed[list[i]] = true;
  var seen = {};
  var plan = [];
  var rows = messages || [];
  for (i = 0; i < rows.length; i++) {
    var message = rows[i];
    if (!message || !allowed[message.subject]) {
      throw new Error('Refusing to label a message that is not one of the 8 fixtures');
    }
    if (!message.threadId) throw new Error('Fixture message is missing a thread id');
    if (!seen[message.threadId]) {
      seen[message.threadId] = { threadId: message.threadId, label: name, messageCount: 0 };
      plan.push(seen[message.threadId]);
    }
    seen[message.threadId].messageCount++;
  }
  return plan;
}

function gmailLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (label) return label;
  return GmailApp.createLabel(name);
}

function threadsForPlan_(plan) {
  var threads = [];
  for (var i = 0; i < plan.length; i++) {
    var thread = GmailApp.getThreadById(plan[i].threadId);
    if (!thread) throw new Error('Fixture thread was not found');
    threads.push(thread);
  }
  return threads;
}

function assertThreadsAreFixtures_(threads, allowedSubjects) {
  var allowed = {};
  var list = fixtureSubjects_(allowedSubjects);
  var i;
  for (i = 0; i < list.length; i++) allowed[list[i]] = true;
  for (i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    if (!messages.length) throw new Error('Refusing to change a label on an empty thread');
    for (var m = 0; m < messages.length; m++) {
      if (!allowed[messages[m].getSubject()]) {
        throw new Error('Refusing to change a label on a thread that contains other mail');
      }
    }
  }
}

/**
 * Adds processed_label to fixture threads only, after every message in each
 * thread has been checked against the eight subjects.
 * @return {number} messages labeled
 */
function applyProcessedLabel(messages, allowedSubjects, labelName) {
  var plan = planProcessedLabels(messages, allowedSubjects, labelName);
  if (!plan.length) return 0;
  var threads = threadsForPlan_(plan);
  assertThreadsAreFixtures_(threads, allowedSubjects);
  var label = gmailLabel_(labelName);
  var labeled = 0;
  for (var i = 0; i < threads.length; i++) {
    threads[i].addLabel(label);
    labeled += plan[i].messageCount;
  }
  return labeled;
}

/**
 * Removes processed_label from fixture threads only.
 * @return {number} messages whose thread had the label removed
 */
function removeProcessedLabel(messages, allowedSubjects, labelName) {
  var plan = planProcessedLabels(messages, allowedSubjects, labelName);
  if (!plan.length) return 0;
  var label = GmailApp.getUserLabelByName(String(labelName || '').trim());
  if (!label) return 0;
  var threads = threadsForPlan_(plan);
  assertThreadsAreFixtures_(threads, allowedSubjects);
  var cleared = 0;
  for (var i = 0; i < threads.length; i++) {
    var names = [];
    var current = threads[i].getLabels();
    for (var n = 0; n < current.length; n++) names.push(current[n].getName());
    if (!hasProcessedLabel_(names, labelName)) continue;
    threads[i].removeLabel(label);
    cleared += plan[i].messageCount;
  }
  return cleared;
}

if (typeof module !== 'undefined') {
  module.exports = {
    resolveCollectMonth: resolveCollectMonth,
    gmailMonthBounds: gmailMonthBounds,
    labelSearchName: labelSearchName,
    excludeProcessedTerm: excludeProcessedTerm,
    buildCollectQueries: buildCollectQueries,
    formatGmailQueryLog: formatGmailQueryLog,
    formatRunCoverage: formatRunCoverage,
    textWithLinks: textWithLinks,
    mergeClientMessages: mergeClientMessages,
    partitionCollectMessages: partitionCollectMessages,
    readClientMessages: readClientMessages,
    labelClientThreads: labelClientThreads,
    buildFixtureSearchQueries: buildFixtureSearchQueries,
    assertFixtureQueries_: assertFixtureQueries_,
    selectCollectMessages: selectCollectMessages,
    readFixtureMessages: readFixtureMessages,
    collectRunTotals: collectRunTotals,
    planProcessedLabels: planProcessedLabels,
    applyProcessedLabel: applyProcessedLabel,
    removeProcessedLabel: removeProcessedLabel
  };
}
