import {OrderError} from './pricing.mjs';
export const onlineReady=env=>Boolean(env.MERCADOPAGO_ACCESS_TOKEN&&env.MERCADOPAGO_WEBHOOK_SECRET);
export async function provider(env,path,{method='GET',body,idempotency}={}){
 if(!env.MERCADOPAGO_ACCESS_TOKEN)throw new OrderError('O pagamento online ainda não está disponível.',503,'PAYMENT_NOT_CONFIGURED');
 const headers={'Authorization':'Bearer '+env.MERCADOPAGO_ACCESS_TOKEN,'Content-Type':'application/json'};
 if(idempotency)headers['X-Idempotency-Key']=idempotency;
 const result=await (env.PAYMENT_FETCH||fetch)('https://api.mercadopago.com'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
 let data;try{data=await result.json()}catch{throw new OrderError('O processador de pagamento não respondeu. Tente novamente.',502)}
 if(!result.ok)throw new OrderError('O pagamento não foi autorizado. Confira os dados ou escolha outra forma.',422,'PAYMENT_REJECTED');
 return data;
}
export async function applyPayment(env,payment,order){
 if(String(payment.external_reference)!==order.id||payment.currency_id!=='BRL'||Math.round(Number(payment.transaction_amount)*100)!==order.total_cents)throw new OrderError('Pagamento divergente do pedido.',409,'PAYMENT_MISMATCH');
 const now=new Date().toISOString();
 const statements=[env.DB.prepare('UPDATE payments SET state=?,updated_at=? WHERE provider_id=? AND order_id=?').bind(String(payment.status),now,String(payment.id),order.id)];
 if(payment.status==='approved')statements.push(env.DB.prepare("UPDATE orders SET status='received',updated_at=? WHERE id=? AND status='awaiting_payment'").bind(now,order.id));
 await env.DB.batch(statements);
}
export function publicPayment(payment){
 const tx=payment.point_of_interaction?.transaction_data||{};
 return {id:String(payment.id),status:payment.status,qrCode:tx.qr_code||null,qrCodeBase64:tx.qr_code_base64||null,expiresAt:payment.date_of_expiration||null};
}
export async function verifyWebhook(request,url,secret){
 if(!secret)return false;
 const signature=request.headers.get('x-signature')||'';const requestId=request.headers.get('x-request-id')||'';
 const entries=Object.fromEntries(signature.split(',').map(x=>x.trim().split('=')));
 const id=(url.searchParams.get('data.id')||'').toLowerCase();
 if(!entries.ts||!entries.v1||!id||!requestId||!/^\d+$/.test(entries.ts)||!/^[a-f0-9]{64}$/.test(entries.v1))return false;
 const stamp=Number(entries.ts);const millis=stamp<1e12?stamp*1000:stamp;
 if(!Number.isFinite(millis)||Math.abs(Date.now()-millis)>10*60*1000)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const bytes=Uint8Array.from(entries.v1.match(/.{2}/g),x=>parseInt(x,16));
 return crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(`id:${id};request-id:${requestId};ts:${entries.ts};`));
}
