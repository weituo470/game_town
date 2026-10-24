import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {buildAiDroneV2Example,createAiDroneDirector} from '../server/aiDroneDirector.js';
import {aiDroneChoiceCorrection} from '../server/aiDroneRepair.js';
const config={enabled:true,apiKey:'test-key-never-log',baseURL:'https://api.deepseek.com/v1',model:'deepseek-flash',dbPath:':memory:',timeoutMs:1000};
const input=()=>({guestId:randomUUID(),requestId:randomUUID(),mode:'prompt',prompt:'moonstone黑客松上海站',ip:'127.0.0.1'});
const response=score=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(score)}}]}));
const invalid=()=>{const s=buildAiDroneV2Example(123);s.cast[0].kind='moonstone';return s;};
test('one targeted enum correction preserves theme and seed, charges one reservation, and replays without model calls',async()=>{
 const calls=[],director=createAiDroneDirector({config,fetchImpl:async(_,o)=>{calls.push(JSON.parse(o.body));return response(calls.length===1?invalid():buildAiDroneV2Example(123));}}),body=input();
 try{const result=await director.generate(body);assert.equal(calls.length,2);assert.equal(result.show.modelCalls,2);assert.equal(result.usage.used,1);
 assert.equal(calls[0].messages[1].content,calls[1].messages[1].content);assert.match(calls[1].messages.at(-1).content,/kind/);assert(!calls[1].messages.at(-1).content.includes('moonstone'));
 assert.equal(calls[0].messages[0].content,calls[1].messages[0].content);assert.equal(calls[1].temperature,.2);assert.equal(result.show.prompt,body.prompt);
 assert.equal((await director.generate(body)).replayed,true);assert.equal(calls.length,2);
 }finally{await director.close();}
});
test('second invalid draft is terminal and idempotent; no template fallback and no third model call',async()=>{
 let calls=0;const director=createAiDroneDirector({config,fetchImpl:async()=>{calls++;return response(invalid());}}),body=input();
 try{for(const replayed of [false,true])await assert.rejects(director.generate(body),e=>e.reason==='AI_SCORE_CHOICE'&&e.replayed===replayed);assert.equal(calls,2);}
 finally{await director.close();}
});
test('corrected draft still fails original quality gate; network failures are never retried',async()=>{
 let calls=0;const poor=buildAiDroneV2Example(123);poor.scenes.forEach(s=>s.camera='wide');
 const director=createAiDroneDirector({config,fetchImpl:async()=>{calls++;return response(calls===1?invalid():poor);}});
 try{await assert.rejects(director.generate(input()),{code:'AI_DRONE_QUALITY_FAILED'});assert.equal(calls,2);}finally{await director.close();}
 calls=0;const network=createAiDroneDirector({config,fetchImpl:async()=>{calls++;throw Error('private provider failure');}});
 try{await assert.rejects(network.generate(input()),{code:'AI_DRONE_UPSTREAM'});assert.equal(calls,1);}finally{await network.close();}
});
test('one shared deadline covers the correction and cancellation never triggers a third request',async()=>{
 let calls=0;const director=createAiDroneDirector({config:{...config,timeoutMs:25},fetchImpl:async()=>{calls++;return calls===1?response(invalid()):new Promise(()=>{});}});
 try{await assert.rejects(director.generate(input()),{code:'AI_DRONE_TIMEOUT'});assert.equal(calls,2);}finally{await director.close();}
});
test('repair feedback is trusted enums only and executable, malformed or unknown-field errors never trigger correction',()=>{
 for(const value of ['javascript:alert(1)','__proto__','constructor','PRIVATE KEY']){const score=invalid();score.cast[0].kind=value;assert.equal(aiDroneChoiceCorrection(score,{code:'AI_SCORE_CHOICE',field:'kind'}),null);}
 for(const code of ['AI_SCORE_FIELDS','AI_SCORE_QUALITY','AI_SCORE_JSON'])assert.equal(aiDroneChoiceCorrection(invalid(),{code,field:'kind'}),null);
});
