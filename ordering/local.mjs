import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from './worker.mjs';
export function databaseAdapter(database){
 class Statement {
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new Statement(this.sql,args)}
  async first(){return database.prepare(this.sql).get(...this.args)||null}
  async all(){return {results:database.prepare(this.sql).all(...this.args)}}
  async run(){const result=database.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:Number(result.changes)}}}
 }
 return {prepare:sql=>new Statement(sql),async batch(statements){database.exec('BEGIN IMMEDIATE');try{const results=[];for(const statement of statements)results.push(await statement.run());database.exec('COMMIT');return results}catch(error){database.exec('ROLLBACK');throw error}}};
}
export function createDatabase(path,catalog){
 if(path!==':memory:')mkdirSync(dirname(resolve(path)),{recursive:true});
 const database=new DatabaseSync(path);
 database.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 database.prepare("INSERT OR IGNORE INTO configuration(id,value) VALUES('catalog',?)").run(JSON.stringify(catalog));
 return database;
}
export function createServer({database,assets,password}){
 let origin;
 const env={DB:databaseAdapter(database),ADMIN_PASSWORD:password,ASSETS:{async fetch(request){
  const pathname=decodeURIComponent(new URL(request.url).pathname);
  const path=resolve(assets,'.'+(pathname==='/'?'/index.html':pathname));
  if(!path.startsWith(resolve(assets)+'/'))return new Response('Não encontrado',{status:404});
  try{const type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.webp':'image/webp','.ttf':'font/ttf','.json':'application/json'}[extname(path)]||'application/octet-stream';return new Response(readFileSync(path),{headers:{'Content-Type':type}})}catch{return new Response('Não encontrado',{status:404})}
 }}};
 const server=http.createServer(async(req,res)=>{
  try{
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>32768){res.writeHead(413);res.end('Pedido muito grande');return;}chunks.push(chunk)}
   origin=`http://${req.headers.host}`;
   const request=new Request(origin+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})});
   const response=await worker.fetch(request,{...env,ALLOWED_ORIGINS:origin});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Erro de desenvolvimento')}
 });
 return server;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const assets=resolve(root,'public');
 if(!existsSync(assets+'/index.html'))throw new Error('Execute python3 scripts/prepare_ordering.py antes de iniciar.');
 const catalog=JSON.parse(readFileSync(root+'/data/menu.json','utf8'));
 const database=createDatabase(process.env.KIGULA_DB_PATH||root+'/.local/orders.sqlite',catalog);
 const server=createServer({database,assets,password:process.env.ADMIN_PASSWORD});
 server.listen(Number(process.env.PORT)||8787,'127.0.0.1',()=>console.log('KiGula: servidor local iniciado. Loja fechada até a configuração no painel.'));
}
