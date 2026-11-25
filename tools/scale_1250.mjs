import { Api } from '../web/api.mjs';
import { checkedView } from '../web/freshness.mjs';
import { TopicViews } from '../web/topic-views.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const protocol = Object.freeze({ blocks:9, warmups:2, ratio:1.5, stratum:'warm', osCache:'uncontrolled' });
export function median(values) {
  if(!values.length||values.some(x=>!Number.isFinite(x)||x<=0))throw Error('Missing or invalid timing sample');
  const xs=[...values].sort((a,b)=>a-b),n=xs.length;
  return n%2?xs[n>>1]:(xs[n/2-1]+xs[n/2])/2;
}
export function decide(records) {
  if(records.length!==protocol.blocks)throw Error('Exactly nine paired blocks required');
  for(const [n,row] of records.entries()) {
    if(row.block!==n||row.order!==(n%2?'large-small':'small-large'))throw Error('Pair order changed');
    if(row.small?.status!=='ok'||row.large?.status!=='ok')return {passed:false,reason:'failed request',records};
  }
  const small=records.map(x=>x.small.ms),large=records.map(x=>x.large.ms);
  const ratio=median(large)/median(small);
  return {passed:ratio<=protocol.ratio,ratio,smallMedian:median(small),largeMedian:median(large),
    maxSmall:Math.max(...small),maxLarge:Math.max(...large),pairedRatios:records.map(x=>x.large.ms/x.small.ms)};
}

export function client(config,log=[]) {
  const fetcher=async(path,options={})=>fetch(new URL(path,config.origin),{
    ...options,headers:{...options.headers,Origin:config.origin}});
  const api=new Api(config.token,fetcher);
  const owner=new TopicViews({instanceId:config.instance_id,topicId:'target',reader:'reader',window:()=>({budget:300})});
  return {api,async read(args) {
    if(JSON.stringify(args)!==JSON.stringify({topic_id:'target',direction:'before',limit:30}))throw Error('Unlisted view argument shape');
    const start=performance.now();
    try {
      const answer=checkedView(await api.view('topic_messages',args),config.instance_id);
      if(!Array.isArray(answer.items)||answer.items.length!==30||answer.items.some(x=>x.topic_id!=='target'||!x.stack_position))throw Error('Invalid complete message page');
      if(!owner.messagesPage(answer,{initial:true}))throw Error('Existing message-page owner refused the answer');
      const row={status:'ok',ms:performance.now()-start,rows:answer.items.length,
        expandedBytes:Buffer.byteLength(JSON.stringify(answer)),view:'topic_messages',args,
        endpoint:'complete parsed/expanded/checked envelope'};
      log.push(row);return row;
    }catch(error){const row={status:'failed',ms:performance.now()-start,error:String(error),view:'topic_messages',args};log.push(row);return row;}
  }};
}
export async function measure(config) {
  if(config.stratum!=='warm')throw Error('This first slice only implements the declared warm stratum');
  const log=[],small=client(config.small,log),large=client(config.large,log);
  await small.api.bootstrap();await large.api.bootstrap();
  const warmups=[];
  for(let n=0;n<protocol.warmups;n++)warmups.push({small:await small.read(config.args),large:await large.read(config.args)});
  const records=[];
  for(let n=0;n<protocol.blocks;n++) {
    const row={block:n,order:n%2?'large-small':'small-large'};
    for(const side of (n%2?['large','small']:['small','large']))row[side]=await (side==='small'?small:large).read(config.args);
    records.push(row);
  }
  const warmupFailed=warmups.some(x=>x.small.status!=='ok'||x.large.status!=='ok');
  return {protocol,warmups,records,log,decision:warmupFailed?{passed:false,reason:'failed retained warmup'}:decide(records),
    limits:['warm only; no fresh-process/clone cold claim','first view only; no whole-action/native inventory claim','expanded bytes are not wire bytes']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const result=await measure(config);writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
  process.exitCode=result.decision.passed?0:1;
}
