/**
 * Dev only. Checks the default searches, body-invoice detection, and the
 * RunLog coverage line. Does not read Gmail or change Settings.
 */

function testCoverage() {
  var detail = '';
  var pass = false;
  try {
    var field = null;
    var i;
    for (i = 0; i < SETTINGS_FIELDS.length; i++) {
      if (SETTINGS_FIELDS[i].key === 'search_queries') field = SETTINGS_FIELDS[i];
    }
    var lines = String(field.value)
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });
    var coverage = formatRunCoverage([2, 1], { 'outside month': 1 }, 3);
    var note = coverageDraftLine(3, 1);
    var checks = [
      lines.length === 3,
      lines[0].indexOf('has:attachment (חשבונית') === 0,
      lines[1].indexOf('has:attachment') < 0 && lines[1].indexOf('total due') >= 0,
      lines[2].indexOf('filename:pdf') >= 0,
      lines[0].indexOf('החשבונית') > 0 && lines[0].indexOf('billing') > 0 && lines[0].indexOf('לחשבונית') > 0,
      lines[1].indexOf('has:attachment') < 0 && lines[1].indexOf('"order confirmation"') > 0,
      noticeWithoutInvoice('Your subscription renews').notes === 'check for invoice',
      interpretLinkFetch('https://vendor.example/a.pdf', { status: 401, bytes: [] }).action === 'review',
      bodyHasInvoiceText('סה"כ לתשלום 10') === true,
      bodyHasInvoiceText('hello meeting') === false,
      coverage.indexOf('q1=2') >= 0 && coverage.indexOf('skipped 1') >= 0,
      note === 'Coverage: 3 messages scanned, 1 documents.',
      multipageNote({ name: 'a.pdf', pages: 3, start: 5, keepLocal: [2] }) ===
        'File a.pdf has 3 pages; pages to keep: 6; merged PDF pages 5-7',
      multipageNote({ name: 'b.pdf', pages: 2, start: 1, keepLocal: null }).indexOf('check manually') >= 0,
      multipageNote({ name: 'c.pdf', pages: 1, start: 1, keepLocal: [1] }) === ''
    ];
    pass = checks.every(function (ok) {
      return ok;
    });
    detail = lines.length + ' queries; ' + note;
    Logger.log('testCoverage lines %s', lines.join(' | '));
    Logger.log('testCoverage %s', coverage);
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  }
  Logger.log('testCoverage %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail };
}
