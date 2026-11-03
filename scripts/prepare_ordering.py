"""Prepara os arquivos públicos do app de pedidos, sem dados privados."""
from pathlib import Path
import shutil
import argparse,json
parser=argparse.ArgumentParser();parser.add_argument('--mode',choices=['preview','live'],default='preview');args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
out=root/'public';out.mkdir(exist_ok=True)
for name in ['index.html','script.js','orders.js','config.js','style.css','admin.html','admin.js','admin.css']:
 shutil.copyfile(root/name,out/name)
shutil.copytree(root/'assets',out/'assets',dirs_exist_ok=True)
(out/'ordering').mkdir(exist_ok=True)
shutil.copyfile(root/'ordering/pricing.mjs',out/'ordering/pricing.mjs')
(out/'.nojekyll').touch()
(out/'config.js').write_text('window.KIGULA_CONFIG = '+json.dumps({'apiBase':'','mode':args.mode})+';\n')
print('App público preparado em',out)
