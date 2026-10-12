from pathlib import Path
import re
root=Path(__file__).parent
s=(root/'references/kleur-karakter-original/index.html').read_text()
s=s.replace('href="/app.css"','href="/kleur-karakter/base.css"><link rel="stylesheet" href="/kleur-karakter/refinement.css"')
s=s.replace('<body class="painter-page">','<body class="painter-page"><a class="skip-link" href="#main">Naar inhoud</a>')
s=s.replace('<main>','<main id="main">')
s=s.replace('<nav aria-label="Hoofdnavigatie">','<nav id="site-menu" aria-label="Hoofdnavigatie">')
s=s.replace('</header>','<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-menu">Menu <span aria-hidden="true">＋</span></button></header>')
s=s.replace('<div class="hero-copy reveal">','<div class="hero-copy">').replace('<div class="hero-bottom reveal">','<div class="hero-bottom">')
s=s.replace('<canvas class="splash-canvas" aria-hidden="true"></canvas>','',1)
s=s.replace('<div class="paint-stage"','<div class="hero-art"><canvas class="splash-canvas" aria-hidden="true"></canvas><div class="paint-stage"',1)
s=s.replace('</span></div></div><div class="hero-bottom">','</span></div></div></div><div class="hero-bottom">',1)
s=s.replace('Van strak binnenwerk tot duurzaam buitenwerk. Deze demo laat zien hoe vakmanschap, kleuradvies en een zorgvuldige planning samenkomen.','Binnen- en buitenschilderwerk, kleuradvies en aandacht voor de afwerking. Geef jouw huis meer karakter.')
s=s.replace('aria-label="Offerte aanvragen"><svg','aria-label="Offerte aanvragen"><span>Vraag een offerte aan</span><svg',1)
s=re.sub(r'<div class="trust-orbit".*?</div>','',s,count=1)
s=s.replace('Demo: reviewscore nog te koppelen','Voorbeeldweergave · nog geen gekoppelde reviews')
s=s.replace('<section class="manifesto brush reveal">','<section class="manifesto" id="diensten">')
s=re.sub(r'<div class="service-line">.*?</div>', '''<div class="service-line">
<details><summary><span>01</span> Binnenschilderwerk <i>＋</i></summary><p>Wanden, plafonds en houtwerk. Een rustige basis begint bij een egaal oppervlak en een kleur die bij de ruimte past.</p></details>
<details><summary><span>02</span> Buitenschilderwerk <i>＋</i></summary><p>Kozijnen, deuren en gevelhout. De bestaande ondergrond bepaalt welke voorbereiding en afwerking nodig zijn.</p></details>
<details><summary><span>03</span> Kleuradvies <i>＋</i></summary><p>Bekijk kleuren in het licht van jouw woning. Onderzoek hoe wanden, houtwerk en bestaande materialen samenkomen.</p></details>
<details><summary><span>04</span> Houtrotbehandeling <i>＋</i></summary><p>Eerst de staat van het hout beoordelen. Daarna bespreken welke reparatie of vervanging nodig is vóór het schilderen.</p></details></div>''',s,count=1)
s=s.replace('photo-1600596542815-ffad4c1539a9','photo-1600210492486-724fe5c67fb0')
# The live source's first image is an exterior; keep it and accurately name it.
s=s.replace('Lichte woonkamer met warme aardetinten','Voorbeeldbeeld van een moderne woning').replace('Warmte in de woonkamer','Karakter aan de buitenkant').replace('Binnenwerk · rustige aardetint','Buitenwerk · voorbeeldbeeld')
s=s.replace('Monumentaal, maar fris','Warmte in de woonkamer').replace('Totaalproject · binnen &amp; buiten','Binnenwerk · voorbeeldbeeld')
for i in range(3):
 s=s.replace(f'data-project="{i}"',f'data-project="{i}" role="button" tabindex="0" aria-label="Bekijk project {i+1}" aria-pressed="{str(i==1).lower()}"')
comparison='''<section class="before-after" id="voor-na" aria-labelledby="before-title">
<div class="ba-copy"><p class="ba-eyebrow">01 / De hele ruimte</p><h2 id="before-title">Van kaal<br>naar <em>karakter.</em></h2><p class="ba-description">Van onbewerkt beton naar een rustige, geschilderde woonkamer. Dezelfde ruimte, hetzelfde licht — het verschil zit in het oppervlak.</p>
<div class="comparison-nav" aria-label="Kies een vergelijking"><button type="button" class="compare-prev" aria-label="Vorige vergelijking">←</button><span class="compare-count" aria-live="polite">01 / 03</span><button type="button" class="compare-next" aria-label="Volgende vergelijking">→</button></div>
<div class="comparison-tabs" role="group" aria-label="Onderwerp"><button type="button" data-scene="0" aria-pressed="true">Ruimte</button><button type="button" data-scene="1" aria-pressed="false">Details</button><button type="button" data-scene="2" aria-pressed="false">Houtwerk</button></div></div>
<div class="comparison-media"><div class="compare" style="--position:50%"><img class="compare-after-image" src="/kleur-karakter/media/room-after.webp" width="1024" height="688" alt="Illustratie: dezelfde woonkamer met geschilderde wanden"><div class="compare-before"><img src="/kleur-karakter/media/room-before.webp" width="1024" height="688" alt="Illustratie: woonkamer met onbewerkt beton"></div><span class="label before">Voor</span><span class="label after">Na</span><span class="handle" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8 8-4 4 4 4m8-8 4 4-4 4"/></svg></span><input aria-label="Vergelijk voor en na" aria-describedby="compare-hint" type="range" min="0" max="100" value="50"></div><div class="comparison-caption"><span id="compare-hint">Sleep de lijn om te vergelijken</span><span>AI-illustraties · geen uitgevoerd project</span></div><p class="comparison-status" role="status"></p></div></section>'''
s=re.sub(r'<section class="before-after.*?</section>',comparison,s,count=1,flags=re.S)
s=s.replace('<div class="owner-portrait reveal">','<div class="owner-portrait">')
s=s.replace('Hier kan straks de echte motivatie, werkwijze en persoonlijke belofte van het bedrijf staan.','Hier komt de echte motivatie van de eigenaar te staan. Hieronder zie je hoe een aanvraag in dit concept wordt uitgelegd.')
s=s.replace('<strong>Eigenaar · naam nog in te vullen</strong>','''<strong>Eigenaar · voorbeeldportret</strong><ol class="process-list"><li><span>01</span><div><b>Vertel over je plannen</b><p>Wat wil je laten schilderen en welke uitstraling zoek je?</p></div></li><li><span>02</span><div><b>Bespreek het werk</b><p>Ondergrond, afwerking en planning worden samen bekeken.</p></div></li><li><span>03</span><div><b>Bekijk het voorstel</b><p>De werkzaamheden en kosten vormen de basis voor je keuze.</p></div></li></ol>''')
# Make unsupported proof neutral, while retaining review composition.
s=s.replace('“Vanaf het eerste contact duidelijk en prettig. Het eindresultaat voelt rustig en verzorgd.”','Hier krijgt een echte klantervaring de ruimte.').replace('“Er werd netjes gewerkt en goed meegedacht over de kleur. Precies de uitstraling die we zochten.”','Aandacht voor kleur, afwerking en het contact.').replace('“Heldere planning, fijne communicatie en een prachtig resultaat.”','Het verhaal achter een tevreden klant.')
s=s.replace('Voorbeeldreview · geen echte klantclaim','Voorbeeldpositie · nog geen echte review')
s=s.replace('<a href="tel:+31000000000">Bel direct <span>→</span></a><a href="mailto:demo@voorbeeld.nl?subject=Offerteaanvraag%20via%20demo">Vraag een offerte aan <span>→</span></a>','<button type="button" class="open-enquiry" aria-label="Vraag een offerte aan">Vraag een offerte aan <span>→</span></button><button type="button" class="contact-demo">Liever bellen? <span>↗</span></button>')
s=s.replace('</div></section>\n  </main>','</div><p class="contact-note">Vertel wat je wilt laten schilderen. Deze conceptdemo verstuurt geen aanvragen.</p></section>\n  </main>')
s=s.replace('href="tel:+31000000000"','href="#contact"').replace('href="mailto:demo@voorbeeld.nl"','href="#contact"')
s=s.replace('<div class="mobile-bar"><a href="#contact">Bel direct</a><a href="#contact">Offerte</a></div>','')
# Preserve the existing hero motion source. Replace gallery logic which scrolls ancestor containers.
script=re.search(r'<script>(.*?)</script>',s,re.S).group(1)
script=script[:script.index('  const cards=')]+'})()'
# Correct WebGL compositing only; preserve the existing time/motion functions.
script=script.replace('gl_FragColor=vec4(col,mask);','gl_FragColor=vec4(col*mask,mask);')
s=re.sub(r'<script>.*?</script>','<script src="/kleur-karakter/hero-motion.js" defer></script><script src="/kleur-karakter/refinement.js" defer></script>',s,flags=re.S)
dialog='''<dialog id="enquiry-dialog" aria-labelledby="enquiry-title"><button class="close-dialog" type="button" aria-label="Sluiten">×</button><p class="kicker">Een frisse blik op jouw plannen</p><h2 id="enquiry-title">Wat wil je laten <em>schilderen?</em></h2><p>Probeer de aanvraagstappen. Dit is een conceptdemo: er wordt niets verstuurd of opgeslagen.</p><form id="enquiry-form"><label>Je naam<input name="name" autocomplete="name" required maxlength="100"></label><label>E-mailadres<input name="email" type="email" autocomplete="email" required maxlength="254"></label><label>Wat wil je laten doen?<textarea name="message" rows="3" required maxlength="2000"></textarea></label><button type="submit" class="submit-enquiry">Bekijk je aanvraag <span>→</span></button><p class="form-feedback" role="status"></p></form></dialog>'''
s=s.replace('</body>',dialog+'</body>')
(root/'public/kleur-karakter/index.html').write_text(s)
(root/'public/kleur-karakter/hero-motion.js').write_text(script+'\n')
print('Built',len(s))
