import type { DataSource } from './datasource'
import { createHttpDataSource } from './http/httpAdapter'
import { createMockDataSource } from './mock/adapter'

/**
 * VITE_DATA_SOURCE=http (default) talks to the Go API at /api/v1. VITE_DATA_SOURCE=mock runs on
 * in-memory fixtures for UI work without a database (`npm run dev:mock`). Vite inlines the flag, so
 * production builds drop the mock adapter entirely.
 */
export const DATA_SOURCE_KIND: 'mock' | 'http' = import.meta.env.VITE_DATA_SOURCE === 'mock' ? 'mock' : 'http'

export const api: DataSource = import.meta.env.VITE_DATA_SOURCE === 'mock' ? createMockDataSource() : createHttpDataSource()

export type { DataSource }
