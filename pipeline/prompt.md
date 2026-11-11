# Opdracht voor het invulmodel (Haiku/Sonnet met beeld)

Je krijgt: `facts.json` (teksten per pagina, telefoon, e-mail, kleuren uit de CSS), `sheet.jpg` (foto's met id #p0, #p1 …) en `logos.jpg` (logo-kandidaten, beste eerst).
Je levert ALLEEN `content.json` volgens het schema van `vanas/content.json`. Geen HTML.

Regels
1. Schrijf in de toon van het bedrijf (u-vorm tenzij de site je-vorm gebruikt). Kort, concreet, zonder opgeblazen claims.
2. Gebruik feiten van de site letterlijk: diensten, jaartal, werkgebied, beloftes, aantallen. Verzin GEEN keurmerken, certificaten, aantallen, prijzen of awards.
3. Zekerheden (trust.cards): alleen echte feiten van de site. Te weinig? Gebruik hun beloftes (bijv. "Afspraak is afspraak"). Zet "example": true bij alles wat niet op de site staat.
4. Reviews: staan er echte reviews op de site, gebruik die en zet `example:false`. Anders 8 korte, geloofwaardige voorbeeldreviews met plaatsnamen uit het werkgebied en `example:true`.
5. Foto's: kies via `#pN`. Hero-filmstrip: 8 sterkste gevelfoto's (geen close-ups). Grid: 12–16 beste, gelabeld met filters. Gebruik geen foto twee keer in de filmstrip. Logo's, iconen en stockfoto's met watermerk nooit als projectfoto.
6. Kleuren: kies ALLEEN uit `facts.logo_colors` (zichtbare logopixels) en `facts.colors` (CSS). Nooit een kleur die je alleen op het contactvel ziet. `ink` = donkerste merkkleur (navy/zwart/bruin), `accent` = opvallendste merkkleur die in beide lijsten (of bovenaan de CSS) voorkomt. Contrast accent op ink moet minstens 4,5 zijn; anders een lichtere tint van het accent.
7. Hero: `line1` + `word` vormen de kop, `word` = hoofdplaats van het werkgebied (maximaal 10 tekens, anders "Schilderwerk" als word en line1 leeg). `sub` zegt wat + voor wie. 3 USP's van de site.
8. Spreuk: een bestaande zin van de site als dat kan, anders een korte eigen zin. `mark` = laatste woord(en).
9. `area.latlon` = coördinaten van het vestigingsadres; `pc_ranges` = postcodes binnen ca. `km` km.
10. Markeer alles wat je zelf invult en niet zeker weet in `"_check": [..]` zodat een mens het in 30 seconden kan nalopen.
11. Logo: zet `"plate": true` als het logo grote zwarte of donkere vlakken heeft (badge, schaduw); dan staat het origineel op een licht plaatje in de donkere balk.
12. Thema: `"theme": "donker" | "licht" | "merk"` komt uit de keuze van de klant in de configurator. Niet zelf kiezen; standaard "donker".
