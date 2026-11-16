/** Bump when extraction or coverage rules change so stored rows are rewritten. */
var EXTRACT_VERSION = '2';

/**
 * Pure extraction. Text in, fields and confidence out.
 * Keywords, the company id, the VAT rate, and the month come from config
 * (the Settings sheet). No Google services.
 */

function normalizeExtractText(text) {
  return String(text || '')
    .replace(/[\u200e\u200f\u202a-\u202e]/g, '')
    .replace(/[״”“]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .replace(/מס'/g, 'מספר')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ ]*\n[ ]*/g, '\n')
    .trim();
}

function foldExtract_(text) {
  return normalizeExtractText(text).toLowerCase();
}

function squashExtract_(text) {
  return foldExtract_(text).replace(/\s/g, '');
}

function reverseExtract_(text) {
  return String(text || '').split('').reverse().join('');
}

function phraseHits_(haystack, phrase) {
  var folded = foldExtract_(haystack);
  var needle = foldExtract_(phrase);
  if (!needle) return false;
  if (boundedHit_(folded, needle)) return true;
  var flat = folded.replace(/\s/g, '');
  var flatNeedle = needle.replace(/\s/g, '');
  if (flatNeedle && boundedHit_(flat, flatNeedle)) return true;
  if (!/[\u0590-\u05ff]/.test(needle)) return false;
  return boundedHit_(flat, reverseExtract_(flatNeedle));
}

function boundedHit_(haystack, needle) {
  var at = haystack.indexOf(needle);
  while (at >= 0) {
    var before = at > 0 ? haystack.charAt(at - 1) : '';
    var latin = /[a-z]/.test(before) && /^[a-z]/.test(needle);
    if (!latin) return true;
    at = haystack.indexOf(needle, at + 1);
  }
  return false;
}

function extractLines_(text) {
  return normalizeExtractText(text)
    .split('\n')
    .map(function (line) {
      return line.trim();
    })
    .filter(function (line) {
      return line.length > 0;
    });
}

function typedPhrases_(lines) {
  return (lines || [])
    .map(function (line) {
      var parts = String(line).split('|');
      return {
        type: String(parts[0] || '').trim(),
        phrase: parts.slice(1).join('|').trim()
      };
    })
    .filter(function (item) {
      return item.type && item.phrase;
    })
    .sort(function (a, b) {
      return squashExtract_(b.phrase).length - squashExtract_(a.phrase).length;
    });
}

function findDocType_(text, config) {
  var phrases = typedPhrases_(config.keywords_doc_type);
  for (var i = 0; i < phrases.length; i++) {
    if (phraseHits_(text, phrases[i].phrase)) return phrases[i].type;
  }
  return null;
}

function dateToken_(line) {
  var match = /(\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/.exec(line || '');
  return match ? match[1] : '';
}

function dateParts_(token) {
  var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token || '');
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  var local = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(token || '');
  if (!local) return null;
  var year = local[3].length === 2 ? 2000 + Number(local[3]) : Number(local[3]);
  return { year: year, month: Number(local[2]), day: Number(local[1]) };
}

function inCollectMonth_(token, month) {
  var parts = dateParts_(token);
  if (!parts || !/^\d{4}-\d{2}$/.test(month || '')) return false;
  return parts.year === Number(month.slice(0, 4)) && parts.month === Number(month.slice(5, 7));
}

function stripDates_(line) {
  return String(line || '').replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g, ' ');
}

function parseAmounts_(line) {
  var cleaned = stripDates_(line).replace(/\d+(?:\.\d+)?\s*%/g, ' ');
  var detailed = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?-?|-?\d+\.\d+-?/g;
  var found = collectAmounts_(cleaned, detailed);
  if (!found.length) found = collectAmounts_(cleaned, /-?\d{1,6}-?/g);
  if (!found.length) return null;
  var best = found[0];
  for (var i = 1; i < found.length; i++) {
    if (Math.abs(found[i]) > Math.abs(best)) best = found[i];
  }
  return best;
}

function collectAmounts_(line, pattern) {
  var found = [];
  var match;
  while ((match = pattern.exec(line))) {
    var token = match[0];
    var negative = token.charAt(0) === '-' || token.charAt(token.length - 1) === '-';
    var digits = token.replace(/[^\d]/g, '');
    if (digits.length >= 9 && token.indexOf('.') < 0) continue;
    var amount = Number(digits) / (token.indexOf('.') >= 0 ? Math.pow(10, digits.length - token.replace(/[^\d.]/g, '').indexOf('.')) : 1);
    if (token.indexOf('.') >= 0) {
      amount = Number(token.replace(/-/g, '').replace(/,/g, ''));
    } else {
      amount = Number(digits);
    }
    if (!isFinite(amount)) continue;
    found.push(Math.round((negative ? -amount : amount) * 100) / 100);
  }
  return found;
}

function firstKeywordLine_(lines, keywords, skipKeywords) {
  var list = keywords || [];
  var skip = skipKeywords || [];
  for (var k = 0; k < list.length; k++) {
    for (var i = 0; i < lines.length; i++) {
      if (!phraseHits_(lines[i], list[k])) continue;
      var blocked = false;
      for (var s = 0; s < skip.length; s++) {
        if (squashExtract_(skip[s]) !== squashExtract_(list[k]) && phraseHits_(lines[i], skip[s])) {
          blocked = true;
        }
      }
      if (!blocked) return i;
    }
  }
  return -1;
}

function keywordTail_(line, phrase, skipKeywords) {
  var text = normalizeExtractText(line);
  var needle = normalizeExtractText(phrase);
  if (!needle) return null;
  var from = 0;
  while (from < text.length) {
    var at = text.indexOf(needle, from);
    if (at < 0) return null;
    var inside = false;
    var skips = skipKeywords || [];
    var s;
    for (s = 0; s < skips.length; s++) {
      var skip = normalizeExtractText(skips[s]);
      if (!skip || skip === needle) continue;
      var skipAt = text.lastIndexOf(skip, at);
      if (skipAt >= 0 && at >= skipAt && at + needle.length <= skipAt + skip.length) inside = true;
    }
    if (!inside) return text.slice(at + needle.length);
    from = at + Math.max(needle.length, 1);
  }
  return null;
}

function amountForKeywords_(lines, keywords, skipKeywords) {
  var list = keywords || [];
  var skip = skipKeywords || [];
  var k;
  var i;
  for (k = 0; k < list.length; k++) {
    for (i = 0; i < lines.length; i++) {
      if (!phraseHits_(lines[i], list[k])) continue;
      var tail = keywordTail_(lines[i], list[k], skip);
      var amount = tail != null ? parseAmounts_(tail) : null;
      if (tail != null && amount == null) {
        var text = normalizeExtractText(lines[i]);
        var needle = normalizeExtractText(list[k]);
        var at = text.indexOf(needle);
        if (at > 0) amount = parseAmounts_(text.slice(0, at));
      }
      if (tail == null) {
        var sharesSkip = false;
        var s;
        for (s = 0; s < skip.length; s++) {
          if (squashExtract_(skip[s]) !== squashExtract_(list[k]) && phraseHits_(lines[i], skip[s])) sharesSkip = true;
        }
        if (sharesSkip) continue;
        amount = parseAmounts_(lines[i]);
        if (amount == null && i + 1 < lines.length) amount = parseAmounts_(lines[i + 1]);
      }
      if (amount != null) return amount;
    }
  }
  return null;
}

function collectIdNumbers_(lines, config) {
  var ids = [];
  function add(value) {
    var digits = String(value || '').replace(/\D/g, '');
    if (digits.length >= 8 && ids.indexOf(digits) < 0) ids.push(digits);
  }
  add(config && config.company_id);
  var list = lines || [];
  for (var i = 0; i < list.length; i++) {
    var found = String(list[i] || '').match(/\d{8,}/g) || [];
    for (var n = 0; n < found.length; n++) add(found[n]);
  }
  return ids;
}

function idFragment_(token, ids) {
  if (!/^\d+$/.test(token)) return false;
  var list = ids || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] === token || list[i].indexOf(token) >= 0) return true;
  }
  return false;
}

function withoutMoney_(line) {
  return String(line || '')
    .replace(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g, ' ')
    .replace(/-?\d+\.\d+/g, ' ');
}

/** Q-17, INV-44190. Amounts and 9-digit ids do not match. */
function letterDocToken_(line) {
  var cleaned = withoutMoney_(stripDates_(line)).replace(/[–—−‐‑]/g, '-');
  var forward = /(?:^|[^A-Za-z0-9])([A-Z]+-?\d+)/i.exec(cleaned);
  if (forward) return forward[1];
  var reversed = /(?:^|[^A-Za-z0-9])-?(\d+)-?([A-Z]+)(?![A-Za-z0-9])/i.exec(cleaned);
  if (reversed) return reversed[2].toUpperCase() + '-' + reversed[1];
  return null;
}

function numericDocToken_(line, ids) {
  var withoutDates = withoutMoney_(stripDates_(line));
  var match;
  var pattern = /(?:^|[^\d])(\d{3,8})(?!\d)/g;
  while ((match = pattern.exec(withoutDates))) {
    if (idFragment_(match[1], ids)) continue;
    return match[1];
  }
  return null;
}

function quoteDocLabel_(keyword) {
  var flat = squashExtract_(keyword);
  return flat === squashExtract_('הצעת מחיר') || flat === squashExtract_('quote') || flat === squashExtract_('מספר');
}

function findDocNumber_(lines, config) {
  var keywords = (config.keywords_doc_number || []).slice();
  keywords.push('קבלה מספר');
  keywords.push("מס' מסמך");
  keywords.push('הצעת מחיר');
  keywords.push('Quote');
  keywords.push('מספר');
  var skip = config.keywords_allocation || [];
  var ids = collectIdNumbers_(lines, config);
  var k;
  var i;
  for (k = 0; k < keywords.length; k++) {
    for (i = 0; i < lines.length; i++) {
      if (!phraseHits_(lines[i], keywords[k])) continue;
      var blocked = false;
      var s;
      for (s = 0; s < skip.length; s++) {
        if (squashExtract_(skip[s]) !== squashExtract_(keywords[k]) && phraseHits_(lines[i], skip[s])) blocked = true;
      }
      if (blocked) continue;
      if (quoteDocLabel_(keywords[k])) {
        var after;
        for (after = i; after < lines.length; after++) {
          var quoted = letterDocToken_(lines[after]);
          if (quoted) return quoted;
        }
        continue;
      }
      var letter = letterDocToken_(lines[i]);
      if (!letter && i + 1 < lines.length) letter = letterDocToken_(lines[i + 1]);
      if (letter) return letter;
      var numeric = numericDocToken_(lines[i], ids);
      if (!numeric && i + 1 < lines.length) numeric = numericDocToken_(lines[i + 1], ids);
      if (numeric) return numeric;
    }
  }
  return null;
}

function findDate_(lines, config) {
  var keywords = (config.keywords_date || []).slice().sort(function (a, b) {
    return squashExtract_(b).length - squashExtract_(a).length;
  });
  var index = firstKeywordLine_(lines, keywords, []);
  if (index >= 0) {
    var token = dateToken_(lines[index]) || (index + 1 < lines.length ? dateToken_(lines[index + 1]) : '');
    if (token) return token;
  }
  for (var i = 0; i < lines.length; i++) {
    var fallback = dateToken_(lines[i]);
    if (fallback && inCollectMonth_(fallback, config.month)) return fallback;
  }
  return null;
}

function findVendorId_(lines, config) {
  var company = String(config.company_id || '').replace(/\D/g, '');
  var keywords = config.keywords_vendor_id || [];
  for (var i = 0; i < lines.length; i++) {
    if (!keywords.some(function (keyword) { return phraseHits_(lines[i], keyword); })) continue;
    var ids = lines[i].match(/\d{9}/g) || [];
    for (var n = 0; n < ids.length; n++) {
      if (ids[n] !== company) return ids[n];
    }
  }
  return null;
}

function findAllocation_(lines, config) {
  var index = firstKeywordLine_(lines, config.keywords_allocation || [], []);
  if (index < 0) return null;
  var match = lines[index].match(/\d{10,}/);
  return match ? match[0] : null;
}

function docTypeLine_(line, phrases) {
  var folded = squashExtract_(line);
  for (var i = 0; i < phrases.length; i++) {
    var phrase = squashExtract_(phrases[i].phrase);
    if (!phrase || folded.indexOf(phrase) < 0) continue;
    var rest = folded.split(phrase).join('').replace(/[\d:.\-/%]/g, '');
    if (!rest) return true;
  }
  return false;
}

function compactCompany_(text) {
  return foldExtract_(text).replace(/["']/g, '').replace(/\s+/g, '');
}

function ownCompanyLine_(line, config) {
  var names = String((config && config.company_name) || '').split(/\n/);
  var flat = compactCompany_(line);
  if (!flat) return false;
  for (var i = 0; i < names.length; i++) {
    var name = compactCompany_(names[i]);
    if (name && flat === name) return true;
  }
  return false;
}

function businessNameLine_(line) {
  var flat = compactCompany_(line);
  if (flat.indexOf('בעמ') >= 0) return true;
  return /\b(ltd|inc|llc|gmbh|corp)\b\.?/i.test(line);
}

function buyerMarkerLine_(line) {
  return phraseHits_(line, 'לכבוד') || phraseHits_(line, 'bill to') || phraseHits_(line, 'customer');
}

function noiseNameLine_(line) {
  var flat = squashExtract_(line);
  var noise = ['מקור', 'העתק', 'נאמן למקור', 'original', 'copy'];
  for (var i = 0; i < noise.length; i++) {
    if (flat === squashExtract_(noise[i])) return true;
  }
  return false;
}

function nameLikeLine_(line, phrases, idKeywords) {
  if (line.indexOf('@') >= 0) return false;
  if (dateToken_(line)) return false;
  if (docTypeLine_(line, phrases)) return false;
  if ((idKeywords || []).some(function (keyword) { return phraseHits_(line, keyword); })) return false;
  if (noiseNameLine_(line)) return false;
  if (!/[A-Za-z\u0590-\u05FF]/.test(line)) return false;
  return true;
}

function findVendorName_(lines, config, senderName) {
  var settings = config || {};
  var phrases = typedPhrases_(settings.keywords_doc_type);
  var idKeywords = settings.keywords_vendor_id || [];
  var buyerAt = lines.length;
  var i;
  for (i = 0; i < lines.length; i++) {
    if (buyerMarkerLine_(lines[i])) {
      buyerAt = i;
      break;
    }
  }
  for (i = 0; i < buyerAt; i++) {
    if (!nameLikeLine_(lines[i], phrases, idKeywords) || ownCompanyLine_(lines[i], settings)) continue;
    if (businessNameLine_(lines[i])) return lines[i].replace(/\s+/g, ' ').trim();
  }
  for (i = 0; i < buyerAt; i++) {
    if (!nameLikeLine_(lines[i], phrases, idKeywords) || ownCompanyLine_(lines[i], settings)) continue;
    return lines[i].replace(/\s+/g, ' ').trim();
  }
  var fallback = String(senderName || '').trim();
  return fallback || null;
}

function findCurrency_(text, totalLine, config) {
  var sample = String(totalLine || '') + '\n' + String(text || '');
  if (/\bUSD\b|US\$|\$/.test(sample)) return 'USD';
  if (/ש"ח|₪|\bILS\b|\bNIS\b/.test(sample)) return 'ILS';
  return config.currency_default || 'ILS';
}

/**
 * 1-based indexes of pages whose text contains a total, VAT, or document-number keyword.
 * @param {string[]} pageTexts
 * @param {Object} config
 * @return {number[]}
 */
function keywordPages(pageTexts, config) {
  var settings = config || {};
  var keywords = []
    .concat(settings.keywords_total || [])
    .concat(settings.keywords_vat || [])
    .concat(settings.keywords_doc_number || []);
  var hits = [];
  var pages = pageTexts || [];
  var i;
  var k;
  for (i = 0; i < pages.length; i++) {
    if (pages[i] == null || pages[i] === '') continue;
    var found = false;
    for (k = 0; k < keywords.length; k++) {
      if (phraseHits_(String(pages[i]), keywords[k])) {
        found = true;
        break;
      }
    }
    if (found) hits.push(i + 1);
  }
  return hits;
}

function idInText_(text, companyId) {
  var id = String(companyId || '').replace(/\D/g, '');
  if (id.length < 8) return false;
  var joined = String(text || '').replace(/(\d)[\s.\-]+(?=\d)/g, '$1');
  var at = joined.indexOf(id);
  while (at >= 0) {
    var before = at > 0 ? joined.charAt(at - 1) : '';
    var after = joined.charAt(at + id.length) || '';
    if (!/\d/.test(before) && !/\d/.test(after)) return true;
    at = joined.indexOf(id, at + 1);
  }
  return false;
}

function buyerNameOk_(text, config) {
  var settings = config || {};
  if (idInText_(text, settings.company_id)) return true;
  var folded = compactCompany_(text);
  var names = String(settings.company_name || '').split(/\n/);
  for (var i = 0; i < names.length; i++) {
    var name = compactCompany_(names[i]);
    if (name && folded.indexOf(name) >= 0) return true;
  }
  return false;
}

function knownVendor_(email, whitelist) {
  var host = String(email || '').trim().toLowerCase();
  if (!host) return false;
  var domain = host.split('@')[1] || '';
  var list = whitelist || [];
  for (var i = 0; i < list.length; i++) {
    var item = String(list[i] || '').trim().toLowerCase();
    if (!item) continue;
    if (item === host || item === domain || host.endsWith('@' + item)) return true;
  }
  return false;
}

function expectedVatFromTotal_(total, rate) {
  if (total == null || total === '') return null;
  var ratio = Number(rate);
  if (!isFinite(ratio) || ratio < 0) ratio = 0.18;
  var amount = Math.abs(Number(total));
  if (!isFinite(amount)) return null;
  return Math.round((amount * ratio / (1 + ratio)) * 100) / 100;
}

function collectKeywordAmounts_(lines, keywords, skipKeywords) {
  var found = [];
  var list = keywords || [];
  var skip = skipKeywords || [];
  var k;
  var i;
  for (k = 0; k < list.length; k++) {
    for (i = 0; i < lines.length; i++) {
      if (!phraseHits_(lines[i], list[k])) continue;
      var tail = keywordTail_(lines[i], list[k], skip);
      var amount = tail != null ? parseAmounts_(tail) : null;
      if (tail != null && amount == null) {
        var text = normalizeExtractText(lines[i]);
        var needle = normalizeExtractText(list[k]);
        var at = text.indexOf(needle);
        if (at > 0) amount = parseAmounts_(text.slice(0, at));
        if (amount == null && String(tail).trim() === '' && i + 1 < lines.length) {
          amount = parseAmounts_(lines[i + 1]);
        }
      }
      if (tail == null) {
        var sharesSkip = false;
        var s;
        for (s = 0; s < skip.length; s++) {
          if (squashExtract_(skip[s]) !== squashExtract_(list[k]) && phraseHits_(lines[i], skip[s])) sharesSkip = true;
        }
        if (sharesSkip) continue;
        amount = parseAmounts_(lines[i]);
        if (amount == null && i + 1 < lines.length) amount = parseAmounts_(lines[i + 1]);
      }
      if (amount != null) found.push(amount);
    }
  }
  return found;
}

function pickVatAmount_(candidates, total, rate, tolerance) {
  var tol = Number(tolerance);
  if (!isFinite(tol)) tol = 1;
  var usable = [];
  var list = candidates || [];
  var i;
  for (i = 0; i < list.length; i++) {
    if (total != null && Math.abs(total) > tol && Math.abs(Math.abs(list[i]) - Math.abs(total)) <= tol) continue;
    usable.push(list[i]);
  }
  if (!usable.length) return null;
  var expected = expectedVatFromTotal_(total, rate);
  if (expected == null) return usable[0];
  var best = usable[0];
  var gap = Math.abs(Math.abs(best) - expected);
  for (i = 1; i < usable.length; i++) {
    var next = Math.abs(Math.abs(usable[i]) - expected);
    if (next < gap) {
      best = usable[i];
      gap = next;
    }
  }
  return best;
}

function vatCheckPasses_(before, vat, total, rate, tolerance) {
  if (vat == null || total == null) return false;
  var tol = Number(tolerance);
  if (!isFinite(tol)) tol = 1;
  if (Math.abs(total) > tol && Math.abs(Math.abs(vat) - Math.abs(total)) <= tol) return false;
  var expected = expectedVatFromTotal_(total, rate);
  if (expected == null || Math.abs(Math.abs(vat) - expected) > tol) return false;
  if (before == null) return true;
  return Math.abs(before + vat - total) <= tol;
}

/**
 * @param {string} text
 * @param {Object} config getConfig() shape
 * @param {{senderEmail?: string, senderName?: string}=} context
 * @return {Object}
 */
function extractInvoice(text, config, context) {
  var settings = config || {};
  var meta = context || {};
  var lines = extractLines_(text);
  var before = amountForKeywords_(lines, settings.keywords_before_vat, []);
  var total = amountForKeywords_(lines, settings.keywords_total, settings.keywords_before_vat);
  var vatSkip = [].concat(settings.keywords_before_vat || [], settings.keywords_total || []);
  var vat = pickVatAmount_(
    collectKeywordAmounts_(lines, settings.keywords_vat, vatSkip),
    total,
    settings.vat_rate,
    settings.amount_tolerance
  );
  var totalIndex = firstKeywordLine_(lines, settings.keywords_total, settings.keywords_before_vat);
  var docDate = findDate_(lines, settings);
  var vendorId = findVendorId_(lines, settings);
  var fields = {
    vendor_name: findVendorName_(lines, settings, meta.senderName),
    vendor_id: vendorId,
    doc_type: findDocType_(text, settings),
    doc_number: findDocNumber_(lines, settings),
    doc_date: docDate,
    amount_before_vat: before,
    vat_amount: vat,
    total: total,
    currency: findCurrency_(text, totalIndex >= 0 ? lines[totalIndex] : '', settings),
    allocation_number: findAllocation_(lines, settings),
    buyer_name_ok: buyerNameOk_(text, settings)
  };
  var score = 0;
  if (fields.total != null) score += 0.25;
  if (docDate && inCollectMonth_(docDate, settings.month)) score += 0.2;
  if (fields.doc_number) score += 0.15;
  if (fields.vendor_id) score += 0.15;
  if (vatCheckPasses_(before, vat, total, settings.vat_rate, settings.amount_tolerance)) score += 0.15;
  if (knownVendor_(meta.senderEmail, settings.vendor_whitelist)) score += 0.1;
  fields.confidence = Math.round(score * 100) / 100;
  return fields;
}

function moneyClose_(left, right, tolerance) {
  var tol = Number(tolerance);
  if (!isFinite(tol)) tol = 1;
  return Math.abs(left - right) <= tol;
}

/**
 * @param {Object} fields extractInvoice() result
 * @param {Object} config
 * @param {Array<Object>=} existing rows already stored; same vendor_id + doc_number is a duplicate
 * @return {{status: string, reasons: string[]}}
 */
/**
 * Order confirmation or subscription mail that never becomes an invoice.
 * @return {{status: string, notes: string}|null}
 */
function noticeWithoutInvoice(text) {
  var sample = String(text || '');
  var notice =
    phraseHits_(sample, 'order confirmation') ||
    phraseHits_(sample, 'subscription') ||
    phraseHits_(sample, 'renews') ||
    phraseHits_(sample, 'renewal') ||
    phraseHits_(sample, 'payment') ||
    phraseHits_(sample, 'הזמנה');
  var invoice =
    phraseHits_(sample, 'חשבונית') ||
    phraseHits_(sample, 'קבלה') ||
    phraseHits_(sample, 'invoice') ||
    phraseHits_(sample, 'receipt');
  if (!notice || invoice) return null;
  return { status: 'NOT_INVOICE', notes: 'check for invoice' };
}

function classifyInvoice(fields, config, existing) {
  var settings = config || {};
  var doc = fields || {};
  var reasons = [];
  if (doc.doc_type === 'not_invoice') {
    return { status: 'NOT_INVOICE', reasons: ['not an invoice'] };
  }
  if (duplicateInvoice_(doc, existing)) {
    return { status: 'DUPLICATE', reasons: ['same vendor id and document number'] };
  }
  if (!doc.doc_type) reasons.push('document type was not found');
  var before = doc.amount_before_vat;
  var vat = doc.vat_amount;
  var total = doc.total;
  var rate = Number(settings.vat_rate);
  if (!isFinite(rate)) rate = 0.18;
  if (before != null && vat != null && total != null) {
    if (!moneyClose_(before + vat, total, settings.amount_tolerance)) {
      reasons.push('total does not equal amount before VAT plus VAT');
    }
  } else if (total != null && (before == null || vat == null)) {
    reasons.push('VAT breakdown was not found');
  } else if (total == null) {
    reasons.push('total was not found');
  }
  var tol = Number(settings.amount_tolerance);
  if (!isFinite(tol)) tol = 1;
  if (vat != null && total != null && Math.abs(total) > tol && moneyClose_(Math.abs(vat), Math.abs(total), tol)) {
    reasons.push('VAT equals total');
  }
  var expectedVat = expectedVatFromTotal_(total, rate);
  if (vat != null && expectedVat != null && !moneyClose_(Math.abs(vat), expectedVat, tol)) {
    reasons.push('VAT is not the configured rate');
  }
  if (doc.doc_type === 'receipt') reasons.push('not valid for VAT deduction alone');
  var allocationAt = settings.allocation_threshold;
  var taxable = doc.doc_type === 'tax_invoice' || doc.doc_type === 'tax_invoice_receipt';
  if (allocationAt != null && total != null && taxable && Math.abs(total) >= Number(allocationAt) && !doc.allocation_number) {
    reasons.push('missing allocation number');
  }
  var minimum = Number(settings.confidence_threshold);
  if (!isFinite(minimum)) minimum = 0.7;
  if (!(Number(doc.confidence) >= minimum)) reasons.push('low confidence');
  if (reasons.length) return { status: 'REVIEW', reasons: reasons };
  return { status: 'OK', reasons: [] };
}

function duplicateInvoice_(fields, existing) {
  if (!fields || !fields.vendor_id || !fields.doc_number) return false;
  var rows = existing || [];
  for (var i = 0; i < rows.length; i++) {
    if (!rows[i]) continue;
    if (String(rows[i].vendor_id || '') === String(fields.vendor_id) && String(rows[i].doc_number || '') === String(fields.doc_number)) {
      return true;
    }
  }
  return false;
}

if (typeof module !== 'undefined') {
  module.exports = {
    EXTRACT_VERSION: EXTRACT_VERSION,
    normalizeExtractText: normalizeExtractText,
    extractInvoice: extractInvoice,
    keywordPages: keywordPages,
    noticeWithoutInvoice: noticeWithoutInvoice,
    classifyInvoice: classifyInvoice
  };
}
