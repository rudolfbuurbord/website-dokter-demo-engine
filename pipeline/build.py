#!/usr/bin/env python3
"""Stap 3: invulbestand (content.json) + facts.json -> complete demo-site in <out>/site.
Gebruik: build.py <werkmap>   (werkmap bevat facts.json, content.json, raw/)"""
import sys,json,os,io,math,shutil,colorsys,concurrent.futures as cf,urllib.request,urllib.parse,time
from PIL import Image,ImageOps,ImageEnhance
import jinja2
T0=time.time()
W=sys.argv[1];P=os.path.dirname(os.path.abspath(__file__))
facts=json.load(open(f'{W}/facts.json'));C=json.load(open(f'{W}/content.json'))
site=f'{W}/site';shutil.rmtree(site,ignore_errors=True);os.makedirs(f'{site}/img');os.makedirs(f'{site}/logos')
UA={'User-Agent':'DeWebsiteDokters-demo/1.0'}

# ---------- kleuren: alles afgeleid uit 2 merkkleuren ----------
def hx(h):h=h.lstrip('#');return tuple(int(h[i:i+2],16) for i in (0,2,4))
def tohex(c):return '#%02X%02X%02X'%tuple(max(0,min(255,round(v))) for v in c)
def lum(c):
    def ch(v):v/=255;return v/12.92 if v<=.03928 else ((v+.055)/1.055)**2.4
    r,g,b=c;return .2126*ch(r)+.7152*ch(g)+.0722*ch(b)
def contrast(a,b):la,lb=sorted([lum(a),lum(b)],reverse=True);return (la+.05)/(lb+.05)
def shade(c,f):return tuple(v*f for v in c)
def tint(c,f):return tuple(v+(255-v)*f for v in c)
ink=hx(C['brand']['ink']);acc=hx(C['brand']['accent'])
# HARDE CONTROLE: kleuren moeten echt in het merk voorkomen (zichtbaar logo of CSS). Anders stopt de bouw.
known=[x[0] for x in facts.get('logo_colors',[])]+[x[0] for x in facts.get('colors',[])[:6]]
def dist(a,b):return sum(abs(x-y) for x,y in zip(a,b))
def neutral(c):return max(c)-min(c)<40   # zwart/grijs/antraciet mag altijd als inkt
problems=[]
if known and min(dist(acc,hx(k)) for k in known)>90: problems.append(f"accent {C['brand']['accent']} staat niet in logo/CSS")
if known and not neutral(ink) and min(dist(ink,hx(k)) for k in known)>90: problems.append(f"inkt {C['brand']['ink']} staat niet in logo/CSS")
if not facts.get('logo_colors'): problems.append('geen zichtbare logokleuren gemeten: logo handmatig nakijken')
if problems:
    print('KLEURCONTROLE MISLUKT:','; '.join(problems));print('Merkkleuren gevonden:',known)
    if not C['brand'].get('override'): sys.exit(2)
    print('Doorgezet met override, reden:',C['brand']['override'])
h,l,s=colorsys.rgb_to_hls(*[v/255 for v in ink])
if contrast(ink,(244,240,233))<12: ink=tuple(v*255 for v in colorsys.hls_to_rgb(h,.13,min(s,.55)))   # inkt alleen verdiepen als contrast te laag is; echte merkkleur blijft anders staan
cardD=tint(ink,.07);paper=tint(tint(ink,.0),.955) ;paper=tuple(v for v in tint((244,240,233),0))
onAcc=ink if contrast(acc,ink)>=contrast(acc,(255,255,255)) else (255,255,255)
c={'ink':tohex(ink),'cardD':tohex(cardD),'paper':tohex(paper),'accent':tohex(acc),'accentH':tohex(tint(acc,.15)),
   'onAccent':tohex(onAcc),'muted':tohex(tint(ink,.42)),'line':'rgba(%d,%d,%d,.12)'%tuple(map(round,ink)),
   'demobar':tohex(shade(ink,.7)),'navLight':'rgba(244,240,233,.92)','glow':'rgba(%d,%d,%d,.22)'%acc,'glowSoft':'rgba(%d,%d,%d,.09)'%acc,
   'inkRgba':'rgba(%d,%d,%d,'%tuple(map(round,ink)),'rollerDark':tohex(shade(acc,.72)),'rollerLight':tohex(tint(acc,.35)),'pin':C['brand'].get('pin',tohex(acc))}
if contrast(acc,ink)<3: print('LET OP: accent heeft weinig contrast op inkt',contrast(acc,ink))

# ---------- thema: donker / licht / merk ----------
theme=C.get('theme','donker')
def rgba(col,a):return 'rgba(%d,%d,%d,%s)'%(tuple(map(round,col))+(a,))
W_=(255,255,255);PAPER=(244,240,233)
if theme=='licht':
    hb=(250,248,244);ht=ink
    t=dict(heroBg=tohex(hb),heroText=tohex(ht),heroMuted=rgba(ink,.68),heroLine=rgba(ink,.16),heroIcon=tohex(ink),ghost='transparent',
           paintFill=tohex(acc),heroBtnBg=tohex(ink),heroBtnText='#FFFFFF',heroGlow='transparent',navCtaBg=tohex(ink),navCtaText='#FFFFFF',
           navScrolledBg='rgba(250,248,244,.92)',navScrolledText=tohex(ink))
elif theme=='merk':
    on=onAcc;onIsInk=on==ink
    t=dict(heroBg=tohex(acc),heroText=tohex(on),heroMuted=rgba(on,.74),heroLine=rgba(on,.24),heroIcon=tohex(on),ghost=rgba(on,.38),
           paintFill=tohex(on),heroBtnBg=tohex(on),heroBtnText='#FFFFFF' if onIsInk else tohex(ink),heroGlow='rgba(255,255,255,.35)',
           navCtaBg=tohex(ink),navCtaText='#FFFFFF',navScrolledBg='rgba(244,240,233,.92)',navScrolledText=tohex(ink))
else:
    theme='donker'
    t=dict(heroBg=tohex(ink),heroText=tohex(PAPER),heroMuted='rgba(244,240,233,.68)',heroLine='rgba(244,240,233,.14)',heroIcon=tohex(acc),
           ghost='rgba(244,240,233,.55)',paintFill=tohex(acc),heroBtnBg=tohex(acc),heroBtnText=tohex(onAcc),heroGlow=rgba(acc,.22),
           navCtaBg=tohex(acc),navCtaText=tohex(onAcc),navScrolledBg=rgba(ink,.9),navScrolledText=tohex(PAPER))
if C.get('hero_glow') is False: t['heroGlow']='transparent'
print('thema:',theme,'| accent op papier',round(contrast(acc,(244,240,233)),1))

# ---------- foto's ----------
photos=facts['photos'];used={}
def need(idx,name=None):
    used[idx]=name or f'p{idx}';return used[idx]
def walk(o):
    if isinstance(o,dict):return {k:walk(v) for k,v in o.items()}
    if isinstance(o,list):return [walk(v) for v in o]
    if isinstance(o,str) and o.startswith('#p'):return need(int(o[2:]))
    return o
C=walk(C)
def conv(item):
    idx,name=item;im=Image.open(photos[idx]['file']);im=ImageOps.exif_transpose(im).convert('RGB')
    a=im.copy();a.thumbnail((1400,1400));a.save(f'{site}/img/{name}.webp','WEBP',quality=74,method=5)
    b=im.copy();b.thumbnail((640,640));b.save(f'{site}/img/f_{name}.webp','WEBP',quality=70,method=5)
with cf.ThreadPoolExecutor(8) as ex: list(ex.map(conv,used.items()))

# ---------- logo (+ lichte versie voor donkere balk) ----------
lg=Image.open(C['logo']['file']).convert('RGBA')
if C['logo'].get('knockout'):   # achtergrondkleur transparant maken
    kc=hx(C['logo']['knockout']);px=lg.load()
    for y in range(lg.height):
        for x in range(lg.width):
            r,g,b,a=px[x,y]
            if abs(r-kc[0])+abs(g-kc[1])+abs(b-kc[2])<60:px[x,y]=(r,g,b,0)
bbox=lg.getbbox();lg=lg.crop(bbox) if bbox else lg
lg.thumbnail((520,160));lg.save(f'{site}/logos/logo.png')
li=lg.copy();px=li.load()
for y in range(li.height):
    for x in range(li.width):
        r,g,b,a=px[x,y]
        if a>20 and lum((r,g,b))<.08:px[x,y]=(244,240,233,a)   # donkere delen -> licht
        elif a>20 and abs(r-g)<22 and abs(g-b)<22 and r<200:px[x,y]=(244,240,233,a)
# automatisch: veel donkere vlakken (badges, schaduw)? dan origineel logo op licht plaatje
op=[p for p in lg.getdata() if p[3]>20];dark=sum(1 for p in op if lum(p[:3])<.06)/max(1,len(op))
white=sum(1 for p in op if lum(p[:3])>.8)/max(1,len(op))
plate=C['logo'].get('plate', dark>.05 and white>.01)   # donker + wit samen = badge/negatief: niet omkleuren
(lg if plate else li).save(f'{site}/logos/logo-licht.png')
near=sum(1 for p in op if sum(abs(p[i]-acc[i]) for i in range(3))<90)/max(1,len(op))
mplate=theme=='merk' and near>.12
print(f'logo: donker {dark:.0%}, wit {white:.0%} -> {"plaatje" if plate else "lichte versie"}')
for f in ['sikkens.png','sigma.svg','histor.png','flexa-dark.svg','wijzonol.svg','repaircare.svg','graco.svg']:
    shutil.copy(f'{P}/assets/{f}',f'{site}/logos/{f}')

# ---------- kaart (cache per locatie) ----------
lat,lon=C['area']['latlon'];km=C['area']['km'];z=11 if km<=30 else 10
os.makedirs(f'{P}/cache',exist_ok=True);ck=f'{P}/cache/mapgray_{lat:.3f}_{lon:.3f}_{z}.png'
def px(la,lo,z):
    n=256*2**z;x=(lo+180)/360*n;y=(1-math.log(math.tan(math.radians(la))+1/math.cos(math.radians(la)))/math.pi)/2*n;return x,y
Wm,Hm=1600,1216;cx,cy=px(lat,lon,z);x0,y0=cx-Wm/2,cy-Hm/2
if not os.path.exists(ck):
    img=Image.new('RGB',(Wm,Hm))
    tiles=[(tx,ty) for tx in range(int(x0//256),int((x0+Wm)//256)+1) for ty in range(int(y0//256),int((y0+Hm)//256)+1)]
    def tile(tt):
        tx,ty=tt;return tt,Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(f'https://tile.openstreetmap.org/{z}/{tx}/{ty}.png',headers=UA)).read())).convert('RGB')
    with cf.ThreadPoolExecutor(6) as ex:
        for (tx,ty),tim in ex.map(tile,tiles): img.paste(tim,(int(tx*256-x0),int(ty*256-y0)))
    ImageEnhance.Contrast(ImageOps.grayscale(img)).enhance(1.1).save(ck)
g=Image.open(ck).convert('L')
if C.get('alldark'): ImageOps.colorize(ImageOps.invert(g),black=c['ink'],white='#C4C4C4',mid='#3C3C3C').save(f'{site}/img/kaart.webp','WEBP',quality=74)
else: ImageOps.colorize(g,black=c['ink'],white='#F4F0E9',mid='#ADA79E').save(f'{site}/img/kaart.webp','WEBP',quality=74)
mpp=156543.03*math.cos(math.radians(lat))/2**z
C['area']['map']={'x':50,'y':50,'d':round(2*km*1000/mpp/Wm*100,1)}

# ---------- renderen ----------
env=jinja2.Environment(loader=jinja2.FileSystemLoader(f'{P}/template'),autoescape=True)
m=C['meta'];m['phone_href']=''.join(ch for ch in m['phone'] if ch.isdigit() or ch=='+')
js={'film':C['film'],'grid':C['grid'],'services':C['services'],'reviews':C['reviews']['items'],'reviewsExample':C['reviews']['example'],'reviewsSource':C['reviews'].get('source','Google-review'),
    'faq':C['faq'],'faqHello':C.get('faq_hello','Goedendag! Tik op een vraag, dan antwoorden we direct.'),'pc':C['area']['pc_ranges']}
assert isinstance(t,dict) and t.get('heroBg'), 'themawaarden leeg'
ctx=dict(trade=C.get('trade','schilder'),ctaGrad=C['brand'].get('cta_gradient'),alldark=bool(C.get('alldark')),lowacc=contrast(acc,(244,240,233))<3 and not C.get('alldark'),theme=theme,t=t,mplate=mplate,plate=plate,c=c,m=m,h=C['hero'],q=C['quote'],p=C['projects'],s=C['services_head'],w=C['who'],ww=C['steps'],z=C['trust'],a=C['area'],r=C['reviews'],o=C['offer'],f=C['footer'],js=js)
html=env.get_template('head.j2').render(**ctx)+'\n'+env.get_template('body.j2').render(**ctx)+'\n'+open(f'{P}/template/app.js').read()
open(f'{site}/index.html','w').write(html)
print(f'gebouwd in {time.time()-T0:.1f}s · {len(used)} foto\'s · accent-contrast {contrast(acc,ink):.1f}')
