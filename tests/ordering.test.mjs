import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createDatabase,databaseAdapter} from '../ordering/local.mjs';
import {priceCart,OrderError} from '../ordering/pricing.mjs';
import worker from '../ordering/worker.mjs';
const catalog=JSON.parse(readFileSync(new URL('../data/menu.json',import.meta.url),'utf8'));
const all=catalog.categories.flatMap(c=>c.products);
const hotdog=all.find(p=>p.name==='Cachorro Q. de Carne');
const pizza=all.find(p=>p.price.kind==='from');
const acaí=all.find(p=>p.name==='Açaí 300ml');
function setup(){const database=createDatabase(':memory:',catalog);database.prepare("INSERT INTO configuration(id,value) VALUES('settings',?)").run(JSON.stringify({acceptingOrders:true,deliveryFeeCents:800,minimumCents:400,deliveryEnabled:true,pickupEnabled:true}));const env={DB:databaseAdapter(database),ADMIN_PASSWORD:'only-for-automated-local-tests',ASSETS:{fetch:()=>new Response('static')}};return {database,env};}
const input=(fulfillment='delivery')=>({name:'Cliente de teste',phone:'81999999999',fulfillment,address:{street:'Rua de teste',number:'10',neighborhood:'Centro'},payment:{method:'cash',changeForCents:5000},expectedSubtotalCents:2800,expectedTotalCents:fulfillment==='pickup'?2800:3600,items:[{productId:hotdog.id,quantity:2,options:{}}]});
async function call(env,path,{method='GET',body,headers={}}={}){const response=await worker.fetch(new Request('https://kigula.test'+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:response.status,headers:response.headers,data:await response.json()};}
const attempt=()=>({'Idempotency-Key':crypto.randomUUID(),'X-Order-Token':'a'.repeat(64)});
test('retirada não paga entrega; entrega cobra exatamente R$8; valores não vêm do cliente',async()=>{
 const {database,env}=setup();
 for(const mode of ['pickup','delivery']){const body=input(mode);body.totalCents=1;body.deliveryCents=0;body.items[0].price=0;const result=await call(env,'/api/orders',{method:'POST',body,headers:attempt()});assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.order.subtotalCents,2800);assert.equal(result.data.order.deliveryCents,mode==='pickup'?0:800);assert.equal(result.data.order.totalCents,mode==='pickup'?2800:3600);assert.equal(result.data.order.status,'received');}
 assert.equal(database.prepare('SELECT COUNT(*) AS n FROM orders').get().n,2);database.close();
});
test('adicionais, quantidade e sabores são calculados no servidor; creme grátis não zera açaí',()=>{
 const group=catalog.optionGroups.find(g=>g.name==='Complementos Adicionais');const bacon=group.options.find(o=>o.name==='bacon');
 const priced=priceCart(catalog,[{productId:hotdog.id,quantity:2,options:{[group.id]:[{id:bacon.id,quantity:1}]}}]);assert.equal(priced.subtotalCents,4000);
 const rule=acaí.optionSelections.find(r=>r.priceModel===2)||acaí.optionSelections[0];const option=catalog.optionGroups.find(g=>g.id===rule.groupId).options.find(o=>o.availability==='available');assert.equal(priceCart(catalog,[{productId:acaí.id,quantity:1,options:{[rule.groupId]:[{id:option.id,quantity:1}]}}]).subtotalCents,1000);
 const flavors=pizza.variants.filter(v=>v.availability==='available');const low=flavors.reduce((a,b)=>a.price.amount<b.price.amount?a:b);const high=flavors.reduce((a,b)=>a.price.amount>b.price.amount?a:b);const flavorRule=pizza.optionSelections.find(r=>r.priceModel===2);
 assert.equal(priceCart(catalog,[{productId:pizza.id,quantity:1,options:{[flavorRule.groupId]:[{id:low.id,quantity:1},{id:high.id,quantity:1}]}}]).subtotalCents,Math.round(high.price.amount*100));
 assert.throws(()=>priceCart(catalog,[{productId:pizza.id,quantity:1,options:{}}]),OrderError);
 assert.throws(()=>priceCart(catalog,[{productId:hotdog.id,quantity:1,options:{inventado:[]}}]),OrderError);
 assert.throws(()=>priceCart(catalog,[{productId:hotdog.id,quantity:999,options:{}}]),OrderError);
});
test('reenvio idempotente, privacidade de pedidos e autorização administrativa',async()=>{
 const {database,env}=setup();const headers=attempt();const created=await call(env,'/api/orders',{method:'POST',body:input(),headers});const repeat=await call(env,'/api/orders',{method:'POST',body:input(),headers});assert.equal(created.data.order.id,repeat.data.order.id);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);
 assert.equal((await call(env,'/api/orders/'+created.data.order.id)).status,404);
 assert.equal((await call(env,'/api/orders/'+created.data.order.id,{headers:{'X-Order-Token':'b'.repeat(64)}})).status,404);
 assert.equal((await call(env,'/api/orders/'+created.data.order.id,{headers:{'X-Order-Token':headers['X-Order-Token']}})).status,200);
 assert.equal((await call(env,'/api/admin/orders')).status,401);
 assert.equal((await call(env,'/api/admin/login',{method:'POST',body:{password:'incorreta'}})).status,401);
 const login=await call(env,'/api/admin/login',{method:'POST',body:{password:env.ADMIN_PASSWORD}});assert.equal(login.status,200);
 const auth={Authorization:'Bearer '+login.data.token};const list=await call(env,'/api/admin/orders',{headers:auth});assert.equal(list.data.orders[0].customerPhone,'81999999999');
 assert.equal((await call(env,'/api/admin/orders/'+created.data.order.id,{method:'PATCH',headers:auth,body:{status:'completed'}})).status,409);
 assert.equal((await call(env,'/api/admin/orders/'+created.data.order.id,{method:'PATCH',headers:auth,body:{status:'confirmed'}})).status,200);
 await call(env,'/api/admin/logout',{method:'POST',headers:auth});assert.equal((await call(env,'/api/admin/orders',{headers:auth})).status,401);database.close();
});
test('loja fechada, origem indevida, esgotado, pagamento online sem credenciais e webhook forjado são recusados',async()=>{
 const {database,env}=setup();
 assert.equal((await call(env,'/api/orders',{method:'POST',body:input(),headers:{...attempt(),Origin:'https://outro.example'}})).status,403);
 const sold=all.find(p=>p.availability==='unavailable');const body=input();body.items=[{productId:sold.id,quantity:1}];assert.equal((await call(env,'/api/orders',{method:'POST',body,headers:attempt()})).status,409);
 const online=input();online.payment={method:'pix',email:'teste@example.com'};assert.equal((await call(env,'/api/orders',{method:'POST',body:online,headers:attempt()})).data.code,'PAYMENT_NOT_CONFIGURED');
 assert.equal((await call(env,'/api/payments/webhook?data.id=123',{method:'POST',body:{}})).status,401);
 database.prepare("UPDATE configuration SET value=? WHERE id='settings'").run(JSON.stringify({acceptingOrders:false}));assert.equal((await call(env,'/api/orders',{method:'POST',body:input(),headers:attempt()})).data.code,'STORE_CLOSED');database.close();
});
test('pagamento de teste usa total servidor e só aprovação autenticada libera pedido',async()=>{
 const {database,env}=setup();env.MERCADOPAGO_ACCESS_TOKEN='test-fixture';env.MERCADOPAGO_WEBHOOK_SECRET='test-fixture-signing';let payment;let calls=0;
 env.PAYMENT_FETCH=async(url,init)=>{calls++;if(init.method==='POST'){const payload=JSON.parse(init.body);assert.equal(payload.transaction_amount,36);payment={id:'123456',external_reference:payload.external_reference,transaction_amount:payload.transaction_amount,currency_id:'BRL',status:'pending',point_of_interaction:{transaction_data:{qr_code:'fixture-pix'}}};}return Response.json(payment);};
 const body=input();body.payment={method:'pix',email:'teste@example.com'};const headers=attempt();const result=await call(env,'/api/orders',{method:'POST',body,headers});assert.equal(result.status,201);assert.equal(result.data.order.status,'awaiting_payment');const id=result.data.order.id;
 const pHeaders={'X-Order-Token':headers['X-Order-Token'],'Idempotency-Key':crypto.randomUUID()};const pix=await call(env,'/api/orders/'+id+'/payments',{method:'POST',body:{transaction_amount:.01},headers:pHeaders});assert.equal(pix.status,200,JSON.stringify(pix.data));assert.equal(pix.data.payment.qrCode,'fixture-pix');
 payment={...payment,status:'approved'};const receipt=await call(env,'/api/orders/'+id,{headers:{'X-Order-Token':headers['X-Order-Token']}});assert.equal(receipt.data.order.status,'received');assert.equal(database.prepare('SELECT state FROM payments').get().state,'approved');assert(calls>=2);database.close();
});

test('mudanças de preço exigem nova confirmação; chave idempotente não pode criar pedido diferente',async()=>{const {database,env}=setup();const bad=input();bad.expectedTotalCents=1;assert.equal((await call(env,'/api/orders',{method:'POST',body:bad,headers:attempt()})).data.code,'PRICE_CHANGED');const h=attempt();assert.equal((await call(env,'/api/orders',{method:'POST',body:input(),headers:h})).status,201);const changed=input();changed.name='Outra pessoa';assert.equal((await call(env,'/api/orders',{method:'POST',body:changed,headers:h})).data.code,'IDEMPOTENCY_CONFLICT');assert.equal(database.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);database.close();});
