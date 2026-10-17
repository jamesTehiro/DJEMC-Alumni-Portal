export const MIN_GRADUATION_YEAR = 1885;
export const getMaxGraduationYear = () => new Date().getFullYear();
export const getGraduationYearError = () => `Graduation year must be between ${MIN_GRADUATION_YEAR} and ${getMaxGraduationYear()}.`;
export const isValidGraduationYear = (value, maxYear = getMaxGraduationYear()) => ["string", "number"].includes(typeof value) && /^\d{4}$/.test(String(value)) && Number(value) >= MIN_GRADUATION_YEAR && Number(value) <= maxYear;
