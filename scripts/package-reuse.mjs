import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const root = process.cwd()
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'ems-reuse-'))
const target = path.join(staging, 'ems-connect-starter')
fs.mkdirSync(target)
const replacements = [
  ['kxwxoemkkotsoqmneuuw', 'YOUR_SUPABASE_PROJECT_REF'],
  ['https://k119.vercel.app', 'https://your-booking-site.example'],
  ['60874bf9-2dec-4e86-b733-6cc242787f4f', 'YOUR_DRIVER_PROFILE_UUID'],
  ['fd39b056-ef5f-46c8-8799-27caa275550c', 'YOUR_VEHICLE_UUID'],
  ['70c2f308-43f3-4f27-bcd0-ab77dfe4f6e2', 'YOUR_TEST_HOSPITAL_PROFILE_UUID'],
  ['6e9e7a2b-97ad-4fec-823a-1985b9a414ac', 'YOUR_TEST_RESERVATION_UUID'],
]
function copy(source, destination) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination, { recursive: true })
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(destination, name))
    return
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (/\.(tsx?|css|sql|toml|json|md|js|html|svg)$/.test(source)) {
    let value = fs.readFileSync(source, 'utf8')
    for (const [from, to] of replacements) value = value.replaceAll(from, to)
    fs.writeFileSync(destination, value)
  } else fs.copyFileSync(source, destination)
}
for (const name of ['src', 'public', 'package.json', 'package-lock.json', 'index.html', 'vite.config.ts', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', '.gitignore']) copy(path.join(root, name), path.join(target, name))
copy(path.join(root, 'supabase'), path.join(target, 'reference-sql'))
copy(path.join(root, 'docs/REUSE-GUIDE.md'), path.join(target, 'REUSE-GUIDE.md'))
fs.writeFileSync(path.join(target, '.env.example'), '# New project only. Keep blank for disconnected preview.\nVITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=\n')
fs.writeFileSync(path.join(target, 'README.md'), '# EMS CONNECT reusable starter\n\nRead REUSE-GUIDE.md first.\n\n```sh\nnpm ci\nnpm run dev\n```\n\nNo database credentials or production patient data included. reference-sql is NOT a fresh-database bootstrap.\n')
const manifest = []
function verify(directory) {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name)
    if (fs.statSync(file).isDirectory()) { verify(file); continue }
    const relative = path.relative(target, file).replaceAll('\\', '/')
    if (/^\.env(?!\.example$)/.test(relative) || /(^|\/)(node_modules|\.git|\.vercel)(\/|$)/.test(relative)) throw new Error('Forbidden archive entry')
    const bytes = fs.readFileSync(file)
    if (/\.(tsx?|sql|toml|json|js|html|md)$/.test(file)) {
      const text = bytes.toString('utf8')
      if (/kxwxoemkkotsoqmneuuw|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9]+|-----BEGIN .*PRIVATE KEY-----/.test(text)) throw new Error(`Unexpected credentials/production project in ${relative}`)
    }
    manifest.push({ file: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })
  }
}
verify(target)
fs.writeFileSync(path.join(target, 'MANIFEST.json'), JSON.stringify({ saved: '2026-11-20', sourceCommit: 'f0921cd', files: manifest }, null, 2))
process.stdout.write(target)
