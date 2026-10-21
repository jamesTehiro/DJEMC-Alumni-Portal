const { TextDecoder } = require("node:util");
const { validateAcademicProgram } = require("./academicPrograms");

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_CSV_ROWS = 1000;
const ALLOWED_COLUMNS = ["full_name", "course", "batch_year", "student_id", "email", "major"];
const normalizeKey = (value) => String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const recordKey = (record) => JSON.stringify([normalizeKey(record.full_name), normalizeKey(record.course), Number(record.batch_year)]);

function csvError(message, status = 400) {
    return Object.assign(new Error(message), { status });
}

// Quoted commas, escaped quotes and embedded newlines are supported. Uploads
// never reach the filesystem; the size and record limits bound parsing work.
function parseCsv(buffer) {
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw csvError("Choose a non-empty CSV file.");
    if (buffer.length > MAX_CSV_BYTES) throw csvError("CSV files must be 2 MB or smaller.", 413);
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer).replace(/^\uFEFF/, ""); }
    catch { throw csvError("Save the CSV using UTF-8 encoding and try again."); }
    if (text.includes("\0")) throw csvError("The CSV contains invalid binary content.");

    const rows = [];
    let cells = [], value = "", state = "plain", line = 1, rowLine = 1;
    const endCell = () => { cells.push(value); value = ""; state = "plain"; };
    const endRow = () => {
        endCell();
        if (cells.some((cell) => cell.trim())) rows.push({ row: rowLine, cells });
        if (rows.length > MAX_CSV_ROWS + 1) throw csvError(`Import at most ${MAX_CSV_ROWS} records at a time.`);
        cells = [];
    };
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (state === "quoted") {
            if (char === '"') {
                if (text[index + 1] === '"') { value += '"'; index += 1; }
                else state = "closed";
            } else {
                value += char;
                if (char === "\n" || (char === "\r" && text[index + 1] !== "\n")) line += 1;
            }
        } else if (char === ",") {
            endCell();
            if (cells.length >= ALLOWED_COLUMNS.length) throw csvError(`Too many CSV columns on line ${rowLine}.`);
        } else if (char === "\r" || char === "\n") {
            endRow();
            if (char === "\r" && text[index + 1] === "\n") index += 1;
            line += 1;
            rowLine = line;
        } else if (char === '"') {
            if (state !== "plain" || value.length) throw csvError(`Unexpected quote on line ${line}.`);
            state = "quoted";
        } else {
            if (state === "closed") throw csvError(`Unexpected text after a closing quote on line ${line}.`);
            value += char;
        }
    }
    if (state === "quoted") throw csvError(`Unclosed quoted field on line ${rowLine}.`);
    if (value.length || cells.length || state === "closed") endRow();
    if (rows.length < 2) throw csvError("The CSV must contain a header and at least one alumni record.");
    const headers = rows.shift().cells.map((header) => header.trim().toLowerCase());
    if (new Set(headers).size !== headers.length) throw csvError("The CSV contains duplicate column headers.");
    if (headers.some((header) => !ALLOWED_COLUMNS.includes(header))) throw csvError(`Allowed headers: ${ALLOWED_COLUMNS.join(", ")}.`);
    if (["full_name", "course", "batch_year"].some((header) => !headers.includes(header))) throw csvError("Required CSV headers: full_name, course, batch_year.");
    return { headers, rows };
}

function validateCsv(parsed, { deferAcademicValidation = false } = {}) {
    const validRows = [], issues = [];
    const latestYear = new Date().getFullYear() + 1;
    for (const row of parsed.rows) {
        const problems = [];
        if (row.cells.length !== parsed.headers.length) problems.push("The number of values does not match the header.");
        const record = Object.fromEntries(parsed.headers.map((header, index) => [header, String(row.cells[index] || "").normalize("NFC").trim()]));
        for (const field of ["full_name", "course"]) if (!record[field]) problems.push(`${field} is required.`);
        for (const [field, value] of Object.entries(record)) {
            if (value.length > 255) problems.push(`${field} must be at most 255 characters.`);
            if (/[\x00-\x1f\x7f]/.test(value)) problems.push(`${field} cannot contain control characters or line breaks.`);
            if (/^[=+@-]/.test(value)) problems.push(`${field} must contain plain text, not a spreadsheet formula.`);
        }
        if (!/^\d{4}$/.test(record.batch_year) || Number(record.batch_year) < 1900 || Number(record.batch_year) > latestYear) problems.push(`batch_year must be a year between 1900 and ${latestYear}.`);
        if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) problems.push("email is invalid.");
        try { if (!deferAcademicValidation) Object.assign(record, validateAcademicProgram(record.course, record.major)); }
        catch (error) { problems.push(error.message); }
        if (problems.length) {
            issues.push({ row: row.row, kind: "invalid", message: problems.join(" ") });
        } else {
            validRows.push({ row: row.row, record: { full_name: record.full_name, course: record.course, major: record.major || null, batch_year: Number(record.batch_year), student_id: record.student_id || null, email: record.email?.toLowerCase() || null } });
        }
    }
    return { validRows, issues };
}

function classifyDuplicates(validRows, existingRecords) {
    const names = new Set(existingRecords.map(recordKey));
    const students = new Set(existingRecords.filter((record) => record.student_id).map((record) => normalizeKey(record.student_id)));
    const emails = new Set(existingRecords.filter((record) => record.email).map((record) => normalizeKey(record.email)));
    const accepted = [], issues = [];
    for (const row of validRows) {
        const record = row.record;
        if (names.has(recordKey(record)) || (record.student_id && students.has(normalizeKey(record.student_id))) || (record.email && emails.has(normalizeKey(record.email)))) {
            issues.push({ row: row.row, kind: "duplicate", message: "An alumni record with this student ID, email, or name/program/batch already exists in the database or this CSV. This row will be skipped." });
            continue;
        }
        accepted.push(row);
        names.add(recordKey(record));
        if (record.student_id) students.add(normalizeKey(record.student_id));
        if (record.email) emails.add(normalizeKey(record.email));
    }
    return { accepted, issues };
}

module.exports = { MAX_CSV_BYTES, MAX_CSV_ROWS, parseCsv, validateCsv, classifyDuplicates, csvError };
