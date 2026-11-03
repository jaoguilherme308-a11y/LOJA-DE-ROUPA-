#!/usr/bin/env python3
"""Exporta o site em um único HTML; não altera as fontes do projeto.

Uso: python3 scripts/export_single_file.py [--output /caminho/KiGula.html]
As fotos que só existem como URLs remotas permanecem remotas.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import html
import json
import mimetypes
from pathlib import Path
import re
from urllib.parse import urlsplit

REPO = Path(__file__).resolve().parents[1]


def main() -> None:
    if (REPO / "orders.js").exists():
        raise SystemExit("A versão própria com carrinho usa módulos e servidor. Para apresentar, use scripts/prepare_ordering.py --mode preview e hospedagem HTTP. O antigo HTML único era da versão anterior.")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=REPO.parent / 'entregas' / 'KiGula.html')
    args = parser.parse_args()
    sources = [REPO / name for name in ('index.html', 'style.css', 'script.js')]
    before = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    document, css, runtime = (p.read_text(encoding='utf-8') for p in sources)
    encoded: dict[str, str] = {}
    sizes: dict[str, int] = {}

    def data_uri(reference: str) -> str:
        reference = html.unescape(reference)
        if reference in encoded:
            return encoded[reference]
        parsed = urlsplit(reference)
        if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
            raise ValueError(f'Esperado recurso local sem consulta/fragmento: {reference}')
        resource = (REPO / reference).resolve()
        if not resource.is_relative_to(REPO) or not resource.is_file():
            raise ValueError(f'Recurso local inexistente ou fora do projeto: {reference}')
        mime = {'.ttf': 'font/ttf', '.webp': 'image/webp'}.get(resource.suffix.lower())
        mime = mime or mimetypes.guess_type(resource.name)[0]
        if not mime:
            raise ValueError(f'Tipo de recurso desconhecido: {reference}')
        content = resource.read_bytes()
        sizes[reference] = len(content)
        encoded[reference] = f'data:{mime};base64,' + base64.b64encode(content).decode('ascii')
        return encoded[reference]

    def embed_css_url(match: re.Match[str]) -> str:
        value = match.group(2).strip()
        if value.startswith(('data:', 'https:', 'http:', '#')):
            return match.group(0)
        return 'url("' + data_uri(value) + '")'

    css = re.sub(r'url\(\s*([\'"]?)([^\'"\)]+)\1\s*\)', embed_css_url, css)
    document, styles_count = re.subn(
        r'<link\b[^>]*\brel="stylesheet"[^>]*\bhref="style\.css"[^>]*>',
        lambda _: '<style>\n' + css + '\n</style>', document, flags=re.I)
    if styles_count != 1:
        raise ValueError('Não foi encontrada exatamente uma folha style.css para incorporar.')
    document = re.sub(r'\s*<link\b[^>]*\brel="preload"[^>]*\bhref="assets/[^\"]+"[^>]*>', '', document, flags=re.I)
    document, scripts_count = re.subn(r'\s*<script\b[^>]*\bsrc="script\.js"[^>]*>\s*</script>', '', document, flags=re.I)
    if scripts_count != 1:
        raise ValueError('Não foi encontrado exatamente um script.js para incorporar.')

    def recursive_assets(value):
        if isinstance(value, str) and value.startswith('assets/'):
            return data_uri(value)
        if isinstance(value, list):
            return [recursive_assets(entry) for entry in value]
        if isinstance(value, dict):
            return {key: recursive_assets(entry) for key, entry in value.items()}
        return value

    def embed_json(match: re.Match[str]) -> str:
        payload = recursive_assets(json.loads(match.group(2)))
        # Evita que dados de produto possam encerrar a tag <script>.
        serialized = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
        serialized = serialized.replace('<', '\\u003c').replace('>', '\\u003e').replace('&', '\\u0026')
        return match.group(1) + serialized + match.group(3)

    document = re.sub(r'(<script\b[^>]*\btype="application/(?:json|ld\+json)"[^>]*>)(.*?)(</script>)', embed_json, document, flags=re.I | re.S)
    document = re.sub(r'\b(src|href)=("|\')(assets/[^"\']+)\2', lambda m: f'{m.group(1)}={m.group(2)}{data_uri(m.group(3))}{m.group(2)}', document)
    image_guard = '  const image = item.image || {};'
    if runtime.count(image_guard) != 1:
        raise ValueError('A função safeImage mudou: revise a incorporação da versão independente.')
    runtime = runtime.replace(image_guard, image_guard + '\n  if (image.localPath && /^data:image\\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.localPath)) return image.localPath;', 1)
    if '</script' in runtime.lower():
        raise ValueError('Runtime contém terminador de script; revise o escape antes de exportar.')
    if document.lower().count('</body>') != 1:
        raise ValueError('Estrutura de body inesperada.')
    # O script externo original usa defer no head. O inline precisa vir após o DOM.
    document = re.sub(r'</body>', lambda _: '<script>\n' + runtime + '\n</script>\n</body>', document, count=1, flags=re.I)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(document, encoding='utf-8')
    after = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    if before != after:
        raise RuntimeError('As fontes originais foram alteradas durante a exportação.')
    print(json.dumps({'output': str(args.output), 'bytes': args.output.stat().st_size, 'uniqueEmbeddedAssets': len(encoded), 'embeddedSourceBytes': sum(sizes.values()), 'sourceFilesUnchanged': True}, ensure_ascii=False))


if __name__ == '__main__':
    main()
