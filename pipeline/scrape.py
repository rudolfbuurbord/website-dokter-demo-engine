#!/usr/bin/env python3
"""Stap 1: lees een site parallel en schrijf facts.json (teksten, foto's, kleuren, contact)."""
import sys,re,json,html,os,concurrent.futures as cf,urllib.request,urllib.parse,collections,io
from PIL import Image
UA={'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36'}
def get(u,t=20,html_only=False):
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=t)
        if html_only and 'html' not in (r.headers.get('content-type') or ''): return b'',u
        return r.read(),r.geturl()
    except Exception as e: return b'',u
def text(h):
    h=re.sub(r'<(script|style|noscript|svg|nav|header|footer)[^>]*>.*?</\1>','',h,flags=re.S|re.I)
    t=html.unescape(re.sub(r'<[^>]+>','\n',h));t=re.sub(r'[ \t\xa0]+',' ',t);return re.sub(r'\n\s*\n+','\n',t).strip()
base=sys.argv[1].rstrip('/')+'/';out=sys.argv[2];os.makedirs(out+'/raw',exist_ok=True)
b,final=get(base);home=b.decode('utf8','ignore');root=urllib.parse.urlsplit(final).netloc
links=[]
for h in re.findall(r'href=["\']([^"\'#]+)["\']',home):
    u=urllib.parse.urljoin(final,h);p=urllib.parse.urlsplit(u)
    if p.netloc.replace('www.','')==root.replace('www.','') and not re.search(r'\.(jpg|jpeg|png|webp|gif|svg|pdf|css|js|xml|ico|woff2?|otf|ttf|eot|php|json|zip|mp4)(\?|$)|/wp-(content|includes|json|admin)/|/fonts?/|feed|privacy|cookie|disclaimer|voorwaarden|login|cart|tag/|author/|xmlrpc',u,re.I):
        u=u.split('?')[0]
        if u not in links and u.rstrip('/')!=final.rstrip('/'): links.append(u)
links=links[:14]
pages={final:home}
with cf.ThreadPoolExecutor(10) as ex:
    for u,(bb,_) in zip(links,ex.map(lambda x:get(x,html_only=True),links)):
        if bb: pages[u]=bb.decode('utf8','ignore')
# ---------- logo-kandidaten (punt 2) ----------
dom_tokens=[t for t in re.split(r'[^a-z]+',root.lower().replace('www.','').split('.')[0]) if len(t)>2]
logo_c={}
def add_logo(u,score):
    u=urllib.parse.urljoin(final,html.unescape(u.split(' ')[0]))
    logo_c[u]=max(logo_c.get(u,0),score)
header=re.search(r'<header.*?</header>',home,re.S|re.I);hdr=header.group(0) if header else home[:15000]
for m in re.finditer(r'<img[^>]+>',hdr,re.I):
    tag=m.group(0);src=re.search(r'(?:data-src|src)=["\']([^"\']+)',tag)
    if not src or src.group(1).startswith('data:'):continue
    sc=3+(3 if re.search(r'logo',tag,re.I) else 0)+(2 if any(t in tag.lower() for t in dom_tokens) else 0)+(1 if re.search(r'\.(svg|png)',src.group(1),re.I) else 0)
    add_logo(src.group(1),sc)
for m in re.finditer(r'<img[^>]+>',home,re.I):
    tag=m.group(0);src=re.search(r'(?:data-src|src)=["\']([^"\']+)',tag)
    if src and re.search(r'logo',tag,re.I) and not src.group(1).startswith('data:'): add_logo(src.group(1),4)
for m in re.findall(r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',home,re.I): add_logo(m,1)
for m in re.findall(r'<link[^>]+rel=["\'][^"\']*(?:apple-touch-icon|icon)[^"\']*["\'][^>]+href=["\']([^"\']+)',home,re.I): add_logo(m,0)

# ---------- foto's: grootste variant per bestand ----------
imgs={}
for u,h in pages.items():
    hh=html.unescape(h)
    cands=re.findall(r'(?:src|data-src|data-lazy-src|href)=["\']([^"\']+\.(?:jpe?g|png|webp)(?:\?[^"\']*)?)["\']',hh,re.I)
    for ss in re.findall(r'srcset=["\']([^"\']+)["\']',hh): cands+= [x.strip().split(' ')[0] for x in ss.split(',')]
    cands+=re.findall(r'url\(["\']?([^"\')]+\.(?:jpe?g|png|webp))',hh,re.I)
    # sitebouwers (o.a. Strato/cm4all) met de extensie midden in het pad: .../foto.jpg/picture-1200?...
    cands+=re.findall(r'(?:src=["\']|url\(["\']?)([^"\' )]+\.(?:jpe?g|png|webp)/[^"\' )]+)',hh,re.I)
    for c in cands:
        a=urllib.parse.urljoin(u,c);path=a.split('?')[0]
        base=re.sub(r'(\.(?:jpe?g|png|webp))/[^/]+$',r'\1',path,flags=re.I)
        key=re.sub(r'-\d+x\d+(?=\.\w+$)','',base.rsplit('/',1)[-1]).replace('-scaled','')
        w=re.search(r'-(\d+)x\d+\.\w+(\?|$)',a) or re.search(r'[?&]w=(\d+)',a) or re.search(r'/picture-(\d+)',a);w=int(w.group(1)) if w else 9999
        if key not in imgs or w>imgs[key][0]: imgs[key]=(w,a)
def dl(a):
    bb,_=get(a)
    try:
        im=Image.open(io.BytesIO(bb));im.load();return a,im,bb
    except Exception: return a,None,None
def dhash(im,n=8):
    g=im.convert('L').resize((n+1,n),Image.LANCZOS);px=list(g.getdata())
    return sum(1<<i for i in range(n*n) if px[(i//n)*(n+1)+i%n]>px[(i//n)*(n+1)+i%n+1])
def is_photo(im):
    """echte foto: groot genoeg, niet bijna transparant, genoeg kleurvariatie, geen icoon/banner"""
    w,h=im.size
    if w*h<400*300 or w/h>3.2 or h/w>2.2: return 'te klein/vorm'
    if im.mode in('RGBA','LA','P'):
        al=im.convert('RGBA').getchannel('A');
        if sum(1 for v in al.resize((40,40)).getdata() if v<200)>320: return 'transparant'
    sm=im.convert('RGB').resize((64,64));cols=len(set(sm.getdata()))
    if cols<900: return 'vlak/grafisch'
    return None
photos=[];logos=[];rejected=collections.Counter();hashes=[]
with cf.ThreadPoolExecutor(12) as ex:
    res=list(ex.map(dl,[a for _,(w,a) in imgs.items()]))
    lres=list(ex.map(dl,list(logo_c)))
for a,im,bb in res:
    if im is None: continue
    if 'logo' in a.lower(): logo_c[a]=max(logo_c.get(a,0),4); lres.append((a,im,bb)); continue
    why=is_photo(im)
    if why: rejected[why]+=1; continue
    hsh=dhash(im)
    if any(bin(hsh^x).count('1')<=6 for x in hashes): rejected['dubbel']+=1; continue
    hashes.append(hsh)
    name='p%d'%len(photos);fn=f'{out}/raw/{name}.img';open(fn,'wb').write(bb)
    photos.append({'id':name,'file':fn,'size':list(im.size),'url':a})
seen=set()
for a,im,bb in sorted(lres,key=lambda r:(-logo_c.get(r[0],0),-(r[1].size[0]*r[1].size[1] if r[1] else 0))):   # bij gelijke score: grootste
    if im is None or a in seen: continue
    seen.add(a);fn=f'{out}/raw/logo{len(logos)}.png';open(fn,'wb').write(bb)
    logos.append({'file':fn,'size':list(im.size),'url':a,'score':logo_c.get(a,0)})
photos.sort(key=lambda p:-p['size'][0]*p['size'][1])
for p in photos[40:]:   # maximaal de 40 grootste: houdt het contactvel en de demo behapbaar
    try: os.remove(p['file'])
    except OSError: pass
photos=photos[:40]
for i,p in enumerate(photos):   # hernummeren op grootte
    nf=f'{out}/raw/f{i}.img';os.replace(p['file'],nf);p['file']=nf;p['id']='p%d'%i
print('afgekeurd:',dict(rejected))
# kleuren uit css
css=''
for u,h in pages.items():
    css+=' '.join(re.findall(r'<style[^>]*>(.*?)</style>',h,re.S))
for href in set(re.findall(r'href=["\']([^"\']+\.css[^"\']*)["\']',home))[:6] if False else list(set(re.findall(r'href=["\']([^"\']+\.css[^"\']*)["\']',home)))[:6]:
    css+=get(urllib.parse.urljoin(final,href))[0].decode('utf8','ignore')
cnt=collections.Counter(h.lower() for h in re.findall(r'#([0-9a-fA-F]{6})\b',css))
def sat(h):
    r,g,b=[int(h[i:i+2],16) for i in (0,2,4)];mx,mn=max(r,g,b),min(r,g,b);return (mx-mn)/(mx or 1)
colors=[('#'+h,n) for h,n in cnt.most_common(40) if sat(h)>.35][:8]
alltext=text(home)
def cfdec(e):
    k=int(e[:2],16);return ''.join(chr(int(e[i:i+2],16)^k) for i in range(2,len(e),2))
alljs=' '.join(pages.values())
emails=sorted(set(re.findall(r'[\w.+-]+@[\w-]+\.[a-z]{2,6}',alljs+' '+' '.join(cfdec(x) for x in re.findall(r'data-cfemail="([0-9a-f]+)"',alljs)))))[:5]
ptext={u:text(h) for u,h in pages.items()}
lc=collections.Counter(l.strip() for t in ptext.values() for l in set(t.splitlines()) if l.strip())
boiler={l for l,n in lc.items() if n>=max(3,len(ptext)*.5)}
ptext={u:'\n'.join(l for l in t.splitlines() if l.strip() and l.strip() not in boiler)[:3500] for u,t in ptext.items()}
facts={'url':final,'pages':ptext,'boilerplate':sorted(boiler)[:60],'title':re.search(r'<title>(.*?)</title>',home,re.S).group(1).strip() if '<title>' in home else '',
 'phones':sorted(set(re.findall(r'(?:\+31|0)[\d \-]{8,13}\d',' '.join(text(h) for h in pages.values()))))[:6],
 'emails':emails,
 'colors':colors,'logos':logos[:6],'photos':photos[:40]}
json.dump(facts,open(out+'/facts.json','w'),indent=1,ensure_ascii=False)
print('pagina\'s',len(pages),'foto\'s',len(photos),'logo-kandidaten',[(l['url'].rsplit('/',1)[-1][:40],l['score']) for l in logos[:4]],'kleuren',colors[:4])
# logokleuren: alleen zichtbare pixels (alpha>200), nooit de transparante achtergrond
def logo_colors(fn):
    im=Image.open(fn).convert('RGBA');cnt=collections.Counter()
    for r,g,b,a in im.getdata():
        if a>200: cnt[(r//12*12,g//12*12,b//12*12)]+=1
    tot=sum(cnt.values()) or 1;out=[]
    for c,n in cnt.most_common(12):
        hx='#%02x%02x%02x'%c
        if n/tot>.03 and not any(sum(abs(int(hx[i:i+2],16)-int(o[0][i:i+2],16)) for i in (1,3,5))<60 for o in out): out.append((hx,round(n/tot,2)))
    return out[:5]
if logos: facts['logo_colors']=logo_colors(logos[0]['file']);json.dump(facts,open(out+'/facts.json','w'),indent=1,ensure_ascii=False);print('logokleuren (zichtbaar):',facts['logo_colors'])
# contactvel voor het beeldmodel (labels = foto-id)
from PIL import ImageDraw
S=220;Wc=6;rows=(len(photos)+Wc-1)//Wc or 1
sheet=Image.new('RGB',(Wc*S,rows*(S+18)),'white');d=ImageDraw.Draw(sheet)
for i,p in enumerate(photos[:40]):
    im=Image.open(p['file']).convert('RGBA');bg=Image.new('RGBA',im.size,'white');im=Image.alpha_composite(bg,im).convert('RGB');im.thumbnail((S,S));x=(i%Wc)*S;y=(i//Wc)*(S+18);sheet.paste(im,(x,y));d.text((x+3,y+S+2),f"#{p['id']}  {p['size'][0]}x{p['size'][1]}",fill='black')
sheet.save(out+'/sheet.jpg',quality=72)
if logos:
    ls=Image.new('RGB',(900,120*len(logos[:4])),'#888');
    for i,l in enumerate(logos[:4]):
        im=Image.open(l['file']).convert('RGBA');im.thumbnail((860,110));ls.paste(im,(10,i*120+5),im)
    ls.save(out+'/logos.jpg',quality=80)
