export interface Trip {
  id: string           // "trip_${uuid}"
  name: string         // "东京2024"
  description?: string
  startDate: string    // ISO date "2024-03-01"
  endDate: string      // ISO date "2024-03-07"
  coverImage?: string
  emoji?: string       // 旅行图标，默认 ✈️
  markerIds?: string[]  // Places saved to this trip but not assigned to a day
  createdAt: string
  updatedAt: string
}

export interface TripDay {
  id: string           // "day_${uuid}"
  tripId: string
  date: string         // ISO date "2024-03-01" — bound to real calendar date
  title?: string       // optional custom title; if empty display "第N天 · 3月1日"
  emoji?: string       // 自定义每日图标
  colorIndex?: number  // Persisted palette slot, independent of date and ordering
  markerIds: string[]  // ordered list of marker IDs for this day (membership)
  routeChains?: RouteChain[] // Canonical routes; chains is the legacy projection
  chains: string[][]   // ordered chains of marker IDs for this day (connection lines)
                       // e.g. [[A,B,C],[D,E]] — F in markerIds but not in chains = isolated
}

export type ActiveViewMode = 'overview' | 'trip' | 'day'

export interface ActiveView {
    /** Route clicks preserve the map camera; date selectors focus the first marker. */
    focusFirstMarker?: boolean
  mode: ActiveViewMode
  tripId: string | null
  dayId: string | null
}

/** Local clock time on TripDay.date, not a timezone-converted timestamp. */
export interface Schedule {
  startTime?: string
  durationMinutes?: number // User-planned duration; never provider duration
}
export type TransportMode = 'walking' | 'cycling' | 'driving' | 'taxi' | 'bus' | 'subway' | 'train' | 'flight' | 'ferry' | 'other'
export interface ChainStop extends Schedule {
  id: string
  markerId: string
  note?: string
}
export interface ChainLeg extends Schedule {
  fromStopId: string
  toStopId: string
  mode: TransportMode
  serviceNumber?: string // Line / service number: 2号线, G123, NH920, ferry service
  note?: string
}
export interface RouteChain {
  id: string
  stops: ChainStop[]
  legs: ChainLeg[] // Active manually defined directed adjacent legs
  inactiveLegs?: ChainLeg[] // Same-route directed edges temporarily disconnected by reordering
}
