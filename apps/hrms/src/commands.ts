import { createHmac } from 'node:crypto';
import { QBError } from '@qb-flex/contracts';
import { Backend, assertWrite, allowedRead, hash, workingDays, payrollAmount } from './backend';
import { resources, details, type CommandInput, type CommandResult, type DomainRow, type Member, type Table, type Resource } from './catalog';
type Operation={table:string;method:'insert'|'update';id:string;values:Record<string,unknown>;revision?:number};
export type Journal=DomainRow & {fingerprint:string;actor_id:string;input:string;result:string;step:number|string};
const numeric=['amount','bonus','deductions','maximum','installment','days','hours','progress','rating'];
export function validateValues(table:Table,values:Record<string,string|number>){
 const result:Record<string,string|number>={};
 for(const field of (resources[table] as Resource).fields){const value=values[field.name];if(field.required&&(value===undefined||String(value).trim()===''))throw new QBError('VALIDATION',`${field.label} is required`);
 if(value===undefined)continue;if(String(value).length>8000)throw new QBError('VALIDATION','Field is too long');
 if(field.options&&!field.options.includes(String(value)))throw new QBError('VALIDATION',`Invalid ${field.label}`);
 if(field.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value)))throw new QBError('VALIDATION','Enter a valid email');
 if(numeric.includes(field.name)){const n=Number(value||0);if(!Number.isSafeInteger(n)||n<0)throw new QBError('VALIDATION',`${field.label} must be a nonnegative whole number`);if(field.name==='progress'&&n>100||field.name==='rating'&&(n<1||n>5)||field.name==='hours'&&n>24)throw new QBError('VALIDATION',`${field.label} is outside the allowed range`);result[field.name]=n;}else result[field.name]=String(value).trim();
 }
 if(result.start_date&&result.end_date&&result.end_date<result.start_date)throw new QBError('VALIDATION','End date must follow the start date');
 if(result.url&&!/^https:\/\//.test(String(result.url)))throw new QBError('VALIDATION','External course links require HTTPS');
 return result;
}
export class Commands {
 private serial:Promise<unknown>=Promise.resolve();
 private interrupted=false;
 constructor(readonly backend:Backend){}
 enqueue<T>(fn:()=>Promise<T>):Promise<T>{const task=this.serial.then(fn);this.serial=task.catch(()=>{});return task;}
 async recover(){const journals=await this.backend.all<Journal>('hrms_commands',[{column:'status',op:'eq',value:'running'}]);for(const journal of journals){try{await this.execute(journal);}catch{this.interrupted=true;}}}
 async run(member:Member,input:CommandInput,key:string):Promise<CommandResult>{return this.enqueue(async()=>{
 if(!/^[a-zA-Z0-9_-]{8,128}$/.test(key))throw new QBError('VALIDATION','Provide an idempotency key');
 const id=hash([member.owner_id,key]);const fingerprint=hash(input);const previous=(await this.backend.data<Journal>('hrms_commands',[{column:'id',op:'eq',value:id}])).data[0];
 if(previous){if(previous.fingerprint!==fingerprint)throw new QBError('CONFLICT','Idempotency key belongs to a different command',409);if(previous.status==='completed')return {id,state:'completed',result:JSON.parse(previous.result).response};await this.execute(previous);return {id,state:'completed',result:JSON.parse(previous.result).response};}
 if(this.interrupted)throw new QBError('COMMANDS_PAUSED','An interrupted command needs recovery before accepting further writes',503);
 const operations=await this.prepare(member,input,id);const response={recordId:operations[0]?.id,message:'Your changes have been saved.'};
 const row:Journal={...this.backend.row(id,member.owner_id,input.action,'running'),fingerprint,actor_id:member.owner_id,input:JSON.stringify(input),result:JSON.stringify({operations,response}),step:0};
 await this.backend.insert('hrms_commands',row,id+'-journal');
 try{await this.execute(row);}catch(e){this.interrupted=true;throw e;}
 return {id,state:'completed',result:response};
 });}
 async execute(journal:Journal){const {operations}=JSON.parse(journal.result) as {operations:Operation[]};
 for(let i=Number(journal.step);i<operations.length;i++){const operation=operations[i]!;if(operation.method==='insert')await this.backend.insert(operation.table,operation.values,journal.id+'-'+i);else await this.backend.update(operation.table,operation.id,operation.values,operation.revision,journal.id+'-'+i);
 await this.backend.update('hrms_commands',journal.id,{step:i+1},undefined,journal.id+'-checkpoint-'+i);}
 await this.backend.update('hrms_commands',journal.id,{status:'completed'},undefined,journal.id+'-done');this.interrupted=false;
 }
 async prepare(member:Member,input:CommandInput,commandId:string):Promise<Operation[]>{
 const table=input.table;const resource:Resource=resources[table];if(!resource)throw new QBError('VALIDATION','Unknown resource');
 const ops:Operation[]=[];const now=new Date().toISOString();let index=0;
 const add=(table:string,row:DomainRow)=>{ops.push({table,method:'insert',id:row.id,values:{...row,created_at:now}});};
 const make=(title:string,status:string,rest:Partial<DomainRow>={})=>this.backend.row(commandId+'-'+index++,member.owner_id,title,status,{manager_id:'',...rest});
 let row:DomainRow|undefined;
 if(input.id){row=await this.backend.one(table,input.id);if(!allowedRead(member,table,row))throw new QBError('DENIED','Record is outside your scope',403);if(input.revision!==undefined&&Number(row.revision)!==input.revision)throw new QBError('REVISION_CONFLICT','This record changed. Refresh and review it again.',409);}
 const update=(values:Record<string,unknown>)=>{if(!row)throw new QBError('VALIDATION','Choose a record');ops.push({table,method:'update',id:row.id,values,revision:Number(row.revision)});};
 const employee=await this.backend.one('employees',member.employee_id);
 if(input.action==='create'||input.action==='update'){
 assertWrite(member,table,row);const values=validateValues(table,input.values);
 const data={...(row?details(row):{}),...values};const columns:Record<string,unknown>={};for(const key of ['title','subtitle','start_date','end_date','amount'])if(values[key]!==undefined)columns[key]=values[key];
 if(table==='employees')for(const key of ['email','department','location','employment'])columns[key]=values[key];
 if(table==='leave'){
 const days=workingDays(String(values.start_date),String(values.end_date),(await this.backend.all('holidays')).map(h=>h.start_date));if(days<1)throw new QBError('VALIDATION','Select at least one working day');data.days=days;
 const existing=await this.backend.all('leave',[{column:'owner_id',op:'eq',value:member.owner_id}]);
 if(existing.some(l=>l.id!==row?.id&&['Pending review','Approved'].includes(l.status)&&l.start_date<=String(values.end_date)&&l.end_date>=String(values.start_date)))throw new QBError('CONFLICT','You already have a request overlapping these dates',409);
 if(values.title!=='Unpaid leave'){const used=existing.filter(l=>l.id!==row?.id&&l.title===values.title&&['Pending review','Approved'].includes(l.status)).reduce((s,l)=>s+Number(details(l).days||0),0);const policy=(await this.backend.all('policies')).find(p=>p.title===values.title);const entitlement=Number(policy?details(policy).days:values.title==='Sick leave'?10:21);if(used+days>entitlement)throw new QBError('VALIDATION','Insufficient available leave balance');}
 columns.subtitle=member.title;columns.manager_id=employee.manager_id;
 if(row&&!['Pending review','Changes requested'].includes(row.status))throw new QBError('CONFLICT','This leave request can no longer be edited',409);
 }
 if(table==='suggestions'){columns.owner_id='anonymous';columns.manager_id='';}
 if(table==='salaries'){const salary=make(String(values.title),'Active',{amount:Number(values.amount),data:JSON.stringify(data)});payrollAmount(salary);}
 if(row)update({...columns,data:JSON.stringify(data)});else{const record={...make(String(values.title??resource.singular),resource.statuses[0]!,{manager_id:employee.manager_id}),...columns,data:JSON.stringify(data)};if(table==='employees')record.owner_id='unassigned-'+commandId;add(table,record);}
 }else if(input.action==='clock'){
 if(table!=='attendance'||!['clock_in','break','resume','clock_out'].includes(String(input.decision))||!['employee','manager','super_admin','hr_admin'].includes(member.role))throw new QBError('DENIED','Clock action not permitted',403);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const existing=(await this.backend.all('attendance',[{column:'owner_id',op:'eq',value:member.owner_id},{column:'start_date',op:'eq',value:today}]))[0];
 if(input.decision==='clock_in'){if(existing&&existing.status!=='Clocked out')throw new QBError('CONFLICT','You are already clocked in',409);add('attendance',make(member.title,'Present',{start_date:today,manager_id:employee.manager_id,data:JSON.stringify({clock_in:now,breaks:[]})}));}
 else{if(!existing)throw new QBError('CONFLICT','Clock in first',409);const status=input.decision==='break'?'Break':input.decision==='resume'?'Present':'Clocked out';if(existing.status==='Clocked out'||input.decision==='break'&&existing.status!=='Present'||input.decision==='resume'&&existing.status!=='Break')throw new QBError('CONFLICT','This clock action is no longer available',409);ops.push({table:'attendance',method:'update',id:existing.id,revision:Number(existing.revision),values:{status,data:JSON.stringify({...details(existing),last_action:now,...(status==='Clocked out'?{clock_out:now}:{})})}});}
 }else if(input.action==='respond'||input.action==='rsvp'||input.action==='enroll'){
 if(!row)throw new QBError('VALIDATION','Choose a record');
 const target=input.action==='respond'?'responses':input.action==='rsvp'?'rsvps':table==='benefits'?'benefit_enrollments':'enrollments';
 if(input.action==='respond'&&(table!=='surveys'||row.status!=='Open'))throw new QBError('VALIDATION','Survey is closed');
 if(input.action==='rsvp'&&table!=='events'||input.action==='enroll'&&!['courses','benefits'].includes(table))throw new QBError('VALIDATION','Action does not match resource');
 const prior=await this.backend.all(target,[{column:'owner_id',op:'eq',value:member.owner_id}]);if(prior.some(p=>details(p).source_id===row!.id))throw new QBError('CONFLICT','You have already submitted this action',409);
 const score=Number(input.values.score??8);if(input.action==='respond'&&(!Number.isInteger(score)||score<0||score>10))throw new QBError('VALIDATION','Score must be between 0 and 10');
 add(target,make(row.title,input.action==='respond'?'Submitted':input.action==='rsvp'?'Going':target==='enrollments'?'In progress':'Active',{manager_id:employee.manager_id,subtitle:row.subtitle,data:JSON.stringify({source_id:row.id,score})}));
 }else if(input.action==='run_adapter'){
 if(!row||!['integrations','automations'].includes(table))throw new QBError('VALIDATION','Choose a demo adapter');assertWrite(member,table,row);
 const text=String(details(row).description??'');let output='Demo workflow completed; no external delivery.';
 if(row.title==='HR assistant')output='Sample annual leave entitlement: 21 working days. Submit a request from My leave.';
 if(row.title==='Resume screening')output=JSON.stringify({matches:['react','typescript','design'].filter(v=>text.toLowerCase().includes(v)),method:'Deterministic keyword demonstration; no AI model'});
 if(row.title==='Attrition scenario')output='Scenario only: review engagement and workload with employees. No employee risk prediction.';
 if(row.title==='Smart scheduling')output='Suggested slot: next working day, 10:00 Asia/Dubai. No calendar booking was sent.';
 if(row.title==='Sentiment analysis')output=/great|happy|good/i.test(text)?'Positive keyword match (demo)':'Needs human review (demo)';
 if(row.title==='Document generation')output=`PGSiO sample document\n${text}\nGenerated for review; no signature or legal certification.`;
 if(table==='integrations'){const signature=createHmac('sha256',this.backend.config.serviceKey).update(text).digest('hex');output=JSON.stringify({payload:text,signature,verified:createHmac('sha256',this.backend.config.serviceKey).update(text).digest('hex')===signature,delivery:'local sandbox only'});}
 add('executions',make(row.title,'Completed',{data:JSON.stringify({input:text,output,source_id:row.id,adapter:'deterministic demo'})}));
 }else if(input.action==='transition'){
 if(!row)throw new QBError('VALIDATION','Choose a record');
 const action=resource.action;if(!action)throw new QBError('DENIED','No transition available',403);
 const decision=input.decision??action;
 if(['leave','expenses','timesheets','compensation'].includes(table)&&decision==='cancel'){
 if(row.owner_id!==member.owner_id||!['Pending review','Changes requested','Submitted'].includes(row.status))throw new QBError('DENIED','Only the requester may cancel a pending request',403);update({status:'Cancelled'});
 }else{
 if(['leave','expenses','timesheets','compensation'].includes(table)){
 const allowed=table==='leave'||table==='timesheets'?['super_admin','hr_admin','manager']:['super_admin','hr_admin','finance'];
 if(!allowed.includes(member.role)||row.owner_id===member.owner_id)throw new QBError('DENIED','An authorized independent approver is required',403);
 if(!['Pending review','Submitted','Draft','Changes requested'].includes(row.status))throw new QBError('CONFLICT','This request has already been decided',409);
 if(!['approve','decline','changes'].includes(decision))throw new QBError('VALIDATION','Choose a valid decision');
 update({status:decision==='approve'?'Approved':decision==='decline'?'Declined':'Changes requested',data:JSON.stringify({...details(row),decision_by:member.owner_id,decision_at:now})});
 }else if(action==='publish_payroll'){
 assertWrite(member,table,row);if(row.status==='Published')throw new QBError('CONFLICT','Payroll already published',409);
 const salaries=await this.backend.all('salaries',[{column:'workspace_id',op:'eq',value:member.workspace_id}]);
 for(const salary of salaries)add('payslips',this.backend.row(commandId+'-slip-'+salary.id,salary.owner_id,row.title,'Published',{amount:payrollAmount(salary),subtitle:salary.title,start_date:row.start_date,end_date:row.end_date,data:JSON.stringify({run_id:row.id,currency:'AED',base:Number(salary.amount),bonus:details(salary).bonus??0,deductions:details(salary).deductions??0})}));
 update({status:'Published',amount:salaries.reduce((s,r)=>s+payrollAmount(r),0),data:JSON.stringify({...details(row),count:salaries.length})});
 }else if(action==='accept_offer'){
 assertWrite(member,table,row);if(row.status==='Accepted')throw new QBError('CONFLICT','Offer already accepted',409);
 add('onboarding',make('Welcome to PGSiO','Active',{subtitle:row.title,data:JSON.stringify({tasks:'Upload documents\nComplete induction\nCollect laptop',source_id:row.id})}));update({status:'Accepted'});
 }else if(action==='advance'){
 assertWrite(member,table,row);const stages=resource.statuses;const current=stages.indexOf(row.status);if(current<0||current>=stages.length-1)throw new QBError('CONFLICT','Candidate is at the final stage',409);update({status:stages[current+1]});
 }else if(action==='complete'){
 if(row.owner_id!==member.owner_id)assertWrite(member,table,row);
 if(table==='enrollments'){const courseId=String(details(row).source_id??'');if(courseId){const course=await this.backend.one('courses',courseId);const expected=String(details(course).answer??'').toLowerCase();if(expected&&String(input.values.answer??'').trim().toLowerCase()!==expected)throw new QBError('VALIDATION','Review the lesson and try the assessment again');}}
 update({status:table==='assets'?'Returned':['consents','compliance','suggestions'].includes(table)?'Reviewed':'Completed',data:JSON.stringify({...details(row),progress:100,completed_at:now})});
 }else if(action==='publish'){assertWrite(member,table,row);update({status:'Published'});}else throw new QBError('VALIDATION','Use the dedicated action');
 }
 }else throw new QBError('VALIDATION','Unknown command');
 const anonymous=table==='suggestions';add('audit',this.backend.row(commandId+'-audit',anonymous?'anonymous':member.owner_id,`${input.action} · ${table}`,'Recorded',{subtitle:anonymous?'Anonymous submission':member.title,data:JSON.stringify({record_id:anonymous?'redacted':row?.id??ops[0]?.id,command_id:anonymous?'redacted':commandId})}));
 return ops;
 }
}
