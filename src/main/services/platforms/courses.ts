// Cursos de la plataforma tal como los ve la interfaz («crear un curso desde mi plataforma»): Canvas y Moodle.
import type { PlatformCourse } from '@shared/platforms/types'
import type { CanvasCourse } from '../canvas/models'
import type { MoodleCourse } from './moodle'

export function canvasCoursesToPlatform(accountId: string, courses: CanvasCourse[]): PlatformCourse[] {
  return courses.map((c) => ({
    id: c.id,
    accountId,
    kind: 'canvas' as const,
    name: c.name,
    ...(c.courseCode && c.courseCode !== c.name ? { code: c.courseCode } : {}),
    ...(c.term?.name ? { term: c.term.name } : {}),
    url: c.url
  }))
}

export function moodleCoursesToPlatform(accountId: string, courses: MoodleCourse[]): PlatformCourse[] {
  return courses.map((c) => ({
    id: String(c.id),
    accountId,
    kind: 'moodle' as const,
    name: c.fullname,
    ...(c.shortname && c.shortname !== c.fullname ? { code: c.shortname } : {}),
    ...(c.category ? { term: c.category } : {}),
    url: c.url
  }))
}

/** Orden para la interfaz: por periodo (los más recientes primero, sin periodo al final) y por nombre. */
export function sortPlatformCourses(list: PlatformCourse[]): PlatformCourse[] {
  return [...list].sort((a, b) => {
    if (a.term && b.term && a.term !== b.term) return b.term.localeCompare(a.term, undefined, { numeric: true })
    if (a.term && !b.term) return -1
    if (!a.term && b.term) return 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
  })
}
