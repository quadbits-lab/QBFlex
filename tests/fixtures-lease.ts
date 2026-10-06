import { acquireLease } from '../packages/database/src/lease';
acquireLease(process.argv[2]!);
console.log('LEASED');
setInterval(() => {}, 1000);
