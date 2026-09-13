from pathlib import Path
import json,base64,re
root=Path(__file__).resolve().parents[1];page=root/'public/kleur-karakter'
s=(page/'index.html').read_text()
for name in ['base.css','refinement.css']:
 s=s.replace('<link rel="stylesheet" href="/kleur-karakter/'+name+'">','<style>'+(page/name).read_text()+'</style>')
assets={p.stem:'data:image/webp;base64,'+base64.b64encode(p.read_bytes()).decode() for p in (page/'media').glob('*.webp')}
for name,url in assets.items():s=s.replace('src="/kleur-karakter/media/'+name+'.webp"','src="'+url+'"')
s=s.replace('<script src="/kleur-karakter/hero-motion.js" defer></script>','<script id="inline-media" type="application/json">'+json.dumps(assets)+'</script><script>'+(page/'hero-motion.js').read_text()+'</script>')
s=s.replace('<script src="/kleur-karakter/refinement.js" defer></script>','<script>'+(page/'refinement.js').read_text()+'</script>')
# Inline scripts need the complete DOM, including the enquiry dialog.
blocks=re.findall(r'<script\b[^>]*>.*?</script>',s,re.S)
s=re.sub(r'<script\b[^>]*>.*?</script>','',s,flags=re.S).replace('</body>',''.join(blocks)+'</body>')
out=root/'public/kleur-karakter-verfijnd.html';out.write_text(s);print(out,len(s))
