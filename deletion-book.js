import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';
export function deletionBook(home) {
 const directory=join(home,'archive-delete','deletions'),entries=new Map();
 const file=id=>join(directory,createHash('sha256').update(id).digest('hex')+'.json');
 return {
  entries,
  has(id){
   const target=file(id);
   if(existsSync(target)){const record=JSON.parse(readFileSync(target,'utf8'));if(record.id!==id||!['pending','deleted'].includes(record.state))throw new Error('Invalid session deletion record');entries.set(id,record);}
   return entries.has(id);
  },
  refresh(){
   if(!existsSync(directory))return entries;
   for(const name of readdirSync(directory)){
    if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
    const record=JSON.parse(readFileSync(join(directory,name),'utf8'));
    if(typeof record.id!=='string'||!record.id||!['pending','deleted'].includes(record.state)||file(record.id)!==join(directory,name))throw new Error('Invalid session deletion record');
    entries.set(record.id,record);
   }
   return entries;
  },
  mark(id,state){
   mkdirSync(directory,{recursive:true});
   const record={id,state,requested_at:entries.get(id)?.requested_at||new Date().toISOString()},target=file(id),pending=target+'.'+randomUUID()+'.tmp';
   writeFileSync(pending,JSON.stringify(record)+'\n',{mode:0o600});renameSync(pending,target);entries.set(id,record);
  }
 };
}
