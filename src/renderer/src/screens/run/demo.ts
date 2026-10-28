// Una creación de ejemplo que avanza sola (modo demostración).
import type { AgentLaneView, GenerationStage, RunView, StageStatus } from '@shared/generation/types'
import { GENERATION_STAGES } from '@shared/generation/types'
import { demoText as L } from '@renderer/lib/demo'

export function demoRun(id: string, t0: number): RunView {
  const elapsed = (Date.now() - t0) / 1000
  const stageIdx = Math.min(3, 2 + Math.floor(elapsed / 8))
  const stage = GENERATION_STAGES[stageIdx]
  const stages = Object.fromEntries(GENERATION_STAGES.map((s, i) => [s, (i < stageIdx ? 'done' : i === stageIdx ? 'running' : 'pending') as StageStatus])) as Record<GenerationStage, StageStatus>
  stages.gather = 'skipped'
  const now = new Date().toISOString()
  const lane = (id: string, role: AgentLaneView['role'], title: string, current: string, steps: number, status: AgentLaneView['status'] = 'working'): AgentLaneView => ({ id, role, stage: 'author', title, current, status, steps, provider: 'Claude', startedAt: now })
  return {
    id,
    packId: 'demo-quimica',
    title: L('Química general · Examen final', 'General Chemistry · Final exam'),
    icon: 'chemistry',
    hue: 0.38,
    mode: 'create',
    state: 'running',
    stage,
    stages,
    progress: Math.min(0.92, 0.18 + elapsed / 60),
    provider: 'Claude',
    startedAt: new Date(t0 - 120000).toISOString(),
    lanes: [
      lane('l1', 'planner', L('Plan del curso', 'Course plan'), L('Plan listo: 8 temas ordenados por prerrequisitos', 'Plan ready: 8 topics ordered by prerequisites'), 14, 'done'),
      lane('l2', 'lesson', L('Masa molar', 'Molar mass'), L('Escribiendo la lección: ejemplo resuelto del agua', 'Writing the lesson: worked example with water'), 9 + Math.floor(elapsed)),
      lane('l3', 'exercises', L('Masa molar', 'Molar mass'), L('Preparando 12 ejercicios con plantillas', 'Preparing 12 exercises with templates'), 7 + Math.floor(elapsed / 2)),
      lane('l4', 'lesson', L('Balanceo de ecuaciones', 'Balancing equations'), L('Dibujando el diagrama de la reacción', 'Drawing the reaction diagram'), 5 + Math.floor(elapsed / 1.5)),
      lane('l5', 'verifier', L('El mol y Avogadro', 'The mole and Avogadro'), L('Resolviendo sin ver la clave: 6 de 10', 'Solving without the answer key: 6 of 10'), 11),
      lane('l6', 'cards', L('Estequiometría', 'Stoichiometry'), L('Haciendo 10 tarjetas', 'Making 10 flashcards'), 3 + Math.floor(elapsed / 3))
    ],
    skills: [
      { id: 'a', title: L('El mol y Avogadro', 'The mole and Avogadro'), status: 'verifying', attempts: 1, note: '', openIssues: 0 },
      { id: 'b', title: L('Masa molar', 'Molar mass'), status: 'running', attempts: 1, note: '', openIssues: 0 },
      { id: 'c', title: L('Balanceo de ecuaciones', 'Balancing equations'), status: 'running', attempts: 1, note: '', openIssues: 0 },
      { id: 'd', title: L('Estequiometría', 'Stoichiometry'), status: 'running', attempts: 1, note: '', openIssues: 0 },
      { id: 'e', title: L('Reactivo limitante', 'Limiting reagent'), status: 'pending', attempts: 0, note: '', openIssues: 0 },
      { id: 'f', title: L('Disoluciones', 'Solutions'), status: 'pending', attempts: 0, note: '', openIssues: 0 },
      { id: 'g', title: L('Gases ideales', 'Ideal gases'), status: 'pending', attempts: 0, note: '', openIssues: 0 },
      { id: 'h', title: L('Ácidos y bases', 'Acids and bases'), status: 'done', attempts: 1, note: '', openIssues: 0 }
    ],
    findings: L(
      'El examen final vale **100 puntos**, dura 2 horas y permite calculadora científica. Según el programa, entran los temas 1 a 6; el profesor insiste en **cifras significativas** y en mostrar el procedimiento.',
      'The final exam is worth **100 points**, lasts 2 hours and allows a scientific calculator. According to the syllabus, units 1 to 6 are included; the professor insists on **significant figures** and on showing your work.'
    )
  }
}
