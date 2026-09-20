import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COOKIE, ID, createFixtureServer } from '../tests/fixtures/renewal-db.mjs';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.env.RENEWAL_QA_OUTPUT || '/tmp/roxlogy-renewal-qa';
await mkdir(output,{recursive:true});
const db=createFixtureServer();db.server.listen(54321,'127.0.0.1');await once(db.server,'listening');
let logs='';
const child=spawn(process.execPath,['--import',path.join(cwd,'tests/fixtures/offline-network-guard.mjs'),'node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','18088'],{cwd,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'ci-dummy-anon-key',NEXT_TELEMETRY_DISABLED:'1'}});
child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
async function files(dir){const entries=await readdir(dir,{withFileTypes:true});return (await Promise.all(entries.map(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]))).flat();}
const pages=(await files(path.join(cwd,'app'))).filter(p=>p.endsWith('/page.tsx'));
const cases=pages.map(file=>({file:path.relative(cwd,file),route:'/'+path.relative(path.join(cwd,'app'),path.dirname(file)).split('/').filter(p=>!p.startsWith('(')).join('/')}));
const results=[];
const visibleText=(html)=>html.replace(/<script[\s\S]*?<\/script>/g,'');
try{
 for(let i=0;i<150&&!logs.includes('Ready');i++)await new Promise(r=>setTimeout(r,100));
 if(!logs.includes('Ready'))throw new Error(logs);
 for(const item of cases){
  const route=item.route.replaceAll('[id]',ID).replaceAll('[postId]',ID).replaceAll('[eventId]',ID).replaceAll('[slug]','review-crew').replaceAll('[code]','REVIEW');
  const publicPage=['/','/login','/signup','/auth/native','/download','/board/REVIEW'].includes(route);
  db.setMode(publicPage?'anonymous':'member');
  const r=await fetch('http://127.0.0.1:18088'+route,{headers:{cookie:(publicPage?'':COOKIE+'; ')+'NEXT_LOCALE=ko','user-agent':'QA-review'},redirect:'manual'});
  const html=await r.text();
  const visible=html.replace(/<script[\s\S]*?<\/script>/g, "");
  const error=/data-dgst="(?!BAILOUT)[^"]+"|화면을 불러오지 못했어요/.test(visible);
  const hasContent=/<h1\b|<main\b/.test(visible);
  const status=r.status===200&&!error&&hasContent?'PASS':'FAIL';
  results.push({...item,status,http:r.status,error});
  await writeFile(path.join(output,encodeURIComponent(item.route)+'.html'),html);
  console.log(status,r.status,item.route);
 }
 for(const [route,mode,anonymous] of [
  [`/programs/${ID}?preview=1`,'member',false],['/crews/review-crew/finance?tab=dues','member',false],
  ['/dashboard','suspended',false],['/crews/review-crew/finance','associate',false],
  ['/crews/review-crew/members','anonymous',true],[`/crews/review-crew/schedule/${ID}`,'event-gate',false],
  ['/pft/race/REVIEW','profile-required',false],['/this-route-does-not-exist','anonymous',true],
 ]){
  db.setMode(mode);const r=await fetch('http://127.0.0.1:18088'+route,{headers:{cookie:(anonymous?'':COOKIE+'; ')+'NEXT_LOCALE=ko'},redirect:'manual'});const html=await r.text();
  const content=visibleText(html);
  if(route.includes('preview=1')){
    assert.match(content,/>복제<\/button>/);
    assert.ok(!/<button[^>]*>삭제<\/button>/.test(content),'preview hides delete');
    assert.ok(!content.includes('rx-program-footer'),'preview hides builder');
  }
  const expected={suspended:'정지된 계정',associate:'회계는 정회원에게만 공개됩니다.',anonymous:route.includes('/members')?'멤버 목록과 기록 순위는 로그인한 사용자에게만 보여드립니다.':null,'event-gate':'정회원 전용 모임입니다','profile-required':'프로필'}[mode];
  if(expected)assert.ok(content.includes(expected),mode+' gate is actually rendered');
  if(mode==='associate')assert.ok(!content.includes('rx-finance-grid'),'finance data stays hidden');
  if(route.includes('tab=dues'))assert.ok(content.includes('rx-finance-grid'),'dues uses split layout');
  await writeFile(path.join(output,mode+'-'+encodeURIComponent(route)+'.html'),html);
  results.push({route,mode,http:r.status,status:(r.status===200||r.status===404)&&!html.replace(/<script[\s\S]*?<\/script>/g,'').includes('화면을 불러오지 못했어요')?'PASS':'FAIL'});
 }
 for(const lang of ['en','es']){
  db.setMode('member');const r=await fetch('http://127.0.0.1:18088/settings/profile',{headers:{cookie:COOKIE+'; NEXT_LOCALE='+lang}});const html=await r.text();
  results.push({route:'/settings/profile',locale:lang,http:r.status,status:r.status===200&&!html.replace(/<script[\s\S]*?<\/script>/g,'').match(/Something went wrong|Algo salió mal/)?'PASS':'FAIL'});
 }
 await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({pages:cases.length,checks:results.length,passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status!=='PASS')}));
 if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
}finally{await writeFile(path.join(output,'server.log'),logs);child.kill('SIGTERM');db.server.close();}
