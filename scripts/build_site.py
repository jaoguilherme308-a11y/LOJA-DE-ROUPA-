#!/usr/bin/env python3
"""Renderiza o catálogo estático a partir da cópia pública em data/menu.json."""
import html
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
esc = lambda value: html.escape(str(value or ''), quote=True)
MENU = 'https://pedido.anota.ai/loja/ki-gula?referer=gbp_anota'
ARROW = '<svg class="icon" aria-hidden="true"><use href="#arrow-up"/></svg>'
PLACEHOLDER = '<svg viewBox="0 0 48 44" aria-hidden="true"><path d="M7 18C7 1 41 1 41 18ZM5 25h38M8 33h32c0 11-32 11-32 0Z"/></svg>'

def image_url(product):
    image = product.get('image') or {}
    local = image.get('localPath')
    if local and (ROOT / local).is_file():
        return local
    url = image.get('sourceUrl')
    if url and urlparse(url).scheme == 'https':
        return url
    return None

def price_html(product):
    p = product['price']
    value = 'R$ ' + f"{p['amount']:.2f}".replace('.', ',')
    return ('<small>A partir de</small>' if p.get('kind') == 'from' else '') + esc(value)

def card(product, category):
    src = image_url(product)
    photo = (f'<img src="{esc(src)}" alt="{esc(product["name"])} — foto do cardápio da KiGula" width="600" height="600" loading="lazy" decoding="async">' if src else '')
    placeholder = 'FOTO DO CARDÁPIO' if src else 'SEM FOTO NO CARDÁPIO'
    status = '<p class="product-availability">Esgotado na consulta · confira no pedido</p>' if product['availability'] == 'unavailable' else ''
    description = product.get('description') or 'Veja os detalhes e as opções no cardápio oficial.'
    return f'''<article class="product-card" data-product-id="{esc(product['id'])}" data-category-id="{esc(category['id'])}">
      <div class="product-photo"><div class="photo-placeholder">{PLACEHOLDER}<span>{placeholder}</span></div>{photo}</div>
      <div class="product-copy"><p class="product-category">{esc(category['name'])}</p><h3>{esc(product['name'])}</h3><p class="product-description">{esc(description)}</p>{status}<div class="product-footer"><span class="product-price">{price_html(product)}</span><button class="product-detail-button" data-product-open="{esc(product['id'])}" aria-label="Ver detalhes de {esc(product['name'])}">Escolher {ARROW}</button></div></div>
    </article>'''

def build():
    data = json.loads((ROOT / 'data/menu.json').read_text())
    categories = data['categories']
    products = [(p, c) for c in categories for p in c['products']]
    date = datetime.fromisoformat(data['collectedAt']).astimezone(ZoneInfo('America/Sao_Paulo')).strftime('%d/%m/%Y')
    featured = {pid: i for i, pid in enumerate(data.get('featuredIds', []))}
    # Os destaques são os publicados pela própria loja; os demais mantêm a ordem de origem.
    ordered = sorted(products, key=lambda pair: (0, featured[pair[0]['id']]) if pair[0]['id'] in featured else (1, 0))
    cards = '\n'.join(card(p,c) for p,c in ordered)
    options = ''.join(f'<option value="{esc(c["id"])}">{esc(c["name"])} ({len(c["products"])})</option>' for c in categories)
    source_note = f'Preços e disponibilidade consultados em {date}. Confira os valores e as opções na sacola.'
    section = f'''<!-- CATALOG:START -->
    <section class="catalog section wrap" id="cardapio" aria-labelledby="catalog-title">
      <div class="section-heading"><div><div class="eyebrow">O CARDÁPIO DA KIGULA</div><h2 id="catalog-title">HORA DE ESCOLHER.<br><span class="text-outline">QUAL VAI SER O SEU?</span></h2></div><div><p>{len(products)} opções entre lanches, pizzas, açaís e bebidas. Veja os detalhes e monte sua sacola e faça o pedido aqui mesmo.</p><button class="text-link" data-cart-open>Ver minha sacola {ARROW}</button></div></div>
      <div class="catalog-tools"><label class="catalog-search" for="menu-search"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg><span class="sr-only">Buscar produtos</span><input type="search" id="menu-search" placeholder="O que deu vontade de comer?" autocomplete="off"></label><label class="catalog-category mobile-visible" for="menu-category"><span class="sr-only">Filtrar por categoria</span><select id="menu-category"><option value="all">Todos os produtos ({len(products)})</option><option value="featured">Destaques da loja ({len(featured)})</option>{options}</select></label></div>
      <div class="catalog-meta"><p id="catalog-count" role="status" aria-live="polite">{len(products)} produtos no cardápio</p><span class="catalog-last-updated">Consulta em {date}</span></div>
      <noscript><p class="catalog-noscript">Todos os produtos estão listados abaixo. Para personalizar a sacola e conferir o total, ative o JavaScript no navegador.</p></noscript>
      <div class="catalog-grid">{cards}</div>
      <div class="catalog-empty" hidden><h3>Esse lanche não apareceu por aqui.</h3><p>Tente outro nome ou escolha uma categoria diferente.</p><button id="catalog-reset">Limpar busca e filtros</button></div>
      <div class="catalog-bottom"><button class="button catalog-more" id="catalog-more" hidden>Mostrar mais produtos <svg class="icon" aria-hidden="true"><use href="#arrow"/></svg></button><p>{source_note}</p></div>
      <p class="catalog-source">Fotos e descrições do cardápio oficial da KiGula. Na demonstração, a disponibilidade reflete a consulta. A operação real será controlada pela loja.</p>
    </section>
    <!-- CATALOG:END -->'''
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    embedded = '<script type="application/json" id="catalog-data">' + payload + '</script>'
    page = (ROOT / 'index.html').read_text()
    if '<!-- CATALOG:START -->' in page:
        page = re.sub(r'<!-- CATALOG:START -->.*?<!-- CATALOG:END -->', lambda _:section, page, flags=re.S)
    else:
        page = page.replace('    <section class="ways section wrap"', section + '\n    <section class="ways section wrap"', 1)
    page = re.sub(r'<script type="application/json" id="catalog-data">.*?</script>', '', page, flags=re.S)
    page = page.replace('</body>', embedded + '\n</body>')
    (ROOT / 'index.html').write_text(page)
    print(f'Catálogo gerado: {len(products)} produtos, {len(categories)} categorias, consulta {date}.')

if __name__ == '__main__':
    build()
