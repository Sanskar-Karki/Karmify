type Cell = string | number | null | undefined;

function encodeCell(cell: Cell) {
  const text = cell === null || cell === undefined ? "" : String(cell);
  // A leading =, +, - or @ makes a spreadsheet run the cell as a formula, and
  // customer names and addresses arrive from a public website form.
  // Plain numbers such as +977 phone numbers are harmless and stay untouched.
  const isFormula = typeof cell === "string" && /^[=+\-@\t\r]/.test(text) && !/^[+-]?[\d\s().-]+$/.test(text);
  const safe = isFormula ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function downloadCsv(filename: string, header: string[], rows: Cell[][]) {
  const csv = [header, ...rows].map(row => row.map(encodeCell).join(",")).join("\r\n");
  // The byte-order mark makes Excel read Nepali text as UTF-8.
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
