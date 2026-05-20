import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

import { properties, builders } from '../../src/data/properties.js'
import { articles, featuredArticle } from '../../src/data/articlesData.js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function migrate() {
  console.log('🚀 Migration starting...')

  // 1. Builders migrate
  console.log('📦 Migrating builders...')
  const { error: buildersError } = await supabase
    .from('builders')
    .upsert(builders.map(b => ({
      id: b.id,
      name: b.name,
      badge: b.badge,
      since: b.since,
    })))
  if (buildersError) console.error('❌ Builders error:', buildersError.message)
  else console.log(`✅ ${builders.length} builders migrated!`)

  // 2. Properties migrate
  console.log('🏠 Migrating properties...')
  const { error: propsError } = await supabase
    .from('properties')
    .upsert(properties.map(p => ({
      id: p.id,
      builder_id: p.builderId,
      builder_name: p.builderName,
      name: p.name,
      location: p.location,
      type: p.type,
      status: p.status,
      bhk: p.bhk,
      price: p.price,
      area: p.area,
      img: p.img,
      images: p.images,
      description: p.desc,
      amenities: p.amenities,
      nearby: p.nearby,
      total_units: p.totalUnits,
      sold_units: p.soldUnits,
      possession: p.possession,
      rera: p.rera,
      tag: p.tag,
    })))
  if (propsError) console.error('❌ Properties error:', propsError.message)
  else console.log(`✅ ${properties.length} properties migrated!`)

  // 3. Articles migrate — slug as id
  console.log('📰 Migrating articles...')
  const allArticles = [featuredArticle, ...articles]
  const { error: articlesError } = await supabase
    .from('articles')
    .upsert(allArticles.map(a => ({
      id: a.slug,           // slug = id
      title: a.title,
      excerpt: a.desc,
      content: JSON.stringify(a.body),  // body array JSON-a store pannuvom
      author: a.author,
      category: a.cat,
      img: a.img,
      read_time: a.read,
      published_at: new Date().toISOString(),
    })))
  if (articlesError) console.error('❌ Articles error:', articlesError.message)
  else console.log(`✅ ${allArticles.length} articles migrated!`)

  console.log('🎉 Migration complete!')
}

migrate()