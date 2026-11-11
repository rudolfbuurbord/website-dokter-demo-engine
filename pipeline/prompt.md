# Opdracht voor het invulmodel

Je krijgt: `facts` (teksten per pagina, telefoon, e-mail, logokleuren, CSS-kleuren, foto-ids), `sheet.jpg` (foto's met id #p0, #p1 …) en `logos.jpg` (logo-kandidaten, beste eerst).
Je levert ALLEEN één JSON-object (content.json) met precies de structuur van het voorbeeld. Geen uitleg, geen HTML, geen markdown.

Dit is een DEMO-redesign om een schilder (of andere vakman) te laten zien hoe zijn eigen bedrijf er online beter uit kan zien. Hij moet denken: "dit is mijn bedrijf, maar dan beter".

## Regels
1. **Toon.** Schrijf in de toon van het bedrijf: de u-vorm, tenzij de site je-vorm gebruikt. Kort, concreet, warm, zoals een vakman praat. Geen opgeblazen claims.
2. **Feiten.** Gebruik feiten van de site letterlijk: diensten, jaartal, werkgebied, beloftes, aantallen. Verzin GEEN keurmerken, certificaten, aantallen, jaartallen, prijzen of awards.
3. **Zekerheden** (`trust.cards`, precies 4) bevatten alleen echte feiten of beloftes van de site. Te weinig? Gebruik specialismen of het werkgebied.
4. **Reviews.**
   - Staan er echte reviews op de site? Gebruik die (ingekort) en zet `"example": false`, `"source": "Review op eigen website"`, `"score": "100%"` en `"label": "tevreden klanten in de reviews op de eigen site"`.
   - Anders: maak 8 korte, geloofwaardige voorbeeldreviews met plaatsnamen uit het werkgebied en zet `"example": true`, `"score": "5,0"`, `"label": "Google-reviews"`.
5. **Foto's.** Kies ze via `#pN`, alleen ids die in `facts.photo_ids` staan.
   - Filmstrip (`film`): 8 sterke, verschillende foto's.
   - `grid`: 12–16 foto's, met 4 filters die passen bij het werk.
   - Gebruik nooit logo's, iconen, banners met tekst of foto's met een watermerk als projectfoto. Een bus of bedrijfsauto mag wel, bijvoorbeeld bij de stap "Prijs".
6. **Kleuren.** Kies ALLEEN uit `facts.logo_colors` (zichtbare logopixels) en kleuren die je duidelijk in het logo op `logos.jpg` ziet.
   - Kleuren van het websitethema (WordPress-blauw #0693e3, #00d084, one.com-blauw, enzovoort) horen NIET bij het merk.
   - `ink` is de donkerste merkkleur (zwart, marine of bruin). Heeft het logo geen donkere kleur, gebruik dan `#1C1615`.
   - `accent` is de opvallendste merkkleur. Kies de **felste, meest poppende variant** uit het logo, niet een doffe tint.
   - Contrast van accent op ink moet minstens 4,5 zijn.
   - Heeft het logo een kleurverloop (bijvoorbeeld donkergroen naar limoen), zet dan `"cta_gradient": [donker, midden, licht]` in `brand`.
7. **Thema.**
   - `"licht"`: het logo is vooral wit, rood of zwart op wit.
   - `"donker"`: het logo heeft een sterke donkere merkkleur (marine, zwart, donkergroen).
   - Is de huidige site zelf helemaal zwart of donker, zet dan ook `"alldark": true` en `"hero_glow": false`.
   - Bij `"licht"` altijd `"hero_glow": false`.
8. **Hero.** `line1` + `word` vormen de kop, meestal "Schilder in" + hoofdplaats.
   - `word` is maximaal 11 tekens. Is de plaatsnaam langer, gebruik dan line1 "Uw schilder" en word "in de regio".
   - `pill`: kort, maximaal 30 tekens.
   - `sub`: wat ze doen en voor wie, waarbij het tweede deel tussen `<span>` en `</span>` staat.
   - `usps`: 3 USP's van de site, elk maximaal 34 tekens.
9. **Spreuk.** Gebruik een bestaande zin van de site als dat kan, anders een korte eigen zin. `mark` is de laatste woord(en).
10. **Werkgebied.**
    - `area.latlon` zijn de coördinaten van de vestigingsplaats.
    - `pc_ranges` zijn de postcodereeksen binnen ongeveer `km` km.
    - `places` zijn 12 echte plaatsen in de buurt.
11. **Diensten** (precies 6), in de vorm `[koptekst met &shy; voor lange woorden, titel, korte zin, uitleg, [3 punten], "#pN", "c1".."c6"]`.
12. **Meta.**
    - Gebruik telefoon, e-mail en adres van de site.
    - Ontbreekt de straat, laat `street` en `postcode` dan leeg ("").
    - `hours` mag je verzinnen ("ma–vr 07.30–17.00"), maar zet het dan in `footer.example_note`.
13. **Logo.** Staat het logo op een effen gekleurde achtergrond (bijvoorbeeld zwart), zet dan `"knockout": "#000000"` en `"plate": false` in `logo`. Anders laat je `logo` leeg (`{}`).
14. **Verkoop.** Het argument is voor dezelfde klussen meer betaald krijgen en betere klussen aangeboden krijgen. Dat staat NIET op de demo zelf, maar bepaalt wel de toon: vakmanschap en kwaliteit, niet goedkoop.
15. **Controle.** Zet alles wat je zelf invult en niet zeker weet in `"_check": [..]`.
