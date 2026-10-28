// Catálogo de herramientas. Cada una vive en tools/<id>/index.tsx (export default) y se carga bajo demanda.
// `floating: true` permite fijarla como ventanita flotante encima de cualquier pantalla (calculadora, temporizador…).
import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { Atom, Calculator, FlaskConical, LineChart, Ruler, Timer, Sigma, Grid3x3, BookMarked, Triangle, Orbit, Waves } from 'lucide-react'

export interface ToolProps {
  /** true cuando se muestra en la ventanita flotante (más compacta). */
  compact?: boolean
}

export interface ToolDef {
  id: string
  icon: typeof Calculator
  floating: boolean
  /** Palabras para la búsqueda (es y en). */
  keywords: string[]
  component: LazyExoticComponent<ComponentType<ToolProps>>
}

export const TOOLS: ToolDef[] = [
  { id: 'calculator', icon: Calculator, floating: true, keywords: ['calculadora', 'calculator', 'fracciones', 'fractions', 'raíz', 'root', 'trigonometría', 'logaritmo', 'factorial', 'combinatoria'], component: lazy(() => import('./calculator')) },
  { id: 'grapher', icon: LineChart, floating: false, keywords: ['graficadora', 'grapher', 'función', 'function', 'plot', 'gráfica', 'graph', 'paramétrica', 'parametric', 'polar', 'raíces', 'roots'], component: lazy(() => import('./grapher')) },
  { id: 'periodic', icon: Atom, floating: false, keywords: ['tabla periódica', 'periodic table', 'elementos', 'elements', 'configuración electrónica', 'electron configuration', 'electronegatividad', 'bohr'], component: lazy(() => import('./periodic')) },
  { id: 'chemistry', icon: FlaskConical, floating: false, keywords: ['química', 'chemistry', 'masa molar', 'molar mass', 'balancear', 'balance', 'estequiometría', 'stoichiometry', 'ph', 'molaridad', 'molarity', 'dilución', 'gases'], component: lazy(() => import('./chemistry')) },
  { id: 'molecules', icon: Orbit, floating: false, keywords: ['moléculas', 'molecules', '3d', 'vsepr', 'geometría molecular', 'molecular geometry', 'hibridación', 'hybridization'], component: lazy(() => import('./molecules')) },
  { id: 'units', icon: Ruler, floating: true, keywords: ['conversor', 'unidades', 'units', 'converter', 'temperatura', 'temperature', 'presión', 'pressure', 'longitud', 'length'], component: lazy(() => import('./units')) },
  { id: 'timer', icon: Timer, floating: true, keywords: ['temporizador', 'pomodoro', 'timer', 'concentración', 'focus'], component: lazy(() => import('./timer')) },
  { id: 'stats', icon: Sigma, floating: false, keywords: ['estadística', 'statistics', 'media', 'mean', 'regresión', 'regression', 'desviación', 'deviation', 'histograma', 'histogram', 'normal'], component: lazy(() => import('./stats')) },
  { id: 'matrix', icon: Grid3x3, floating: false, keywords: ['matrices', 'matrix', 'determinante', 'determinant', 'inversa', 'inverse', 'gauss', 'rref', 'rango', 'rank'], component: lazy(() => import('./matrix')) },
  { id: 'geometry', icon: Triangle, floating: false, keywords: ['geometría', 'triángulos', 'triangle', 'geometry', 'área', 'area', 'perímetro', 'perimeter', 'círculo', 'circle', 'seno', 'coseno'], component: lazy(() => import('./geometry')) },
  { id: 'physics', icon: Waves, floating: false, keywords: ['física', 'physics', 'simulación', 'simulation', 'péndulo', 'pendulum', 'tiro', 'projectile', 'muelle', 'spring', 'ondas', 'waves', 'choques', 'collisions'], component: lazy(() => import('./physics')) },
  { id: 'formulas', icon: BookMarked, floating: false, keywords: ['fórmulas', 'constantes', 'formulas', 'constants', 'chuleta', 'cheat sheet'], component: lazy(() => import('./formulas')) }
]

export const toolById = (id: string | undefined) => TOOLS.find((t) => t.id === id)
