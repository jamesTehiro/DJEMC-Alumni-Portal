const MIN_GRADUATION_YEAR = 2023;
const MAX_GRADUATION_YEAR = 2027;
const GRADUATION_YEAR_ERROR = `Graduation year must be between ${MIN_GRADUATION_YEAR} and ${MAX_GRADUATION_YEAR}.`;
const isValidGraduationYear = value => ["string", "number"].includes(typeof value) && /^\d{4}$/.test(String(value)) && Number(value) >= MIN_GRADUATION_YEAR && Number(value) <= MAX_GRADUATION_YEAR;
module.exports = { isValidGraduationYear, GRADUATION_YEAR_ERROR };
