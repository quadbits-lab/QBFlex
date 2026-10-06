import { openDatabase } from '@qb-flex/database';
const db = openDatabase(process.argv[2]!);
db.exec('CREATE TABLE ledger(id INTEGER PRIMARY KEY,value TEXT NOT NULL)');
for (let i = 1; i <= 20; i++) {
  db.query('INSERT INTO ledger VALUES(?,?)').run(i, 'acknowledged');
  console.log('ACK ' + i);
}
db.exec("BEGIN IMMEDIATE;INSERT INTO ledger VALUES(21,'uncommitted');");
console.log('UNCOMMITTED');
await new Promise(() => {});
