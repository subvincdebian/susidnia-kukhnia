import { localDatabase } from './database.mjs';
import { migrate } from './migrations.mjs';
let database;
try {database=await localDatabase();await migrate(database.config);}
catch {console.error('Міграції не виконано. Робочі записи не очищено.');process.exitCode=1;}
finally {database?.stop();}
