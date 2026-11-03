import { localDatabase } from './database.mjs';
import { prisma } from './migrations.mjs';
const command=process.argv[2];
if(command!=='studio')throw new Error('Дозволена команда: studio');
let database;
try {database=await localDatabase();await prisma(['studio','--port','5555','--browser','none'],database.config);}
finally {database?.stop();}
