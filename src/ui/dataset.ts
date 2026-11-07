import { api } from './api'

/** The seeded demo company, built once per page load. */
export const ds = api.loadDataset()
export const MAX_WEEK = api.maxWeek(ds)
export const PEOPLE = api.people(ds)
