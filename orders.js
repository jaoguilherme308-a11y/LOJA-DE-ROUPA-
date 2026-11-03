import {priceCart,cents,validateCustomer} from './ordering/pricing.mjs';

const isPreview=window.KIGULA_CONFIG?.mode!=='live';
const previewBanner=document.querySelector('.preview-banner');if(previewBanner)previewBanner.hidden=!isPreview;
const apiBase=(window.KIGULA_CONFIG?.apiBase||'').replace(/\/$/,'');
const money=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'});
const cash=value=>money.format(value/100);
const $=selector=>document.querySelector(selector);
const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
let catalog=JSON.parse($('#catalog-data').textContent);
let settings={acceptingOrders:false,deliveryEnabled:true,pickupEnabled:true,deliveryFeeCents:800,minimumCents:400};
let paymentConfig={pix:false,onlineCard:false,publicKey:null};
let connected=false;let basket=[];let editIndex=null;let currentProduct=null;let selected={};let currentQuantity=1;
let receipt=null;let pollTimer;let busy=false;let cardBrick;let paymentAttempt=null;let lastFocus;
const cartDialog=$('#cart-dialog');const productDialog=$('.product-dialog');
const statusLabels={preview:'Prévia do pedido · não enviado',quote_requested:'Aguardando taxa de entrega',awaiting_customer:'Confirme o valor da entrega',awaiting_payment:'Aguardando pagamento',received:'Recebido · aguardando confirmação',confirmed:'Pedido confirmado',preparing:'Em preparo',ready:'Pronto para retirada',out_for_delivery:'Saiu para entrega',completed:'Pedido concluído',cancelled:'Pedido cancelado'};
const randomToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const products=()=>new Map(catalog.categories.flatMap(c=>c.products.map(p=>[p.id,{...p,categoryName:c.name}])));
const groups=()=>new Map(catalog.optionGroups.map(g=>[g.id,g]));
const pic=p=>p.image?.localPath||p.image?.sourceUrl||null;
function notice(text){const box=$('#ordering-notice');box.textContent=text;box.hidden=!text;}
async function api(path,{method='GET',body,token,idempotency}={}){
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
 try{
  const result=await fetch(apiBase+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{'X-Order-Token':token}:{}),...(idempotency?{'Idempotency-Key':idempotency}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
  let data;try{data=await result.json()}catch{throw new Error('O recebimento de pedidos ainda não está conectado. Tente mais tarde.');}
  if(!result.ok){const error=new Error(data.error||'Não foi possível concluir a operação.');error.code=data.code;throw error;}
  return data;
 }catch(error){if(error.name==='AbortError')throw new Error('A conexão demorou. Seu carrinho foi mantido; tente novamente.');throw error;}finally{clearTimeout(timeout);}
}
function saveBasket(){try{localStorage.setItem('kigula.basket.v1',JSON.stringify(basket));}catch{}}
function validBasket(){const valid=[];for(const line of basket){try{priceCart(catalog,[line]);valid.push(line)}catch{}}const changed=valid.length!==basket.length;basket=valid;if(changed)notice('Alguns itens mudaram ou ficaram indisponíveis. Confira sua sacola.');saveBasket();}
function itemPrice(line){return priceCart(catalog,[line]).items[0];}
function subtotal(){try{return priceCart(catalog,basket).subtotalCents}catch{return 0}}
function updateBasket(){
 validBasket();const qty=basket.reduce((n,line)=>n+line.quantity,0);
 document.querySelectorAll('[data-cart-count]').forEach(n=>{n.textContent=qty;n.hidden=!qty;});
 document.querySelectorAll('[data-cart-total]').forEach(n=>n.textContent=cash(subtotal()));
 $('#basket-empty').hidden=Boolean(basket.length);$('#basket-filled').hidden=!basket.length;
 const list=$('#basket-items');list.replaceChildren();
 basket.forEach((line,index)=>{
  const p=products().get(line.productId),priced=itemPrice(line);
  const row=node('article','basket-item');const copy=node('div','basket-item-copy');
  copy.append(node('h3','',p.name));
  if(priced.choices.length)copy.append(node('p','',priced.choices.map(o=>`${o.quantity}× ${o.name}`).join(' · ')));
  if(line.note)copy.append(node('p','',line.note));
  copy.append(node('strong','',cash(priced.lineCents)));
  const actions=node('div','basket-item-actions');const edit=node('button','link-button','Editar');edit.type='button';edit.addEventListener('click',()=>{cartDialog.close();openProduct(line.productId,edit,index);});
  const remove=node('button','link-button','Remover');remove.type='button';remove.addEventListener('click',()=>{basket.splice(index,1);updateBasket();});actions.append(edit,remove);copy.append(actions);
  const step=node('div','quantity-step');const minus=node('button','','−');minus.type='button';minus.setAttribute('aria-label','Diminuir quantidade de '+p.name);minus.addEventListener('click',()=>{if(line.quantity===1)basket.splice(index,1);else line.quantity--;updateBasket();});
  const number=node('span','',line.quantity);const plus=node('button','','+');plus.type='button';plus.setAttribute('aria-label','Aumentar quantidade de '+p.name);plus.disabled=line.quantity>=20;plus.addEventListener('click',()=>{line.quantity++;try{priceCart(catalog,basket);updateBasket()}catch(error){line.quantity--;notice(error.message);}});step.append(minus,number,plus);
  row.append(copy,step);list.append(row);
 });
 $('#basket-subtotal').textContent=cash(subtotal());
 $('#basket-minimum').textContent='Pedido mínimo de produtos: '+cash(settings.minimumCents);
 $('#go-checkout').disabled=!basket.length;
 updateCheckout();
}
function openCart(trigger){lastFocus=trigger;notice('');$('#basket-step').hidden=false;$('#checkout-step').hidden=true;$('#receipt-step').hidden=true;cartDialog.showModal();document.body.classList.add('dialog-open');updateBasket();}
document.querySelectorAll('[data-cart-open]').forEach(button=>button.addEventListener('click',()=>openCart(button)));
document.querySelectorAll('[data-cart-close]').forEach(button=>button.addEventListener('click',()=>cartDialog.close()));
cartDialog.addEventListener('close',()=>{if(!document.querySelector('dialog[open]'))document.body.classList.remove('dialog-open');lastFocus?.focus();});
cartDialog.addEventListener('click',event=>{const r=cartDialog.getBoundingClientRect();if(event.target===cartDialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))cartDialog.close();});
$('#continue-shopping').addEventListener('click',()=>{cartDialog.close();$('#cardapio').scrollIntoView({behavior:'smooth'});});
$('#go-checkout').addEventListener('click',()=>{notice('');$('#basket-step').hidden=true;$('#checkout-step').hidden=false;$('#receipt-step').hidden=true;updateCheckout();$('#customer-name').focus();});
$('#back-to-basket').addEventListener('click',()=>{$('#basket-step').hidden=false;$('#checkout-step').hidden=true;notice('');});
function priceSelection(){
 try{return itemPrice({productId:currentProduct.id,quantity:currentQuantity,options:selected,note:$('#product-note').value})}
 catch{return null;}
}
function renderSelection(){
 const result=priceSelection();$('#selection-total').textContent=result?cash(result.lineCents):'Complete as escolhas';$('#product-add').disabled=!result;
 $('#selection-quantity').textContent=currentQuantity;$('#selection-minus').disabled=currentQuantity===1;$('#selection-plus').disabled=currentQuantity===20;
}
function configureGroup(group,rule){
 const field=node('fieldset','selection-group');field.append(node('legend','',group.name));
 const help=node('p','selection-rule',rule.priceModel===2&&rule.min>0?'Escolha até dois sabores. Vale o maior preço entre eles.':rule.min?`Escolha de ${rule.min} a ${rule.max} opções`:`Opcional · até ${rule.max} opções`);field.append(help);
 const entries=()=>selected[group.id]||[];
 for(const option of group.options){
  const row=node('label','selection-option');const check=node('input');check.type='checkbox';check.value=option.id;check.checked=entries().some(x=>x.id===option.id);check.disabled=option.availability==='unavailable';
  const text=node('span','selection-option-name',option.name);const value=node('span','selection-option-price',cash(cents(option.price.amount)));
  check.addEventListener('change',()=>{
   let choices=entries().filter(x=>x.id!==option.id);
   if(check.checked){if(rule.max===1){choices=[];field.querySelectorAll('input').forEach(i=>{if(i!==check)i.checked=false;});}else if(choices.length>=rule.max){check.checked=false;$('#selection-error').textContent=`Escolha no máximo ${rule.max} opções em ${group.name}.`;return;}choices.push({id:option.id,quantity:1});}
   selected[group.id]=choices;$('#selection-error').textContent='';renderSelection();
  });
  row.append(check,text,value);field.append(row);
 }
 return field;
}
function openProduct(id,trigger,index=null){
 const p=products().get(id);if(!p)return;
 if(p.availability==='unavailable'){notice('Esse item está indisponível no momento.');return;}
 lastTrigger=trigger;currentProduct=p;editIndex=index;
 const existing=index===null?null:basket[index];selected=structuredClone(existing?.options||{});currentQuantity=existing?.quantity||1;
 $('#product-title').textContent=p.name;productDialog.querySelector('.eyebrow').textContent=p.categoryName;
 productDialog.querySelector('.product-dialog-description').textContent=p.description||'Monte seu pedido do seu jeito.';
 const photo=productDialog.querySelector('.product-dialog-photo'),image=photo.querySelector('img'),url=pic(p);photo.classList.remove('no-photo');image.hidden=!url;if(url){image.src=url;image.alt=p.name;}else image.removeAttribute('src');
 productDialog.querySelector('.product-image-note').textContent=p.image?.note||'';productDialog.querySelector('.product-image-note').hidden=!p.image?.note;
 const holder=productDialog.querySelector('.product-option-groups');holder.replaceChildren();
 const allGroups=groups();for(const rule of p.optionSelections||[]){const g=allGroups.get(rule.groupId);if(g)holder.append(configureGroup(g,rule));}
 $('#product-note').value=existing?.note||'';$('#selection-error').textContent='';
 $('#product-add').textContent=existing?'Salvar alterações':'Adicionar à sacola';
 productDialog.querySelector('.product-dialog-source').textContent='Confira os ingredientes. Informe observações e restrições alimentares antes de confirmar.';
 renderSelection();productDialog.showModal();document.body.classList.add('dialog-open');productDialog.querySelector('.product-dialog-layout').scrollTop=0;
}
window.KiGulaOrdering={openProduct};
$('#selection-minus').addEventListener('click',()=>{if(currentQuantity>1){currentQuantity--;renderSelection();}});
$('#selection-plus').addEventListener('click',()=>{if(currentQuantity<20){currentQuantity++;renderSelection();}});
$('#product-note').addEventListener('input',renderSelection);
$('#product-config-form').addEventListener('submit',event=>{
 event.preventDefault();const result=priceSelection();if(!result)return;
 const line={productId:currentProduct.id,quantity:currentQuantity,options:structuredClone(selected),note:$('#product-note').value.trim()};
 const before=structuredClone(basket);
 if(editIndex!==null)basket[editIndex]=line;else basket.push(line);
 try{priceCart(catalog,basket)}catch(error){basket=before;$('#selection-error').textContent=error.message;return;}
 updateBasket();productDialog.close();showToast(currentProduct.name+' adicionado à sacola.');
});
function updateCheckout(){
 const form=$('#checkout-form');const fulfillment=form.elements.fulfillment.value;
 const delivery=fulfillment==='delivery';const fee=delivery?settings.deliveryFeeCents:0;
 $('#checkout-address').hidden=!delivery;$('#checkout-address').querySelectorAll('input').forEach(i=>{i.disabled=!delivery;});
 $('#checkout-subtotal').textContent=cash(subtotal());$('#checkout-delivery').textContent=fee===null?'A confirmar':cash(fee);$('#checkout-total').textContent=fee===null?'A confirmar':cash(subtotal()+fee);
 $('#fulfillment-delivery-label').textContent=settings.deliveryFeeCents===null?'Entrega · taxa a confirmar':'Entrega em Tamandaré · '+cash(settings.deliveryFeeCents);
 $('#fulfillment-pickup-label').textContent='Retirada · sem taxa';
 const method=form.elements.paymentMethod.value;const online=['pix','online_card'].includes(method);
 $('#payment-email-row').hidden=!online;$('#payment-email').disabled=!online;$('#payment-email').required=online;
 $('#change-row').hidden=method!=='cash';$('#change-for').disabled=method!=='cash';
 const ready=isPreview||(connected&&settings.acceptingOrders);
 $('#submit-order').disabled=busy||!ready||!basket.length||subtotal()<settings.minimumCents;
 $('#submit-order').textContent=isPreview?'Ver prévia do pedido · '+cash(subtotal()+(fee||0)):(busy?'Enviando…':(fee===null?'Solicitar entrega':'Confirmar pedido · '+cash(subtotal()+fee)));
 $('#checkout-service').textContent=isPreview?'Demonstração: use dados fictícios. Nenhum pedido será enviado e nenhum pagamento será realizado.':!connected?'O recebimento de pedidos ainda está sendo conectado. Sua sacola está salva neste navegador.':(!settings.acceptingOrders?'A loja está fechada para pedidos no momento.':(online?'Seu pedido fica aguardando a confirmação do pagamento.':'A lanchonete confirmará o recebimento e o preparo aqui no site.'));
 $('#payment-pix').disabled=!paymentConfig.pix;$('#payment-online-card').disabled=!paymentConfig.onlineCard;
 $('#payment-online-note').textContent=paymentConfig.pix||paymentConfig.onlineCard?'Pagamento online protegido, sem sair do site.':'Pix e cartão online estarão disponíveis após a ativação do pagamento da loja.';
}
$('#checkout-form').addEventListener('change',updateCheckout);
$('#checkout-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget;if(busy||!form.reportValidity())return;
 const total=subtotal()+(form.elements.fulfillment.value==='delivery'?(settings.deliveryFeeCents||0):0);
 const change=form.elements.changeFor.value.trim();const changeCents=change?Math.round(Number(change.replace(',','.'))*100):null;
 if(form.elements.paymentMethod.value==='cash'&&changeCents!==null&&changeCents<total){notice('O valor para troco precisa ser igual ou maior que o total.');return;}
 busy=true;notice('');updateCheckout();
 if(isPreview){
  const payload={name:form.elements.customerName.value,phone:form.elements.phone.value,fulfillment:form.elements.fulfillment.value,address:{street:form.elements.street.value,number:form.elements.number.value,neighborhood:form.elements.neighborhood.value,reference:form.elements.reference.value},payment:{method:form.elements.paymentMethod.value,changeForCents:changeCents},notes:form.elements.orderNotes.value,items:basket};
  try{const customer=validateCustomer(payload);const priced=priceCart(catalog,basket);const delivery=customer.fulfillment==='pickup'?0:800;
   receipt={order:{id:null,reference:'PRÉVIA — NÃO ENVIADO',status:'preview',fulfillment:customer.fulfillment,payment:customer.payment,items:priced.items,subtotalCents:priced.subtotalCents,deliveryCents:delivery,totalCents:priced.subtotalCents+delivery}};
   showReceipt(receipt.order);
  }catch(error){notice(error.message)}finally{busy=false;updateCheckout();}
  return;
 }
 let pending;try{pending=JSON.parse(sessionStorage.getItem('kigula.pending')||'null')}catch{}
 if(!pending){pending={id:crypto.randomUUID(),token:randomToken()};try{sessionStorage.setItem('kigula.pending',JSON.stringify(pending))}catch{}}
 const payload={name:form.elements.customerName.value,phone:form.elements.phone.value,fulfillment:form.elements.fulfillment.value,address:{street:form.elements.street.value,number:form.elements.number.value,neighborhood:form.elements.neighborhood.value,reference:form.elements.reference.value},payment:{method:form.elements.paymentMethod.value,changeForCents:changeCents,email:form.elements.paymentEmail.value},notes:form.elements.orderNotes.value,items:basket,expectedSubtotalCents:subtotal(),expectedTotalCents:form.elements.fulfillment.value==='delivery'&&settings.deliveryFeeCents===null?null:total};
 try{
  const result=await api('/api/orders',{method:'POST',body:payload,token:pending.token,idempotency:pending.id});
  if(cardBrick){try{await cardBrick.unmount()}catch{}cardBrick=null;}
  $('#pix-box').hidden=true;$('#pix-qr').removeAttribute('src');$('#payment-status').textContent='';
  $('#open-tracking').hidden=false;
  receipt={id:result.order.id,token:pending.token,order:result.order,paymentMethod:payload.payment.method};
  try{localStorage.setItem('kigula.receipt',JSON.stringify({id:receipt.id,token:receipt.token}));sessionStorage.removeItem('kigula.pending')}catch{}
  basket=[];saveBasket();updateBasket();paymentAttempt=crypto.randomUUID();showReceipt(result.order);startPolling();
 }catch(error){if(['PRICE_CHANGED','UNAVAILABLE_PRODUCT','UNAVAILABLE_OPTION'].includes(error.code)){try{const state=await api('/api/store');catalog=state.catalog;settings=state.settings;paymentConfig=state.payments;updateBasket();}catch{}}notice(error.message)}finally{busy=false;updateCheckout();}
});
function showReceipt(order){
 if(!receipt)return;receipt.order=order;
 $('#basket-step').hidden=true;$('#checkout-step').hidden=true;$('#receipt-step').hidden=false;
 $('#receipt-reference').textContent=order.reference;$('#receipt-status').textContent=statusLabels[order.status]||order.status;
 $('#receipt-subtotal').textContent=cash(order.subtotalCents);$('#receipt-delivery').textContent=order.deliveryCents===null?'A confirmar':cash(order.deliveryCents);$('#receipt-total').textContent=order.totalCents===null?'A confirmar':cash(order.totalCents);
 $('#receipt-mode').textContent=order.fulfillment==='pickup'?'Retirada na KiGula · sem taxa de entrega':'Entrega em Tamandaré';
 $('#receipt-explanation').textContent=order.status==='preview'?'Esta é uma prévia: nenhum pedido foi enviado e nenhum pagamento foi realizado. A operação real será ativada após a configuração da loja.':order.status==='received'?'Pedido salvo e enviado para a lanchonete. Aguarde a confirmação aqui.':(order.status==='awaiting_payment'?'Conclua o pagamento abaixo para enviar seu pedido ao preparo.':(order.status==='awaiting_customer'?'Confira a taxa informada pela loja e confirme o total para continuar.':''));
 const list=$('#receipt-items');list.replaceChildren();for(const item of order.items){const line=node('li','',`${item.quantity}× ${item.name}`);line.append(node('strong','',cash(item.lineCents)));list.append(line);}
 $('#accept-quote').hidden=order.status!=='awaiting_customer';
 $('#refresh-order').hidden=isPreview;$('#copy-order-link').hidden=isPreview;$('#tracking-privacy').hidden=isPreview;
 const paying=order.status==='awaiting_payment';$('#online-payment').hidden=!paying;
 if(paying){$('#pix-start-group').hidden=order.payment.method!=='pix';$('#card-payment-host').hidden=order.payment.method!=='online_card';if(order.payment.method==='online_card')startCardPayment();}
}
async function refreshReceipt(){
 if(!receipt||document.hidden)return;
 const id=receipt.id;try{const result=await api('/api/orders/'+id,{token:receipt.token});if(receipt?.id!==id)return;receipt.order=result.order;if(!$('#receipt-step').hidden)showReceipt(result.order);$('#tracking-error').textContent='';}catch(error){$('#tracking-error').textContent='Não foi possível atualizar agora. '+error.message;}
}
function startPolling(){clearInterval(pollTimer);pollTimer=setInterval(refreshReceipt,15000);}
$('#refresh-order').addEventListener('click',refreshReceipt);
$('#accept-quote').addEventListener('click',async()=>{if(!receipt)return;try{const result=await api('/api/orders/'+receipt.id+'/accept-quote',{method:'POST',token:receipt.token,body:{totalCents:receipt.order.totalCents}});showReceipt(result.order)}catch(error){notice(error.message)}});
$('#copy-order-link').addEventListener('click',async()=>{
 if(!receipt)return;const url=new URL(location.href);url.hash=new URLSearchParams({pedido:receipt.id,chave:receipt.token}).toString();
 try{await navigator.clipboard.writeText(url.href);showToast('Link copiado. Compartilhe somente com quem pode acompanhar este pedido.')}catch{$('#tracking-error').textContent=url.href;}
});
$('#open-tracking').addEventListener('click',async event=>{if(!receipt)return;lastFocus=event.currentTarget;cartDialog.showModal();document.body.classList.add('dialog-open');if(receipt.order)showReceipt(receipt.order);await refreshReceipt();startPolling();});
async function pay(payload){
 if(!receipt)return;
 const result=await api('/api/orders/'+receipt.id+'/payments',{method:'POST',body:payload,token:receipt.token,idempotency:paymentAttempt||(paymentAttempt=crypto.randomUUID())});
 if(result.payment.qrCode){$('#pix-code').value=result.payment.qrCode;$('#pix-box').hidden=false;const raw=result.payment.qrCodeBase64;if(raw&&/^[A-Za-z0-9+/=]+$/.test(raw)){$('#pix-qr').src='data:image/png;base64,'+raw;$('#pix-qr').hidden=false;}}
 $('#payment-status').textContent=result.payment.status==='approved'?'Pagamento aprovado. Atualizando pedido…':(result.payment.status==='rejected'?'Pagamento não aprovado. Confira os dados para tentar novamente.':'Aguardando confirmação do pagamento.');
 if(result.payment.status==='rejected')paymentAttempt=crypto.randomUUID();
 await refreshReceipt();return result;
}
$('#pix-start').addEventListener('click',async()=>{
 const emailMessage=$('#payment-status');$('#pix-start').disabled=true;
 try{const cpf=$('#pix-cpf').value.replace(/\D/g,'');if(cpf.length!==11)throw new Error('Informe um CPF válido para o pagamento Pix.');await pay({identification:{type:'CPF',number:cpf}})}catch(error){emailMessage.textContent=error.message}finally{$('#pix-start').disabled=false;}
});
$('#copy-pix').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('#pix-code').value);showToast('Código Pix copiado.')}catch{$('#pix-code').select();}});
let sdkPromise;
function loadPaymentSDK(){
 if(window.MercadoPago)return Promise.resolve();
 if(!sdkPromise)sdkPromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://sdk.mercadopago.com/js/v2';script.onload=resolve;script.onerror=()=>{sdkPromise=null;reject(new Error('Não foi possível carregar o pagamento seguro.'))};document.head.append(script);});return sdkPromise;
}
async function startCardPayment(){
 if(cardBrick||!paymentConfig.publicKey||!receipt)return;
 try{
  await loadPaymentSDK();const mp=new window.MercadoPago(paymentConfig.publicKey,{locale:'pt-BR'});
  cardBrick=await mp.bricks().create('cardPayment','card-payment-host',{initialization:{amount:receipt.order.totalCents/100,payer:{email:receipt.order.payment.email}},customization:{paymentMethods:{maxInstallments:1}},callbacks:{onReady:()=>{},onSubmit:formData=>pay(formData),onError:()=>{$('#payment-status').textContent='Confira os dados do cartão ou tente novamente.';}}});
 }catch(error){$('#payment-status').textContent=error.message;}
}
async function connect(){
 if(isPreview){for(const card of document.querySelectorAll('.product-card')){const p=products().get(card.dataset.productId);const button=card.querySelector('[data-product-open]');if(button&&p){button.disabled=p.availability==='unavailable';if(button.disabled)button.firstChild.textContent='Esgotado ';}}updateBasket();return;}
 try{
  const state=await api('/api/store');catalog=state.catalog;settings=state.settings;paymentConfig=state.payments;connected=true;
  const map=products();for(const card of document.querySelectorAll('.product-card')){const p=map.get(card.dataset.productId);if(!p)continue;const button=card.querySelector('[data-product-open]');button.disabled=p.availability==='unavailable';button.firstChild.textContent=button.disabled?'Esgotado ':'Escolher ';let badge=card.querySelector('.product-availability');if(p.availability==='unavailable'){if(!badge){badge=node('p','product-availability');card.querySelector('.product-copy').append(badge);}badge.textContent='Esgotado';}else badge?.remove();const target=card.querySelector('.product-price');target.replaceChildren();if(p.price.kind==='from')target.append(node('small','','A partir de'));target.append(document.createTextNode(cash(cents(p.price.amount))));}
 }catch{connected=false;}
 updateBasket();
 let stored;try{const hash=new URLSearchParams(location.hash.slice(1));stored=hash.has('pedido')?{id:hash.get('pedido'),token:hash.get('chave')}:JSON.parse(localStorage.getItem('kigula.receipt')||'null');}catch{}
 if(stored&&/^[a-f0-9-]{36}$/.test(stored.id)&&/^[a-f0-9]{64}$/.test(stored.token)){
  receipt={id:stored.id,token:stored.token};$('#open-tracking').hidden=false;
  try{const result=await api('/api/orders/'+receipt.id,{token:receipt.token});receipt.order=result.order;if(location.hash.includes('pedido=')){lastFocus=$('#open-tracking');cartDialog.showModal();document.body.classList.add('dialog-open');showReceipt(result.order);}startPolling();}catch{}
 }
}
try{basket=JSON.parse(localStorage.getItem('kigula.basket.v1')||'[]');if(!Array.isArray(basket))basket=[];}catch{basket=[];}
await connect();
