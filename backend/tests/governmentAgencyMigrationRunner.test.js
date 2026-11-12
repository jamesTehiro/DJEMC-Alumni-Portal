'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { main, REQUIRED_COLUMNS } = require('../scripts/applyGovernmentAgencyMigration');

function createHarness({ existingColumns = REQUIRED_COLUMNS, tables = ['employerprofiles'] } = {}) {
    const calls = { secureConnection: 0, migration: 0, inspected: 0, output: [] };
    const db = {
        Sequelize: {},
        sequelize: {
            config: { host: 'db.example.invalid', database: 'test_database' },
            getQueryInterface: () => ({
                showAllTables: async () => tables
            })
        }
    };
    const migration = {
        up: async () => { calls.migration++; },
        inspect: async () => {
            calls.inspected++;
            return Object.fromEntries(REQUIRED_COLUMNS.map(name => [name, existingColumns.includes(name)]));
        }
    };
    const secureConnection = () => { calls.secureConnection++; };
    const output = result => calls.output.push(result);
    return { db, migration, secureConnection, output, calls };
}

test('check-only is the default and does not apply schema changes', async () => {
    const harness = createHarness();
    const result = await main([], harness);
    assert.equal(result.checkOnly, true);
    assert.equal(result.schemaReady, true);
    assert.equal(harness.calls.migration, 0);
    assert.equal(harness.calls.inspected, 1);
    assert.equal(harness.calls.secureConnection, 1);
});

test('detects all existing government agency columns', async () => {
    const harness = createHarness();
    const result = await main([], harness);
    assert.deepEqual(result.missingColumns, []);
    assert.equal(result.schemaReady, true);
});

test('reports missing columns without applying migration in check-only mode', async () => {
    const harness = createHarness({ existingColumns: ['organization_type'] });
    const result = await main([], harness);
    assert.deepEqual(result.missingColumns, [
        'government_agency_details',
        'government_agency_documents'
    ]);
    assert.equal(result.schemaReady, false);
    assert.equal(harness.calls.migration, 0);
});

test('apply requires explicit --apply and matching host and database', async () => {
    const harness = createHarness();
    const check = await main(['--host', 'db.example.invalid', '--database', 'test_database'], harness);
    assert.equal(check.checkOnly, true);
    assert.equal(harness.calls.migration, 0);

    await assert.rejects(
        main(['--apply', '--database', 'test_database'], createHarness()),
        /Apply requires --host and --database/
    );
    await assert.rejects(
        main(['--apply', '--host', 'other.example.invalid', '--database', 'test_database'], createHarness()),
        /does not match/
    );
    await assert.rejects(
        main(['--apply', '--host', 'db.example.invalid', '--database', 'other_database'], createHarness()),
        /does not match/
    );
});

test('apply runs only after target verification and rechecks the resulting schema', async () => {
    const harness = createHarness({ existingColumns: [] });
    harness.migration.up = async () => {
        harness.calls.migration++;
        harness.migration.inspect = async () => Object.fromEntries(REQUIRED_COLUMNS.map(name => [name, true]));
    };
    const result = await main([
        '--apply',
        '--host', 'db.example.invalid',
        '--database', 'test_database'
    ], harness);
    assert.equal(result.checkOnly, false);
    assert.equal(result.schemaReady, true);
    assert.equal(harness.calls.migration, 1);
});

test('reports a missing employerprofiles table without attempting inspection or migration', async () => {
    const harness = createHarness({ tables: ['users'] });
    const result = await main([], harness);
    assert.equal(result.employerProfilesTableExists, false);
    assert.equal(result.schemaReady, false);
    assert.deepEqual(result.missingColumns, REQUIRED_COLUMNS);
    assert.equal(harness.calls.migration, 0);
    assert.equal(harness.calls.inspected, 0);
});
