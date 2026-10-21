const programs = require("../config/academicPrograms.json");
const key = value => String(value || "").trim().toLowerCase();
const findProgram = course => programs.find(p => [p.value, p.label, ...p.aliases].some(v => key(v) === key(course)));
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };

// Display names never rewrite stored abbreviations or historical program names.
function validateAcademicProgram(course, major, { previous, required = true } = {}) {
    if (course != null && typeof course !== "string") fail("Program must be text.");
    if (major != null && typeof major !== "string") fail("Major / Specialization must be text.");
    const clean = { course: String(course || "").trim(), major: String(major || "").trim() || null };
    if ((required || clean.major) && !clean.course) fail("Program is required.");
    if (clean.course.length > 255 || (clean.major || "").length > 255) fail("Program and Major / Specialization must be at most 255 characters.");
    if (/[\x00-\x1f\x7f]/.test(clean.course + (clean.major || ""))) fail("Program and Major / Specialization cannot contain control characters.");
    // Unchanged historical records, including majorless BSBA/BSED, remain editable.
    if (previous && clean.course === String(previous.course || "").trim() && clean.major === (String(previous.major || "").trim() || null)) return clean;
    const program = findProgram(clean.course);
    if (program?.majors.length && !program.majors.includes(clean.major)) fail(`Choose a valid Major / Specialization for ${program.label}: ${program.majors.join(", ")}.`);
    if (program && !program.majors.length && clean.major) fail(`${program.label} has no configured Major / Specialization. Clear the major.`);
    return clean;
}
module.exports = { programs, findProgram, validateAcademicProgram };
