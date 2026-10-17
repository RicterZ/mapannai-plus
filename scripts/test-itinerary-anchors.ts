import assert from 'node:assert/strict'
import { itineraryAnchors } from '../src/lib/map/itinerary-anchors'
import type { Marker } from '../src/types/marker'
import type { TripDay } from '../src/types/trip'
const markers = [0, .01, .02, 1].map((longitude, i) => ({id:String(i),coordinates:{longitude,latitude:35}})) as Marker[]
const day: TripDay = {id:'day',tripId:'trip',date:'2027-01-01',markerIds:['0','1','2','3'],chains:[['0','1','2','3']]}
assert.deepEqual(itineraryAnchors([day],markers).get('day'),['2','3'])
const scheduled = {...day,routeChains:[{id:'r',legs:[],stops:day.chains[0].map((markerId,i)=>({id:`s${i}`,markerId,durationMinutes:i===1||i===2?120:10}))}]}
assert.deepEqual(itineraryAnchors([scheduled],markers).get('day'),['1','2'])
assert.deepEqual(itineraryAnchors([{...day,chains:[['0','1']]}],markers).get('day'),['3'])
assert.deepEqual(itineraryAnchors([{...day,chains:[],markerIds:[]}],markers).get('day'),[])
console.log('Automatic itinerary anchor checks passed')
