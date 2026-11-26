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
  return {api,async read(args,view='topic_messages') {
    const shape = view==='topic_messages'?{topic_id:'target',direction:'before',limit:30}:view==='topic_unread'?{topic_id:'target'}:null;
    if(!shape||JSON.stringify(args)!==JSON.stringify(shape))throw Error('Unlisted view argument shape');
    if(view==='topic_unread'&&!config.expected_unread)throw Error('Missing offline unread oracle');
    const start=performance.now();
    let answer;
    try {
      let ownerAccepted;
      if(view==='topic_unread') {
        ownerAccepted=await owner.readUnread(async(name,query)=>{
          if(name!==view||JSON.stringify(query)!==JSON.stringify(args))throw Error('Unread owner changed request shape');
          answer=await api.view(name,query);
          checkedView(answer,config.instance_id);
          const expected=config.expected_unread, actual=answer.oldest_unread, first=expected.oldest_unread;
          if(answer.instance_id!==expected.instance_id||answer.topic_id!==expected.topic_id||
            !Number.isSafeInteger(answer.commit_seq)||answer.commit_seq!==expected.commit_seq||
            !actual||!first||actual.id!==first.id||!Number.isSafeInteger(actual.seq)||actual.seq!==first.seq||
            !Number.isSafeInteger(actual.sent_ms)||actual.sent_ms!==first.sent_ms)throw Error('Unread frontier or snapshot metadata differs from offline oracle');
          return answer;
        });
      } else {
        answer=checkedView(await api.view(view,args),config.instance_id);
        if(!Array.isArray(answer.items)||answer.items.length!==30||answer.items.some(x=>x.topic_id!=='target'||!x.stack_position))throw Error('Invalid complete message page');
        ownerAccepted=owner.messagesPage(answer,{initial:true});
      }
      if(!ownerAccepted)throw Error('Existing page owner refused the answer');
      const row={status:'ok',ms:performance.now()-start,rows:view==='topic_messages'?answer.items.length:1,
        expandedBytes:Buffer.byteLength(JSON.stringify(answer)),view,args,
        ...(view==='topic_unread'?{answer,ownerAccepted}:{}),
        endpoint:'complete parsed/expanded/checked envelope'};
      log.push(row);return row;
    }catch(error){const row={status:'failed',ms:performance.now()-start,error:String(error),view,args,
      ...(view==='topic_unread'?{answer}: {})};log.push(row);return row;}
  }};
}
export async function measure(config) {
  if(config.stratum!=='warm')throw Error('This tool only implements the declared warm stratum');
  const log=[],small=client(config.small,log),large=client(config.large,log);
  await small.api.bootstrap();await large.api.bootstrap();
  const warmups=[];
  for(let n=0;n<protocol.warmups;n++)warmups.push({small:await small.read(config.args,config.view),large:await large.read(config.args,config.view)});
  const records=[];
  for(let n=0;n<protocol.blocks;n++) {
    const row={block:n,order:n%2?'large-small':'small-large'};
    for(const side of (n%2?['large','small']:['small','large']))row[side]=await (side==='small'?small:large).read(config.args,config.view);
    records.push(row);
  }
  const warmupFailed=warmups.some(x=>x.small.status!=='ok'||x.large.status!=='ok');
  return {protocol,warmups,records,log,decision:warmupFailed?{passed:false,reason:'failed retained warmup'}:decide(records),
    limits:['warm only; no fresh-process/clone cold claim','one declared view only; no whole-action/native inventory claim','expanded bytes are not wire bytes']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
  const result=await measure(config);writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
  process.exitCode=result.decision.passed?0:1;
}
