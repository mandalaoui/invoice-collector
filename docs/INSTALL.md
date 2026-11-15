# Install Invoice Collector

One Google Workspace user runs this inside the company account. Client names, ids, and emails stay in the Settings tab. The script does not send the accountant email. It only creates a Gmail draft.

## Admin, once

1. Admin console → **Apps → Google Workspace → Drive and Docs → Google Apps Script**. Turn Apps Script **on** for the people who will run it.
2. Admin console → **Apps → Google Workspace Marketplace apps → Settings**. Allow users to install **internal** apps.

## Advanced Drive service

In the Apps Script editor, open **Services** (the plus next to Services) and add **Drive API**. Set the identifier to `Drive` and the version to **v2**. A project pushed from this repo already has that service in `appsscript.json`. Leave it on. The script uses it to read scans. It does not send files out of the company Drive.

## First run

1. Open the spreadsheet named **Invoice Collector**. If it is not there yet, in the editor run `install` once and authorize Sheets, Drive, and Gmail.
2. Reload the sheet. Use the menu **Invoice Collector → Install**.
3. When owner or accountant is empty, Install asks for those two addresses and nothing else. Put the company name, company id, and month in Settings yourself.
4. Install creates the tabs, the default Settings rows, the Gmail labels `invoices/processed` and `invoices/review`, and a My Drive folder named `Invoices`. Run it again: it keeps existing rows, labels, and that folder.

## After install

- **Test run (draft to me)** uses at most 3 documents. The draft is addressed to you. Nothing is sent. The file is `__test_run_YYYY-MM.pdf`. `YYYY-MM_merged.pdf` is left as it is.
- **Run this month** builds the full pack and a draft to the accountant. A person sends that draft. If the run fails, the error mail goes only to the owner.
- **Turn monthly trigger on** runs on day 2 at 08:00, Asia/Jerusalem. **Turn monthly trigger off** removes it.

The copy that a client uses does not include the `dev` test functions. Those stay on the development account.
