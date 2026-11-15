/**
 * Dev only. Reads the eight saved fixtures and extracts fields.
 * Text-layer documents must match the answer key. Scans and photos are logged;
 * Drive OCR is checked later by testPhase2.
 * Restores company_name, company_id, and month.
 */

var EXTRACT_FIELD_KEYS_ = [
  'vendor_name',
  'vendor_id',
  'doc_type',
  'doc_number',
  'doc_date',
  'amount_before_vat',
  'vat_amount',
  'total',
  'currency',
  'allocation_number',
  'buyer_name_ok'
];

function extractFieldMisses_(actual, expectedFields) {
  var misses = [];
  for (var i = 0; i < EXTRACT_FIELD_KEYS_.length; i++) {
    var key = EXTRACT_FIELD_KEYS_[i];
    var expected = expectedFields[key];
    var got = actual[key];
    var same = expected == null ? got == null || got === '' : got === expected;
    if (!same) misses.push(key + '=' + got);
  }
  return misses;
}

function testExtract() {
  var saved = {
    company_name: readSettingValue_('company_name'),
    company_id: readSettingValue_('company_id'),
    month: readSettingValue_('month')
  };
  var detail = '';
  var pass = false;
  try {
    if (!saved.company_name || !saved.company_id || !saved.month) {
      throw new Error('Settings is missing company_name, company_id, or month.');
    }
    writeSettingValue_(
      'company_name',
      FIXTURE_EXPECTED.buyer.name_he + '\n' + FIXTURE_EXPECTED.buyer.name_en
    );
    writeSettingValue_('company_id', FIXTURE_EXPECTED.buyer.vendor_id);
    writeSettingValue_('month', FIXTURE_EXPECTED.month);
    var folderId = getConfig().invoices_folder_id;
    if (!folderId) throw new Error('invoices_folder_id is empty. Run saveTestFixtureFiles first.');
    var folder = DriveApp.getFolderById(folderId);
    var docs = FIXTURE_EXPECTED.documents;
    var pending = {};
    var i;
    for (i = 0; i < docs.length; i++) pending[docs[i].file.replace(/\.[^.]+$/, '')] = docs[i];
    var failures = [];
    var files = folder.getFiles();
    while (files.hasNext()) {
      var file = files.next();
      var stem = '';
      var keys = Object.keys(pending);
      for (i = 0; i < keys.length; i++) {
        if (file.getName().indexOf(keys[i]) >= 0) stem = keys[i];
      }
      if (!stem) continue;
      var doc = pending[stem];
      var read = readDriveBlobText(file.getBlob(), file.getName());
      var fields = extractInvoice(read.text, getConfig(), { senderEmail: doc.from, senderName: doc.name });
      var misses = extractFieldMisses_(fields, doc.fields);
      Logger.log(
        'testExtract %s source=%s confidence=%s misses=%s',
        doc.file,
        read.source,
        fields.confidence,
        misses.join(',') || '-'
      );
      if (doc.kind !== 'pdf_scan' && doc.kind !== 'image' && misses.length) {
        failures.push(doc.file + ' ' + misses.join(','));
      }
      delete pending[stem];
    }
    var missing = Object.keys(pending);
    if (missing.length) throw new Error('missing files ' + missing.join(', '));
    pass = failures.length === 0;
    detail = pass ? 'text-layer fixtures match' : failures.join('; ');
  } catch (error) {
    pass = false;
    detail = String(error && error.message ? error.message : error);
  } finally {
    if (saved.company_name) writeSettingValue_('company_name', saved.company_name.value);
    if (saved.company_id) writeSettingValue_('company_id', saved.company_id.value);
    if (saved.month) writeSettingValue_('month', saved.month.value);
    Logger.log('testExtract restored company_name, company_id, month');
  }
  Logger.log('testExtract %s %s', pass ? 'PASS' : 'FAIL', detail);
  return { result: pass ? 'PASS' : 'FAIL', detail: detail };
}
