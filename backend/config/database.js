
const { Sequelize } = require("sequelize");
const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, "..", ".env")
});

const isProduction = process.env.NODE_ENV === "production";

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || 3306),
        dialect: "mysql",
        logging: false,

        ...(isProduction && {
            dialectOptions: {
                ssl: {
                    rejectUnauthorized: false
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
