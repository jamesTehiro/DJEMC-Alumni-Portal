import programs from "../../../../backend/config/academicPrograms.json";
export { programs };
const key = value => String(value || "").trim().toLowerCase();
export const findProgram = course => programs.find(p => [p.value, p.label, ...p.aliases].some(v => key(v) === key(course)));
export const programLabel = course => findProgram(course)?.label || String(course || "").trim() || "Not recorded";
export const programKey = course => findProgram(course)?.value || String(course || "").trim();
export const academicLabel = (course, major, year) => [programLabel(course) + (major ? ` — ${major}` : ""), year ? `Batch ${year}` : ""].filter(Boolean).join(" · ");
// Take official academic fields together; never borrow a different program's major.
export const academicInfo = user => {
    const record = user?.AlumniRecord || user?.alumniRecord;
    const profile = user?.AlumniProfile || user?.alumniProfile;
    if (record?.course) return { course: record.course, major: record.major || "", year: record.batch_year };
    return { course: profile?.course || user?.course || "", major: profile?.course ? profile.major || "" : user?.major || "", year: profile?.graduation_year || user?.graduation_year };
};
