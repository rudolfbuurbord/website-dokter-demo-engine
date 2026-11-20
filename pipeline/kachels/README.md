# Kachel-template (De Website Dokters)

Van de website van een kachelzaak naar een premium demo op `demo.dewebsitedokters.nl/<naam>`, in de WARMTE-stijl van De Kachelerij.
Doel: binnen 15 tot 30 minuten een demo die voelt als *"dit is mijn zaak, maar dan beter"*.

```bash
cd /home/claude/website-dokter-demo-engine/pipeline
python3 kachels/maak_kachel.py start https://www.voorbeeldkachels.nl voorbeeldkachels   # ± 1 min
#   → bekijk logos.jpg, sheet.jpg en producten.jpg in /home/claude/demos/voorbeeldkachels/
#   → maak content.json af (zie hieronder), laat kleuren en hero goedkeuren
python3 kachels/maak_kachel.py build   voorbeeldkachels    # lokaal bouwen + testen (390 en 1280 px)
python3 kachels/maak_kachel.py publish voorbeeldkachels    # live zetten
```

Voorbeeld van een complete `content.json`: `kachels/voorbeeld_dekachelerij.json` (webshop met 12 secties).

## Wat er automatisch gebeurt
| Stap | Script | Resultaat |
|---|---|---|
| Site uitlezen | `../scrape.py` (gedeeld met de schilders) | teksten, logo, logokleuren, telefoon, e-mail |
| Webshop uitlezen | `shop_scrape.py` | producten met naam, prijs, link, foto, **kW, m², rendement**, type. Volgorde: Shopify → WooCommerce → JSON-LD → productkaarten |
| Foto's | `uitsnijden.py` | witte achtergrond weg, energielabel weg, vloerschaduw weg, losse restjes weg, vuurvenster blijft heel. Geen witte achtergrond? Dan sfeerfoto (label wordt afgeknipt) |
| Concept | `maak_kachel.py start` | `content.json` met bedrijf, producten, voorgestelde secties. Veld `_status` blokkeert publiceren tot het af is |
| Bouwen | `build_kachel.py` | `site/` met losse beelden (≈60 KB HTML i.p.v. 8 MB). Stopt bij ontbrekende foto's of product-id's |

## Flexibel: niet elke kachelzaak is hetzelfde
Drie knoppen bepalen alles.

**1. `profiel`: wat voor zaak is het?**
- `"webshop": true/false`. Bij `false` verdwijnen zoekbalk, winkelwagen en prijzen-uit-de-webshop-teksten.
- `"hoofdactie"`:
  - `webshop`: knoppen naar productpagina's;
  - `offerte`: knoppen "Vraag advies", naar het formulier;
  - `afspraak`: idem, met de bezoekplanner voorop.
- `"zekerheden"`: 2 tot 4 echte beloftes van de zaak, met icoon (`truck`, `store`, `shield`, `back`, `home`, `users`, `wrench`, `clock`, `card`).

**2. `secties`: welke blokken, in welke volgorde.** Weglaten is ook een keuze.

| Sectie | Wanneer gebruiken |
|---|---|
| `snelbalk` | webshop met onderdelen, pijpen of brandstof |
| `intro` | altijd |
| `kiezer` | altijd als er ≥ 3 kachels met foto zijn |
| `soorten` | 2 tot 4 soorten. Pellet-specialist? Dan bijvoorbeeld "Pellet of hout" |
| `uitgelicht` | altijd: één topmodel + 3 favorieten (+ showroommodellen indien aanwezig) |
| `koken` | ≥ 2 houtfornuizen |
| `diensten` | **zaken die plaatsen, onderhouden, vegen of cv koppelen** (installateurs). Kaarten + stappen |
| `buiten` | als ze buitenkachels, plancha's of vuurschalen verkopen |
| `startpakket` | webshop met pijpen, haardsets en brandstof |
| `over` | altijd (met `stookgids: true/false`) |
| `faq` | altijd: chat met hun eigen antwoorden over verzending, levering, retour, garantie en afspraken |
| `verhalen` | altijd. Echte reviews als ze er zijn, anders `voorbeeld: true` |
| `bezoek` | altijd. `tabs`: elke combinatie van `bezoek` (dag + tijd), `thuis` (advies aan huis) en `offerte` |

**3. `producten`: de Kachelkiezer bouwt zich hieruit op.**
- Elk product heeft een `type`: `hout`, `fornuis`, `pellet`, `gas`, `sfeer`, `buiten-koken`, `buiten-warm` of `buiten-sfeer`.
- De kiezer stelt alleen vragen die ertoe doen:
  - binnen/buiten alleen als beide er zijn;
  - de soorten die ze echt verkopen;
  - ruimtegrootte alleen als er m² bekend is.
- De uitkomst: de 2 best passende modellen op m², met voorkeur voor een `badge`.
- Geef de 6 tot 10 beste kachels een `waarom` (één zin) en eventueel een `badge` ("Aanbieding", "Keuze van …").

**Iets wat echt niet past?**
- Zet het als extra `rijen` of `extra` bij `soorten`.
- Of voeg in `template/index.j2` een nieuwe sectie toe, op dezelfde manier als `diensten`, en zet de naam in `secties`. Zo groeit de template mee.

## Vaste regels (van de eigenaar, altijd toepassen)
- **Contact en openingstijden één keer** op de pagina: alleen in `bezoek` (plus kort in de footer).
- **Typografie:** Fraunces voor alle titels, Inter voor tekst, Bodoni alleen in het woord WARMTE. Titels en subteksten gecentreerd. Tekst ≥ 17 px op mobiel.
- **Lichte secties** (`light`) gebruiken donkere tekst. Nooit lichtbeige op beige.
- **Kleuren alleen uit het logo of de CSS**, gemeten en nooit gegokt. Een eigen accent zet je via `"kleur": {"ember": "#EC752A"}`.
- **Hero:** `variant: warmte` gebruikt de vaste studiobeelden (in `assets/`). Wil je een eigen foto, gebruik dan `variant: foto` met `foto: "<bestand>"`.
- **Echte feiten** (prijzen, kW, m², garantie, verzendkosten) komen van hun eigen site. Reviews die er niet staan, markeer je als voorbeeld.
- **Elke prijs heeft een knop.** Bij een webshop gaat die naar de juiste productpagina.
- Demo-vermelding alleen in de footer.

## Controle voor oplevering
`maak_kachel.py build` draait de QA: geen fouten, geen horizontale overflow, geen kapotte beelden, op 390 en 1280 px.
Bekijk daarna zelf:
1. de hero;
2. de Kachelkiezer (doorklikken tot een uitkomst);
3. één lichte sectie;
4. de footer.
