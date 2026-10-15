const parseTargetGraduationYear = (value) => {
    const input = String(value ?? "").trim();
    if (!input) return { valid: true, range: null };

    const match = /^(\d{4})(?:\s*-\s*(\d{4}))?$/.exec(input);
    if (!match) return { valid: false, range: null };

    const years = [Number(match[1]), Number(match[2] || match[1])];
    return { valid: true, range: [Math.min(...years), Math.max(...years)] };
};

const graduationYearWhere = (range, Sequelize) => {
    if (!range) return null;
    if (range[0] === range[1]) return range[0];
    return { [Sequelize.Op.between]: range };
};

module.exports = { parseTargetGraduationYear, graduationYearWhere };
