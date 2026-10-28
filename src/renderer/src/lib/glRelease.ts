// Liberar una escena de three al desmontar un <Canvas> (J4-2). R3F ya suelta el renderer y fuerza la pérdida del contexto,
// pero lo que vive fuera de React se queda: la geometría COMPARTIDA de todos los THREE.Sprite (una variable del módulo de
// three) guarda en su aviso «dispose» al renderer viejo → su contexto WebGL → el <canvas> → la pantalla entera (≈1 750
// nodos y 250 KB por visita). Al desmontar se liberan esa geometría y todo lo que quede en la escena, y el renderer.
// Solo lo importan las vistas 3D (trozos perezosos): three no entra en el arranque.
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

/** Libera geometrías, materiales y texturas de un objeto y sus hijos (los <primitive> no los libera R3F). */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] }
    mesh.geometry?.dispose?.()
    const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    for (const m of mats) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
      m.dispose()
    }
  })
}

/** La geometría que comparten todos los Sprite (three la crea una vez y nunca la suelta). */
function spriteGeometry(): THREE.BufferGeometry {
  return new THREE.Sprite().geometry
}

/** Dentro de un <Canvas>: al desmontarlo, libera lo que quede de la escena, la geometría compartida y las listas del renderer. */
export function ReleaseGL(): null {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  useEffect(
    () => () => {
      try {
        disposeObject3D(scene)
        // otras vistas 3D abiertas la vuelven a subir a su GPU sola al pintar (three lo permite tras dispose)
        spriteGeometry().dispose()
        gl.renderLists.dispose()
      } catch {
        /* contexto ya perdido: nada que liberar */
      }
    },
    [gl, scene]
  )
  return null
}
