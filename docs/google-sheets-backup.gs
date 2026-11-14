/**
 * Karmify → Google Sheets daily backup.
 *
 * Paste this whole file into the Sheet (Extensions → Apps Script), then follow
 * docs/google-sheets-backup.md. Karmify posts each day's orders and the full
 * customer list here:
 *   - "Orders" tab: one row per order. Sending a day again replaces that
 *     day's rows, so nothing is ever duplicated.
 *   - "Customers" tab: rewritten with every customer each time.
 *   - "Backup log" tab: one line per backup received.
 *
 * The secret lives in Project Settings → Script properties as BACKUP_SECRET
 * and must equal SHEETS_BACKUP_SECRET in Karmify.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    var data = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty("BACKUP_SECRET");
    if (!secret || data.secret !== secret) return reply({ ok: false, error: "Wrong or missing secret." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date || "")) return reply({ ok: false, error: "Missing date." });

    var book = SpreadsheetApp.getActiveSpreadsheet();
    writeOrders(book, data.date, data.orderColumns, data.orders || []);
    writeCustomers(book, data.customerColumns, data.customers || []);
    sheet(book, "Backup log", ["Received", "Day", "Orders", "Customers"])
      .appendRow([new Date(), data.date, (data.orders || []).length, (data.customers || []).length]);

    return reply({ ok: true, date: data.date, orders: (data.orders || []).length });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/** Replaces the given day's rows in "Orders" (column A holds the date) with the new ones. */
function writeOrders(book, date, columns, rows) {
  var tab = sheet(book, "Orders", columns);
  var last = tab.getLastRow();
  if (last > 1) {
    var dates = tab.getRange(2, 1, last - 1, 1).getDisplayValues();
    // Delete from the bottom up so row numbers stay valid; runs of rows go in one call.
    for (var i = dates.length - 1; i >= 0; i--) {
      if (dates[i][0] !== date) continue;
      var end = i;
      while (i - 1 >= 0 && dates[i - 1][0] === date) i--;
      tab.deleteRows(i + 2, end - i + 1);
    }
  }
  if (rows.length) {
    // Keep dates and IDs as text, so Sheets doesn't reformat them.
    var start = tab.getLastRow() + 1;
    tab.getRange(start, 1, rows.length, columns.length).setNumberFormat("@").setValues(rows);
    var money = ["Goods", "Discount", "Delivery", "Total", "COD", "Units"];
    money.forEach(function (name) {
      var col = columns.indexOf(name) + 1;
      if (col > 0) {
        var range = tab.getRange(start, col, rows.length, 1);
        range.setNumberFormat(name === "Units" ? "0" : "#,##0.00");
        range.setValues(rows.map(function (r) { return [Number(r[col - 1]) || 0]; }));
      }
    });
    // Oldest day first.
    if (tab.getLastRow() > 2) tab.getRange(2, 1, tab.getLastRow() - 1, columns.length).sort([{ column: 1, ascending: true }, { column: 2, ascending: true }]);
  }
}

/** Rewrites "Customers" with the full list. */
function writeCustomers(book, columns, rows) {
  var tab = sheet(book, "Customers", columns);
  if (tab.getLastRow() > 1) tab.getRange(2, 1, tab.getLastRow() - 1, tab.getMaxColumns()).clearContent();
  if (rows.length) {
    tab.getRange(2, 1, rows.length, columns.length).setNumberFormat("@").setValues(rows);
    ["Orders", "Spent", "Website orders", "Returns", "Cancelled"].forEach(function (name) {
      var col = columns.indexOf(name) + 1;
      if (col > 0) {
        tab.getRange(2, col, rows.length, 1)
          .setNumberFormat(name === "Spent" ? "#,##0.00" : "0")
          .setValues(rows.map(function (r) { return [Number(r[col - 1]) || 0]; }));
      }
    });
  }
}

/** The named tab, created with a bold, frozen header row if it's missing. */
function sheet(book, name, columns) {
  var tab = book.getSheetByName(name) || book.insertSheet(name);
  if (tab.getLastRow() === 0 || tab.getRange(1, 1).getValue() !== columns[0]) {
    tab.getRange(1, 1, 1, columns.length).setValues([columns]).setFontWeight("bold");
    tab.setFrozenRows(1);
  }
  return tab;
}

function reply(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
