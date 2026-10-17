const { Op, fn, col, where } = require("sequelize");
const nameTokens = value => String(value || "").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
const tolerantNameWhere = value => {
    const tokens = nameTokens(value).filter(token => token.length > 1);
    return tokens.length ? { [Op.and]: tokens.map(token => where(fn("LOWER", col("AlumniRecord.full_name")), { [Op.like]: `%${token}%` })) } : null;
};
module.exports = { nameTokens, tolerantNameWhere };
