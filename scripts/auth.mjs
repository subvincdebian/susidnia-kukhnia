import pg from 'pg';

// These credentials are intentionally synthetic and public for the local demo.
export const demoAccounts = [
  {email:'admin@demo.test',full_name:'Демо адміністратор',phone:'+380000000901',role:'admin',password_hash:'pbkdf2-sha256$600000$T9GR3i6DRE2fkDzCMXFzGQ==$Ycf6fogRjkN8mmVHAU0/mNxjLP3Z5rJlio+vp7lfJjI='},
  {email:'user@demo.test',full_name:'Демо користувач',phone:'+380000000902',role:'user',password_hash:'pbkdf2-sha256$600000$slNmwoKU8hEMsy3NpD/aHg==$rqVi8DgyyZjsMNWxpDkjx2MAGmHLMV/wl9TgjsfphD4='},
];
// Reuse the same typed statements for PostgreSQL startup and browser database upgrades.
export const authSeedStatements = demoAccounts.map(account => ({
  sql: `WITH identity AS (
    SELECT $1::text AS full_name,$2::text AS email,$3::text AS phone,$4::text AS password_hash,$5::text AS role
    WHERE NOT EXISTS(SELECT 1 FROM app_users WHERE email=$2::text)
  ), new_customer AS (
    INSERT INTO customers(full_name,email,phone,default_delivery_address)
    SELECT i.full_name,
      CASE WHEN EXISTS(SELECT 1 FROM customers WHERE email=i.email) THEN NULL ELSE i.email END,
      COALESCE(
        (SELECT i.phone WHERE NOT EXISTS(SELECT 1 FROM customers WHERE phone=i.phone)),
        (SELECT '+380000'||lpad(candidate::text,6,'0') FROM generate_series(0,9999) AS candidate
          WHERE NOT EXISTS(SELECT 1 FROM customers WHERE phone='+380000'||lpad(candidate::text,6,'0')) ORDER BY candidate LIMIT 1)
      ),
      'Демонстраційна адреса, 1'
    FROM identity i RETURNING id
  )
  INSERT INTO app_users(customer_id,email,password_hash,role)
  SELECT c.id,i.email,i.password_hash,i.role FROM new_customer c CROSS JOIN identity i RETURNING id`,
  params:[account.full_name,account.email,account.phone,account.password_hash,account.role],
}));
export async function seedAuth(db) {
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(718202627)');
    let added = 0;
    // These statements create separate contacts; matching legacy records are never claimed or changed.
    for (const statement of authSeedStatements) added += (await db.query(statement.sql,statement.params)).rows.length;
    await db.query('COMMIT');
    return {added};
  } catch (error) {await db.query('ROLLBACK');throw error;}
}
export async function seedAuthDatabase(config) {
  const db = new pg.Client(config);await db.connect();
  try {return await seedAuth(db);} finally {await db.end();}
}
