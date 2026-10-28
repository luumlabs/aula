import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './i18n'
import { App } from './app/App'
import { setIconResolver } from './design/pixel/resolve'
import { CourseIconCatalog } from '@shared/schema/courseIcons'
import { installPowerPolicy } from './lib/power'

// Iconos de cursos antiguos o inventados por la IA → el pixel-art del catálogo (por asignatura y título)
setIconResolver((icon, hint) => CourseIconCatalog.resolve(icon, hint))
// lo ambiental se queda quieto cuando la ventana no se ve o nadie la usa (J4-1)
installPowerPolicy()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
