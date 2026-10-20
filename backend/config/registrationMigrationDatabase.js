const fs = require("fs");
const { Sequelize } = require("sequelize");

function createMigrationConnection(env = process.env, { apply = false } = {}) {
    const dedicated = !!env.MIGRATION_DB_HOST || apply;
    const prefix = dedicated ? "MIGRATION_DB_" : "DB_";
    const required = ["HOST", "NAME", "USER", "PORT", ...(apply ? ["PASS"] : [])];
    if (required.some(key => !String(env[prefix + key] || "").trim())) throw new Error(`Configure ${prefix}{HOST,NAME,USER,PORT${apply ? ",PASS" : ""}} securely before running this command.`);
    const host = env[prefix + "HOST"];
    const port = Number(env[prefix + "PORT"]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid migration database port.");
    const local = ["localhost", "127.0.0.1", "::1", require("os").hostname().toLowerCase()].includes(host.toLowerCase());
    const caPath = env.MIGRATION_DB_CA_FILE || env.DB_CA_FILE;
    return new Sequelize(env[prefix + "NAME"], env[prefix + "USER"], env[prefix + "PASS"], {
        host, port, dialect: "mysql", logging: false,
        pool: { max: 1, min: 0, acquire: 15000, idle: 1000 },
        ...(!local ? { dialectOptions: { ssl: { rejectUnauthorized: true, ...(caPath ? { ca: fs.readFileSync(caPath, "utf8") } : {}) } } } : {})
    });
}
module.exports = { createMigrationConnection };
