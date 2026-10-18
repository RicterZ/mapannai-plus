import assert from 'node:assert/strict'
import { itineraryAnchors } from '../src/lib/map/itinerary-anchors'
import type { Marker } from '../src/types/marker'
import type { TripDay } from '../src/types/trip'
const markers = [0, .01, .02, 1].map((longitude, i) => ({id:String(i),coordinates:{longitude,latitude:35}})) as Marker[]
const day: TripDay = {id:'day',tripId:'trip',date:'2027-01-01',markerIds:['0','1','2','3'],chains:[['0','1','2','3']]}
assert.deepEqual(itineraryAnchors([day],markers).get('day'),['0','3'])
const scheduled = {...day,routeChains:[{id:'r',legs:[],stops:day.chains[0].map((markerId,i)=>({id:`s${i}`,markerId,durationMinutes:i===1||i===2?120:10}))}]}
assert.deepEqual(itineraryAnchors([scheduled],markers).get('day'),['1','2'], 'Longest visits outrank exceptional travel endpoints')
const akihabara = {...scheduled,routeChains:[{...scheduled.routeChains[0],stops:scheduled.routeChains[0].stops.map(stop=>({...stop,durationMinutes:stop.markerId==='2'?240:10}))}]}
assert.deepEqual(itineraryAnchors([akihabara],markers).get('day'),['2'], 'A day with a longest visit must not add low-priority endpoints')
assert.deepEqual(itineraryAnchors([{...scheduled,chains:[['0','1','2']],markerIds:['0','1','2'],routeChains:[{...scheduled.routeChains[0],stops:scheduled.routeChains[0].stops.slice(0,3)}]}],markers).get('day'),['1','2'])
assert.deepEqual(itineraryAnchors([{...day,chains:[['0','1']]}],markers).get('day'),['3'])
assert.deepEqual(itineraryAnchors([{...day,chains:[],markerIds:[]}],markers).get('day'),[])
console.log('Automatic itinerary anchor checks passed')

const highlighted = {...scheduled,routeChains:[{...scheduled.routeChains[0],stops:scheduled.routeChains[0].stops.map(stop=>({...stop,isHighlight:stop.markerId==='0'||stop.markerId==='3'}))}]}
assert.deepEqual(itineraryAnchors([highlighted],markers).get('day'),['0','3'], 'Explicit highlights override longest stays')
assert.deepEqual(itineraryAnchors([scheduled],markers).get('day'),['1','2'], 'Highlights never affect another day/visit')
const cancelled = {...highlighted,routeChains:[{...highlighted.routeChains[0],stops:highlighted.routeChains[0].stops.map(stop=>({...stop,isHighlight:false}))}]}
assert.deepEqual(itineraryAnchors([cancelled],markers).get('day'),['1','2'], 'Clearing highlights restores automatic selection')
