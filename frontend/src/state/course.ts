import type { Course } from '../types/state';
import type { Concept, Level } from '../types/domain';

/**
 * The one place a Course is constructed.
 *
 * Concept ids arrive from the provider numbered per path -- "1".."7" -- which
 * means every course in the app has a concept called "1". Nothing in the store
 * is scoped by course, so a `concepts.find(c => c.id === record.conceptIds[0])`
 * against the wrong course resolved happily to a different subject's concept:
 * the Progress history showed a probability session labelled with a chess
 * concept and that concept's mastery numbers, and an old `/session/1` deep link
 * silently opened whatever concept "1" was in the course you had since switched
 * to. Wrong data, no error.
 *
 * Namespacing at construction fixes it at the source rather than at each of the
 * (currently five, eventually more) lookup sites. The id stays opaque and
 * URL-safe; nothing parses it.
 */
export function namespaceConceptId(courseId: string, conceptId: string): string {
  return `${courseId}.${conceptId}`;
}

export interface NewCourse {
  id: string;
  topic: string;
  goal: string;
  level: Level;
  dailyTimeMin: number;
  createdAt: number;
  concepts: Concept[];
}

export function makeCourse(c: NewCourse): Course {
  return {
    id: c.id,
    topic: c.topic,
    goal: c.goal,
    level: c.level,
    dailyTimeMin: c.dailyTimeMin,
    createdAt: c.createdAt,
    archivedAt: null,
    concepts: c.concepts.map((concept) => ({
      ...concept,
      id: namespaceConceptId(c.id, concept.id),
    })),
  };
}
