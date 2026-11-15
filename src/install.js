/**
 * First install: sheet, Settings defaults, Gmail labels, Drive folder.
 * The only questions are owner_email and accountant_email, and only when empty.
 */

var INSTALL_FOLDER_NAME = 'Invoices';
var INSTALL_EMAIL_KEYS = ['owner_email', 'accountant_email'];

function isInstallEmail_(value) {
  var text = String(value || '').trim();
  if (text.indexOf('@') < 1) return false;
  if (/\s/.test(text)) return false;
  return true;
}

/**
 * @param {Object} config
 * @return {string[]} owner_email and accountant_email when the saved value is not an email
 */
function installPromptKeys(config) {
  var source = config || {};
  var needed = [];
  for (var i = 0; i < INSTALL_EMAIL_KEYS.length; i++) {
    var key = INSTALL_EMAIL_KEYS[i];
    if (!isInstallEmail_(source[key])) needed.push(key);
  }
  return needed;
}

/**
 * Keeps the current address when the answer is blank.
 * @param {string} current
 * @param {string} answer
 * @return {string}
 */
function applyInstallEmail(current, answer) {
  var next = String(answer == null ? '' : answer).trim();
  if (!next) return String(current || '').trim();
  if (!isInstallEmail_(next)) throw new Error('email is not valid');
  return next;
}

/**
 * @param {Object} config
 * @return {string[]}
 */
function installLabelNames(config) {
  var source = config || {};
  var raw = [
    source.processed_label || 'invoices/processed',
    source.review_label || 'invoices/review'
  ];
  var names = [];
  var seen = {};
  for (var i = 0; i < raw.length; i++) {
    var name = String(raw[i] || '').trim();
    if (!name || seen[name]) continue;
    seen[name] = true;
    names.push(name);
  }
  return names;
}

function installEmailPrompt_(key) {
  if (key === 'owner_email') return 'Owner email (errors only)';
  if (key === 'accountant_email') return 'Accountant email (draft only)';
  throw new Error('Install does not ask for ' + key);
}

function writeInstallEmail_(key, value) {
  if (INSTALL_EMAIL_KEYS.indexOf(key) < 0) throw new Error('Install does not write ' + key);
  var sheet = openCollectorSpreadsheet_().getSheetByName('Settings');
  if (!sheet) throw new Error('Settings tab is missing. Run install().');
  var values = sheet.getDataRange().getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() !== key) continue;
    sheet.getRange(i + 1, 2).setValue(value);
    return value;
  }
  throw new Error('Settings is missing ' + key);
}

function promptInstallEmails_(needed) {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (error) {
    throw new Error('Open the Invoice Collector sheet and run Install from the menu.');
  }
  var asked = [];
  var config = getConfig();
  for (var i = 0; i < needed.length; i++) {
    var key = needed[i];
    var response = ui.prompt(
      installEmailPrompt_(key),
      'Install asks only for this address. Nothing is sent.',
      ui.ButtonSet.OK_CANCEL
    );
    if (response.getSelectedButton() !== ui.Button.OK) throw new Error('Install cancelled');
    var email = applyInstallEmail(config[key], response.getResponseText());
    if (!isInstallEmail_(email)) throw new Error(key + ' is empty');
    writeInstallEmail_(key, email);
    asked.push(key);
  }
  return asked;
}

function ensureGmailLabel_(name) {
  var existing = GmailApp.getUserLabelByName(name);
  if (existing) return { name: name, created: false };
  GmailApp.createLabel(name);
  return { name: name, created: true };
}

function ensureInvoicesRoot_() {
  var root = DriveApp.getRootFolder();
  var found = root.getFoldersByName(INSTALL_FOLDER_NAME);
  if (found.hasNext()) return { id: found.next().getId(), created: false, name: INSTALL_FOLDER_NAME };
  var created = root.createFolder(INSTALL_FOLDER_NAME);
  return { id: created.getId(), created: true, name: INSTALL_FOLDER_NAME };
}

function ensureMenuTrigger_(ss) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'onOpen') return { action: 'kept' };
  }
  ScriptApp.newTrigger('onOpen').forSpreadsheet(ss).onOpen().create();
  return { action: 'created' };
}

/**
 * Creates tabs, default Settings, both Gmail labels, and My Drive/Invoices.
 * A second run adds nothing that already exists.
 * @return {Object}
 */
function install() {
  var ss = openOrCreateCollectorSpreadsheet_();
  writeCollectorTabs_(ss);
  var config = getConfig();
  var needed = installPromptKeys(config);
  var prompted = needed.length ? promptInstallEmails_(needed) : [];
  var names = installLabelNames(getConfig());
  var labels = [];
  for (var i = 0; i < names.length; i++) labels.push(ensureGmailLabel_(names[i]));
  var folder = ensureInvoicesRoot_();
  var trigger = ensureMenuTrigger_(ss);
  Logger.log(ss.getUrl());
  return {
    url: ss.getUrl(),
    prompted: prompted,
    labels: labels,
    folder: folder,
    trigger: trigger
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    INSTALL_FOLDER_NAME: INSTALL_FOLDER_NAME,
    INSTALL_EMAIL_KEYS: INSTALL_EMAIL_KEYS,
    isInstallEmail_: isInstallEmail_,
    installPromptKeys: installPromptKeys,
    applyInstallEmail: applyInstallEmail,
    installLabelNames: installLabelNames,
    installEmailPrompt_: installEmailPrompt_
  };
}
