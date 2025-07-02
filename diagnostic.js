// test-connection.js
const { Client } = require('pg');

const client = new Client({
  host: 'db.bpopnlwahfywxhambicw.supabase.co',
  port: 5432,
  user: 'postgres',
  password: 'FMTH8zqj86py-6',
  database: 'postgres',
  ssl: {
    rejectUnauthorized: false,
  },
});

client.connect()
  .then(() => {
    console.log('✅ Conexión exitosa a Supabase');
    return client.query('SELECT NOW()');
  })
  .then(result => {
    console.log('Resultado de prueba:', result.rows[0]);
    client.end();
  })
  .catch(err => {
    console.error('❌ Error de conexión:', err);
    client.end();
  });