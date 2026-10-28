// Vista previa (galería del sistema de diseño, solo desarrollo y capturas): la marca en todos sus estados y una respuesta de Aula
// a medias, con un paso hecho y otros en curso de cada clase, para ver sus animaciones sin una IA de verdad.
import { AulaMark, Card, SectionTitle, type MarkState } from '@renderer/design'
import type { AssistantMessage, AssistantStep } from '@shared/assistant/types'
import { demoText as L } from '@renderer/lib/demo'
import { Message } from './Message'

const STATES: MarkState[] = ['idle', 'thinking', 'working', 'done', 'waiting', 'paused', 'offline']

const step = (id: string, tool: string, label: string, more: Partial<AssistantStep> = {}): AssistantStep => ({ id, tool, label, ...more })

function reply(id: string, steps: AssistantStep[], text = ''): AssistantMessage {
  return { id, role: 'assistant', text, date: new Date().toISOString(), mentions: [], attachments: [], cards: [], steps, notices: [], failed: false, interrupted: false }
}

export function ActivityPreview() {
  const working = reply('preview-1', [
    step('a', 'search_course_materials', L('Buscando en los materiales del curso', 'Searching the course materials'), { ok: true, detail: L('vértice de la parábola', 'reference angle of 210°') }),
    step('b', 'read_course_material', L('Leyendo un material del curso', 'Reading a course material'), { detail: L('Apuntes del tema 3', 'Unit 3 lecture notes') }),
    step('c', 'make_flashcards', L('Preparando las tarjetas', 'Preparing the flashcards'), { count: 5 }),
    step('d', 'add_calendar_event', L('Preparando el evento', 'Preparing the event'), { detail: L('Examen de Matemáticas', 'English test') }),
    step('e', 'web_search', L('Buscando en internet', 'Searching the web'), { detail: L('forma canónica parábola', 'unit circle exact values') }),
    step('f', 'graph_function', L('Calculando la gráfica', 'Plotting the graph'), { detail: L('x^2 - 4x + 3', 'cos(x)') }),
    step('g', 'calculate', L('Calculando', 'Calculating'), { detail: L('-b/2a', 'cos(210°)') })
  ])
  const thinking = reply('preview-2', [])
  const failed = { ...reply('preview-3', []), failed: true, text: L('El proveedor no respondió a tiempo. Prueba otra vez en un momento.', "The provider didn't answer in time. Try again in a moment.") }
  const done = reply('preview-4', [step('h', 'search_course_materials', L('Buscando', 'Searching'), { ok: true, detail: L('vértice', 'exact values') }), step('i', 'read_course_material', L('Leyendo', 'Reading'), { ok: true, detail: L('Tema 3', 'Unit 3') }), step('j', 'make_quiz', L('Preparando el cuestionario', 'Preparing the quiz'), { ok: true, count: 4 }), step('k', 'web_search', L('Buscando en internet', 'Searching the web'), { ok: false })], L('Listo: aquí tienes un cuestionario de **4 preguntas** sobre el vértice.', 'Done: here is a **4-question** quiz on exact values.'))
  return (
    <Card className="col-span-12" padded="lg">
      <SectionTitle title={L('Aula trabajando', 'Aula at work')} />
      <div className="mt-3 flex flex-wrap items-end gap-6 text-text">
        {STATES.map((s) => (
          <div key={s} className="flex flex-col items-center gap-1.5 t-caption">
            <AulaMark size={56} state={s} />
            {s}
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-8 @3xl:grid-cols-2">
        <Message m={thinking} threadId="preview" streaming language={L('es', 'en')} />
        <Message m={working} threadId="preview" streaming language={L('es', 'en')} />
        <Message m={failed} threadId="preview" streaming={false} language={L('es', 'en')} onRetry={() => undefined} />
        <Message m={done} threadId="preview" streaming={false} language={L('es', 'en')} />
      </div>
    </Card>
  )
}
