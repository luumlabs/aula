// Solo para las capturas del vídeo (se carga con NODE_OPTIONS=--require en el proceso principal de la app capturada):
// sin vigilantes de archivos. Sus avisos (FSEvents) llegan en tiempo real y en momentos imprevisibles y hacen que la
// interfaz recargue datos en un fotograma u otro. Los cambios que hace la propia app se siguen avisando por su cuenta.
const fs = require('fs')
const { EventEmitter } = require('events')
function dummy() {
  const e = new EventEmitter()
  e.close = () => {}
  e.ref = () => e
  e.unref = () => e
  return e
}
fs.watch = () => dummy()
fs.watchFile = () => {}
fs.unwatchFile = () => {}
