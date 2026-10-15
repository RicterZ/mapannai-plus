export function validPlanDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
    const time = Date.parse(`${value}T00:00:00Z`)
    return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === value
}
export function validatePlanDays(days: {date:string}[], expected: string[] = []) {
    if (!days.length || days.some(day => !validPlanDate(day.date))) throw new Error('骨架日期必须是真实日期，不允许占位日期')
    for (let i=1;i<days.length;i++) if (Date.parse(days[i].date)-Date.parse(days[i-1].date)!==86400000) throw new Error('骨架日期必须连续且不重复')
    if (expected.length && (expected.length !== days.length || expected.some((date,i)=>days[i]?.date!==date))) throw new Error('骨架必须完整覆盖已确认日期范围')
}
export function datesFromFacts(text: string): string[] {
    const matches: string[] = Array.from(text.match(/\d{4}-\d{2}-\d{2}/g) || [])
    if (!matches.length || matches.some(date=>!validPlanDate(date))) return []
    const start=matches[0]!, end=matches[matches.length-1]!
    const count=(Date.parse(end)-Date.parse(start))/86400000+1
    if(count<1||count>90)return []
    return Array.from({length:count},(_,i)=>new Date(Date.parse(start)+i*86400000).toISOString().slice(0,10))
}
