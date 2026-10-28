// Archivos tar mínimos (ustar) para las pruebas de descompresión e instalación del motor.

/** Una entrada tar: archivo ('0'), carpeta ('5'), enlace simbólico ('2'), nombre largo GNU ('L') o cabecera pax ('x'). */
export function tarEntry(name: string, o: { data?: string; type?: string; link?: string; mode?: number } = {}): Buffer {
  const header = Buffer.alloc(512)
  const data = Buffer.from(o.data ?? '')
  header.write(name, 0, 100)
  header.write(((o.mode ?? 0o644).toString(8)).padStart(7, '0') + '\0', 100)
  header.write('0000000\0', 108)
  header.write('0000000\0', 116)
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124)
  header.write('00000000000\0', 136)
  header.write('        ', 148)
  header.write(o.type ?? '0', 156)
  if (o.link) header.write(o.link, 157, 100)
  header.write('ustar\0', 257)
  header.write('00', 263)
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512)
  data.copy(padded)
  return Buffer.concat([header, padded])
}
/** El tar completo (con los dos bloques vacíos del final). */
export const tar = (...entries: Buffer[]): Buffer => Buffer.concat([...entries, Buffer.alloc(1024)])
