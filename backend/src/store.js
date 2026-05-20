import fs from 'node:fs/promises'
import path from 'node:path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const INQUIRIES_PATH = path.join(DATA_DIR, 'inquiries.json')

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true })
}

export async function readInquiries() {
  await ensureDataDir()
  try {
    const raw = await fs.readFile(INQUIRIES_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch (err) {
    if (err && err.code === 'ENOENT') return []
    throw err
  }
}

export async function appendInquiry(inquiry) {
  const existing = await readInquiries()
  existing.unshift(inquiry)
  await fs.writeFile(INQUIRIES_PATH, JSON.stringify(existing, null, 2) + '\n', 'utf8')
}

