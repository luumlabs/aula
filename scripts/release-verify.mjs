// Comprueba los feeds, bytes y firmas antes de subir. Mac conserva el puente en latest-mac desde 0.2.6.
// node scripts/release-verify.mjs [--no-signatures] release/0.2.5 [0.2.5]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DEVELOPER_FEED, LEGACY_FEED, macMode, metadataFiles, verifyMetadata } from './release-common.mjs'
import { verifyMacChannels } from './release-mac-bridge.mjs'

async function main() {
  const args = process.argv.slice(2)
  const signatures = !args.includes('--no-signatures')
  const positional = args.filter((arg) => arg !== '--no-signatures')
  const dir = resolve(positional[0] || 'release')
  const version = positional[1] || JSON.parse(readFileSync('package.json', 'utf8')).version
  const feeds = metadataFiles(dir)
  if (!feeds.length) throw new Error(`No hay feeds de actualización en ${dir}`)
  if (feeds.includes(LEGACY_FEED) || feeds.includes(DEVELOPER_FEED)) {
    await verifyMacChannels(dir, version)
    console.log(`✓ macOS: canales y originales verificados para ${version}`)
  }
  for (const feed of feeds.filter((name) => name !== LEGACY_FEED && name !== DEVELOPER_FEED)) {
    await verifyMetadata(dir, feed, { version, signatures })
    console.log(signatures ? `✓ ${feed}: archivos, hashes y firmas válidos` : `✓ ${feed}: archivos y hashes válidos (firma pendiente)`)
  }
  const expected = [LEGACY_FEED, ...(macMode(version) === 'legacy' ? [] : [DEVELOPER_FEED]), 'latest.yml', 'latest-linux.yml', 'latest-linux-arm64.yml']
  for (const feed of expected) if (!feeds.includes(feed)) console.warn(`! Falta ${feed}: esa plataforma o canal no verá la actualización`)
  console.log(`\nTodo en orden para la ${version}.`)
}

main().catch((error) => { console.error(`✗ ${error.message}\nNo subas esta carpeta.`); process.exitCode = 1 })
