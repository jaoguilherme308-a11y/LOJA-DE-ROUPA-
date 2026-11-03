import {priceCart,validateCustomer,OrderError} from './pricing.mjs';
import {onlineReady,provider,applyPayment,publicPayment,verifyWebhook} from './payments.mjs';
const DEFAULT_SETTINGS={acceptingOrders:false,deliveryEnabled:true,pickupEnabled:true,deliveryFeeCents:800,minimumCents:400,storeName:'KiGula'};
const encoder=new TextEncoder();
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const token=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function settings(db){const row=await db.prepare("SELECT value FROM configuration WHERE id='settings'").first();return {...DEFAULT_SETTINGS,...(row?JSON.parse(row.value):{})};}
async function catalog(db){const row=await db.prepare("SELECT value FROM configuration WHERE id='catalog'").first();if(!row)throw new OrderError('O cardápio ainda está sendo configurado.',503,'NOT_CONFIGURED');return JSON.parse(row.value);}
async function body(request){
 if(Number(request.headers.get('Content-Length')||0)>32768)throw new OrderError('Pedido muito grande.',413);
 if(!request.body)throw new OrderError('Dados inválidos.');
 const reader=request.body.getReader();const chunks=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();throw new OrderError('Pedido muito grande.',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let data;try{data=JSON.parse(new TextDecoder().decode(bytes))}catch{throw new OrderError('Dados inválidos.');}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new OrderError('Dados inválidos.');
 return data;
}
async function limit(db,key,max,period){
 const now=Date.now();
 await db.prepare('INSERT INTO request_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<? THEN excluded.expires_at ELSE expires_at END').bind(key,now+period,now,now).run();
 const row=await db.prepare('SELECT count FROM request_limits WHERE key=?').bind(key).first();
 if(row.count>max)throw new OrderError('Muitas tentativas. Aguarde alguns minutos.',429,'RATE_LIMITED');
}
async function admin(request,env){
 const auth=request.headers.get('Authorization')||'';
 if(!/^Bearer [a-f0-9]{64}$/.test(auth))throw new OrderError('Entre no painel para continuar.',401);
 const row=await env.DB.prepare('SELECT expires_at FROM admin_sessions WHERE token_hash=?').bind(await hash(auth.slice(7))).first();
 if(!row||row.expires_at<Date.now())throw new OrderError('Sua sessão expirou. Entre novamente.',401);
}
function serialize(row,privateFields=false){
 const result={id:row.id,reference:row.reference,createdAt:row.created_at,updatedAt:row.updated_at,status:row.status,fulfillment:row.fulfillment,items:JSON.parse(row.items_json),subtotalCents:row.subtotal_cents,deliveryCents:row.delivery_cents,totalCents:row.total_cents,payment:JSON.parse(row.payment_json),notes:row.notes};
 if(privateFields)Object.assign(result,{customerName:row.customer_name,customerPhone:row.customer_phone,address:row.address_json?JSON.parse(row.address_json):null});
 return result;
}
async function findCustomerOrder(request,env,id){
 const key=request.headers.get('X-Order-Token')||'';
 if(!/^[a-f0-9]{64}$/.test(key))throw new OrderError('Pedido não encontrado.',404);
 const row=await env.DB.prepare('SELECT * FROM orders WHERE id=? AND token_hash=?').bind(id,await hash(key)).first();
 if(!row)throw new OrderError('Pedido não encontrado.',404);
 return row;
}
async function api(request,env,url){
 if(!env.DB)throw new OrderError('O recebimento de pedidos ainda não está conectado.',503,'NOT_CONFIGURED');
 const path=url.pathname;const method=request.method;
 if(path==='/api/store'&&method==='GET')return response({settings:await settings(env.DB),catalog:await catalog(env.DB),payments:{pix:onlineReady(env),onlineCard:onlineReady(env)&&Boolean(env.MERCADOPAGO_PUBLIC_KEY),publicKey:env.MERCADOPAGO_PUBLIC_KEY||null}});
 if(path==='/api/orders'&&method==='POST'){
  const ip=await hash(request.headers.get('CF-Connecting-IP')||'local');
  await limit(env.DB,'orders:'+ip,10,10*60*1000);
  const input=await body(request);
  const idempotency=request.headers.get('Idempotency-Key')||'';
  const customerToken=request.headers.get('X-Order-Token')||'';
  if(!/^[a-f0-9-]{36}$/.test(idempotency)||!/^[a-f0-9]{64}$/.test(customerToken))throw new OrderError('Identificação do pedido inválida.');
  const tokenHash=await hash(customerToken),requestHash=await hash(JSON.stringify(input));
  const existing=await env.DB.prepare('SELECT * FROM orders WHERE idempotency_key=?').bind(idempotency).first();
  if(existing){
   if(existing.token_hash!==tokenHash)throw new OrderError('Identificação já utilizada.',409);
   if(existing.request_hash!==requestHash)throw new OrderError('Este envio já criou um pedido. Atualize o acompanhamento antes de fazer outro.',409,'IDEMPOTENCY_CONFLICT');
   return response({order:serialize(existing),reused:true});
  }
  const current=await settings(env.DB);
  if(!current.acceptingOrders)throw new OrderError('A loja não está recebendo pedidos agora.',409,'STORE_CLOSED');
  const customer=validateCustomer(input);
  if(customer.fulfillment==='delivery'&&!current.deliveryEnabled)throw new OrderError('A entrega está indisponível no momento.',409);
  if(customer.fulfillment==='pickup'&&!current.pickupEnabled)throw new OrderError('A retirada está indisponível no momento.',409);
  if(['pix','online_card'].includes(customer.payment.method)&&(!onlineReady(env)||(customer.payment.method==='online_card'&&!env.MERCADOPAGO_PUBLIC_KEY)))throw new OrderError('O pagamento online ainda não está disponível. Escolha pagar na entrega ou retirada.',409,'PAYMENT_NOT_CONFIGURED');
  const priced=priceCart(await catalog(env.DB),input.items);
  if(priced.subtotalCents<current.minimumCents)throw new OrderError('O subtotal está abaixo do pedido mínimo.',400,'BELOW_MINIMUM');
  const delivery=customer.fulfillment==='pickup'?0:current.deliveryFeeCents;
  const total=delivery===null?null:priced.subtotalCents+delivery;
  if(input.expectedSubtotalCents!==priced.subtotalCents||input.expectedTotalCents!==total)throw new OrderError('Os valores foram atualizados. Confira o novo total antes de confirmar.',409,'PRICE_CHANGED');
  if(total!==null&&customer.payment.changeForCents!==null&&customer.payment.changeForCents<total)throw new OrderError('O valor para troco deve ser igual ou maior que o total.');
  const id=crypto.randomUUID();const reference='KG-'+id.slice(0,8).toUpperCase();const now=new Date().toISOString();
  await env.DB.prepare('INSERT INTO orders(id,reference,token_hash,created_at,updated_at,status,customer_name,customer_phone,fulfillment,address_json,payment_json,notes,items_json,subtotal_cents,delivery_cents,total_cents,idempotency_key,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,reference,tokenHash,now,now,total===null?'quote_requested':(['pix','online_card'].includes(customer.payment.method)?'awaiting_payment':'received'),customer.name,customer.phone,customer.fulfillment,customer.address?JSON.stringify(customer.address):null,JSON.stringify(customer.payment),customer.notes,JSON.stringify(priced.items),priced.subtotalCents,delivery,total,idempotency,requestHash).run();
  const row=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
  return response({order:serialize(row)},201);
 }
 const customerMatch=path.match(/^\/api\/orders\/([a-f0-9-]{36})(\/accept-quote)?$/);
 if(customerMatch){
  const row=await findCustomerOrder(request,env,customerMatch[1]);
  if(method==='GET'&&!customerMatch[2]){
   if(row.status==='awaiting_payment'&&onlineReady(env)){
    const known=await env.DB.prepare('SELECT provider_id FROM payments WHERE order_id=? ORDER BY created_at DESC LIMIT 1').bind(row.id).first();
    if(known){await limit(env.DB,'payment-check:'+row.id,12,60000);await applyPayment(env,await provider(env,'/v1/payments/'+known.provider_id),row);}
   }
   return response({order:serialize(await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(row.id).first())});
  }
  if(method==='POST'&&customerMatch[2]){
   if(row.status!=='awaiting_customer')throw new OrderError('A cotação não está disponível para confirmação.',409);
   const input=await body(request);
   if(input.totalCents!==row.total_cents)throw new OrderError('O valor foi atualizado. Confira o novo total.',409);
   const payment=JSON.parse(row.payment_json);
   if(payment.changeForCents!==null&&payment.changeForCents<row.total_cents)throw new OrderError('O valor de troco informado é menor que o total. Entre em contato com a loja.',409);
   await env.DB.prepare("UPDATE orders SET status=CASE WHEN json_extract(payment_json,'$.method') IN ('pix','online_card') THEN 'awaiting_payment' ELSE 'received' END,updated_at=? WHERE id=? AND status='awaiting_customer' AND total_cents=?").bind(new Date().toISOString(),row.id,row.total_cents).run();
   return response({order:serialize(await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(row.id).first())});
  }
 }
 const paymentMatch=path.match(/^\/api\/orders\/([a-f0-9-]{36})\/payments$/);
 if(paymentMatch&&method==='POST'){
  const order=await findCustomerOrder(request,env,paymentMatch[1]);
  if(order.status!=='awaiting_payment'||order.total_cents===null)throw new OrderError('Este pedido não está aguardando pagamento.',409);
  if(!onlineReady(env))throw new OrderError('Pagamento online não configurado.',503,'PAYMENT_NOT_CONFIGURED');
  const input=await body(request);const method=JSON.parse(order.payment_json).method;
  if(!['pix','online_card'].includes(method))throw new OrderError('Forma de pagamento inválida.');
  const attempt=request.headers.get('Idempotency-Key')||'';
  if(!/^[a-f0-9-]{36}$/.test(attempt))throw new OrderError('Identificação de pagamento inválida.');
  const existing=await env.DB.prepare('SELECT provider_id FROM payments WHERE id=? AND order_id=?').bind(attempt,order.id).first();
  if(existing){const paid=await provider(env,'/v1/payments/'+existing.provider_id);await applyPayment(env,paid,order);return response({payment:publicPayment(paid)});}
  await limit(env.DB,'payment-create:'+order.id,5,60*60000);
  const stored=JSON.parse(order.payment_json);
  const payer={email:stored.email};
  if(input.identification){if(input.identification.type!=='CPF'||!/^\d{11}$/.test(input.identification.number||''))throw new OrderError('Confira o CPF do pagador.');payer.identification=input.identification;}
  const payload={transaction_amount:order.total_cents/100,description:'Pedido '+order.reference+' — KiGula',external_reference:order.id,notification_url:url.origin+'/api/payments/webhook',payer};
  if(method==='pix')payload.payment_method_id='pix';
  else{
   if(typeof input.token!=='string'||input.token.length>300||!input.token||typeof input.payment_method_id!=='string'||input.installments!==1)throw new OrderError('Dados do cartão inválidos.');
   payload.token=input.token;payload.payment_method_id=input.payment_method_id;payload.installments=1;
   if(input.issuer_id)payload.issuer_id=String(input.issuer_id);
  }
  const paid=await provider(env,'/v1/payments',{method:'POST',body:payload,idempotency:'kigula-'+order.id+'-'+attempt});
  const now=new Date().toISOString();
  await env.DB.prepare('INSERT INTO payments(id,order_id,provider_id,state,method,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(attempt,order.id,String(paid.id),String(paid.status),method,now,now).run();
  await applyPayment(env,paid,order);
  return response({payment:publicPayment(paid)});
 }
 if(path==='/api/payments/webhook'&&method==='POST'){
  if(!await verifyWebhook(request,url,env.MERCADOPAGO_WEBHOOK_SECRET))throw new OrderError('Assinatura inválida.',401);
  const payment=await provider(env,'/v1/payments/'+encodeURIComponent(url.searchParams.get('data.id')));
  const order=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(String(payment.external_reference||'')).first();
  if(order)await applyPayment(env,payment,order);
  return response({ok:true});
 }
 if(path==='/api/admin/login'&&method==='POST'){
  if(!env.ADMIN_PASSWORD||env.ADMIN_PASSWORD.length<12)throw new OrderError('A senha administrativa ainda precisa ser configurada.',503,'NOT_CONFIGURED');
  await limit(env.DB,'login:'+await hash(request.headers.get('CF-Connecting-IP')||'local'),5,15*60*1000);
  const input=await body(request);const provided=typeof input.password==='string'?input.password:'';
  if(provided.length>128)throw new OrderError('Credenciais inválidas.',401);
  const left=await hash(provided),right=await hash(env.ADMIN_PASSWORD);let difference=0;for(let i=0;i<left.length;i++)difference|=left.charCodeAt(i)^right.charCodeAt(i);
  if(difference)throw new OrderError('Credenciais inválidas.',401);
  const session=token();const expiresAt=Date.now()+12*60*60*1000;
  await env.DB.prepare('INSERT INTO admin_sessions(token_hash,expires_at) VALUES(?,?)').bind(await hash(session),expiresAt).run();
  return response({token:session,expiresAt});
 }
 if(path.startsWith('/api/admin/')){
  await admin(request,env);
  if(path==='/api/admin/logout'&&method==='POST'){await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await hash(request.headers.get('Authorization').slice(7))).run();return response({ok:true});}
  if(path==='/api/admin/orders'&&method==='GET'){
   const rows=await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 200').all();return response({orders:rows.results.map(row=>serialize(row,true))});
  }
  if(path==='/api/admin/settings'&&method==='GET')return response({settings:await settings(env.DB)});
  if(path==='/api/admin/settings'&&method==='PUT'){
   const input=await body(request);
  const idempotency=request.headers.get('Idempotency-Key')||'';
  const customerToken=request.headers.get('X-Order-Token')||'';
  if(!/^[a-f0-9-]{36}$/.test(idempotency)||!/^[a-f0-9]{64}$/.test(customerToken))throw new OrderError('Identificação do pedido inválida.');
  const tokenHash=await hash(customerToken),requestHash=await hash(JSON.stringify(input));
  const existing=await env.DB.prepare('SELECT * FROM orders WHERE idempotency_key=?').bind(idempotency).first();
  if(existing){
   if(existing.token_hash!==tokenHash)throw new OrderError('Identificação já utilizada.',409);
   if(existing.request_hash!==requestHash)throw new OrderError('Este envio já criou um pedido. Atualize o acompanhamento antes de fazer outro.',409,'IDEMPOTENCY_CONFLICT');
   return response({order:serialize(existing),reused:true});
  }
  const current=await settings(env.DB);
   for(const key of ['acceptingOrders','deliveryEnabled','pickupEnabled'])if(key in input){if(typeof input[key]!=='boolean')throw new OrderError('Configuração inválida.');current[key]=input[key];}
   for(const key of ['minimumCents','deliveryFeeCents'])if(key in input){if(key==='deliveryFeeCents'&&input[key]===null){current[key]=null;continue;}if(!Number.isInteger(input[key])||input[key]<0||input[key]>100000)throw new OrderError('Valor de configuração inválido.');current[key]=input[key];}
   await env.DB.prepare("INSERT INTO configuration(id,value) VALUES('settings',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(JSON.stringify(current)).run();return response({settings:current});
  }
  if(path==='/api/admin/catalog'&&method==='GET')return response({catalog:await catalog(env.DB)});
  const productMatch=path.match(/^\/api\/admin\/products\/([a-f0-9]{24})$/);
  if(productMatch&&method==='PATCH'){
   const input=await body(request);const row=await env.DB.prepare("SELECT value FROM configuration WHERE id='catalog'").first();
   const current=JSON.parse(row.value);const p=current.categories.flatMap(c=>c.products).find(p=>p.id===productMatch[1]);
   if(!p)throw new OrderError('Produto não encontrado.',404);
   if('available' in input){if(typeof input.available!=='boolean')throw new OrderError('Disponibilidade inválida.');p.availability=input.available?'available':'unavailable';}
   if('priceCents' in input){if(p.price.kind!=='fixed'||!Number.isInteger(input.priceCents)||input.priceCents<1||input.priceCents>1000000)throw new OrderError('Preço inválido. Edite os sabores para produtos com preço variável.');p.price.amount=input.priceCents/100;p.price.display='R$ '+(input.priceCents/100).toFixed(2).replace('.',',');}
   const result=await env.DB.prepare("UPDATE configuration SET value=? WHERE id='catalog' AND value=?").bind(JSON.stringify(current),row.value).run();
   if(!result.meta.changes)throw new OrderError('O cardápio foi atualizado em outra sessão. Recarregue.',409);
   return response({product:p});
  }
  const orderMatch=path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})$/);
  if(orderMatch&&method==='PATCH'){
   const row=await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderMatch[1]).first();if(!row)throw new OrderError('Pedido não encontrado.',404);
   const input=await body(request);let total=row.total_cents,delivery=row.delivery_cents,status=input.status;
   const transitions={awaiting_payment:['cancelled'],quote_requested:['awaiting_customer','cancelled'],awaiting_customer:['cancelled'],received:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','out_for_delivery','cancelled'],ready:['completed','cancelled'],out_for_delivery:['completed','cancelled'],completed:[],cancelled:[]};
   if(!(transitions[row.status]||[]).includes(status))throw new OrderError('Essa mudança de status não é permitida.',409);
   if(status==='awaiting_customer'){
    if(!Number.isInteger(input.deliveryCents)||input.deliveryCents<0||input.deliveryCents>100000)throw new OrderError('Informe uma taxa de entrega válida.');
    delivery=input.deliveryCents;total=row.subtotal_cents+delivery;
   }
   if(status==='cancelled'){const paid=await env.DB.prepare("SELECT id FROM payments WHERE order_id=? AND state='approved' LIMIT 1").bind(row.id).first();if(paid)throw new OrderError('Este pedido foi pago. Providencie o estorno no processador antes de cancelar.',409,'REFUND_REQUIRED');}
   if(status==='out_for_delivery'&&row.fulfillment!=='delivery')throw new OrderError('Este pedido é para retirada.');
   const updated=await env.DB.prepare('UPDATE orders SET status=?,delivery_cents=?,total_cents=?,updated_at=? WHERE id=? AND status=?').bind(status,delivery,total,new Date().toISOString(),row.id,row.status).run();
   if(updated.meta.changes===0)throw new OrderError('O pedido foi atualizado. Recarregue o painel.',409);
   return response({order:serialize(await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(row.id).first(),true)});
  }
 }
 throw new OrderError('Rota não encontrada.',404);
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
 const origin=request.headers.get('Origin');const allowed=(env.ALLOWED_ORIGINS||url.origin).split(',').map(s=>s.trim());
 if(origin&&!allowed.includes(origin))return response({error:'Origem não permitida.'},403);
 const headers={'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization,X-Order-Token,Idempotency-Key','Vary':'Origin'};
 if(origin)headers['Access-Control-Allow-Origin']=origin;
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 let result;
 try{result=await api(request,env,url)}catch(error){const known=error instanceof OrderError;result=response({error:known?error.message:'Não foi possível concluir a operação. Tente novamente.',code:known?error.code:'SERVER_ERROR'},known?error.status:500);}
 for(const [key,value] of Object.entries(headers))result.headers.set(key,value);
 return result;
}};
