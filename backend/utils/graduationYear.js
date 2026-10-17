const MIN_GRADUATION_YEAR = 1885;
const getMaxGraduationYear = () => new Date().getFullYear();
const getGraduationYearError = () => `Graduation year must be between ${MIN_GRADUATION_YEAR} and ${getMaxGraduationYear()}.`;
const isValidGraduationYear = (value, maxYear = getMaxGraduationYear()) => ["string", "number"].includes(typeof value) && /^\d{4}$/.test(String(value)) && Number(value) >= MIN_GRADUATION_YEAR && Number(value) <= maxYear;
module.exports = { isValidGraduationYear, getGraduationYearError, getMaxGraduationYear, MIN_GRADUATION_YEAR };
