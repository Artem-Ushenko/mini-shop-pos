import sharp from 'sharp'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root  = resolve(__dir, '..')
const svg   = readFileSync(resolve(root, 'public/logo.svg'))

const sizes = [
  { file: 'public/logo-192.png',        size: 192 },
  { file: 'public/logo-512.png',        size: 512 },
  { file: 'public/apple-touch-icon.png', size: 180 },
]

for (const { file, size } of sizes) {
  await sharp(svg).resize(size, size).png().toFile(resolve(root, file))
  console.log(`✓ ${file}`)
}
