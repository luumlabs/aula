// Conversaciones de ejemplo para el modo demostración.
import type { AssistantThread } from '@shared/assistant/types'
import { demoText as L } from '@renderer/lib/demo'

export function demoThreads(): AssistantThread[] {
  const now = Date.now()
  const iso = (minAgo: number) => new Date(now - minAgo * 60000).toISOString()
  const base = { mentions: [], attachments: [], cards: [], steps: [], notices: [], failed: false, interrupted: false }
  return [
    {
      id: 't1',
      title: L('El vértice de una parábola', 'The vertex of a parabola'),
      created: iso(30),
      updated: iso(28),
      pinned: false,
      messages: [
        { ...base, id: 'm1', role: 'user', text: L('¿Cómo encuentro el vértice de y = x² − 4x + 3?', 'How do I find the vertex of y = x² − 4x + 3?'), date: iso(30) },
        {
          ...base,
          id: 'm2',
          role: 'assistant',
          date: iso(29),
          steps: [{ id: 's1', tool: 'calculate', label: L('Calculando', 'Calculating'), detail: '−b/2a', ok: true }, { id: 's2', tool: 'graph_function', label: L('Calculando la gráfica', 'Plotting the graph'), detail: 'x² − 4x + 3', ok: true }],
          text: L(
            'El vértice está en $x_v = -\\dfrac{b}{2a}$. Aquí $a=1$ y $b=-4$, así que $x_v = 2$ y $y_v = 2^2 - 4\\cdot 2 + 3 = -1$.\n\n**Vértice: $(2, -1)$.** Mira la gráfica: es el punto más bajo, sobre el eje de simetría $x = 2$.\n\n```aula-block\n{"id":"p1","type":"plot","title":"$y = x^2 - 4x + 3$","xMin":-1,"xMax":5,"yMin":-2,"yMax":6,"curves":[{"expr":"x^2-4x+3","label":"y = x² − 4x + 3"}],"points":[{"x":"2","y":"-1","label":"vértice"}]}\n```\n\n¿Te pongo tres ejercicios parecidos para comprobarlo?',
            'The vertex is at $x_v = -\\dfrac{b}{2a}$. Here $a=1$ and $b=-4$, so $x_v = 2$ and $y_v = 2^2 - 4\\cdot 2 + 3 = -1$.\n\n**Vertex: $(2, -1)$.** Look at the graph: it is the lowest point, on the axis of symmetry $x = 2$.\n\n```aula-block\n{"id":"p1","type":"plot","title":"$y = x^2 - 4x + 3$","xMin":-1,"xMax":5,"yMin":-2,"yMax":6,"curves":[{"expr":"x^2-4x+3","label":"y = x² − 4x + 3"}],"points":[{"x":"2","y":"-1","label":"vertex"}]}\n```\n\nShall I give you three similar exercises to check it?'
          ),
          cards: [
            { id: 'c1', kind: 'question', title: L('¿Practicamos?', 'Shall we practice?'), options: [{ id: 'o1', label: L('Sí, tres ejercicios', 'Yes, three exercises') }, { id: 'o2', label: L('Mejor otra explicación', 'Explain it another way') }], allowsOther: true, items: [], facts: [], state: 'pending', actions: [] }
          ]
        }
      ]
    },
    {
      id: 't2',
      title: L('Prueba de inglés del lunes', "Monday's English test"),
      created: iso(200),
      updated: iso(190),
      pinned: true,
      messages: [
        { ...base, id: 'm3', role: 'user', text: L('El lunes tengo prueba de inglés', 'I have an English test on Monday'), date: iso(200) },
        {
          ...base,
          id: 'm4',
          role: 'assistant',
          date: iso(199),
          text: L('¡Vamos a prepararla! La apunto en tu calendario.', "Let's get ready for it! I'll put it in your calendar."),
          steps: [{ id: 's3', tool: 'add_calendar_event', label: L('Preparando el evento', 'Preparing the event'), detail: L('Prueba de inglés', 'English test'), ok: true }],
          cards: [
            { id: 'c2', kind: 'question', title: L('¿A qué hora es la prueba?', 'What time is the test?'), options: [], allowsOther: true, items: [], facts: [], state: 'answered', answer: '10:00', actions: [] },
            { id: 'c3', kind: 'course', title: L('Inglés · prueba del lunes', "English · Monday's test"), detail: L('Reuniendo tus materiales', 'Gathering your materials'), options: [], allowsOther: false, items: [], facts: [], state: 'pending', packID: 'demo-ingles', actions: [{ id: 'a1', kind: 'open', label: L('Ver progreso', 'See progress'), prominent: true, courseID: 'demo-ingles' }] }
          ]
        }
      ]
    },
    { id: 't3', title: L('¿Qué entra en el examen?', "What's on the exam?"), created: iso(3000), updated: iso(2900), pinned: false, messages: [{ ...base, id: 'm5', role: 'user', text: L('¿Qué entra en el examen?', "What's on the exam?"), date: iso(3000) }, { ...base, id: 'm6', role: 'assistant', text: L('Según el temario, los temas 3 y 4.', 'According to the syllabus, units 3 and 4.'), date: iso(2990) }] }
  ]
}
