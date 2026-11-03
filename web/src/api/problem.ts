import type { Problem } from './types'

/** An application/problem+json error (or a client-side equivalent). */
export class ApiProblem extends Error implements Problem {
  readonly type: string
  readonly title: string
  readonly status: number
  readonly detail: string
  /** Optional field-level errors keyed by request field (server extension or client mapping). */
  readonly fieldErrors?: Record<string, string>

  constructor(problem: Problem & { fieldErrors?: Record<string, string> }) {
    super(problem.detail || problem.title)
    this.name = 'ApiProblem'
    this.type = problem.type
    this.title = problem.title
    this.status = problem.status
    this.detail = problem.detail
    this.fieldErrors = problem.fieldErrors
  }

  static is(value: unknown): value is ApiProblem {
    return value instanceof ApiProblem
  }
}

export function isProblemShape(value: unknown): value is Problem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.title === 'string' && typeof v.status === 'number'
}

export function problemMessage(error: unknown): string {
  if (ApiProblem.is(error)) return error.detail || error.title
  if (error instanceof Error) return error.message
  return 'Something went wrong. Try again.'
}

export function isUnauthorized(error: unknown): boolean {
  return ApiProblem.is(error) && error.status === 401
}
