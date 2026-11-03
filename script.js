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
function openProduct(id, trigger) {
  if (window.KiGulaOrdering) window.KiGulaOrdering.openProduct(id, trigger);
  else showToast('O carrinho está carregando. Tente novamente em instantes.');
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
  if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open');
  lastTrigger?.focus();
});
