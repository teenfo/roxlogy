// Offline presentation fixtures. No production credentials or data; never imported by app code.
import http from 'node:http';
import { createHmac } from 'node:crypto';
export const ID='11111111-1111-4111-8111-111111111111';
export const USER='22222222-2222-4222-8222-222222222222';
const NOW='2026-09-20T09:00:00Z';
const profile={id:USER,display_name:'Review Athlete',email:'review@example.invalid',gender:'male',birth_year:1990,is_admin:true,disabled:false,timezone:'Asia/Seoul',locale:'ko',height_cm:175,weight_kg:70,leaderboard_opt_in:true,created_at:NOW,updated_at:NOW,mcp_token:'',mcp_write:false};
const user={id:USER,email:profile.email,aud:'authenticated',role:'authenticated',created_at:NOW,app_metadata:{provider:'email',providers:['email']},user_metadata:{display_name:profile.display_name},identities:[]};
const jwtBody=Buffer.from(JSON.stringify({sub:USER,aud:'authenticated',role:'authenticated',exp:Math.floor(Date.now()/1000)+86400,iat:Math.floor(Date.now()/1000)})).toString('base64url');
const jwtHeader=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const message=jwtHeader+'.'+jwtBody;
const token=message+'.'+createHmac('sha256','offline-fixture-only').update(message).digest('base64url');
const session={access_token:token,refresh_token:'offline-fixture-only',token_type:'bearer',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
export const COOKIE='sb-127-auth-token=base64-'+Buffer.from(JSON.stringify(session)).toString('base64url');
const exercise={id:ID,name_ko:'러닝',name_en:'Run',category:'run',station_type:'run',description_ko:'러닝 동작 가이드',description_en:'Running guide',default_unit:'m'};
const program={id:ID,owner_id:USER,title:'Review training plan',description:'Offline layout review',weeks:4,level:'intermediate',is_public:true,calendar_token:'offline-calendar-token',week_pattern:[1,3,5],created_at:NOW,program_days:[]};
const workout={id:ID,title:'Review workout',type:'run',workout_template_items:[],program_days:{day_index:1,focus:'Endurance',programs:{...program}}};
const race={id:ID,user_id:USER,event:'ROXLOGY review race',event_date:'2026-09-13',total_time_ms:4200000,division:'open_men',season:'2026',splits:[],race_splits:[],analysis_status:'pending',created_at:NOW};
const sessionRecord={id:ID,user_id:USER,started_at:NOW,total_time_ms:3600000,source_device:'web',analysis_status:'pending',division:'open_men',session_segments:[],race_results:null,deleted_at:null};
const run={id:ID,user_id:USER,ran_on:'2026-09-19',kind:'easy',surface:'road',distance_m:5000,duration_ms:1500000,pace_s_km:300,created_at:NOW};
const pft={id:ID,user_id:USER,tested_on:'2026-09-19',total_ms:1200000,age_at_test:36,scaled:false,run_ms:240000,burpee_ms:180000,lunge_ms:180000,row_ms:240000,pushup_ms:120000,wallball_ms:240000,created_at:NOW};
const crew={id:ID,slug:'review-crew',name:'Review Crew',tagline:'Train together',description:'Offline crew layout review',location:'서울',member_count:23,member_names:[profile.display_name],post_count:1,last_active_at:NOW,join_policy:'open',crew_status:'active',links:{},my_role:'owner',my_status:'active',is_public:true,owner_id:USER,logo_url:null,cover_url:null};
const crewEvent={id:ID,slug:crew.slug,title:'Sunday training',description:'Offline event layout review',starts_at:'2026-09-27T00:00:00Z',location:'서울',capacity:30,members_only:false,going:[{name:profile.display_name,user_id:USER}],maybe_names:[],declined_names:[],waitlist_names:[],comments:[],closed_at:null,created_by:USER,author_id:USER};
const board={race:{id:ID,code:'REVIEW',title:'PFT review',status:'open',crew:crew.name,crew_slug:crew.slug,created_at:NOW,join_open:true},server_now:NOW,entries:[{entry_id:ID,user_id:USER,name:profile.display_name,started_at:null,splits:[],finished_at:null,total_ms:null,scaled:false,badge:null,wave:1,dnf_at:null}]};
const post={id:ID,crew_id:ID,slug:crew.slug,title:'Review announcement',body:'Offline post layout review',content:'Offline post layout review',category:'notice',author_id:USER,author_name:profile.display_name,created_at:NOW,updated_at:NOW,comments:[],like_count:0,comment_count:0,is_pinned:true};
const event={id:ID,name:'Review race event',city:'서울',city_en:'Seoul',country:'Korea',country_code:'KR',start_date:'2026-10-01',end_date:'2026-10-02',season:'2026',venue:'Review venue',is_active:true};
const plan={id:ID,title:'My race plan',race_date:event.start_date,division:'open_men',bib:'101',note:'Review preparation',goal_plan_id:null,race_event_id:ID,role:'owner',my_status:'accepted',owner_name:profile.display_name,partners:[],goal_target_ms:4200000,goal_run_ms:2400000,goal_station_ms:1500000,goal_roxzone_ms:300000};
export function createFixtureServer(){
 let mode='member';
 const calls=[];
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const path=url.pathname;
  let raw='';for await(const chunk of req)raw+=chunk;
  if(raw)JSON.parse(raw);
  calls.push(path);
  const current={...profile,disabled:mode==='suspended',birth_year:mode==='profile-required'?null:profile.birth_year,gender:mode==='profile-required'?null:profile.gender};
  let data=[];
  if(path==='/auth/v1/user')data=user;
  else if(path==='/auth/v1/token')data=session;
  else if(path.includes('/rpc/')){
   const rpc=path.split('/').pop();
   const fixtures={public_profile:[{...current,shared_count:1}],crew_overview:[{...crew,my_role:mode==='associate'?'associate':mode==='anonymous'?null:'owner',my_status:mode==='anonymous'?null:'active'}],crew_directory:[crew],my_crews_overview:[],crew_post_detail:[post],crew_event_detail:mode==='event-gate'?[]:[crewEvent],crew_event_gate:{slug:crew.slug,crew:crew.name,logged_in:true,visible:false,members_only:true},pft_race_board:board,pft_race_can_manage:true,pft_race_my_entry:null,admin_user_detail:{...current,session_count:1,race_count:1,pft_count:1,program_count:1,has_mcp_token:false,crews:[]},my_race_plan:[plan],crew_finance_bank:{opening_balance:0,current_balance:253251},crew_expense_mix:[]};
   data=Object.hasOwn(fixtures,rpc)?fixtures[rpc]:[];
  } else if(path.startsWith('/rest/v1/')){
   const table=path.split('/').pop();const one=req.headers.accept?.includes('vnd.pgrst.object');
   const rows={crews:[crew],profiles:[current],programs:[program],workout_templates:[workout],sessions:[sessionRecord],race_results:[race],runs:[run],pft_results:[pft],exercises:[exercise],crew_posts:[post],race_events:[event],crew_tiers:[],crew_bank:[{opening_balance:0,account_label:'Review account'}]};
   data=rows[table]??[];
   // The dashboard's active enrollment must represent a real program tree; leave it empty.
   if(url.searchParams.has('limit')&&url.searchParams.get('limit')==='0')data=[];
   if(one)data=data[0]??null;
  }
  res.writeHead(200,{'content-type':'application/json','content-range':`0-${Array.isArray(data)?Math.max(0,data.length-1):0}/${Array.isArray(data)?data.length:1}`});
  res.end(req.method==='HEAD'?undefined:JSON.stringify(data));
 });
 return {server,calls,setMode:(value)=>{mode=value;}};
}
