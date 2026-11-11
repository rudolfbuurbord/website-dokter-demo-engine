#!/usr/bin/env python3
"""Stap 4: automatische controle. Start lokale server, checkt overflow/fouten/kapotte plaatjes op 390/1280, maakt screenshots."""
import sys,asyncio,subprocess,time,os,socket
from playwright.async_api import async_playwright
site=sys.argv[1];out=sys.argv[2] if len(sys.argv)>2 else site+'/../qa';os.makedirs(out,exist_ok=True)
s=socket.socket();s.bind(('',0));port=s.getsockname()[1];s.close()
srv=subprocess.Popen(['python3','-m','http.server',str(port)],cwd=site,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);time.sleep(.6)
async def main():
    ok=True
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for w,h,n in [(1280,800,'desktop'),(390,844,'mobiel')]:
            pg=await b.new_page(viewport={'width':w,'height':h});errs=[]
            pg.on('pageerror',lambda e:errs.append(str(e)));pg.on('console',lambda m:errs.append(m.text) if m.type=='error' else None)
            pg.on('response',lambda r:errs.append(f'{r.status} {r.url}') if r.status>=400 else None)
            await pg.goto(f'http://localhost:{port}/',wait_until='networkidle');await pg.wait_for_timeout(2800)
            await pg.screenshot(path=f'{out}/{n}_hero.png')
            # tekst die buiten beeld valt (overflow:hidden verbergt het anders voor de breedte-check)
            clip=await pg.evaluate("[...document.querySelectorAll('.hero h1, .hero h1 *, .hero .h-pill, .hero-ctas a, .nav a')].filter(e=>{const r=e.getBoundingClientRect();return r.width&&(r.right>innerWidth+1||r.left<-1)}).map(e=>(e.className||e.tagName)+':'+(e.textContent||'').trim().slice(0,30))")
            if clip: errs.append('buiten beeld: '+'; '.join(clip[:3]))
            await pg.evaluate("document.querySelectorAll('.rv').forEach(e=>e.classList.add('in'));document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager')")
            await pg.wait_for_timeout(1200)
            sw=await pg.evaluate('document.documentElement.scrollWidth')
            broken=await pg.evaluate("[...document.images].filter(i=>i.getAttribute('src')&&i.complete&&i.naturalWidth===0).map(i=>i.src)")
            await pg.screenshot(path=f'{out}/{n}_full.png',full_page=True)
            status='OK' if sw<=w and not errs and not broken else 'FOUT';ok&=status=='OK'
            print(n,status,'breedte',sw,'fouten',errs[:5],'kapot',broken[:5])
        await b.close()
    return ok
ok=asyncio.run(main());srv.terminate();sys.exit(0 if ok else 1)
