const fs = require('fs');
const { Pool } = require('pg');
const config = require('./config');

const connection = new Pool(config);

async function getDir(path) {
    return new Promise((resolve, reject) => {
        fs.readdir(path, (err, items) => {
            if (err) {
                reject(err);
            } else {
                resolve(items);
            }
        });
    });
}

async function command(sql ,args = []) {
    return await connection.query(sql, args);
}
const createSql = `
create table pg_migrations (
    id integer primary key,
    name text,
    up text,
    dn text,
    run_at timestamp default now()
)
`;
async function createSchema() {
    const sql = `select * from information_schema.tables where table_name = 'pg_migrations'`;
    const table = await command(sql);
    if (table.rowCount < 1) {
        const info = await command(createSql);
    }
}
async function getPastMigrations() {
    const sql = 'select id from pg_migrations';
    const migrations = await command(sql);
    if (migrations.rowCount < 1) {
        return [];
    }
    return migrations.rows.map(r => Number(r.id));
}
function checkCmd(op1, cmd1, op2, cmd2) {
    const errors = [];
    op1 = op1.toLowerCase();
    op2 = op2.toLowerCase();
    if (op1 !== 'up' && op1 !== 'down') {
        errors.push(`invalid operation ${op1 || 'first operation'}`)
    }
    if (op2 !== 'up' && op2 !== 'down') {
        errors.push(`invalid operation ${op2 || 'second operation'}`)
    }
    if (op1 === op2) {
        errors.push(`duplicate operation ${op1 || 'unknown operation'}`)
    }
    if (!cmd1) {
        errors.push(`empty command for ${op1 || 'first operation'}`);
    }
    if (!cmd2) {
        errors.push(`empty command for ${op2 || 'second operation'}`)
    }
    return errors.length > 0 ? errors : null;
}

async function getFileMigrations(path) {
    const dirs = await getDir(path);
    let migrations = dirs
        .map(x => x.match(/^(\d+).(.*?)\.sql$/))
        .filter(x => x !== null)
        .map(x => ({ id: Number(x[1]), name: x[2], file: x[0] }))
        .sort((a,b) => a.id - b.id);

    if (!migrations.length) {
        console.error(`No migrations found in ${path}`);
        return;
    }

    // read all the files
    migrations = await Promise.all(migrations.map(async migration => {
        const text = fs.readFileSync(`${path}/${migration.file}` ,'utf-8');
        const [ignore, op1, cmd1, op2, cmd2] = text.split(/^--\s+?(up|down)\b/mi);
        const errors = checkCmd(op1, cmd1, op2, cmd2);
        if (errors) {
            throw new Error(`${migration.file} ${errors.join(', ')}`);
        }
        if (op1.toLowerCase() === 'up') {
            migration.up = cmd1.trim();
            migration.dn = cmd2.trim();
        } else {
            migration.up = cmd2.trim();
            migration.dn = cmd1.trim();
        }
        return migration;
    }));
    return migrations;
}

const debug = false;

async function doMigrate(detail) {
    if (debug) {
        console.log(detail.up);
        console.log('------');
        return;
    }
    const insert = 'INSERT INTO pg_migrations(id, name, up, dn) VALUES($1, $2, $3, $4)';
    const args = [detail.id, detail.name, detail.up, detail.dn];
    try {
        await command('BEGIN');
        await command(detail.up);
        await command(insert, args);
        await command('COMMIT');
    } catch(e) {
        await command('ROLLBACK');
        console.error(e);
        console.error(`${detail.file} failed all remaing migrations skipped`);
        throw e;
    }
}

async function migrate(path) {
    await createSchema();

    let migrations = await getFileMigrations(path);

    const past = await getPastMigrations();

    // remove any that have been run
    migrations = migrations.filter(m => !past.includes(m.id));

    for(let m = 0; m < migrations.length; m++) {
        const migrate = migrations[m];
        console.log(`executing migrate from ${migrate.file}`)
        await doMigrate(migrate);
    }
}

async function doRollback(detail) {
    if (debug) {
        console.log(detail.dn);
        console.log('------');
        return;
    }
    try {
        await command('BEGIN');
        await command(detail.dn);
        await command('DELETE FROM pg_migrations WHERE id = $1', [detail.id]);
        await command('COMMIT');
    } catch (e) {
        await command('ROLLBACK');
        console.error(e);
        console.error(`${detail.id} - ${detail.name} failed to rollback`);
        throw e;
    }
}

async function rollback(migrationId, migrationDir = null) {
    if (migrationDir) {
        let migrations = await getFileMigrations(migrationDir);
        const past = await getPastMigrations();
        // remove any that have been not run
        migrations = migrations.filter(m => past.includes(m.id) && m.id >= migrationId).sort((a, b) => b.id - a.id);
        for(let m = 0; m < migrations.length; m++) {
            await doRollback(migrations[m]);
        }
    } else {
        const cmd = 'SELECT id, dn, name FROM pg_migrations WHERE id >= $1 ORDER BY id DESC';
        const details = await command(cmd, [migrationId]);
        for(let d = 0; d < details.rowCount; d++) {
            const detail = details.rows[d];
            await doRollback(detail);
        }
    }
}
async function close() {
    await connection.end();
}
module.exports = {
    command,
    migrate,
    rollback,
    close,
}
