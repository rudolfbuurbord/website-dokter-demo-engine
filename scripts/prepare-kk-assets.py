"""Reproduce optimized images from immutable, checksum-verified Higgsfield sources."""
from pathlib import Path
import json,hashlib,urllib.request,io
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
root=Path(__file__).resolve().parents[1]
manifest=json.loads((root/'references/kleur-karakter-assets.json').read_text())
out=root/'public/kleur-karakter/media';out.mkdir(parents=True,exist_ok=True)
def prepare(asset):
    raw=urllib.request.urlopen(asset['source_url'],timeout=60).read()
    assert hashlib.sha256(raw).hexdigest()==asset['sha256'], 'Asset source changed: '+asset['key']
    with Image.open(io.BytesIO(raw)) as im:
        im.save(out/(asset['key']+'.webp'),format='WEBP',quality=88,method=6)
    return asset['key']
with ThreadPoolExecutor(max_workers=3) as pool:
    for key in pool.map(prepare,manifest['assets']):print('Prepared',key)
