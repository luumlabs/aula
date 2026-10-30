// V6 · el portátil en 3D (three, solo en la página del compositor): genérico y sin marca (sin logo ni muesca), de aluminio
// cálido; base con un teclado sugerido y un trackpad; tapa con marco fino de cristal negro y la pantalla, que muestra la
// ventana entera de Aula a la resolución de la captura (emisiva, sin tono: los colores de la app tal cual), con un reflejo
// sutil del cuarto. Sombra suave sobre el papel (sombra de contacto + la de la luz principal). Se dibuja con fondo
// transparente encima del papel del compositor, supermuestreado (el texto de la pantalla, nítido). La cámara y la tapa
// salen de la geometría pura de montage/laptop.ts (la misma proyección, con su desplazamiento de objetivo).
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { laptopDims, lidRotation, projectionMatrix, screenPower, type LaptopCamera, type LaptopDims } from '../montage/laptop.ts'

/** Luz del cuarto: 0 = día (papel claro), 1 = noche (lámpara cálida y la pantalla que alumbra el teclado). `gloss`
 *  (0–1, por defecto 1): el reflejo del cristal de la pantalla (se apaga mientras la pantalla enseña el icono). */
export interface LaptopLook {
  night: number
  gloss?: number
}

const NEAR = 5
const FAR = 4000

/** Rectángulo de esquinas redondas centrado en el origen. */
function rounded(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** Losa de esquinas redondas (planta w × d, grosor t, canto biselado b) apoyada en y = 0. */
function slab(w: number, d: number, t: number, r: number, b: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(rounded(w - 2 * b, d - 2 * b, Math.max(0.05, r - b)), { depth: t - 2 * b, bevelEnabled: true, bevelThickness: b, bevelSize: b, bevelSegments: 5, curveSegments: 24 })
  g.rotateX(-Math.PI / 2)
  g.translate(0, b, 0)
  g.computeVertexNormals()
  return g
}

/** Forma plana (rounded) tumbada en el plano y = 0, mirando hacia arriba. */
function flat(w: number, d: number, r: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(rounded(w, d, r), 16)
  g.rotateX(-Math.PI / 2)
  return g
}

/** Teclado sugerido: filas de teclas (anchos en unidades de tecla), 14,5 unidades por fila. */
const ROWS: { h: number; keys: number[] }[] = [
  { h: 0.62, keys: [1.5, ...Array(12).fill(1), 1] },
  { h: 1, keys: [...Array(13).fill(1), 1.5] },
  { h: 1, keys: [1.5, ...Array(12).fill(1), 1] },
  { h: 1, keys: [1.75, ...Array(11).fill(1), 1.75] },
  { h: 1, keys: [2.25, ...Array(10).fill(1), 2.25] },
  { h: 1, keys: [1, 1, 1, 1.25, 5, 1.25, 1, 1, 1, 1] }
]

/** Textura de la sombra de contacto: la planta de la base, desenfocada (blanco = sombra). */
function contactTexture(d: LaptopDims, pad: number): THREE.Texture {
  const W = 512
  const H = Math.round((W * (d.baseD + 2 * pad)) / (d.baseW + 2 * pad))
  const c = new OffscreenCanvas(W, H)
  const g = c.getContext('2d')!
  const k = W / (d.baseW + 2 * pad)
  g.fillStyle = '#000'
  g.fillRect(0, 0, W, H)
  // un borde apretado (el contacto) y un halo ancho y suave (la oclusión del cuarto), algo corrido hacia atrás
  g.filter = `blur(${(0.5 * k).toFixed(1)}px)`
  g.fillStyle = '#fff'
  g.beginPath()
  g.roundRect((pad + 0.15) * k, (pad + 0.15) * k, (d.baseW - 0.3) * k, (d.baseD - 0.3) * k, 1.2 * k)
  g.fill()
  g.filter = `blur(${(2.2 * k).toFixed(1)}px)`
  g.globalAlpha = 0.7
  g.beginPath()
  g.roundRect((pad - 0.8) * k, (pad - 1.4) * k, (d.baseW + 1.6) * k, (d.baseD + 2.2) * k, 2.2 * k)
  g.fill()
  const t = new THREE.CanvasTexture(c as unknown as HTMLCanvasElement)
  t.colorSpace = THREE.NoColorSpace
  return t
}

export class LaptopRenderer {
  readonly canvas: OffscreenCanvas
  private readonly gl: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera()
  private readonly lid = new THREE.Group()
  private readonly display: THREE.MeshPhysicalMaterial
  private readonly texture: THREE.CanvasTexture
  private readonly key: THREE.DirectionalLight
  private readonly hemi: THREE.HemisphereLight
  private readonly glow: THREE.SpotLight
  private readonly shadow: THREE.ShadowMaterial
  private readonly contact: THREE.MeshBasicMaterial
  private readonly aluminium: THREE.MeshPhysicalMaterial
  private readonly d: LaptopDims

  /** `W × H`: el cuadro del montaje; `ss`: supermuestreo; `screen`: el lienzo de la pantalla (su textura). */
  constructor(W: number, H: number, ss: number, screen: OffscreenCanvas, aspectScreen = 1.6) {
    const d = (this.d = laptopDims(aspectScreen))
    this.canvas = new OffscreenCanvas(Math.round(W * ss), Math.round(H * ss))
    const gl = (this.gl = new THREE.WebGLRenderer({ canvas: this.canvas as unknown as HTMLCanvasElement, antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }))
    gl.setPixelRatio(1)
    gl.setSize(this.canvas.width, this.canvas.height, false)
    gl.setClearColor(0x000000, 0)
    gl.outputColorSpace = THREE.SRGBColorSpace
    gl.toneMapping = THREE.NeutralToneMapping
    gl.toneMappingExposure = 1
    gl.shadowMap.enabled = true
    gl.shadowMap.type = THREE.VSMShadowMap

    // el cuarto: estudio neutro (reflejos del aluminio y del cristal) y una luz principal cálida que da la sombra
    const pmrem = new THREE.PMREMGenerator(gl)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.key = new THREE.DirectionalLight('#fff2e2', 2.4)
    this.key.position.set(-62, 70, 38)
    this.key.target.position.set(0, 4, -2)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(2048, 2048)
    Object.assign(this.key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 10, far: 260 })
    this.key.shadow.radius = 18
    this.key.shadow.blurSamples = 24
    this.key.shadow.bias = -0.0004
    this.scene.add(this.key, this.key.target)
    this.hemi = new THREE.HemisphereLight('#fffaf2', '#cdb79c', 0.45)
    this.scene.add(this.hemi)

    // materiales: aluminio cálido (crema, gris cálido), teclas de carbón tibio, cristal negro, pantalla emisiva
    this.aluminium = new THREE.MeshPhysicalMaterial({ color: '#d6ccbf', metalness: 0.82, roughness: 0.36, clearcoat: 0.12, clearcoatRoughness: 0.4 })
    const keys = new THREE.MeshPhysicalMaterial({ color: '#2b2724', metalness: 0.1, roughness: 0.62 })
    const well = new THREE.MeshStandardMaterial({ color: '#171513', metalness: 0.2, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
    const pad = new THREE.MeshPhysicalMaterial({ color: '#c9bfb2', metalness: 0.78, roughness: 0.44, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    const padRim = new THREE.MeshStandardMaterial({ color: '#8f877c', metalness: 0.7, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
    const glass = new THREE.MeshPhysicalMaterial({ color: '#0b0a09', metalness: 0, roughness: 0.32, specularIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })
    const hingeMat = new THREE.MeshStandardMaterial({ color: '#2c2724', metalness: 0.6, roughness: 0.4 })
    this.texture = new THREE.CanvasTexture(screen as unknown as HTMLCanvasElement)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = gl.capabilities.getMaxAnisotropy()
    this.texture.minFilter = THREE.LinearMipmapLinearFilter
    this.texture.magFilter = THREE.LinearFilter
    this.texture.generateMipmaps = true
    // la pantalla: la ventana tal cual (emisiva y sin tono) bajo un cristal que refleja un poco el cuarto
    this.display = new THREE.MeshPhysicalMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: this.texture, emissiveIntensity: 1, metalness: 0, roughness: 0.22, specularIntensity: 0.12, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })

    // base
    const base = new THREE.Group()
    const body = new THREE.Mesh(slab(d.baseW, d.baseD, d.baseT, 1.1, 0.32), this.aluminium)
    body.castShadow = true
    body.receiveShadow = true
    base.add(body)
    // teclado: el pozo oscuro y las teclas (en grupos del mismo ancho)
    const rowW = 14.5
    const u = 26.4 / rowW
    const gap = 0.26
    const kbDepth = ROWS.reduce((a, r) => a + r.h, 0) * u
    const kbBack = -d.baseD / 2 + 2.15
    const wellMesh = new THREE.Mesh(flat(rowW * u + 0.5, kbDepth + 0.5, 0.45), well)
    wellMesh.position.set(0, d.baseT + 0.004, kbBack + kbDepth / 2)
    wellMesh.receiveShadow = true
    base.add(wellMesh)
    const byWidth = new Map<string, THREE.Matrix4[]>()
    let z = kbBack
    for (const row of ROWS) {
      let x = (-rowW * u) / 2
      for (const w of row.keys) {
        const id = `${w}:${row.h}`
        const m = new THREE.Matrix4().makeTranslation(x + (w * u) / 2, d.baseT - 0.03, z + (row.h * u) / 2)
        byWidth.set(id, [...(byWidth.get(id) ?? []), m])
        x += w * u
      }
      z += row.h * u
    }
    for (const [id, ms] of byWidth) {
      const [w, h] = id.split(':').map(Number)
      const inst = new THREE.InstancedMesh(new RoundedBoxGeometry(w * u - gap, 0.16, h * u - gap, 3, 0.07), keys, ms.length)
      ms.forEach((m, i) => inst.setMatrixAt(i, m))
      inst.receiveShadow = true
      base.add(inst)
    }
    // trackpad: cristal mate con un canto fino
    const padW = 12.2
    const padD = 7.6
    const padZ = kbBack + kbDepth + 1.25 + padD / 2
    const rim = new THREE.Mesh(flat(padW + 0.14, padD + 0.14, 0.62), padRim)
    rim.position.set(0, d.baseT + 0.006, padZ)
    const padMesh = new THREE.Mesh(flat(padW, padD, 0.55), pad)
    padMesh.position.set(0, d.baseT + 0.008, padZ)
    rim.receiveShadow = padMesh.receiveShadow = true
    base.add(rim, padMesh)
    // bisagra
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, d.baseW - 5, 32), hingeMat)
    hinge.rotation.z = Math.PI / 2
    hinge.position.set(0, d.hinge.y - 0.05, d.hinge.z - 0.05)
    base.add(hinge)
    this.scene.add(base)

    // tapa (sistema de la tapa: y hacia arriba desde la bisagra, z fuera de la pantalla; cara de la pantalla en z = 0)
    const back = new THREE.Mesh(slab(d.baseW, d.lidH, d.lidT, 0.95, 0.16), this.aluminium)
    // la losa está tumbada (planta en xz): se pone de pie con su cara en z = 0
    back.geometry.rotateX(Math.PI / 2)
    back.geometry.translate(0, d.lidH / 2, 0)
    back.castShadow = true
    back.receiveShadow = true
    const bezel = new THREE.Mesh(new THREE.ShapeGeometry(rounded(d.baseW - 0.12, d.lidH - 0.12, 0.85), 16), glass)
    bezel.position.set(0, d.lidH / 2, 0.003)
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(d.screenW, d.screenH), this.display)
    panel.position.set(0, d.bezel.bottom + d.screenH / 2, 0.006)
    // de noche, la pantalla alumbra el teclado y el papel de delante (luz suave, del color del papel de la app)
    this.glow = new THREE.SpotLight('#fff3e2', 0, 0, 1.15, 1, 2)
    this.glow.position.set(0, d.bezel.bottom + d.screenH * 0.45, 1.5)
    this.glow.target.position.set(0, -2, 26)
    this.lid.add(back, bezel, panel, this.glow, this.glow.target)
    this.lid.position.set(0, d.hinge.y, d.hinge.z)
    this.scene.add(this.lid)
    // la losa de la tapa: tras rotateX(π/2) su grosor va de z = −lidT… 0 (cara de la pantalla delante)
    back.geometry.computeBoundingBox()
    const bb = back.geometry.boundingBox!
    back.geometry.translate(0, 0, -bb.max.z)

    // suelo: solo sombras (la de la luz y la de contacto), en tono tierra sobre el papel
    this.shadow = new THREE.ShadowMaterial({ color: '#5b412b', opacity: 0.34 })
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), this.shadow)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    this.scene.add(ground)
    const PAD = 4
    this.contact = new THREE.MeshBasicMaterial({ color: '#3b2919', transparent: true, opacity: 0.62, alphaMap: contactTexture(d, PAD), depthWrite: false })
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(d.baseW + 2 * PAD, d.baseD + 2 * PAD), this.contact)
    contact.rotation.x = -Math.PI / 2
    contact.position.y = 0.02
    contact.renderOrder = -1
    this.scene.add(contact)
  }

  /** Dibuja el portátil con la cámara `cam` y la pantalla tal como está ahora en su lienzo. */
  render(cam: LaptopCamera, look: LaptopLook): OffscreenCanvas {
    const n = Math.min(1, Math.max(0, look.night))
    // la tapa
    this.lid.rotation.x = lidRotation(cam.lid)
    // la pantalla: se enciende al abrirse; la textura se vuelve a subir en cada fotograma
    this.display.emissiveIntensity = screenPower(cam.lid)
    this.texture.needsUpdate = true
    // luz: de día, estudio claro; de noche, una lámpara de mesa cálida y baja a la izquierda, el cuarto apagado y la
    // pantalla que alumbra el teclado
    this.scene.environmentIntensity = 0.95 - 0.72 * n
    this.key.color.lerpColors(new THREE.Color('#fff2e2'), new THREE.Color('#ffbf80'), n)
    this.key.position.set(-62 + 14 * n, 70 - 26 * n, 38 - 6 * n)
    this.key.intensity = 2.4 - 1.15 * n
    this.hemi.intensity = 0.45 - 0.36 * n
    this.glow.intensity = 900 * n * screenPower(cam.lid)
    this.display.specularIntensity = 0.12 * (look.gloss ?? 1)
    this.shadow.opacity = 0.34 + 0.12 * n
    this.contact.opacity = 0.62 + 0.15 * n
    // la cámara: la misma que la geometría pura (posición, mirada y proyección con desplazamiento de objetivo)
    const c = this.camera
    c.position.set(...cam.position)
    c.up.set(0, 1, 0)
    c.lookAt(...cam.target)
    c.updateMatrixWorld(true)
    c.projectionMatrix.fromArray(projectionMatrix(cam, NEAR, FAR))
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert()
    this.gl.render(this.scene, c)
    return this.canvas
  }
}
