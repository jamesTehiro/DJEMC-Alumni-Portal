
require("./adminOtpEnvironment");
const { Sequelize } = require("sequelize");
const path = require("path");
const fs = require('node:fs');

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const isProduction = process.env.NODE_ENV === "production";

const requiredConfig = ["DB_HOST", "DB_NAME", "DB_USER"];
if (isProduction) requiredConfig.push("DB_PASS", "DB_PORT");
const missingConfig = requiredConfig.filter((key) => !String(process.env[key] || "").trim());
if (missingConfig.length > 0) {
    throw new Error(`Missing required database configuration: ${missingConfig.join(", ")}`);
}

const databasePort = Number(process.env.DB_PORT || 3306);
if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error("DB_PORT must be a valid TCP port number.");
}

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        port: databasePort,
        dialect: "mysql",
        logging: false,

        ...(isProduction && {
            dialectOptions: {
                ssl: {
                    ca: fs.readFileSync(process.env.DB_CA_FILE || path.join(__dirname, '../cert/ca.pem'), 'utf8'),
                    rejectUnauthorized: true,
                    verifyIdentity: true,
                    minVersion: 'TLSv1.2'
                }
            }
        }),

        pool: {
            max: Number(process.env.DB_POOL_MAX || 5),
            min: Number(process.env.DB_POOL_MIN || 0),
            acquire: Number(process.env.DB_POOL_ACQUIRE || 30000),
            idle: Number(process.env.DB_POOL_IDLE || 10000)
        }
    }
);

module.exports = sequelize;
