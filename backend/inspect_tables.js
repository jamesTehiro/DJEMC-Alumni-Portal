const { sequelize } = require('./models');

(async () => {
    try {
        await sequelize.authenticate();
        const [results] = await sequelize.query('SHOW TABLES');
        console.log('\nExisting tables:');
        results.forEach((r) => {
            const name = Object.values(r)[0];
            console.log(' - ' + name);
        });
        process.exit(0);
    } catch (err) {
        console.error('Error listing tables:', err.message);
        process.exit(1);
    }
})();