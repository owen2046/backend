import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { z } from 'zod'
import { nanoid } from 'nanoid'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import pkg from 'pg'
import { Resend } from 'resend'
import dotenv from 'dotenv'
dotenv.config()

const { Pool } = pkg

const isProduction = process.env.NODE_ENV === 'production'
const requiredProductionEnv = ['DATABASE_URL', 'ADMIN_API_KEY', 'JWT_SECRET']
const missingProductionEnv = requiredProductionEnv.filter(name => !process.env[name])
if (isProduction && missingProductionEnv.length) {
  throw new Error(`Missing required environment variables: ${missingProductionEnv.join(', ')}`)
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

const resend = new Resend(process.env.RESEND_API_KEY)

const PORT = Number(process.env.PORT || 5000)
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5175,http://127.0.0.1:5173,http://127.0.0.1:5175'
const allowedOrigins = CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? '' : 'dev-only-change-me')
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

const app = express()
app.disable('x-powered-by')
app.use(morgan('dev'))
app.use(express.json({ limit: '1mb' }))
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error('Not allowed by CORS'))
  },
}))

// ─── HELPERS ─────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!ADMIN_API_KEY) return res.status(401).json({ error: 'ADMIN_API_KEY not configured' })
  if (req.header('x-admin-key') === ADMIN_API_KEY) return next()
  res.status(401).json({ error: 'ADMIN_AUTH_REQUIRED' })
}

function signUserToken(user) {
  return jwt.sign({ userId: user.id, purpose: 'auth' }, JWT_SECRET, { expiresIn: '30d' })
}

function requireUser(req, res, next) {
  const header = req.header('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return res.status(401).json({ error: 'AUTH_REQUIRED' })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.purpose !== 'auth' || !payload.userId) {
      return res.status(401).json({ error: 'AUTH_REQUIRED' })
    }
    req.user = { id: payload.userId }
    next()
  } catch {
    res.status(401).json({ error: 'AUTH_REQUIRED' })
  }
}

function sendInternalError(res) {
  res.status(500).json({ error: 'INTERNAL_ERROR' })
}

async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    return await client.query(sql, params)
  } finally {
    client.release()
  }
}

// ─── HEALTH ──────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'estates61-backend', db: 'postgresql' })
})

// ─── BUILDERS ────────────────────────────────────────────
app.get('/api/builders', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM builders ORDER BY name')
    res.json({ items: rows })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/builders/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM builders WHERE id = $1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND' })
    res.json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/admin/builders', requireAdmin, async (req, res) => {
  const parsed = z.object({
    id: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(120),
    badge: z.string().trim().max(80).optional(),
    since: z.string().trim().max(80).optional(),
    logo_url: z.string().trim().max(1000).optional(),
    description: z.string().trim().max(2000).optional(),
    website: z.string().trim().max(500).optional(),
    projects_count: z.coerce.number().int().min(0).optional(),
    city: z.string().trim().max(120).optional(),
    contact_email: z.string().trim().email().optional().or(z.literal('')),
    contact_phone: z.string().trim().max(30).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues })
  const d = parsed.data
  try {
    const { rows } = await query(
      `INSERT INTO builders (id, name, badge, since, logo_url, description, website, projects_count, city, contact_email, contact_phone)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [d.id, d.name, d.badge, d.since, d.logo_url, d.description, d.website, d.projects_count || 0, d.city, d.contact_email, d.contact_phone]
    )
    res.status(201).json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/admin/builders/:id', requireAdmin, async (req, res) => {
  const allowed = ['name','badge','since','logo_url','description','website','projects_count','city','contact_email','contact_phone']
  const updates = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)))
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid fields' })
  const sets = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`).join(', ')
  const values = [...Object.values(updates), req.params.id]
  try {
    const { rows } = await query(`UPDATE builders SET ${sets} WHERE id = $${values.length} RETURNING *`, values)
    if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND' })
    res.json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/admin/builders/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM builders WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── PROPERTIES ──────────────────────────────────────────
app.get('/api/properties', async (req, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase()
    const builderId = String(req.query.builderId || '').trim()
    const type = String(req.query.type || '').trim()
    const status = String(req.query.status || '').trim().replace(/-/g, ' ')
    const sortBy = String(req.query.sortBy || '').trim()
    const limit = Math.min(Math.max(Number(req.query.limit || 0) || 50, 1), 200)
    const offset = Math.max(Number(req.query.offset || 0) || 0, 0)

    const conditions = []
    const params = []

    if (builderId) { params.push(builderId); conditions.push(`builder_id = $${params.length}`) }
    if (type) { params.push(`%${type}%`); conditions.push(`LOWER(type) LIKE LOWER($${params.length})`) }
    if (status) { params.push(`%${status}%`); conditions.push(`LOWER(status) LIKE LOWER($${params.length})`) }
    if (search) {
      params.push(`%${search}%`)
      const i = params.length
      conditions.push(`(LOWER(name) LIKE $${i} OR LOWER(location) LIKE $${i} OR LOWER(builder_name) LIKE $${i})`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    let orderBy = 'ORDER BY created_at DESC'
    if (sortBy === 'price-asc') orderBy = 'ORDER BY price ASC'
    else if (sortBy === 'price-desc') orderBy = 'ORDER BY price DESC'
    else if (sortBy === 'name') orderBy = 'ORDER BY name ASC'

    params.push(limit, offset)
    const dataQ = `SELECT * FROM properties ${where} ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`
    const countQ = `SELECT COUNT(*) FROM properties ${where}`

    const [dataRes, countRes] = await Promise.all([
      query(dataQ, params),
      query(countQ, params.slice(0, -2)),
    ])
    res.json({ items: dataRes.rows, total: parseInt(countRes.rows[0].count, 10) })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/properties/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM properties WHERE id = $1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND' })
    res.json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/properties/:id/sold', requireAdmin, async (req, res) => {
  const sold_units = Number(req.body.sold_units)
  if (!Number.isInteger(sold_units) || sold_units < 0) {
    return res.status(400).json({ error: 'sold_units must be a non-negative integer' })
  }
  try {
    const { rows } = await query(
      'UPDATE properties SET sold_units = $1 WHERE id = $2 RETURNING *',
      [sold_units, req.params.id]
    )
    res.json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/admin/properties', requireAdmin, async (req, res) => {
  const parsed = z.object({
    id: z.string().trim().min(1).max(120),
    builder_id: z.string().trim().min(1).max(120),
    builder_name: z.string().trim().min(1).max(120),
    name: z.string().trim().min(1).max(160),
    location: z.string().trim().max(200).optional(),
    type: z.string().trim().max(80).optional(),
    status: z.string().trim().max(80).optional(),
    bhk: z.string().trim().max(80).optional(),
    price: z.string().trim().max(80).optional(),
    area: z.string().trim().max(80).optional(),
    img: z.string().trim().max(1000).optional(),
    images: z.array(z.string()).optional(),
    description: z.string().trim().max(5000).optional(),
    amenities: z.array(z.string()).optional(),
    nearby: z.array(z.string()).optional(),
    total_units: z.coerce.number().int().min(0).optional(),
    sold_units: z.coerce.number().int().min(0).optional(),
    possession: z.string().trim().max(80).optional(),
    rera: z.string().trim().max(120).optional(),
    tag: z.string().trim().max(80).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues })
  const d = parsed.data
  try {
    const { rows } = await query(
      `INSERT INTO properties (id, builder_id, builder_name, name, location, type, status, bhk, price, area, img, images, description, amenities, nearby, total_units, sold_units, possession, rera, tag)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [d.id, d.builder_id, d.builder_name, d.name, d.location, d.type, d.status, d.bhk, d.price, d.area,
       d.img, d.images || [], d.description, d.amenities || [], d.nearby || [],
       d.total_units || 0, d.sold_units || 0, d.possession, d.rera, d.tag]
    )
    res.status(201).json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/admin/properties/:id', requireAdmin, async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(1).max(160).optional(),
    status: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(80).optional(),
    price: z.string().trim().max(80).optional(),
    possession: z.string().trim().max(80).optional(),
    img: z.string().trim().max(1000).optional(),
    images: z.array(z.string().trim().max(1000)).optional(),
    floor_plan_url: z.string().trim().max(1000).optional(),
    floor_plan_code: z.string().trim().max(5000).optional(),
    sold_units: z.coerce.number().int().min(0).optional(),
    total_units: z.coerce.number().int().min(0).optional(),
    location: z.string().trim().max(200).optional(),
    description: z.string().trim().max(5000).optional(),
    bhk: z.string().trim().max(80).optional(),
    area: z.string().trim().max(80).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues })
  const fields = Object.entries(parsed.data)
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' })
  const sets = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ')
  const values = [...fields.map(([, v]) => v), req.params.id]
  try {
    const { rows } = await query(
      `UPDATE properties SET ${sets} WHERE id = $${values.length} RETURNING *`, values
    )
    if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND' })
    res.json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/admin/properties/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM properties WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── ARTICLES ────────────────────────────────────────────
app.get('/api/articles', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM articles ORDER BY published_at DESC')
    res.json({ items: rows })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/articles/:id', async (req, res) => {
  try {
    const { rows } = await query('SELECT * FROM articles WHERE id = $1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'NOT_FOUND' })
    res.json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/admin/articles', requireAdmin, async (req, res) => {
  const parsed = z.object({
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(220),
    category: z.string().trim().max(80).optional(),
    excerpt: z.string().trim().max(2000).optional(),
    img: z.string().trim().max(1000).optional(),
    read_time: z.string().trim().max(80).optional(),
    content: z.string().optional(),
    author: z.string().trim().max(120).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR' })
  const d = parsed.data
  try {
    const { rows } = await query(
      `INSERT INTO articles (id, title, category, excerpt, img, read_time, content, author, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
      [d.id, d.title, d.category, d.excerpt, d.img, d.read_time, d.content, d.author]
    )
    res.status(201).json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.patch('/api/admin/articles/:id', requireAdmin, async (req, res) => {
  const parsed = z.object({
    title: z.string().trim().min(1).max(220).optional(),
    category: z.string().trim().max(80).optional(),
    excerpt: z.string().trim().max(2000).optional(),
    img: z.string().trim().max(1000).optional(),
    read_time: z.string().trim().max(80).optional(),
    content: z.string().optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR' })
  const fields = Object.entries(parsed.data)
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' })
  const sets = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ')
  const values = [...fields.map(([, v]) => v), req.params.id]
  try {
    const { rows } = await query(`UPDATE articles SET ${sets} WHERE id = $${values.length} RETURNING *`, values)
    res.json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.delete('/api/admin/articles/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM articles WHERE id = $1', [req.params.id])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── INQUIRIES ───────────────────────────────────────────
const InquirySchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(7).max(20),
  email: z.string().trim().email().optional().or(z.literal('')).transform(v => v || null),
  message: z.string().trim().max(2000).optional().or(z.literal('')).transform(v => v || null),
  interest: z.string().trim().max(80).optional().or(z.literal('')).transform(v => v || null),
  budget: z.string().trim().max(80).optional().or(z.literal('')).transform(v => v || null),
  city: z.string().trim().max(120).optional().or(z.literal('')).transform(v => v || null),
  propertyId: z.string().trim().max(120).optional().or(z.literal('')).transform(v => v || null),
  propertyName: z.string().trim().max(200).optional().or(z.literal('')).transform(v => v || null),
  source: z.string().trim().max(80).optional().or(z.literal('')).transform(v => v || 'website'),
  pagePath: z.string().trim().max(500).optional().or(z.literal('')).transform(v => v || null),
  requestType: z.string().trim().max(120).optional().or(z.literal('')).transform(v => v || null),
  metadata: z.record(z.string(), z.unknown()).optional().default({}),
})

app.post('/api/inquiries', async (req, res) => {
  const parsed = InquirySchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.issues })
  const d = parsed.data
  try {
    const { rows } = await query(
      `INSERT INTO inquiries (id, name, phone, email, message, property_id, property_name, interest, budget, city, source, page_path, request_type, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [nanoid(12), d.name, d.phone, d.email, d.message, d.propertyId, d.propertyName, d.interest, d.budget, d.city, d.source, d.pagePath, d.requestType, d.metadata]
    )
    res.status(201).json({ item: rows[0] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/inquiries', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM inquiries ORDER BY created_at DESC LIMIT 200')
    res.json({ items: rows })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ─── AUTH ─────────────────────────────────────────────────
app.post('/api/auth/signup', async (req, res) => {
  const parsed = z.object({
    name: z.string().trim().min(2).max(80),
    phone: z.string().trim().min(7).max(20),
    email: z.string().trim().email(),
    password: z.string().min(6).max(128),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'VALIDATION_ERROR' })
  const { name, phone, email, password } = parsed.data
  try {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing.rows[0]) return res.status(409).json({ error: 'An account with this email already exists' })
    const password_hash = await bcrypt.hash(password, 12)
    const id = nanoid(12)
    const { rows } = await query(
      'INSERT INTO users (id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, phone',
      [id, name, email.toLowerCase(), phone, password_hash]
    )
    res.status(201).json({ user: rows[0], token: signUserToken(rows[0]) })
  } catch { sendInternalError(res) }
})

app.post('/api/auth/signin', async (req, res) => {
  const parsed = z.object({
    email: z.string().trim().email(),
    password: z.string().min(1),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'VALIDATION_ERROR' })
  const { email, password } = parsed.data
  try {
    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()])
    const user = rows[0]
    if (!user) return res.status(401).json({ error: 'Invalid email or password' })
    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' })
    const publicUser = { id: user.id, name: user.name, email: user.email, phone: user.phone }
    res.json({ user: publicUser, token: signUserToken(publicUser) })
  } catch { sendInternalError(res) }
})

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' })
  try {
    const { rows } = await query('SELECT id, name FROM users WHERE email = $1', [email.toLowerCase()])
    if (!rows[0]) return res.json({ ok: true, message: 'If this email exists, a reset link has been sent.' })

    const token = jwt.sign({ userId: rows[0].id, purpose: 'reset' }, JWT_SECRET, { expiresIn: '1h' })
    const resetUrl = `${FRONTEND_URL}/reset-password?token=${token}`

    await resend.emails.send({
      from: `Estates61 <${process.env.FROM_EMAIL || 'onboarding@resend.dev'}>`,
      to: email.toLowerCase(),
      subject: 'Reset your Estates61 password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
          <h2 style="color:#0D2340;font-weight:400;">Reset your password</h2>
          <p style="color:#555;">Hi ${rows[0].name},</p>
          <p style="color:#555;">Click the button below to reset your Estates61 password. This link expires in 1 hour.</p>
          <a href="${resetUrl}" style="display:inline-block;padding:13px 28px;background:#B8946A;color:#fff;text-decoration:none;border-radius:4px;font-size:14px;margin:16px 0;">
            Reset Password →
          </a>
          <p style="color:#999;font-size:12px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    })
    res.json({ ok: true, message: 'If this email exists, a reset link has been sent.' })
  } catch (err) {
    console.error('Forgot password error:', err)
    res.json({ ok: true })
  }
})

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body
  if (!token || !password || password.length < 6) {
    return res.status(400).json({ error: 'Valid token and password (min 6 chars) required' })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    if (payload.purpose !== 'reset') return res.status(400).json({ error: 'Invalid token' })
    const password_hash = await bcrypt.hash(password, 12)
    const { rows } = await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, name, email, phone',
      [password_hash, payload.userId]
    )
    if (!rows[0]) return res.status(404).json({ error: 'User not found' })
    res.json({ ok: true, user: rows[0] })
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' })
    res.status(400).json({ error: 'Invalid or expired token' })
  }
})

// ─── USERS ───────────────────────────────────────────────
app.post('/api/users/upsert', (_req, res) => {
  res.status(410).json({ error: 'DEPRECATED_ENDPOINT', message: 'Use /api/auth/signup for users or /api/inquiries for leads.' })
})

// ─── SAVED PROPERTIES ────────────────────────────────────
app.post('/api/saved', requireUser, async (req, res) => {
  const { propertyId } = req.body
  const userId = req.user.id
  if (!propertyId) return res.status(400).json({ error: 'propertyId required' })
  try {
    const existing = await query(
      'SELECT id FROM saved_properties WHERE user_id = $1 AND property_id = $2',
      [userId, propertyId]
    )
    if (existing.rows[0]) {
      await query('DELETE FROM saved_properties WHERE id = $1', [existing.rows[0].id])
      return res.json({ saved: false })
    }
    await query(
      'INSERT INTO saved_properties (id, user_id, property_id) VALUES ($1,$2,$3)',
      [nanoid(12), userId, propertyId]
    )
    res.json({ saved: true })
  } catch { sendInternalError(res) }
})

app.get('/api/saved/:userId', requireUser, async (req, res) => {
  if (req.params.userId !== req.user.id) return res.status(403).json({ error: 'FORBIDDEN' })
  try {
    const { rows: savedRows } = await query(
      'SELECT property_id FROM saved_properties WHERE user_id = $1',
      [req.params.userId]
    )
    if (!savedRows.length) return res.json({ items: [] })
    const ids = savedRows.map(r => r.property_id)
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    const { rows } = await query(`SELECT * FROM properties WHERE id IN (${placeholders})`, ids)
    res.json({ items: rows })
  } catch { sendInternalError(res) }
})

app.get('/api/saved/:userId/:propertyId', requireUser, async (req, res) => {
  if (req.params.userId !== req.user.id) return res.status(403).json({ error: 'FORBIDDEN' })
  try {
    const { rows } = await query(
      'SELECT id FROM saved_properties WHERE user_id = $1 AND property_id = $2',
      [req.params.userId, req.params.propertyId]
    )
    res.json({ saved: Boolean(rows[0]) })
  } catch { sendInternalError(res) }
})

// ─── SITEMAP ─────────────────────────────────────────────
app.get('/sitemap.xml', async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10)
  const staticPages = ['/', '/properties', '/insights', '/partners', '/contact']
  try {
    const [propsRes, artsRes] = await Promise.all([
      query('SELECT id FROM properties'),
      query('SELECT id FROM articles'),
    ])
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPages.map(p => `  <url><loc>${FRONTEND_URL}${p}</loc><changefreq>weekly</changefreq><priority>${p === '/' ? '1.0' : '0.8'}</priority></url>`).join('\n')}
${propsRes.rows.map(p => `  <url><loc>${FRONTEND_URL}/properties/${p.id}</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>`).join('\n')}
${artsRes.rows.map(a => `  <url><loc>${FRONTEND_URL}/insights/${a.id}</loc><lastmod>${today}</lastmod><priority>0.7</priority></url>`).join('\n')}
</urlset>`
    res.header('Content-Type', 'application/xml').send(xml)
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${FRONTEND_URL}/sitemap.xml`)
})

// ─── ERROR HANDLER ───────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'INTERNAL_ERROR' })
})

app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`))
