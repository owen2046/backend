// ─── MIGRATE SUPABASE → NEON ─────────────────────────────
// Run once from your backend/ folder:
//   node migrate-to-neon.js

import { createClient } from '@supabase/supabase-js'
import pkg from 'pg'
import dotenv from 'dotenv'
dotenv.config()

const { Pool } = pkg

const supabase = createClient(
  'https://tjltuupooqwynxqerhre.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqbHR1dXBvb3F3eW54cWVyaHJlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODEzMjQ3MywiZXhwIjoyMDkzNzA4NDczfQ.g15DTfbWXOW7Qppb60xNdPPy1wJNqjNNIyC_2q3gV2M'
)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function q(sql, params = []) {
  const client = await pool.connect()
  try { return await client.query(sql, params) }
  finally { client.release() }
}

function ok(msg) { console.log('  OK  ' + msg) }
function warn(msg) { console.log('  WARN  ' + msg) }

async function migrateBuilders() {
  console.log('\nMigrating builders...')
  const { data, error } = await supabase.from('builders').select('*')
  if (error) { warn('Supabase error: ' + error.message); return }
  if (!data.length) { warn('No builders in Supabase'); return }
  let n = 0
  for (const b of data) {
    try {
      await q(
        `INSERT INTO builders (id,name,badge,since,logo_url,description,website,projects_count,city,contact_email,contact_phone,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`,
        [b.id,b.name,b.badge,b.since,b.logo_url,b.description,b.website,b.projects_count||0,b.city,b.contact_email,b.contact_phone,b.created_at]
      )
      n++
    } catch(e) { warn('Builder ' + b.id + ': ' + e.message) }
  }
  ok(n + '/' + data.length + ' builders done')
}

async function migrateProperties() {
  console.log('\nMigrating properties...')
  const { data, error } = await supabase.from('properties').select('*')
  if (error) { warn('Supabase error: ' + error.message); return }
  if (!data.length) { warn('No properties in Supabase'); return }
  let n = 0
  for (const p of data) {
    try {
      const images = Array.isArray(p.images) ? p.images : (p.images ? JSON.parse(p.images) : [])
      const amenities = Array.isArray(p.amenities) ? p.amenities : (p.amenities ? JSON.parse(p.amenities) : [])
      const nearby = Array.isArray(p.nearby) ? p.nearby : (p.nearby ? JSON.parse(p.nearby) : [])
      await q(
        `INSERT INTO properties (id,builder_id,builder_name,name,location,type,status,bhk,price,area,img,images,description,amenities,nearby,total_units,sold_units,possession,rera,tag,floor_plan_url,floor_plan_code,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) ON CONFLICT (id) DO NOTHING`,
        [p.id,p.builder_id,p.builder_name,p.name,p.location,p.type,p.status,p.bhk,p.price,p.area,
         p.img,images,p.description,amenities,nearby,p.total_units||0,p.sold_units||0,
         p.possession,p.rera,p.tag,p.floor_plan_url,p.floor_plan_code,p.created_at]
      )
      n++
    } catch(e) { warn('Property ' + p.id + ': ' + e.message) }
  }
  ok(n + '/' + data.length + ' properties done')
}

async function migrateArticles() {
  console.log('\nMigrating articles...')
  const { data, error } = await supabase.from('articles').select('*')
  if (error) { warn('Supabase error: ' + error.message); return }
  if (!data.length) { warn('No articles in Supabase'); return }
  let n = 0
  for (const a of data) {
    try {
      await q(
        `INSERT INTO articles (id,title,excerpt,content,author,category,img,read_time,published_at,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [a.id,a.title,a.excerpt,a.content,a.author,a.category,a.img,a.read_time,a.published_at,a.created_at]
      )
      n++
    } catch(e) { warn('Article ' + a.id + ': ' + e.message) }
  }
  ok(n + '/' + data.length + ' articles done')
}

async function migrateUsers() {
  console.log('\nMigrating users...')
  const { data: authData, error: authErr } = await supabase.auth.admin.listUsers()
  if (authErr) { warn('Auth error: ' + authErr.message); return }
  const { data: profiles } = await supabase.from('users').select('*')
  const profileMap = {}
  for (const u of (profiles || [])) profileMap[u.id] = u

  let n = 0
  for (const au of authData.users) {
    const profile = profileMap[au.id]
    const name = profile?.name || au.user_metadata?.name || au.email.split('@')[0]
    const phone = profile?.phone || au.user_metadata?.phone || null
    // Supabase doesn't expose raw password hashes — users must use Forgot Password on first login
    const placeholder = '$2a$12$placeholderHashThatNeverMatchesAnything000000000000000'
    try {
      await q(
        `INSERT INTO users (id,name,email,phone,password_hash,created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [au.id,name,au.email,phone,placeholder,au.created_at]
      )
      n++
    } catch(e) { warn('User ' + au.email + ': ' + e.message) }
  }
  ok(n + '/' + authData.users.length + ' users done')
  if (authData.users.length > 0) {
    warn('Existing users must use Forgot Password to set a new password on first login.')
  }
}

async function migrateInquiries() {
  console.log('\nMigrating inquiries...')
  const { data, error } = await supabase.from('inquiries').select('*')
  if (error) { warn('Supabase error: ' + error.message); return }
  if (!data.length) { warn('No inquiries in Supabase'); return }
  let n = 0
  for (const i of data) {
    try {
      await q(
        `INSERT INTO inquiries (id,name,phone,email,message,interest,budget,city,property_id,status,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
        [i.id,i.name,i.phone,i.email,i.message,i.interest,i.budget,i.city,i.property_id,i.status||'new',i.created_at]
      )
      n++
    } catch(e) { warn('Inquiry ' + i.id + ': ' + e.message) }
  }
  ok(n + '/' + data.length + ' inquiries done')
}

async function migrateSaved() {
  console.log('\nMigrating saved properties...')
  const { data, error } = await supabase.from('saved_properties').select('*')
  if (error) { warn('Supabase error: ' + error.message); return }
  if (!data.length) { warn('No saved properties in Supabase'); return }
  let n = 0
  for (const s of data) {
    try {
      await q(
        `INSERT INTO saved_properties (id,user_id,property_id,created_at)
         VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [s.id,s.user_id,s.property_id,s.created_at]
      )
      n++
    } catch(e) { warn('Saved ' + s.id + ': ' + e.message) }
  }
  ok(n + '/' + data.length + ' saved properties done')
}

async function main() {
  console.log('Starting Supabase to Neon migration...')
  try {
    await migrateBuilders()
    await migrateProperties()
    await migrateArticles()
    await migrateUsers()
    await migrateInquiries()
    await migrateSaved()
    console.log('\nMigration complete!')
  } catch(err) {
    console.error('Migration failed:', err.message)
  } finally {
    await pool.end()
  }
}

main()
