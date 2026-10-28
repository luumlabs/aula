// El equipo de IA que crea y amplía cursos (port de StudyEngine/Pipeline): la tubería por etapas, los agentes (el modelo activo
// o el equipo simulado de `AULA_FAKE_AI`), el área de preparación de materiales y el servicio que usa el IPC.
import type { GenerationRequest } from '@engine/pipeline'
import { tr } from '@shared/ai/i18n'
import { FAKE_PROVIDER_ID, resolveActiveModel } from '../ai'
import { calendarService } from '../calendar'
import { getSettings } from '../settings'
import { getLibrary } from '../store'
import { LiveWebAccess } from '../tools'
import { calendarCampus, courseSearch, packImporter } from './adapters'
import { modelAgents, scriptedAgents, type PipelineAgents } from './agents'
import { DraftStore, type MaterialListener } from './drafts'
import { fakeTeamScript } from './fakeTeam'
import type { PipelineServices } from './runner'
import { GenerationService, type GenerationServiceOptions } from './service'

export * from './agents'
export * from './gate'
export * from './labels'
export * from './runner'
export * from './drafts'
export * from './fakeTeam'
export * from './adapters'
export * from './service'

/** Los agentes con el modelo de IA activo; con la IA simulada, el equipo simulado (que usa las herramientas reales). */
export async function activeAgents(request: GenerationRequest): Promise<PipelineAgents> {
  const model = await resolveActiveModel()
  if (model.providerId === FAKE_PROVIDER_ID) {
    return scriptedAgents(fakeTeamScript(request, { delayMs: Number(process.env.AULA_FAKE_TEAM_DELAY_MS ?? 350) }), { provider: model.model ? `${model.providerName} · ${model.model}` : model.providerName })
  }
  return modelAgents(model)
}

/** Los servicios reales de las herramientas (web, materiales, calendario). El navegador y el rasterizador los pone Electron. */
export function defaultPipelineServices(extra: Partial<PipelineServices> = {}): PipelineServices {
  return { search: courseSearch, importer: packImporter, web: new LiveWebAccess(), campus: calendarCampus(), ...extra }
}

/** El servicio de la app (la carpeta de datos, los ajustes y el modelo activo). */
export function createGenerationService(o: { emit?: GenerationServiceOptions['emit']; onMaterial?: MaterialListener; services?: Partial<PipelineServices> } = {}): GenerationService {
  return new GenerationService({
    library: getLibrary,
    agents: activeAgents,
    services: defaultPipelineServices(o.services),
    drafts: new DraftStore(undefined, o.onMaterial),
    emit: o.emit,
    linkEvent: (eventId, packId) => calendarService().link(eventId, packId),
    maxParallel: () => getSettings().ai.maxParallel,
    webSearch: () => getSettings().data.webSearch,
    language: () => (tr('es', 'en') === 'en' ? 'en' : 'es')
  })
}
