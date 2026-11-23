// Fixture-owned evidence outlives a document and closes before its browser.
export class ResponseCaptures {
  constructor(report) {this.report=report;this.jobs=[];this.closed=false;}
  add(details,work) {
    if(this.closed)return false;
    let result;try{result=work();}catch(error){result=Promise.reject(error);}
    this.jobs.push(Promise.resolve(result).catch(error=>{
      const entry={...details,error:error.stack??String(error)};
      const navigation=entry.error.includes('No resource with given identifier found')&&entry.error.includes('response that was navigated away from');
      (navigation?this.report.lostToNavigation:this.report.captureErrors).push(entry);
    }));
    return true;
  }
  close() {this.closed=true;return this.jobs.length;}
}

export function fixtureEvents(write) {
  const events=[];
  return {events,record(event){write(JSON.stringify(event)+'\n');events.push(event);}};
}
