"""Gera SQL de catálogo público; não inclui credenciais ou pedidos."""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
catalog=json.loads((root/'data/menu.json').read_text())
value=json.dumps(catalog,ensure_ascii=False,separators=(',',':'))
chunks=[value[i:i+8000] for i in range(0,len(value),8000)]
statements=["INSERT INTO configuration(id,value) VALUES('catalog','') ON CONFLICT(id) DO UPDATE SET value='';"]
for chunk in chunks:
 statements.append("UPDATE configuration SET value=value||'"+chunk.replace("'","''")+"' WHERE id='catalog';")
(root/'ordering/catalog.sql').write_text('\n'.join(statements)+'\n')
