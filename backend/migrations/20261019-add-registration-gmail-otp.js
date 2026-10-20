"use strict";
const { EMAIL_KEY_SQL } = require("../utils/registrationEmail");
const table = "registration_email_verifications";
const indexName = "users_normalized_email_uq";

// MySQL 8 may render stored generated expressions with redundant grouping,
// LCASE for LOWER, _utf8mb4 introducers, and escaped quote delimiters. Parse
// the small expression grammar used by EMAIL_KEY_SQL instead of deleting all
// punctuation: removing every parenthesis can make different expressions look
// alike. The resulting AST preserves function/argument/operator structure and
// literal values while normalizing only those MySQL representation changes.
function expressionTokens(expression) {
    if (typeof expression !== "string" || !expression.trim()) return null;
    const tokens = [];
    let i = 0;
    while (i < expression.length) {
        if (/\s/.test(expression[i])) { i++; continue; }

        const charset = /^_utf8mb4/i.exec(expression.slice(i));
        if (charset) {
            const after = i + charset[0].length;
            if (expression[after] === "'" || (expression[after] === "\\" && expression[after + 1] === "'")) {
                i = after;
                continue;
            }
            return null;
        }

        if (expression[i] === "'" || (expression[i] === "\\" && expression[i + 1] === "'")) {
            const escapedDelimiter = expression[i] === "\\";
            const delimiter = escapedDelimiter ? "\\'" : "'";
            const start = i + delimiter.length;
            const end = expression.indexOf(delimiter, start);
            if (end < 0) return null;
            const value = expression.slice(start, end);
            // The canonical expression contains simple ASCII literals only.
            // Reject inner escapes rather than guessing how sql_mode decoded them.
            if (value.includes("\\") || (!escapedDelimiter && value.includes("'"))) return null;
            tokens.push({ type: "string", value });
            i = end + delimiter.length;
            continue;
        }

        if (expression[i] === "`") {
            const end = expression.indexOf("`", i + 1);
            if (end < 0 || expression.slice(i + 1, end).includes("``")) return null;
            tokens.push({ type: "identifier", value: expression.slice(i + 1, end).toLowerCase() });
            i = end + 1;
            continue;
        }
        const number = /^\d+/.exec(expression.slice(i));
        if (number) {
            tokens.push({ type: "number", value: BigInt(number[0]).toString() });
            i += number[0].length;
            continue;
        }
        const identifier = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(expression.slice(i));
        if (identifier) {
            tokens.push({ type: "identifier", value: identifier[0].toLowerCase() });
            i += identifier[0].length;
            continue;
        }
        if ("(),-".includes(expression[i])) {
            tokens.push({ type: expression[i], value: expression[i] });
            i++;
            continue;
        }
        return null;
    }
    return tokens;
}

function canonicalExpression(expression) {
    const tokens = expressionTokens(expression);
    if (!tokens) return null;
    let position = 0;
    const peek = value => tokens[position]?.value === value;
    const take = value => {
        if (!peek(value)) throw new Error("Unexpected expression token");
        return tokens[position++];
    };
    const parsePrimary = () => {
        if (peek("-")) {
            take("-");
            const operand = parsePrimary();
            return operand[0] === "number" ? ["number", (-BigInt(operand[1])).toString()] : ["negate", operand];
        }
        if (peek("(")) {
            take("(");
            const grouped = parseExpression();
            take(")");
            return grouped;
        }
        const token = tokens[position++];
        if (!token) throw new Error("Missing expression value");
        if (token.type === "string") return ["string", token.value];
        if (token.type === "number") return ["number", token.value];
        if (token.type !== "identifier") throw new Error("Unexpected expression value");
        if (token.value === "case") {
            const branches = [];
            while (peek("when")) {
                take("when");
                const condition = parseExpression();
                take("then");
                branches.push([condition, parseExpression()]);
            }
            take("else");
            const otherwise = parseExpression();
            take("end");
            return ["case", branches, otherwise];
        }
        const name = token.value === "lcase" ? "lower" : token.value;
        if (!peek("(")) return ["identifier", name];
        take("(");
        const args = [];
        if (!peek(")")) {
            do {
                args.push(parseExpression());
                if (!peek(",")) break;
                take(",");
            } while (true);
        }
        take(")");
        return ["call", name, args];
    };
    const parseExpression = () => {
        let expressionNode = parsePrimary();
        if (peek("in")) {
            take("in");
            take("(");
            const values = [];
            do {
                values.push(parseExpression());
                if (!peek(",")) break;
                take(",");
            } while (true);
            take(")");
            expressionNode = ["in", expressionNode, values];
        }
        return expressionNode;
    };
    try {
        const ast = parseExpression();
        return position === tokens.length ? JSON.stringify(ast) : null;
    } catch {
        return null;
    }
}

const isEmailKeyExpression = expression => canonicalExpression(expression) === canonicalExpression(EMAIL_KEY_SQL);

async function inspect(qi, Sequelize) {
    const columns = await qi.describeTable("users");
    if (!columns.email) throw new Error("users.email is missing. Check the intended database; no changes applied.");
    if (columns.email_verified_at && (!/^DATETIME(?:\(\d+\))?$/i.test(columns.email_verified_at.type) || !columns.email_verified_at.allowNull)) throw new Error("Existing email_verified_at must be nullable DATETIME. Review reuse without altering existing values.");
    const duplicates = await qi.sequelize.query(`SELECT COUNT(*) AS duplicate_groups FROM (SELECT ${EMAIL_KEY_SQL} AS email_key FROM users WHERE email IS NOT NULL GROUP BY email_key HAVING COUNT(*) > 1) collisions`, { type: Sequelize.QueryTypes.SELECT });
    const generated = await qi.sequelize.query("SELECT GENERATION_EXPRESSION AS expression, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'normalized_email'", { type: Sequelize.QueryTypes.SELECT });
    if (columns.normalized_email && (!/^VARCHAR\(255\)$/i.test(columns.normalized_email.type) || !/VIRTUAL GENERATED/i.test(generated[0]?.extra || "") || !isEmailKeyExpression(generated[0]?.expression)))
        throw new Error("Existing users.normalized_email has an unexpected definition. Manual schema review required.");
    const indexes = await qi.showIndex("users");
    const fullUnique = index => index.unique && index.fields.length === 1 && index.fields[0].attribute === "normalized_email" && !index.fields[0].length;
    if (indexes.some(index => index.name === indexName && !fullUnique(index))) throw new Error("Unexpected normalized email index definition. Manual review required.");
    const tables = await qi.showAllTables();
    const otherVerificationTables = tables.map(value => typeof value === "string" ? value : value.tableName)
        .filter(name => name !== table && /(?:email.*verif|verif.*email|registration.*otp|otp.*registration)/i.test(name));
    const tablePresent = tables.some(value => (typeof value === "string" ? value : value.tableName) === table);
    if (tablePresent) {
        const existing = await qi.describeTable(table);
        const expected = require("../models/RegistrationEmailVerification");
        // Model metadata only; this does not synchronize or query records.
        const model = expected(new Sequelize.Sequelize("", "", "", { dialect: "mysql", logging: false }), Sequelize);
        if (Object.keys(model.rawAttributes).some(field => !existing[field])) throw new Error("Existing registration verification table is incomplete. Manual schema review required.");
        if (!existing.email_key.primaryKey || existing.email_key.type.toUpperCase() !== "VARCHAR(254)") throw new Error("Unexpected registration verification primary key.");
        const otpIndexes = await qi.showIndex(table);
        if (!otpIndexes.some(index => index.unique && index.fields.length === 1 && index.fields[0].attribute === "session_hash" && !index.fields[0].length)) throw new Error("Registration session uniqueness is missing. Review the existing table before reuse.");
    }
    const [normalized] = await qi.sequelize.query("SELECT COUNT(*) AS duplicate_groups FROM (SELECT LOWER(TRIM(email)) AS email_key FROM users WHERE email IS NOT NULL GROUP BY email_key HAVING COUNT(*) > 1) collisions", { type: Sequelize.QueryTypes.SELECT });
    const [raw] = await qi.sequelize.query("SELECT COUNT(*) AS duplicate_groups FROM (SELECT email FROM users WHERE email IS NOT NULL GROUP BY email HAVING COUNT(*) > 1) collisions", { type: Sequelize.QueryTypes.SELECT });
    const [usersTable] = await qi.sequelize.query("SELECT ENGINE AS engine, TABLE_COLLATION AS collation FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'", { type: Sequelize.QueryTypes.SELECT });
    const duplicateCounts = [duplicates[0]?.duplicate_groups, normalized?.duplicate_groups, raw?.duplicate_groups].map(Number);
    if (duplicateCounts.some(count => !Number.isSafeInteger(count) || count < 0)) throw new Error("Could not verify duplicate counts; no migration may proceed.");
    return { duplicateGroups: duplicateCounts[0], trimLowerDuplicateGroups: duplicateCounts[1], databaseComparisonDuplicateGroups: duplicateCounts[2],
        emailColumn: columns.email, userIdColumn: columns.id, usersEngine: usersTable?.engine, usersCollation: usersTable?.collation,
        existingEmailUniqueIndexes: indexes.filter(index => index.unique && index.fields.length === 1 && index.fields[0].attribute === "email" && !index.fields[0].length).map(index => index.name),
        normalizedColumnPresent: !!columns.normalized_email, verifiedAtColumnPresent: !!columns.email_verified_at,
        uniqueIndexPresent: indexes.some(fullUnique), verificationTablePresent: tablePresent, otherVerificationTables,
        existingVerificationColumns: Object.keys(columns).filter(name => /verif|otp/i.test(name) && name !== "email_verified_at") };
}

module.exports = {
    inspect,
    async up(qi, Sequelize) {
        const before = await inspect(qi, Sequelize);
        if (before.duplicateGroups) throw new Error(`Found ${before.duplicateGroups} canonical email collision groups. Resolve with the Registrar before migrating; no records have been merged or deleted.`);
        if (before.otherVerificationTables.length) throw new Error("Other email verification tables exist. Review them for reuse before adding a new OTP table.");
        if (before.existingVerificationColumns.length) throw new Error("Existing user verification fields require review for reuse before this migration may proceed.");
        if (String(before.usersEngine).toLowerCase() !== "innodb") throw new Error("users must use InnoDB. Refusing any automatic engine conversion.");
        if (!/^INT(?:\(\d+\))?$/i.test(before.userIdColumn?.type || "") || !before.userIdColumn?.primaryKey) throw new Error("Draft OTP foreign key expects signed INT users.id. Review production key type; no automatic conversion is allowed.");
        if (!/^VARCHAR\(255\)$/i.test(before.emailColumn?.type || "")) throw new Error("Unexpected email column type. Review generated key capacity before applying.");
        // Add the ordinary nullable column before indexing a virtual column:
        // MariaDB 10.4 cannot add it INSTANT once a virtual index exists.
        if (!before.verifiedAtColumnPresent) await qi.sequelize.query("ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL DEFAULT NULL, ALGORITHM=INSTANT");
        if (!before.normalizedColumnPresent) await qi.sequelize.query(`ALTER TABLE users ADD COLUMN normalized_email VARCHAR(255) GENERATED ALWAYS AS (${EMAIL_KEY_SQL}) VIRTUAL, ALGORITHM=INPLACE, LOCK=NONE`);
        if (!before.uniqueIndexPresent) await qi.sequelize.query(`ALTER TABLE users ADD UNIQUE INDEX ${indexName} (normalized_email), ALGORITHM=INPLACE, LOCK=NONE`);
        if (!before.verificationTablePresent) {
            await qi.createTable(table, {
                email_key: { type: Sequelize.STRING(254), primaryKey: true, allowNull: false },
                email: { type: Sequelize.STRING(254), allowNull: false },
                session_hash: { type: Sequelize.STRING(64), allowNull: false, unique: true },
                otp_hash: { type: Sequelize.STRING(64), allowNull: true },
                status: { type: Sequelize.STRING(16), allowNull: false },
                expires_at: { type: Sequelize.DATE(3), allowNull: true },
                verified_at: { type: Sequelize.DATE, allowNull: true },
                consumed_at: { type: Sequelize.DATE, allowNull: true },
                consumed_by_user_id: { type: Sequelize.INTEGER, allowNull: true, references: { model: "users", key: "id" }, onDelete: "SET NULL", onUpdate: "CASCADE" },
                sent_at: { type: Sequelize.DATE(3), allowNull: false },
                resend_history: { type: Sequelize.JSON, allowNull: false },
                failed_attempts: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
                createdAt: { type: Sequelize.DATE, allowNull: false },
                updatedAt: { type: Sequelize.DATE, allowNull: false }
            }, { engine: "InnoDB" });
        }
        const after = await inspect(qi, Sequelize);
        if (after.duplicateGroups || !after.normalizedColumnPresent || !after.verifiedAtColumnPresent || !after.uniqueIndexPresent || !after.verificationTablePresent) throw new Error("Registration OTP schema verification failed.");
    },
    async down() {
        throw new Error("Automatic rollback is disabled to preserve email uniqueness and verification history. Roll back application code while retaining this additive schema.");
    }
};
