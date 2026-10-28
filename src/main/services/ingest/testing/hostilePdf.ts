// Solo para pruebas: el PDF hostil del juez A2 (`genpdf.py`): un único flujo de contenido «q Q» enorme, comprimido a casi nada y
// compartido por todas las páginas. pdf.js lo interpreta entero en cada página sin ceder el hilo.
import * as zlib from 'node:zlib'

export function qqBombPDF(pages: number, megabytes: number): Uint8Array {
  const unit = Buffer.from('q Q\n', 'latin1')
  const data = zlib.deflateSync(Buffer.alloc(megabytes * 1024 * 1024, unit), { level: 9 })
  const objs: Buffer[] = []
  const kids = Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(' ')
  objs.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'))
  objs.push(Buffer.from(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`))
  objs.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'))
  const content = 4 + pages
  for (let i = 0; i < pages; i++) objs.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`))
  objs.push(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`), data, Buffer.from('\nendstream')]))
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]
  let size = parts[0].length
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(size)
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')])
    parts.push(b)
    size += b.length
  })
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`
  parts.push(Buffer.from(xref))
  return new Uint8Array(Buffer.concat(parts))
}
