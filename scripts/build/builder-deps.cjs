// Módulos que ya trae electron-builder (js-yaml, plist). No se declaran aparte en package.json: se resuelven desde la
// carpeta de electron-builder, así que siguen encontrándose aunque npm los anide en vez de subirlos a la raíz.
const { dirname } = require('node:path')

function fromBuilder(name) {
  const roots = []
  for (const owner of ['app-builder-lib', 'electron-builder']) {
    try { roots.push(dirname(require.resolve(`${owner}/package.json`))) } catch { /* se prueba con el siguiente */ }
  }
  try {
    return require(require.resolve(name, { paths: roots }))
  } catch {
    throw new Error(`Cannot load "${name}", which ships with electron-builder. Run npm install and try again.`)
  }
}

module.exports = { fromBuilder }
