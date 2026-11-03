'use strict';
(()=>{
 const $=s=>document.querySelector(s);const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
 const base=(window.KIGULA_CONFIG?.apiBase||'').replace(/\/$/,'');let session='';let timer;let knownIds=null;let alerts=false;let audio;let catalog;
 const names={quote_requested:'Informar entrega',awaiting_customer:'Aguardando cliente',awaiting_payment:'Aguardando pagamento',received:'Novo pedido',confirmed:'Confirmado',preparing:'Em preparo',ready:'Pronto para retirada',out_for_delivery:'Saiu para entrega',completed:'Concluído',cancelled:'Cancelado'};
 const transitions={quote_requested:['awaiting_customer','cancelled'],awaiting_customer:['cancelled'],awaiting_payment:['cancelled'],received:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','out_for_delivery','cancelled'],ready:['completed','cancelled'],out_for_delivery:['completed','cancelled'],completed:[],cancelled:[]};
 const buttons={awaiting_customer:'Enviar valor ao cliente',confirmed:'Confirmar pedido',preparing:'Iniciar preparo',ready:'Pronto para retirada',out_for_delivery:'Saiu para entrega',completed:'Concluir pedido',cancelled:'Cancelar'};
 const el=(t,c,text)=>{const n=document.createElement(t);if(c)n.className=c;if(text!==undefined)n.textContent=text;return n;};
 const message=t=>{$('#admin-message').textContent=t||'';};
 if(window.KIGULA_CONFIG?.mode!=='live'){$('#admin-login-form button').disabled=true;$('#admin-password').disabled=true;message('Painel pré-configurado. O acesso será ativado após a conexão do servidor e definição da operação com a lanchonete.');return;}

 function logout(){clearInterval(timer);session='';try{sessionStorage.removeItem('kigula.admin')}catch{}$('#admin-content').hidden=true;$('#admin-login').hidden=false;$('#admin-logout').hidden=true;$('#admin-orders').replaceChildren();$('#admin-products').replaceChildren();}
 async function api(path,{method='GET',body,publicRequest=false}={}){
  const r=await fetch(base+path,{method,headers:{...(!publicRequest?{'Authorization':'Bearer '+session}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await r.json()}catch{throw new Error('O servidor de pedidos ainda não está conectado.')}
  if(!r.ok){if(r.status===401&&!publicRequest)logout();throw new Error(data.error||'Não foi possível concluir.')}
  return data;
 }
 async function login(){
  $('#admin-content').hidden=false;$('#admin-login').hidden=true;$('#admin-logout').hidden=false;message('');
  await Promise.all([refreshOrders(),loadSettings(),loadCatalog()]);clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)refreshOrders().catch(e=>message(e.message))},10000);
 }
 $('#admin-login-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;message('');try{const r=await api('/api/admin/login',{method:'POST',body:{password:$('#admin-password').value},publicRequest:true});session=r.token;$('#admin-password').value='';try{sessionStorage.setItem('kigula.admin',session)}catch{}await login()}catch(error){message(error.message)}finally{button.disabled=false;}});
 $('#admin-logout').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'})}finally{logout()}});
 document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==button.dataset.tab);}));
 async function refreshOrders(){
  const {orders}=await api('/api/admin/orders');const newOrders=orders.filter(o=>o.status==='received');
  if(knownIds&&newOrders.some(o=>!knownIds.has(o.id))&&alerts){
   if(audio){const tone=audio.createOscillator();const gain=audio.createGain();tone.connect(gain);gain.connect(audio.destination);gain.gain.value=.08;tone.frequency.value=660;tone.start();tone.stop(audio.currentTime+.35);}
   if(window.Notification?.permission==='granted')new Notification('Novo pedido na KiGula',{body:'Abra o painel para confirmar o pedido.'});
  }
  knownIds=new Set(orders.map(o=>o.id));$('#orders-summary').textContent=`${newOrders.length} novo(s) aguardando confirmação · ${orders.length} pedidos recentes · atualizado ${new Date().toLocaleTimeString('pt-BR')}`;
  const list=$('#admin-orders');list.replaceChildren();
  if(!orders.length){list.append(el('p','','Nenhum pedido recebido ainda.'));return;}
  for(const order of orders){
   const card=el('article','admin-order '+order.status);const top=el('div','order-heading');const title=el('div');title.append(el('h3','',order.reference),el('span','order-date',new Date(order.createdAt).toLocaleString('pt-BR')));top.append(title,el('span','order-status',names[order.status]||order.status));card.append(top);
   const info=el('p','order-customer',order.customerName+' · '+order.customerPhone+'\n'+(order.fulfillment==='pickup'?'RETIRADA NA LOJA':`${order.address.street}, ${order.address.number} — ${order.address.neighborhood}, Tamandaré${order.address.reference?'\nReferência: '+order.address.reference:''}`));card.append(info);
   const items=el('ul','order-items');for(const item of order.items){const line=el('li');const first=el('div','order-item-top');first.append(el('strong','',item.quantity+'× '+item.name),el('strong','',money(item.lineCents)));line.append(first);if(item.choices.length)line.append(el('small','',item.choices.map(o=>`${o.quantity}× ${o.name}`).join(' · ')));if(item.note)line.append(el('small','','Observação: '+item.note));items.append(line);}card.append(items);
   if(order.notes)card.append(el('p','order-notes',order.notes));
   const totals=el('div','order-totals');totals.append(el('span','','Produtos: '+money(order.subtotalCents)),el('span','','Entrega: '+(order.deliveryCents===null?'A confirmar':money(order.deliveryCents))),el('strong','','Total: '+(order.totalCents===null?'A confirmar':money(order.totalCents))));card.append(totals);
   const paymentLabels={cash:'Dinheiro na entrega/retirada',card:'Cartão na entrega/retirada',pix:'Pix online',online_card:'Cartão online'};
   card.append(el('p','',paymentLabels[order.payment.method]+(order.payment.changeForCents!==null?' · Troco para '+money(order.payment.changeForCents):'')));
   const actions=el('div','order-actions');let quote;
   if(order.status==='quote_requested'){quote=el('input','quote-input');quote.type='number';quote.min='0';quote.step='.01';quote.placeholder='Entrega (R$)';quote.setAttribute('aria-label','Taxa de entrega de '+order.reference);actions.append(quote);}
   for(const status of transitions[order.status]||[]){
    if(status==='out_for_delivery'&&order.fulfillment!=='delivery')continue;
    if(status==='ready'&&order.fulfillment!=='pickup')continue;
    const button=el('button',status==='cancelled'?'cancel-order':'',buttons[status]);
    button.addEventListener('click',async()=>{
     if(status==='cancelled'&&!confirm('Cancelar o pedido '+order.reference+'? Pedidos já pagos exigem estorno.'))return;
     const body={status};if(quote&&status==='awaiting_customer'){if(quote.value===''){message('Informe a taxa.');return;}body.deliveryCents=Math.round(Number(quote.value)*100);}
     button.disabled=true;try{await api('/api/admin/orders/'+order.id,{method:'PATCH',body});message('Pedido atualizado.');await refreshOrders()}catch(error){message(error.message);button.disabled=false;}
    });actions.append(button);
   }
   const print=el('button','','Imprimir');print.addEventListener('click',()=>{document.querySelectorAll('.admin-order').forEach(c=>c.classList.remove('printing'));card.classList.add('printing');window.print();});actions.append(print);card.append(actions);list.append(card);
  }
 }
 $('#refresh-orders').addEventListener('click',()=>refreshOrders().catch(e=>message(e.message)));
 $('#enable-alerts').addEventListener('click',async()=>{alerts=true;audio=new (window.AudioContext||window.webkitAudioContext)();if(window.Notification&&Notification.permission==='default')await Notification.requestPermission();$('#enable-alerts').textContent='Alertas ativados';$('#enable-alerts').disabled=true;});
 async function loadSettings(){const {settings}=await api('/api/admin/settings');const form=$('#settings-form');for(const key of ['acceptingOrders','deliveryEnabled','pickupEnabled'])form.elements[key].checked=settings[key];form.elements.deliveryFee.value=settings.deliveryFeeCents===null?'':(settings.deliveryFeeCents/100).toFixed(2);form.elements.minimum.value=(settings.minimumCents/100).toFixed(2);const state=await api('/api/store',{publicRequest:true});$('#admin-payment-status').textContent=(state.payments.pix?'Pix online ativo. ':'Pix online aguarda configuração. ')+(state.payments.onlineCard?'Cartão online ativo.':'Cartão online aguarda configuração.');}
 $('#settings-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const body={acceptingOrders:f.elements.acceptingOrders.checked,deliveryEnabled:f.elements.deliveryEnabled.checked,pickupEnabled:f.elements.pickupEnabled.checked,deliveryFeeCents:Math.round(Number(f.elements.deliveryFee.value)*100),minimumCents:Math.round(Number(f.elements.minimum.value)*100)};try{await api('/api/admin/settings',{method:'PUT',body});message('Configurações salvas. Retirada continua sem taxa de entrega.')}catch(error){message(error.message)}});
 async function loadCatalog(){const r=await api('/api/admin/catalog');catalog=r.catalog;renderCatalog();}
 function renderCatalog(){
  const query=$('#admin-product-search').value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const list=$('#admin-products');list.replaceChildren();
  for(const category of catalog.categories)for(const p of category.products){
   if(!p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query))continue;
   const form=el('form','product-editor'),title=el('div');title.append(el('h3','',p.name),el('small','',category.name));
   const label=el('label','toggle');const available=el('input');available.type='checkbox';available.checked=p.availability!=='unavailable';label.append(available,document.createTextNode('Disponível'));
   const price=el('input');price.type='number';price.step='.01';price.min='.01';price.max='10000';price.required=true;price.value=p.price.amount.toFixed(2);price.disabled=p.price.kind!=='fixed';price.setAttribute('aria-label','Preço de '+p.name);
   const save=el('button','','Salvar');save.type='submit';form.append(title,label,price,save);
   form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{const body={available:available.checked};if(!price.disabled)body.priceCents=Math.round(Number(price.value)*100);const result=await api('/api/admin/products/'+p.id,{method:'PATCH',body});Object.assign(p,result.product);message('Produto atualizado.')}catch(error){message(error.message)}finally{save.disabled=false;}});list.append(form);
  }
 }
 $('#admin-product-search').addEventListener('input',()=>{if(catalog)renderCatalog()});
 try{session=sessionStorage.getItem('kigula.admin')||''}catch{}
 if(session)login().catch(error=>{logout();message(error.message)});
})();
