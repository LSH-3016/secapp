const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  user: 'postgres',
  password: process.env.POSTGRES_PASSWORD,
  database: 'appdb',
});
const redis = createClient({ url: process.env.REDIS_URL || 'redis://redis:6379' });
const JWT_SECRET = process.env.JWT_SECRET;

async function init() {
  await redis.connect();
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS notes (
    id SERIAL PRIMARY KEY, owner_id INT, content TEXT)`);
  const { rowCount } = await pool.query('SELECT 1 FROM users');
  if (rowCount === 0) {
    const hash = bcrypt.hashSync('password123', 10);
    await pool.query('INSERT INTO users(username,password) VALUES ($1,$2),($3,$2)',
      ['alice', hash, 'bob']);
    await pool.query('INSERT INTO notes(owner_id,content) VALUES (1,$1),(2,$2)',
      ['alice의 비공개 메모', 'bob의 비공개 메모']);
  }
}

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'unauthorized' }); }
}

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const r = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
  const u = r.rows[0];
  if (!u || !bcrypt.compareSync(password, u.password))
    return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token: jwt.sign({ id: u.id, username: u.username }, JWT_SECRET, { expiresIn: '1h' }) });
});

// [의도적 취약점] 인증은 하지만, 노트 소유자 검사(인가)가 없음 → IDOR
app.get('/notes/:id', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM notes WHERE id=$1', [req.params.id]);
  if (!r.rows[0]) return res.status(404).json({ error: 'not found' });
  res.json(r.rows[0]);
});

init().then(() => app.listen(3000, () => console.log('listening on 3000')))
  .catch(e => { console.error(e); process.exit(1); });