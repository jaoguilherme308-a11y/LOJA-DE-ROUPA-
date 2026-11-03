'use strict';

const navToggle = document.querySelector('.nav-toggle');
const nav = document.querySelector('.nav');
const toast = document.querySelector('.toast');
let toastTimer;

function closeNavigation() {
  nav.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
  navToggle.setAttribute('aria-label', 'Abrir menu');
}
navToggle.addEventListener('click', () => {
  const open = navToggle.getAttribute('aria-expanded') !== 'true';
  nav.classList.toggle('open', open);
  navToggle.setAttribute('aria-expanded', String(open));
  navToggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
});
nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeNavigation));
document.addEventListener('click', (event) => {
  if (!nav.contains(event.target) && !navToggle.contains(event.target)) closeNavigation();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') {
    closeNavigation();
    navToggle.focus();
  }
});
window.matchMedia('(min-width: 601px)').addEventListener('change', closeNavigation);

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 4500);
}
document.querySelector('.copy-location').addEventListener('click', async () => {
  const location = 'Lanchonete KiGula — 7V3W+HV, Tamandaré, PE, 55578-000';
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(location);
    showToast('Localização copiada! 7V3W+HV · Tamandaré, PE');
  } catch {
    showToast('Código de localização: 7V3W+HV · Tamandaré, PE');
  }
});
document.querySelector('#year').textContent = new Date().getFullYear();

function registerImage(image) {
  const fail = () => {
    const holder = image.closest('.product-photo, .product-dialog-photo');
    if (holder) {
      holder.classList.add('no-photo');
      const label = holder.querySelector('.photo-placeholder > span');
      if (label) label.textContent = 'FOTO INDISPONÍVEL';
    } else {
      image.classList.add('image-failed');
      image.parentElement.classList.add('image-fallback');
    }
  };
  image.addEventListener('error', fail, { once: true });
  if (image.getAttribute('src') && image.complete && image.naturalWidth === 0) fail();
}
document.querySelectorAll('img[src]').forEach(registerImage);

const data = JSON.parse(document.querySelector('#catalog-data').textContent);
const productMap = new Map();
for (const category of data.categories) {
  for (const product of category.products) {
    productMap.set(product.id, { ...product, categoryName: category.name });
  }
}
const optionMap = new Map(data.optionGroups.map((group) => [group.id, group]));
const featured = new Set(data.featuredIds);
const cards = [...document.querySelectorAll('.product-card')];
const search = document.querySelector('#menu-search');
const categorySelect = document.querySelector('#menu-category');
const moreButton = document.querySelector('#catalog-more');
const count = document.querySelector('#catalog-count');
const emptyState = document.querySelector('.catalog-empty');
const normalize = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const searchValues = new Map(cards.map((card) => {
  const p = productMap.get(card.dataset.productId);
  return [card, normalize(`${p.name} ${p.description} ${p.categoryName}`)];
}));
let visibleLimit = 9;
let matchingCards = cards;

function renderCatalog(reset = true) {
  if (reset) visibleLimit = 9;
  const query = normalize(search.value);
  const category = categorySelect.value;
  matchingCards = cards.filter((card) => {
    const inCategory = category === 'all' || (category === 'featured' ? featured.has(card.dataset.productId) : card.dataset.categoryId === category);
    return inCategory && searchValues.get(card).includes(query);
  });
  const visible = new Set(matchingCards.slice(0, visibleLimit));
  cards.forEach((card) => { card.hidden = !visible.has(card); });
  const shown = Math.min(visibleLimit, matchingCards.length);
  count.textContent = matchingCards.length ? `Mostrando ${shown} de ${matchingCards.length} ${matchingCards.length === 1 ? 'produto' : 'produtos'}` : 'Nenhum produto encontrado';
  moreButton.hidden = shown >= matchingCards.length;
  emptyState.hidden = matchingCards.length !== 0;
}
search.addEventListener('input', () => renderCatalog());
categorySelect.addEventListener('change', () => renderCatalog());
moreButton.addEventListener('click', () => {
  const previous = visibleLimit;
  visibleLimit += 9;
  renderCatalog(false);
  matchingCards[previous]?.querySelector('button')?.focus();
});
document.querySelector('#catalog-reset').addEventListener('click', () => {
  search.value = '';
  categorySelect.value = 'all';
  renderCatalog();
  search.focus();
});
renderCatalog();

const dialog = document.querySelector('.product-dialog');
const dialogPhoto = dialog.querySelector('.product-dialog-photo');
const dialogImage = dialogPhoto.querySelector('img');
const placeholder = dialogPhoto.querySelector('.photo-placeholder > span');
const groupContainer = dialog.querySelector('.product-option-groups');
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const date = new Date(data.collectedAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
let lastTrigger;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function safeImage(item) {
  const image = item.image || {};
  if (image.localPath && /^assets\/products\/[a-zA-Z0-9_.-]+$/.test(image.localPath)) return image.localPath;
  if (image.sourceUrl && /^https:\/\/(client-assets\.anota\.ai|anotaai\.s3\.us-west-2\.amazonaws\.com)\//.test(image.sourceUrl)) return image.sourceUrl;
  return null;
}
function renderPrice(target, price) {
  target.replaceChildren();
  if (price.kind === 'from') target.append(element('small', '', 'A partir de'));
  target.append(document.createTextNode(currency.format(price.amount)));
}
function appendOptionGroup(group, selection, options, title) {
  const details = element('details');
  const summary = element('summary', '', title || group.name);
  if (selection) {
    let rule = 'Adicionais opcionais';
    if (selection.min > 0) rule = `Escolha de ${selection.min} a ${selection.max} opções no pedido`;
    else if (selection.max) rule = `Opcional · até ${selection.max} opções no pedido`;
    summary.append(element('small', '', rule));
  }
  const list = element('ul');
  for (const option of options) {
    const row = element('li');
    const info = element('div', 'product-option-info');
    if (title) {
      const src = safeImage(option);
      if (src) {
        const image = element('img', 'option-thumbnail');
        image.src = src;
        image.alt = option.name;
        image.width = 48;
        image.height = 48;
        image.loading = 'lazy';
        image.addEventListener('error', () => { image.hidden = true; }, { once: true });
        info.append(image);
      }
    }
    const copy = element('div');
    copy.append(element('span', 'option-name', option.name));
    if (title && option.description) copy.append(element('small', 'option-description', option.description));
    if (option.availability === 'unavailable') copy.append(element('small', 'option-description', 'Esgotado na consulta'));
    info.append(copy);
    row.append(info, element('span', 'option-price', currency.format(option.price.amount)));
    list.append(row);
  }
  details.append(summary, list);
  groupContainer.append(details);
}
function openProduct(id, trigger) {
  const product = productMap.get(id);
  if (!product) return;
  lastTrigger = trigger;
  dialog.querySelector('.eyebrow').textContent = product.categoryName;
  dialog.querySelector('#product-title').textContent = product.name;
  dialog.querySelector('.product-dialog-description').textContent = product.description || 'Confira os detalhes e as opções ao finalizar o pedido no cardápio oficial.';
  renderPrice(dialog.querySelector('.product-price'), product.price);
  const status = dialog.querySelector('.product-dialog-status');
  status.textContent = product.availability === 'unavailable' ? 'Este item estava esgotado na consulta. Confira a disponibilidade atual na Anota.ai.' : '';
  status.hidden = !status.textContent;
  const src = safeImage(product);
  dialogPhoto.classList.remove('no-photo');
  dialogImage.hidden = !src;
  placeholder.textContent = src ? 'FOTO DO CARDÁPIO' : 'SEM FOTO NO CARDÁPIO';
  if (src) {
    dialogImage.alt = `${product.name} — foto do cardápio da KiGula`;
    dialogImage.src = src;
  } else {
    dialogImage.removeAttribute('src');
  }
  const imageNote = dialog.querySelector('.product-image-note');
  imageNote.textContent = product.image?.note || '';
  imageNote.hidden = !imageNote.textContent;
  groupContainer.replaceChildren();
  const variants = product.variants || [];
  const selections = new Map((product.optionSelections || []).map((selection) => [selection.groupId, selection]));
  if (variants.length) appendOptionGroup({}, { min: 1, max: 2 }, variants, 'Sabores e valores');
  for (const groupId of product.optionGroupIds || []) {
    const group = optionMap.get(groupId);
    if (!group || !group.options.length) continue;
    if (variants.length && group.options.some((option) => variants.some((variant) => variant.id === option.id))) continue;
    appendOptionGroup(group, selections.get(groupId), group.options);
  }
  const configNote = dialog.querySelector('.product-option-note');
  configNote.textContent = variants.length ? 'Escolha os sabores e adicionais na Anota.ai. O valor final depende das escolhas e da regra de cálculo exibida no pedido.' : (groupContainer.children.length ? 'Escolha os adicionais na Anota.ai. O valor final é confirmado antes de concluir o pedido.' : 'Consulte a disponibilidade antes de concluir seu pedido.');
  const order = dialog.querySelector('.product-order');
  const productURL = product.sourceProductUrl;
  order.href = productURL && productURL.startsWith('https://pedido.anota.ai/') ? productURL : data.sourceUrl;
  dialog.querySelector('.product-whatsapp').href = `https://wa.me/5581998905824?text=${encodeURIComponent(`Olá, KiGula! Gostaria de consultar o produto ${product.name}.`)}`;
  dialog.querySelector('.product-dialog-source').textContent = `Produtos, fotos e preços consultados em ${date}. Os valores e a disponibilidade atuais são os exibidos no cardápio oficial no momento do pedido.`;
  dialog.showModal();
  document.body.classList.add('dialog-open');
  dialog.scrollTop = 0;
  dialog.querySelector('.product-dialog-layout').scrollTop = 0;
}
document.querySelector('.catalog-grid').addEventListener('click', (event) => {
  const button = event.target.closest('[data-product-open]');
  if (button) openProduct(button.dataset.productOpen, button);
});
dialogImage.addEventListener('load', () => { dialogPhoto.classList.remove('no-photo'); });
dialogImage.addEventListener('error', () => {
  dialogPhoto.classList.add('no-photo');
  placeholder.textContent = 'FOTO INDISPONÍVEL';
});
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  const rect = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
});
dialog.addEventListener('close', () => {
  document.body.classList.remove('dialog-open');
  lastTrigger?.focus();
});
