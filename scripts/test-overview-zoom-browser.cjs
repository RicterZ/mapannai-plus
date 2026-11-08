// All application requests use fixtures. No production data or provider calls.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
async function main() {
    const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
        const errors=[];page.on('pageerror',error=>errors.push(error.message))
        await page.addInitScript(()=>{
            localStorage.setItem('mapViewState',JSON.stringify({longitude:139,latitude:35,zoom:14}))
            window.jobs=0;window.results=0;const Original=window.Worker
            window.Worker=class extends Original { constructor(...args){super(...args);if(String(args[0]).includes('/_next/static/')){window.jobs++;this.addEventListener('message',()=>window.results++)}} }
        })
        const features=Array.from({length:6},(_,i)=>({type:'Feature',id:`m${i}`,geometry:{type:'Point',coordinates:[139+i*.001,35]},properties:{metadata:{id:`m${i}`,title:`Fixture ${i}`}}}))
        const trips=Array.from({length:20},(_,i)=>({id:`t${i}`,name:`Fixture trip ${i}`,startDate:'2027-01-01',endDate:'2027-01-01',markerIds:[],days:[{id:`d${i}`,tripId:`t${i}`,date:'2027-01-01',markerIds:features.map(f=>f.id),chains:[features.map(f=>f.id)]}]}))
        await page.route('**/api/**',route=>{
            const url=new URL(route.request().url())
            if(url.pathname==='/api/dataset')return route.fulfill({json:{success:true,data:{type:'FeatureCollection',features}}})
            if(url.pathname==='/api/trips')return route.fulfill({json:trips})
            if(url.pathname==='/api/markers')return route.fulfill({json:[]})
            return route.fulfill({status:400,json:{error:'fixture offline'}})
        })
        await page.goto(process.env.REVIEW_BASE_URL||'http://127.0.0.1:3108')
        await page.waitForFunction(()=>location.hash==='#trip/t0')
        await page.getByRole('button',{name:'返回全览'}).click()
        await page.waitForFunction(()=>window.results>0)
        const initial=await page.evaluate(()=>{window.samples=[];window.frames=0;window.last=performance.now();window.running=true;const tick=now=>{if(!window.running)return;window.samples.push(now-window.last);window.last=now;window.frames++;requestAnimationFrame(tick)};requestAnimationFrame(tick);return JSON.parse(localStorage.mapViewState).zoom})
        await page.mouse.move(1000,500)
        for(let i=0;i<6;i++){await page.mouse.wheel(0,-100);await page.waitForTimeout(60)}
        await page.waitForFunction(start=>JSON.parse(localStorage.mapViewState).zoom>start,initial)
        const result=await page.evaluate(()=>{window.running=false;return {zoom:JSON.parse(localStorage.mapViewState).zoom,frames:window.frames,maxFrame:Math.round(Math.max(...window.samples)),jobs:window.jobs,results:window.results}})
        assert(result.frames>5,'wheel burst does not freeze animation frames')
        assert(result.maxFrame<500,'no synchronous multi-second separation stall')
        assert.deepEqual(errors,[])
        console.log('PASS: overview 20 trips/100 segments wheel zoom, worker integration and animation frames',result)
    }finally{await browser.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
