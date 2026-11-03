const categories = { employed: 'employed', unemployed: 'unemployed', 'self-employed': 'selfEmployed' };
const normalizeEmploymentStatus = value => {
    if (typeof value !== 'string') return null;
    const normalized = value.normalize('NFKC').trim().toLowerCase()
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .replace(/\s*[-_]+\s*/g, '-').replace(/\s+/g, ' ');
    return normalized === 'self employed' || normalized === 'selfemployed' ? 'self-employed'
        : Object.hasOwn(categories, normalized) ? normalized : null;
};
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;

function graduateEmploymentMetrics(masterRecords) {
    const counts = { employed: 0, unemployed: 0, selfEmployed: 0 };
    const graduates = new Set(), alumni = new Set();
    for (const record of masterRecords) {
        // These accounts are joined by users.alumni_record_id, never by names,
        // email guesses, employment history, or unrelated profile records.
        const graduateId = validId(record.id), alumniId = validId(record.User?.id);
        if (!graduateId || !alumniId || graduates.has(graduateId) || alumni.has(alumniId)) continue;
        graduates.add(graduateId); alumni.add(alumniId);
        const status = normalizeEmploymentStatus(record.User?.AlumniProfile?.employment_status);
        if (status) counts[categories[status]]++;
    }
    return counts;
}
module.exports = { graduateEmploymentMetrics, normalizeEmploymentStatus };
