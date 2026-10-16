import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resources, roles, workspace, referenceDate, type ServerConfig, type Role, type DomainRow } from '../src/catalog';
import { Backend } from '../src/backend';
import type { Expression, Policy } from '@qb-flex/contracts';
export const demoDir=resolve(import.meta.dir,'../../../..','.data/hrms');
export const configPath=resolve(demoDir,'server.json');
const trueExpr:Expression={op:'true'};
const own:Expression={op:'eq',left:{column:'owner_id'},right:{claim:'sub'}};
const scope:Expression={op:'exists',relationship:'workspace',where:trueExpr};
export async function provision(url='http://localhost:7621'){
 mkdirSync(demoDir,{recursive:true,mode:0o700});
 const identityPath=resolve(demoDir,'owner.json');
 const identity=existsSync(identityPath)?JSON.parse(readFileSync(identityPath,'utf8')):{email:'owner@hrms.example.com',password:crypto.randomUUID()+'aA1!',name:'HRMS Demo Owner'};
 if(!existsSync(identityPath))writeFileSync(identityPath,JSON.stringify(identity),{mode:0o600});
 async function api<T=Record<string,unknown>>(path:string,method='GET',body?:unknown,token?:string):Promise<T>{const response=await fetch(url+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();if(!response.ok)throw new Error(`${path}: ${result.error?.message??response.status}`);return result as T;}
 const setup=await api<{setupRequired:boolean}>('/setup');
 // The bootstrap file exists only for this isolated demo instance.
 const bootstrapPath=resolve(demoDir,'platform/bootstrap.token');
 if(existsSync(bootstrapPath))await api('/setup','POST',{...identity,organization:'PGSiO Showcase',bootstrapToken:readFileSync(bootstrapPath,'utf8').trim()});
 const login=await api<{token:string}>('/platform/auth/sign-in/email','POST',identity);
 const organizations=await api<{data:{id:string}[]}>('/management/v1/organizations','GET',undefined,login.token);
 const projects=await api<{data:{id:string;slug:string}[]}>('/management/v1/projects','GET',undefined,login.token);
 let project=projects.data.find(p=>p.slug==='hrms-showcase');
 let branch:string;
 if(!project){const created=await api<{data:{id:string;branchId:string}}>('/management/v1/projects','POST',{organizationId:organizations.data[0]!.id,name:'PGSiO HRMS',slug:'hrms-showcase'},login.token);project={id:created.data.id,slug:'hrms-showcase'};branch=created.data.branchId;}
 else branch=(await api<{data:{id:string}[]}>(`/management/v1/projects/${project.id}/branches`,'GET',undefined,login.token)).data[0]!.id;
 const base=`/management/v1/projects/${project.id}/branches/${branch}`;
 for(let attempt=0;;attempt++){try{await api(base+'/schema','GET',undefined,login.token);break;}catch(e){if(attempt>90)throw e;await Bun.sleep(300);}}
 if(existsSync(configPath)){const existing:ServerConfig=JSON.parse(readFileSync(configPath,'utf8'));if(existing.projectId!==project.id||existing.branch!==branch)throw new Error('Saved HRMS configuration points to another project; preserve it and use a new demo directory.');
 const token=await api<{data:{token:string}}>('/management/v1/tokens','POST',{projects:[project.id],readOnly:false},login.token);existing.managementToken=token.data.token;writeFileSync(configPath,JSON.stringify(existing,null,2),{mode:0o600});return existing;}
 await api(base+'/migrations','POST',{id:'001-hrms',sql:await Bun.file(new URL('../migrations/001-hrms.sql',import.meta.url)).text()},login.token);
 const schemas=await api<{data:{name:string;columns:{name:string}[]}[]}>(base+'/schema','GET',undefined,login.token);
 for(const t of schemas.data.filter(t=>!t.name.startsWith('_qb_')))await api(base+'/exposure/'+t.name,'PUT',{enabled:true,columns:t.columns.map(c=>c.name)},login.token);
 await api(base+'/relationships','PUT',{name:'members',source:'hrms_workspaces',target:'hrms_members',localColumn:'id',foreignColumn:'workspace_id',cardinality:'many'},login.token);
 const savePolicy=async(p:Policy)=>api(base+'/policies','PUT',p,login.token);
 await savePolicy({id:'hrms_members_own',resource:'hrms_members',operation:'select',roles:['authenticated'],mode:'permissive',using:own,check:own,enabled:true});
 await savePolicy({id:'hrms_workspace_member',resource:'hrms_workspaces',operation:'select',roles:['authenticated'],mode:'permissive',using:{op:'exists',relationship:'members',where:own},check:trueExpr,enabled:true});
 for(const [name,resource] of Object.entries(resources)){
 await api(base+'/relationships','PUT',{name:'workspace',source:name,target:'hrms_workspaces',localColumn:'workspace_id',foreignColumn:'id',cardinality:'one'},login.token);
 await savePolicy({id:name+'_workspace',resource:name,operation:'select',roles:['authenticated'],mode:'restrictive',using:scope,check:trueExpr,enabled:true});
 const shared=['jobs','policies','holidays','courses','benefits','announcements','surveys','recognition','events','rsvps'];
 for(const role of resource.read){const broad=['super_admin','hr_admin','finance','recruiter','auditor'].includes(role)||shared.includes(name);const predicate:Expression=broad?trueExpr:role==='manager'?{op:'or',args:[own,{op:'eq',left:{column:'manager_id'},right:{claim:'sub'}}]}:own;
 await savePolicy({id:name+'_'+role,resource:name,operation:'select',roles:[role],mode:'permissive',using:predicate,check:trueExpr,enabled:true});}
 }
 for(const role of roles)await api(base+'/roles','POST',{name:role,description:`HRMS ${role}`},login.token);
 const publishable=await api<{data:{key:string}}>(`/management/v1/projects/${project.id}/keys`,'POST',{},login.token);
 const service=await api<{data:{key:string}}>(`/management/v1/projects/${project.id}/keys`,'POST',{scope:'service',branch,tables:schemas.data.filter(t=>!t.name.startsWith('_qb_')).map(t=>t.name),methods:['GET','POST','PATCH','DELETE'],bypass:true},login.token);
 const token=await api<{data:{token:string}}>('/management/v1/tokens','POST',{projects:[project.id],readOnly:false},login.token);
 const bucket=await api<{data:{id:string}}>(base+'/buckets','POST',{name:'hrms-private',visibility:'private',maxSize:10485760,mimeRules:['application/pdf','text/plain','image/png','image/jpeg']},login.token);
 const password=crypto.randomUUID()+'aA1!';
 const names=['Sam Parker','Maya Johnson','James Lee','Aisha Khan','Sofia Costa','Omar Latif','Alex Morgan'];
 const users:{id:string;role:Role;name:string;email:string}[]=[];
 for(const [i,role] of roles.entries()){const user=await api<{data:{id:string}}>(base+'/users','POST',{name:names[i],email:`${role}@hrms.example.com`,password,emailVerified:true,roles:[role]},login.token);users.push({id:user.data.id,role,name:names[i]!,email:`${role}@hrms.example.com`});}
 const config:ServerConfig={url,projectId:project.id,branch,publishableKey:publishable.data.key,serviceKey:service.data.key,managementToken:token.data.token,bucketId:bucket.data.id,demo:true,demoPassword:password,personas:users.map(({role,name,email})=>({role,name,email})),coordinatorDir:resolve(demoDir,'coordinator')};
 const backend=new Backend(config);
 await backend.insert('hrms_workspaces',{id:workspace,title:'PGSiO'});
 await backend.insert('hrms_members',users.map((u,i)=>({id:u.id,workspace_id:workspace,owner_id:u.id,employee_id:'employee-'+i,role:u.role,title:u.name,revision:1})));
 const manager=users[2]!.id, employee=users[3]!.id, hr=users[1]!.id;
 const rows=Array.from({length:1248},(_,i)=>{const person=users[i];const name=person?.name??(['Ryan Wilson','Priya Sharma','Emma Chen','Noah Williams','Liam Patel','Amelia Davis'][i%6]+' '+(i>12?i:''));return {...backend.row('employee-'+i,person?.id??'fictional-'+i,name,i>=1224?'Onboarding':i>=1182?'On leave':'Active',{manager_id:manager,subtitle:['Platform engineer','Product manager','HR specialist','Frontend engineer','Finance analyst','Product designer'][i%6]!,start_date:`2026-${String(1+(i%10)).padStart(2,'0')}-${String(1+(i%27)).padStart(2,'0')}`,data:JSON.stringify({annual_days:21})}),email:person?.email??`person${i}@hrms.example.com`,department:['Engineering','Product','People & culture','Design','Finance','Operations'][i%6],location:['Dubai','Abu Dhabi','London','Remote'][i%4],employment:i%9===0?'Contract':'Full-time'};});
 for(let i=0;i<rows.length;i+=100)await backend.insert('employees',rows.slice(i,i+100));
 const attendance=rows.slice(0,1176).map((e,i)=>backend.row('attendance-'+i,e.owner_id,e.title,'Present',{manager_id:manager,start_date:referenceDate,data:JSON.stringify({clock_in:'2026-10-16T04:00:00Z',hours:8,breaks:[]})}));
 for(let i=0;i<attendance.length;i+=100)await backend.insert('attendance',attendance.slice(i,i+100));
 const salaries=rows.map((e,i)=>backend.row('salary-'+i,e.owner_id,e.title,'Active',{amount:300000+(i%12)*18000,data:JSON.stringify({bonus:0,deductions:0,currency:'AED'})}));
 for(let i=0;i<salaries.length;i+=100)await backend.insert('salaries',salaries.slice(i,i+100));
 const seed=async(table:string,title:string,subtitle:string,status:string,data:Record<string,unknown>={},rest:Partial<DomainRow>={})=>backend.insert(table,backend.row('seed-'+table+'-'+hashIndex++,employee,title,status,{manager_id:manager,subtitle,data:JSON.stringify(data),...rest}));let hashIndex=0;
 for(let i=0;i<18;i++)await seed('jobs',['Senior frontend engineer','Product designer','People partner','Finance analyst'][i%4]!,['Engineering','Design','People & culture','Finance'][i%4]!,'Published',{description:'Help build a thoughtful, people-first company.',location:['Dubai','Abu Dhabi','London','Remote'][i%4]});
 await seed('leave','Annual leave','Aisha Khan','Pending review',{description:'Family commitments. I’ll hand over the release checklist to James before I leave.',days:3},{start_date:'2026-10-19',end_date:'2026-10-21'});
 for(let i=1;i<8;i++)await seed('leave',i%2?'Sick leave':'Annual leave',rows[i]!.title,'Pending review',{description:'Planned time away',days:1},{owner_id:rows[i]!.owner_id,start_date:'2026-10-26',end_date:'2026-10-26'});
 await seed('expenses','Travel reimbursement','Ryan Wilson','Pending review',{description:'Client visit'},{amount:64000});
 await seed('expenses','Office supplies','Priya Sharma','Pending review',{description:'Team supplies'},{amount:18000});
 await seed('timesheets','Platform launch','Priya Sharma','Submitted',{hours:4,billing:'Billable'},{start_date:'2026-10-15'});
 await seed('offers','Omar Latif','Product Designer','Draft',{},{amount:1800000,start_date:'2026-11-02'});
 await seed('payroll','October payroll','1,248 employees','Draft',{currency:'AED'},{start_date:'2026-10-01',end_date:'2026-10-31'});
 const samples:Record<string,[string,string,Record<string,unknown>?]>={candidates:['Ella Robinson','Frontend engineer',{email:'ella@example.com',resume:'React, TypeScript, accessible design'}],interviews:['Design conversation','Ella Robinson'],onboarding:['Welcome to PGSiO','Omar Latif',{tasks:'Upload documents\nComplete induction\nCollect laptop',completed:[]}],offboarding:['Exit checklist','Fictional employee',{tasks:'Return laptop\nRevoke access\nExit interview'}],assets:['MacBook Pro','PG-2048'],shifts:['Dubai day shift','08:00–17:00'],policies:['Annual leave','Sample policy',{days:21,description:'Monday–Friday working days; sample rules only.'}],holidays:['Company wellbeing day','Sample company holiday'],loans:['Salary advance','Sample advance',{installment:10000}],goals:['Ship the customer portal','Launch by November',{progress:68}],reviews:['Q4 growth review','Collaboration',{rating:4}],checkins:['1-on-1','October check-in',{description:'Discuss growth opportunities.'}],courses:['Security essentials','Everyone starts here',{description:'Use unique passwords, protect documents, and report suspicious messages.',question:'Should you share your password?',answer:'no'}],enrollments:['Security essentials','Compliance learning',{course_id:'seed-course'}],skills:['TypeScript','Advanced'],benefits:['Wellbeing allowance','PGSiO care',{description:'Annual support for your wellbeing.'}],compensation:['Engineering · Grade 4','Sample market benchmark',{maximum:2400000,description:'Fictional benchmark. No external market data.'}],announcements:['Make room for your wellbeing.','Company update',{description:'Join our wellness session on 22 October. A small pause can make a big difference.'}],surveys:['How likely are you to recommend PGSiO?','eNPS'],recognition:['Thank you, James','Aisha Khan',{description:'For supporting the team through launch week.'}],events:['Make room for your wellbeing','Wellness session',{description:'A guided wellbeing session for everyone.'}],reports:['Workforce overview','employees'],compliance:['Employee data retention','Policy register',{description:'Sample retention policy; review before production use.'}],consents:['Policy acknowledgement','Security policy'],integrations:['Signed webhook sandbox','Demo adapter',{description:'Local sandbox; never contacts an external service.'}],automations:['HR assistant','Deterministic demo',{description:'What is my annual leave entitlement?'}],settings:['Working week','Monday–Friday',{description:'Asia/Dubai · AED · 21 annual working days'}]};
 for(const [table,[title,subtitle,data]] of Object.entries(samples))await seed(table,title,subtitle,resources[table as keyof typeof resources].statuses[0]!,data??{}, {start_date:table==='holidays'?'2026-12-02':table==='events'?'2026-10-22':'2026-10-16',end_date:'2026-12-31',amount:['benefits','loans','compensation'].includes(table)?120000:0});
 const types=await fetch(url+base+'/types',{headers:{authorization:`Bearer ${login.token}`}});if(!types.ok)throw new Error('Type generation failed');await Bun.write(new URL('../src/qb-flex.types.ts',import.meta.url),await types.text());
 writeFileSync(configPath,JSON.stringify(config,null,2),{mode:0o600});
 return config;
}
