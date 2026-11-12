'use strict';

const TABLE = 'employerprofiles';
const REQUIRED_COLUMNS = [
    'organization_type',
    'government_agency_details',
    'government_agency_documents'
];

function getOption(argv, flag) {
    const index = argv.indexOf(flag);
    if (index === -1) return null;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
        throw new Error(`${flag} requires a value.`);
    }
    return value;
}

async function main(argv = process.argv.slice(2), overrides = {}) {
    const db = overrides.db || require('../models');
    const migration = overrides.migration || require('../migrations/20261020-add-government-agency-employer-registration');
    const secureConnection = overrides.secureConnection || require('../config/accountDeletionConnection').secureConnection;
    const output = overrides.output || (result => console.log(JSON.stringify(result)));
    const apply = argv.includes('--apply');

    if (apply) {
        const host = getOption(argv, '--host');
        const database = getOption(argv, '--database');
        if (!host || !database) {
            throw new Error('Apply requires --host and --database matching the configured reviewed target.');
        }
        if (host !== db.sequelize.config.host || database !== db.sequelize.config.database) {
            throw new Error('Apply target does not match the configured Sequelize host and database.');
        }
    }

    secureConnection(db.sequelize);
    const queryInterface = db.sequelize.getQueryInterface();
    const tables = await queryInterface.showAllTables();
    const tableExists = tables.some(name => String(name) === TABLE);

    if (!tableExists) {
        const result = {
            checkOnly: !apply,
            employerProfilesTableExists: false,
            schemaReady: false,
            missingColumns: REQUIRED_COLUMNS
        };
        output(result);
        return result;
    }

    if (apply) await migration.up(queryInterface, db.Sequelize);
    const columns = await migration.inspect(queryInterface, db.Sequelize);
    const missingColumns = REQUIRED_COLUMNS.filter(name => columns[name] !== true);
    const result = {
        checkOnly: !apply,
        employerProfilesTableExists: true,
        schemaReady: missingColumns.length === 0,
        missingColumns
    };
    output(result);
    return result;
}

function safeErrorDetails(error) {
    let message = error?.message || 'Unknown migration runner error.';
    for (const value of [process.env.DB_PASS, process.env.DB_USER]) {
        if (value) message = message.split(value).join('[REDACTED]');
    }
    return { kind: error?.name || 'Error', message };
}

if (require.main === module) {
    const db = require('../models');
    main().then(result => {
        if (!result.schemaReady) process.exitCode = 1;
    }).catch(error => {
        console.error('[GOVERNMENT_AGENCY_MIGRATION_FAILED]', safeErrorDetails(error));
        process.exitCode = 1;
    }).finally(async () => {
        try {
            await db.sequelize.close();
        } catch (error) {
            console.error('[GOVERNMENT_AGENCY_MIGRATION_CLOSE_FAILED]', safeErrorDetails(error));
            process.exitCode = 1;
        }
    });
}

module.exports = { main, REQUIRED_COLUMNS, safeErrorDetails };
