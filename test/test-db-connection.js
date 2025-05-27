// require('dotenv').config();
// const { Client } = require('pg');

// const client = new Client({
//   host: process.env.DB_HOST,
//   port: +process.env.DB_PORT,
//   user: process.env.DB_USERNAME,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   ssl: { rejectUnauthorized: false },
// });

// client.connect()
//   .then(() => {
//     console.log('✅ Conexión exitosa a Supabase PostgreSQL');
//     return client.end();
//   })
//   .catch(err => {
//     console.error('❌ Error de conexión:', err);
//   });

require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // ⚠️ solo para desarrollo
  },
});

client.connect()
  .then(() => {
    console.log('✅ Conexión exitosa a Supabase PostgreSQL');
    return client.end();
  })
  .catch(err => {
    console.error('❌ Error de conexión:', err);
  });
