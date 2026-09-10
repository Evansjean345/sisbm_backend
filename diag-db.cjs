// Diagnostic de connexion — utilise le MÊME pilote que l'application
const fs = require('node:fs')
const { Client } = require('pg')

const env = {}
for (const l of fs.readFileSync('.env', 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (!m) continue
  let v = m[2]
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^["']|["']$/g, '')
  env[m[1]] = v
}

console.log('--- ce que lit le .env ---')
console.log('DB_HOST     :', JSON.stringify(env.DB_HOST))
console.log('DB_PORT     :', JSON.stringify(env.DB_PORT))
console.log('DB_USER     :', JSON.stringify(env.DB_USER))
console.log('DB_DATABASE :', JSON.stringify(env.DB_DATABASE))
console.log(
  'DB_PASSWORD : longueur',
  (env.DB_PASSWORD || '').length,
  '| aperçu',
  JSON.stringify((env.DB_PASSWORD || '').slice(0, 4) + '…')
)

const c = new Client({
  host: env.DB_HOST,
  port: +env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
})
c.connect()
  .then(() => c.query('SELECT current_user, inet_server_addr()::text AS srv, version()'))
  .then((r) => {
    console.log('\n✅ CONNEXION OK')
    console.log(r.rows[0])
    return c.end()
  })
  .catch((e) => {
    console.log('\n❌ ÉCHEC :', e.code, '-', e.message)
    process.exit(1)
  })
