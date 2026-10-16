import { createHash } from 'node:crypto';
import { QBError, type Result } from '@qb-flex/contracts';
import { resources, type DomainRow, type Member, type Role, type ServerConfig, type Table, workspace, details } from './catalog';
export const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class Backend {
 readonly base:string;
 readonly management:string;
 constructor(readonly config:ServerConfig){this.base=`${config.url}/v1/projects/${config.projectId}/branches/${config.branch}`;this.management=`${config.url}/management/v1/projects/${config.projectId}/branches/${config.branch}`;}
 async json<T>(path:string,method='GET',body?:unknown,headers:Record<string,string>={}):Promise<T>{
  const response=await fetch(path,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  const result=await response.json();if(!response.ok)throw new QBError(result.error?.code??'UPSTREAM',result.error?.message??'QB Flex request failed',response.status);return result as T;
 }
 async data<T=DomainRow>(table:string,filters:unknown[]=[],cursor?:string):Promise<Result<T[]>>{const q=new URLSearchParams({limit:'100',filters:JSON.stringify(filters),order:JSON.stringify([{column:'id',direction:'asc'}])});if(cursor)q.set('cursor',cursor);return this.json(`${this.base}/data/${table}?${q}`, 'GET',undefined,{'x-qb-key':this.config.serviceKey});}
 async all<T=DomainRow>(table:string,filters:unknown[]=[]):Promise<T[]>{const rows:T[]=[];let cursor:string|undefined;do{const result=await this.data<T>(table,filters,cursor);rows.push(...result.data);cursor=result.meta.cursor;}while(cursor);return rows;}
 async one<T=DomainRow>(table:string,id:string):Promise<T>{const result=await this.data<T>(table,[{column:'id',op:'eq',value:id}]);if(!result.data[0])throw new QBError('NOT_FOUND','Record not available',404);return result.data[0];}
 async insert<T=DomainRow>(table:string,rows:unknown,key=crypto.randomUUID()):Promise<T[]>{return (await this.json<Result<T[]>>(`${this.base}/data/${table}`,'POST',rows,{'x-qb-key':this.config.serviceKey,'idempotency-key':key})).data;}
 async update(table:string,id:string,values:unknown,revision?:number,key=crypto.randomUUID()):Promise<DomainRow[]>{return (await this.json<Result<DomainRow[]>>(`${this.base}/data/${table}/${encodeURIComponent(id)}`,'PATCH',values,{'x-qb-key':this.config.serviceKey,'idempotency-key':key,...(revision===undefined?{}:{'if-match':String(revision)})})).data;}
 async managementCall<T>(path:string,method='GET',body?:unknown):Promise<T>{return this.json<T>(this.management+path,method,body,{authorization:`Bearer ${this.config.managementToken}`});}
 async identity(request:Request):Promise<Member>{
  const headers:Record<string,string>={'x-qb-key':this.config.publishableKey};for(const name of ['authorization','cookie'])if(request.headers.get(name))headers[name]=request.headers.get(name)!;
  const session=await this.json<{user?:{id:string}}>(`${this.base}/auth/get-session`,'GET',undefined,headers);
  if(!session?.user?.id)throw new QBError('UNAUTHORIZED','Sign in to continue',401);
  const members=await this.all<Member>('hrms_members',[{column:'owner_id',op:'eq',value:session.user.id},{column:'workspace_id',op:'eq',value:workspace}]);
  if(!members[0])throw new QBError('DENIED','Workspace membership required',403);
  return members[0];
 }
 row(id:string,owner_id:string,title:string,status='Active',rest:Partial<DomainRow>={}):DomainRow{return {id,workspace_id:workspace,owner_id,manager_id:'',title,subtitle:'',status,start_date:'',end_date:'',amount:0,data:'{}',revision:1,created_at:new Date().toISOString(),...rest};}
 async canRead(member:Member,table:Table,row:DomainRow){return allowedRead(member,table,row);}
}
const common:Role[]=['super_admin','hr_admin'];
const shared:Table[]=['jobs','policies','holidays','courses','benefits','announcements','surveys','recognition','events','rsvps'];
export function allowedRead(member:Member,table:Table,row:DomainRow):boolean{
 if(row.workspace_id!==member.workspace_id)return false;
 if(!resources[table].read.includes(member.role as never))return false;
 if(common.includes(member.role)||shared.includes(table))return true;
 if(member.role==='finance')return ['payroll','salaries','payslips','expenses','loans','benefit_enrollments','compensation','reports'].includes(table);
 if(member.role==='recruiter')return ['jobs','candidates','interviews','offers'].includes(table);
 if(member.role==='auditor')return ['audit','compliance','consents','reports'].includes(table);
 return row.owner_id===member.owner_id||(member.role==='manager'&&row.manager_id===member.owner_id);
}
export function assertWrite(member:Member,table:Table,row?:DomainRow){
 if(!resources[table].write.includes(member.role as never))throw new QBError('DENIED','Your role cannot change this resource',403);
 if(row&&!allowedRead(member,table,row))throw new QBError('DENIED','Record is outside your scope',403);
}
export function workingDays(start:string,end:string,holidays:string[]=[]){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw new QBError('VALIDATION','Choose valid dates');
 const a=new Date(start+'T00:00:00Z'),b=new Date(end+'T00:00:00Z');
 if(!Number.isFinite(+a)||!Number.isFinite(+b)||a.toISOString().slice(0,10)!==start||b.toISOString().slice(0,10)!==end||b<a||b.getTime()-a.getTime()>366*86400000)throw new QBError('VALIDATION','Choose an ordered date range of at most one year');
 let days=0;for(let d=+a;d<=+b;d+=86400000){const date=new Date(d);if(date.getUTCDay()!==0&&date.getUTCDay()!==6&&!holidays.includes(date.toISOString().slice(0,10)))days++;}return days;
}
export function payrollAmount(row:DomainRow){const d=details(row);const value=Number(row.amount)+Number(d.bonus||0)-Number(d.deductions||0);if(!Number.isSafeInteger(value)||value<0)throw new QBError('VALIDATION','Invalid salary components');return value;}
