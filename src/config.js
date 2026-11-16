/**
 * Settings schema and getConfig().
 * Sheet IDs stay in Script Properties. Client values stay in the Settings tab.
 */

var COLLECTOR_SPREADSHEET_NAME = 'Invoice Collector';

/** Replaced in dist/Code.gs by scripts/build-client.js with the git commit. */
var CODE_BUILD = 'dev';
var SPREADSHEET_ID_PROPERTY = 'SPREADSHEET_ID';

var SHEET_NAMES = ['Invoices', 'RunLog', 'Comparison', 'AnswerKey', 'Settings'];

var INVOICE_HEADERS = [
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
  'buyer_name_ok',
  'source',
  'file_link',
  'confidence',
  'status',
  'notes',
  'extract_version'
];

var RUN_LOG_HEADERS = [
  'started_at',
  'finished_at',
  'mode',
  'messages',
  'files',
  'rows',
  'errors',
  'status',
  'cursor',
  'coverage'
];

/** Previous one-line default. Setup replaces only this exact cell. */
var LEGACY_SEARCH_QUERIES = 'has:attachment (חשבונית OR קבלה OR invoice OR receipt)';

/** Coverage v1 default. Setup replaces only this exact cell. */
var PREVIOUS_SEARCH_QUERIES = [
  'has:attachment (חשבונית OR קבלה OR invoice OR receipt)',
  '(חשבונית OR קבלה OR invoice OR receipt OR "סה\\"כ לתשלום" OR "total due" OR "amount due")',
  'has:attachment (filename:pdf OR filename:jpg OR filename:png)'
].join('\n');

function quoteSearchTerm_(term) {
  var text = String(term || '').trim();
  if (!text || text.charAt(0) === '"') return text;
  if (/[\s()]/.test(text)) return '"' + text + '"';
  return text;
}

function invoiceSearchGroup_(extra) {
  var terms = [
    'חשבונית',
    'החשבונית',
    'חשבוניתך',
    'לחשבונית',
    'קבלה',
    'הקבלה',
    'קבלתך',
    'invoice',
    'receipt',
    'billing',
    'subscription',
    'renews',
    'payment',
    'order confirmation',
    'הזמנה',
    'תשלום'
  ];
  var parts = [];
  var i;
  for (i = 0; i < terms.length; i++) parts.push(quoteSearchTerm_(terms[i]));
  var more = extra || [];
  for (i = 0; i < more.length; i++) parts.push(more[i]);
  return '(' + parts.join(' OR ') + ')';
}

function defaultSearchQueriesValue() {
  return [
    'has:attachment ' + invoiceSearchGroup_([]),
    invoiceSearchGroup_(['"סה\\"כ לתשלום"', '"total due"', '"amount due"']),
    'has:attachment (filename:pdf OR filename:jpg OR filename:png)'
  ].join('\n');
}

function sameSettingText_(left, right) {
  return String(left || '').replace(/\r\n/g, '\n').trim() === String(right || '').replace(/\r\n/g, '\n').trim();
}

var COMPARISON_HEADERS = [
  'field',
  'answer_key_count',
  'deterministic_matches',
  'local_ai_matches',
  'time_ms',
  'tokens',
  'manual_count',
  'match_percent'
];

var ANSWER_KEY_HEADERS = INVOICE_HEADERS.slice();

var SETTINGS_HEADERS = ['key', 'value', 'note'];

/** Keys whose Settings values are one entry per line. */
var LIST_SETTING_KEYS = {
  search_queries: true,
  vendor_whitelist: true,
  keywords_doc_type: true,
  keywords_total: true,
  keywords_before_vat: true,
  keywords_vat: true,
  keywords_date: true,
  keywords_doc_number: true,
  keywords_vendor_id: true,
  keywords_allocation: true
};

/**
 * Defaults from docs/SPEC.md and docs/RULES.md.
 * type number + blankValue null means an empty cell stays empty.
 */
var SETTINGS_FIELDS = [
  {
    key: 'month',
    value: '',
    type: 'string',
    note: 'YYYY-MM to collect. Empty uses the previous calendar month.'
  },
  {
    key: 'search_queries',
    value: defaultSearchQueriesValue(),
    type: 'lines',
    note: 'One Gmail search per line. The second line has no has:attachment so an invoice in the body is found.'
  },
  {
    key: 'vendor_whitelist',
    value: '',
    type: 'lines',
    note: 'One sender email or domain per line.'
  },
  {
    key: 'keywords_doc_type',
    value: [
      'tax_invoice_receipt | חשבונית מס קבלה',
      'tax_invoice_receipt | חשבונית מס/קבלה',
      'tax_invoice_receipt | tax invoice receipt',
      'tax_invoice | חשבונית מס',
      'tax_invoice | tax invoice',
      'receipt | קבלה',
      'receipt | receipt',
      'credit_note | חשבונית זיכוי',
      'credit_note | זיכוי',
      'credit_note | credit note',
      'not_invoice | הצעת מחיר',
      'not_invoice | quote',
      'not_invoice | newsletter',
      'not_invoice | promotion',
      'not_invoice | הזמנה התקבלה'
    ].join('\n'),
    type: 'lines',
    note: 'type | phrase. First match wins, so longer types are listed first. Source: docs/RULES.md.'
  },
  {
    key: 'keywords_total',
    value: [
      'סה"כ לתשלום',
      'סכום לתשלום',
      'סה"כ כולל מע"מ',
      'סה"כ לזיכוי',
      'סה"כ',
      'Total due',
      'Amount due',
      'Total'
    ].join('\n'),
    type: 'lines',
    note: 'Priority order, first line first. Source: docs/RULES.md.'
  },
  {
    key: 'keywords_before_vat',
    value: ['סה"כ לפני מע"מ', 'סכום לפני מע"מ', 'Subtotal'].join('\n'),
    type: 'lines',
    note: 'Source: docs/RULES.md.'
  },
  {
    key: 'keywords_vat',
    value: ['מע"מ', 'VAT'].join('\n'),
    type: 'lines',
    note: 'Source: docs/RULES.md.'
  },
  {
    key: 'keywords_date',
    value: ['תאריך הפקה', 'תאריך', 'Invoice date', 'Date'].join('\n'),
    type: 'lines',
    note: 'Labels that mark the document date. Source: docs/RULES.md.'
  },
  {
    key: 'keywords_doc_number',
    value: ['מס\' חשבונית', 'חשבונית מס מספר', 'מספר מסמך', 'מס\' מסמך', 'קבלה מספר', 'Invoice #', 'Invoice No', 'הצעת מחיר', 'מספר', 'Quote'].join('\n'),
    type: 'lines',
    note: 'Source: docs/RULES.md.'
  },
  {
    key: 'keywords_vendor_id',
    value: ['עוסק מורשה', 'ח.פ', 'ח"פ', 'ע.מ'].join('\n'),
    type: 'lines',
    note: 'Phrases before the 9-digit vendor id. The company id is excluded. Source: docs/RULES.md.'
  },
  {
    key: 'keywords_allocation',
    value: ['מספר הקצאה', 'מס\' הקצאה'].join('\n'),
    type: 'lines',
    note: 'Source: docs/RULES.md.'
  },
  {
    key: 'confidence_threshold',
    value: 0.7,
    type: 'number',
    note: 'Below this score the status is REVIEW. Enter 0.7 for 70%. Source: docs/RULES.md.'
  },
  {
    key: 'allocation_threshold',
    value: '',
    type: 'number',
    blankValue: null,
    note: 'ILS. Invoices at or above this amount need an allocation number. Confirm with the accountant.'
  },
  {
    key: 'vat_rate',
    value: 0.18,
    type: 'number',
    note: 'Enter 0.18 for 18%. Source: docs/RULES.md.'
  },
  {
    key: 'amount_tolerance',
    value: 1,
    type: 'number',
    note: 'ILS. Allowed gap when checking total = amount before VAT + VAT. Source: docs/SPEC.md.'
  },
  {
    key: 'invoices_folder_id',
    value: '',
    type: 'string',
    note: 'Id of the Invoices/YYYY-MM folder copies are saved into. Empty: create Invoices/YYYY-MM in My Drive and store that folder id.'
  },
  {
    key: 'queue_folder_id',
    value: '',
    type: 'string',
    note: 'Drive folder id for the local_ai queue.'
  },
  {
    key: 'accountant_email',
    value: '',
    type: 'string',
    note: 'Draft recipient. The script never sends mail.'
  },
  {
    key: 'owner_email',
    value: '',
    type: 'string',
    note: 'Gets error mail only. The script never sends the accountant draft.'
  },
  {
    key: 'company_name',
    value: '',
    type: 'string',
    note: 'Buyer name expected on the invoice.'
  },
  {
    key: 'company_id',
    value: '',
    type: 'string',
    note: 'Company ח.פ / ע.מ, 9 digits. Excluded when reading a vendor id.'
  },
  {
    key: 'currency_default',
    value: 'ILS',
    type: 'string',
    note: 'Used when the document does not name a currency. Source: docs/SPEC.md.'
  },
  {
    key: 'mode',
    value: 'deterministic',
    type: 'string',
    note: 'deterministic, local_ai, or compare.'
  },
  {
    key: 'batch_size',
    value: 20,
    type: 'number',
    note: 'Unlabeled messages saved per run. Use 3 to test resume on the 8 fixtures. Labels are the only progress state. The run also stops short of the 6-minute limit.'
  },
  {
    key: 'processed_label',
    value: 'invoices/processed',
    type: 'string',
    note: 'Gmail label applied after a message is saved. Source: docs/SPEC.md.'
  },
  {
    key: 'review_label',
    value: 'invoices/review',
    type: 'string',
    note: 'Gmail label for messages that need a person. Source: docs/SPEC.md.'
  }
];

var USER_INPUT_KEYS = {
  month: true,
  vendor_whitelist: true,
  allocation_threshold: true,
  invoices_folder_id: true,
  queue_folder_id: true,
  accountant_email: true,
  owner_email: true,
  company_name: true,
  company_id: true
};

function headersFor(sheetName) {
  switch (sheetName) {
    case 'Invoices':
      return INVOICE_HEADERS.slice();
    case 'RunLog':
      return RUN_LOG_HEADERS.slice();
    case 'Comparison':
      return COMPARISON_HEADERS.slice();
    case 'AnswerKey':
      return ANSWER_KEY_HEADERS.slice();
    case 'Settings':
      return SETTINGS_HEADERS.slice();
    default:
      throw new Error('Unknown sheet: ' + sheetName);
  }
}

function defaultSettingsMap_() {
  var defaults = {};
  for (var i = 0; i < SETTINGS_FIELDS.length; i++) {
    defaults[SETTINGS_FIELDS[i].key] = SETTINGS_FIELDS[i];
  }
  return defaults;
}

function parseLines_(value) {
  if (value == null) return [];
  return String(value)
    .split(/\r?\n/)
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    });
}

function parseNumber_(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'number') {
    return isFinite(value) ? value : fallback;
  }
  var text = String(value).trim();
  if (!text) return fallback;
  var normalized = text.replace(',', '.');
  var parsed = Number(normalized);
  return isFinite(parsed) ? parsed : fallback;
}

function coerceSetting_(field, raw) {
  if (!field) return raw == null ? '' : String(raw).trim();
  if (field.type === 'lines') return parseLines_(raw);
  if (field.type === 'number') {
    var fallback = Object.prototype.hasOwnProperty.call(field, 'blankValue')
      ? field.blankValue
      : field.value;
    return parseNumber_(raw, fallback);
  }
  return raw == null ? '' : String(raw).trim();
}

/**
 * @param {Array<Array<*>>} rows Settings tab values, with or without a header row.
 * @return {Object} Every default key, plus any extra keys present on the sheet.
 */
function parseSettingsRows(rows) {
  var defaults = defaultSettingsMap_();
  var config = {};
  var order = SETTINGS_FIELDS.map(function (field) {
    return field.key;
  });
  var seen = {};

  var source = rows || [];
  var start = 0;
  if (
    source.length &&
    String(source[0][0] || '')
      .trim()
      .toLowerCase() === 'key'
  ) {
    start = 1;
  }

  for (var i = start; i < source.length; i++) {
    var row = source[i] || [];
    var key = String(row[0] || '').trim();
    if (!key) continue;
    if (!seen[key]) order.push(key);
    seen[key] = row.length > 1 ? row[1] : '';
  }

  var uniqueOrder = [];
  var added = {};
  for (var k = 0; k < order.length; k++) {
    if (added[order[k]]) continue;
    added[order[k]] = true;
    uniqueOrder.push(order[k]);
  }

  for (var n = 0; n < uniqueOrder.length; n++) {
    var settingKey = uniqueOrder[n];
    var field = defaults[settingKey];
    var raw = Object.prototype.hasOwnProperty.call(seen, settingKey)
      ? seen[settingKey]
      : field
        ? field.value
        : '';
    config[settingKey] = coerceSetting_(field, raw);
  }
  return config;
}

/**
 * Reads Settings. Pass rows in tests; omit them when running in Apps Script.
 * @param {Array<Array<*>>=} rows
 * @return {Object}
 */
function getConfig(rows) {
  var values = rows || readSettingsValues_();
  return parseSettingsRows(values);
}

function readSettingsValues_() {
  var ss = openCollectorSpreadsheet_();
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) {
    throw new Error('Settings tab is missing. Run setupCollectorSheet().');
  }
  if (sheet.getLastRow() === 0) return [];
  return sheet.getDataRange().getValues();
}

function openCollectorSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(SPREADSHEET_ID_PROPERTY);
  if (id) return SpreadsheetApp.openById(id);
  var file = findCollectorFile_();
  if (!file) {
    throw new Error('Spreadsheet not found. Run setupCollectorSheet().');
  }
  props.setProperty(SPREADSHEET_ID_PROPERTY, file.getId());
  return SpreadsheetApp.openById(file.getId());
}

function findCollectorFile_() {
  var files = DriveApp.getFilesByName(COLLECTOR_SPREADSHEET_NAME);
  var fallback = null;
  while (files.hasNext()) {
    var file = files.next();
    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) continue;
    if (!fallback) fallback = file;
    var ss = SpreadsheetApp.openById(file.getId());
    if (ss.getSheetByName('Settings')) return file;
  }
  return fallback;
}

/**
 * @param {string} name
 * @param {Array<Array<*>>} existingValues
 * @return {Array<Array<*>>|null} Cells to write, or null when the tab already has rows.
 */
function gridForSheet(name, existingValues) {
  if (name === 'Settings') return mergeSettingsGrid(existingValues || []);
  var existing = existingValues || [];
  var hasData = existing.some(function (row) {
    return (row || []).some(function (cell) {
      return cell !== '' && cell != null;
    });
  });
  if (hasData) return null;
  return [headersFor(name)];
}

function mergeSettingsGrid(existing) {
  var rows = [SETTINGS_HEADERS.slice()];
  var seen = {};
  var start = 0;
  var source = existing || [];
  if (
    source.length &&
    String(source[0][0] || '')
      .trim()
      .toLowerCase() === 'key'
  ) {
    start = 1;
  }
  for (var i = start; i < source.length; i++) {
    var row = source[i] || [];
    var key = String(row[0] || '').trim();
    if (!key || seen[key]) continue;
    seen[key] = true;
    var keptValue = row.length > 1 && row[1] != null ? row[1] : '';
    var keptNote = row.length > 2 && row[2] != null ? row[2] : '';
    if (
      key === 'search_queries' &&
      (sameSettingText_(keptValue, LEGACY_SEARCH_QUERIES) || sameSettingText_(keptValue, PREVIOUS_SEARCH_QUERIES))
    ) {
      var replacement = defaultSettingsMap_().search_queries;
      keptValue = replacement.value;
      keptNote = replacement.note;
    }
    rows.push([key, keptValue, keptNote]);
  }
  for (var n = 0; n < SETTINGS_FIELDS.length; n++) {
    var field = SETTINGS_FIELDS[n];
    if (seen[field.key]) continue;
    rows.push([field.key, field.value, field.note]);
  }
  return rows;
}

function rectangular(grid) {
  var width = 0;
  for (var i = 0; i < grid.length; i++) {
    width = Math.max(width, grid[i].length);
  }
  return grid.map(function (row) {
    var copy = row.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
}

function buildInitialGrids() {
  var grids = {};
  for (var i = 0; i < SHEET_NAMES.length; i++) {
    var name = SHEET_NAMES[i];
    grids[name] = rectangular(gridForSheet(name, []));
  }
  return grids;
}

if (typeof module !== 'undefined') {
  module.exports = {
    COLLECTOR_SPREADSHEET_NAME: COLLECTOR_SPREADSHEET_NAME,
    CODE_BUILD: CODE_BUILD,
    SHEET_NAMES: SHEET_NAMES,
    INVOICE_HEADERS: INVOICE_HEADERS,
    RUN_LOG_HEADERS: RUN_LOG_HEADERS,
    COMPARISON_HEADERS: COMPARISON_HEADERS,
    ANSWER_KEY_HEADERS: ANSWER_KEY_HEADERS,
    SETTINGS_HEADERS: SETTINGS_HEADERS,
    SETTINGS_FIELDS: SETTINGS_FIELDS,
    LEGACY_SEARCH_QUERIES: LEGACY_SEARCH_QUERIES,
    PREVIOUS_SEARCH_QUERIES: PREVIOUS_SEARCH_QUERIES,
    defaultSearchQueriesValue: defaultSearchQueriesValue,
    USER_INPUT_KEYS: USER_INPUT_KEYS,
    headersFor: headersFor,
    getConfig: getConfig,
    parseSettingsRows: parseSettingsRows,
    gridForSheet: gridForSheet,
    buildInitialGrids: buildInitialGrids
  };
}
