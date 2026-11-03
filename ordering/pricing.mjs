export class OrderError extends Error {
  constructor(message, status=400, code='INVALID_ORDER') { super(message); this.status=status; this.code=code; }
}
export const cents = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new OrderError('Preço inválido no catálogo.',503,'INVALID_CATALOG');
  return Math.round(value * 100);
};
export function priceCart(catalog, input) {
  if (!Array.isArray(input) || input.length<1 || input.length>30) throw new OrderError('Escolha de 1 a 30 itens diferentes.');
  const products=new Map(catalog.categories.flatMap(c=>c.products.map(p=>[p.id,p])));
  const groups=new Map(catalog.optionGroups.map(g=>[g.id,g]));
  let totalQuantity=0;
  const items=input.map(line=>{
    if(!line||typeof line!=='object'||Array.isArray(line))throw new OrderError('Item inválido.');
    const p=products.get(line.productId);
    if (!p || p.availability==='unavailable') throw new OrderError('Um item está indisponível. Confira o carrinho.',409,'UNAVAILABLE_PRODUCT');
    if (!Number.isInteger(line.quantity)||line.quantity<1||line.quantity>20) throw new OrderError('Quantidade inválida.');
    totalQuantity+=line.quantity;
    const selected=line.options||{};
    if (!selected || Array.isArray(selected) || typeof selected!=='object') throw new OrderError('Adicionais inválidos.');
    const allowed=new Map((p.optionSelections||[]).map(g=>[g.groupId,g]));
    if (Object.keys(selected).some(id=>!allowed.has(id))) throw new OrderError('Adicional não pertence a este produto.');
    let base=p.price.kind==='from'?0:cents(p.price.amount),extras=0;
    const choices=[];
    for (const [id,rule] of allowed) {
      const entries=selected[id]||[];
      if (!Array.isArray(entries)||entries.length>30) throw new OrderError('Seleção inválida.');
      const group=groups.get(id);
      if (!group) throw new OrderError('Grupo de adicionais indisponível.',503,'INVALID_CATALOG');
      const options=new Map(group.options.map(o=>[o.id,o]));
      const used=new Set();let qty=0;const values=[];
      for (const selection of entries) {
        const option=options.get(selection.id);
        if (!option||option.availability==='unavailable'||used.has(selection.id)) throw new OrderError('Uma opção está indisponível ou duplicada.',409,'UNAVAILABLE_OPTION');
        used.add(selection.id);
        if (!Number.isInteger(selection.quantity)||selection.quantity<1||selection.quantity>20) throw new OrderError('Quantidade de adicional inválida.');
        qty+=selection.quantity;
        const value=cents(option.price.amount);
        values.push({value,quantity:selection.quantity});
        choices.push({groupId:id,group:group.name,id:option.id,name:option.name,quantity:selection.quantity,unitCents:value});
      }
      if (qty<(rule.min||0)||qty>(rule.max||20)) throw new OrderError(`Confira as escolhas de ${group.name}.`);
      // Modelo 0 = soma; modelo 2 observado na pizza = maior valor entre os sabores.
      if (rule.priceModel===2) {
        if (entries.some(e=>e.quantity!==1)) throw new OrderError('Escolha sabores diferentes para a pizza.');
        const highest=values.length?Math.max(...values.map(v=>v.value)):0;
        extras+=highest;
      } else if (rule.priceModel===0||rule.priceModel===undefined) {
        extras+=values.reduce((n,v)=>n+v.value*v.quantity,0);
      } else {
        throw new OrderError('A regra de preço deste produto precisa ser configurada.',409,'UNSUPPORTED_PRICE_RULE');
      }
    }
    if (p.price.kind==='from' && !(p.optionSelections||[]).some(r=>r.priceModel===2)) throw new OrderError('Escolha uma opção válida de preço.');
    const note=typeof line.note==='string'?line.note.trim():'';
    if (note.length>300) throw new OrderError('A observação do produto deve ter até 300 caracteres.');
    return {productId:p.id,name:p.name,quantity:line.quantity,choices,note,unitCents:base+extras,lineCents:(base+extras)*line.quantity};
  });
  if(totalQuantity>50) throw new OrderError('O pedido pode ter até 50 unidades.');
  return {items,subtotalCents:items.reduce((n,item)=>n+item.lineCents,0)};
}
export function validateCustomer(input) {
  const clean=(value,max)=>{if(typeof value!=='string'||value.trim().length>max)throw new OrderError('Confira seus dados.');return value.trim();};
  const name=clean(input.name,100);const phone=clean(input.phone,30).replace(/\D/g,'');
  if(name.length<2||!/^\d{10,13}$/.test(phone))throw new OrderError('Informe nome e telefone válidos.');
  if(!['delivery','pickup'].includes(input.fulfillment))throw new OrderError('Escolha entrega ou retirada.');
  let address=null;
  if(input.fulfillment==='delivery') {
    const a=input.address||{};
    address={street:clean(a.street,150),number:clean(a.number,20),neighborhood:clean(a.neighborhood,100),reference:clean(a.reference||'',200),city:'Tamandaré'};
    if(address.street.length<3||!address.number||address.neighborhood.length<2)throw new OrderError('Complete o endereço de entrega em Tamandaré.');
  }
  const payment=input.payment||{};
  if(!['cash','card','pix','online_card'].includes(payment.method))throw new OrderError('Escolha dinheiro ou cartão na entrega/retirada.');
  let changeForCents=null;
  if(payment.method==='cash'&&payment.changeForCents!==null&&payment.changeForCents!==undefined){
    if(!Number.isInteger(payment.changeForCents)||payment.changeForCents<0||payment.changeForCents>1_000_000)throw new OrderError('Valor para troco inválido.');
    changeForCents=payment.changeForCents;
  }
  let email=null;
  if(['pix','online_card'].includes(payment.method)){email=clean(payment.email||'',254);if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new OrderError('Informe um e-mail válido para o pagamento.');}
  const notes=clean(input.notes||'',500);
  return {name,phone,fulfillment:input.fulfillment,address,payment:{method:payment.method,changeForCents,email},notes};
}
