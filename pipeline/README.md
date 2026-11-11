# Demo-pipeline (schilders)

Van website naar live demo op `demo.dewebsitedokters.nl/<naam>`.

```bash
pip install --break-system-packages jinja2 pillow playwright && python3 -m playwright install chromium
git clone https://github.com/rudolfbuurbord/website-dokter-demo-engine /home/claude/website-dokter-demo-engine
cd /home/claude/website-dokter-demo-engine/pipeline

python3 maak_demo.py start https://voorbeeldschilder.nl voorbeeld   # ± 15 s: uitlezen + kleuren meten
#   → palet voorstellen aan Rudolf, na akkoord /home/claude/demos/voorbeeld/content.json schrijven (regels: prompt.md)
python3 maak_demo.py publish voorbeeld                              # ± 2 min: bouwen, testen, live
```

- `scrape.py`: leest de site, de foto's, het logo en de zichtbare logokleuren uit.
- `build.py`: bouwt de site uit `content.json` (thema `donker`, `licht` of `merk`). Stopt als de kleuren niet in het logo of de CSS voorkomen.
- `qa.py`: test met Playwright op overflow, consolefouten en kapotte foto's bij 390 en 1280 px, en maakt screenshots.
- `maak_demo.py publish`:
  - kopieert de site naar `public/<naam>/` en zet de naam in `src/static-demos.js`;
  - pusht naar main en wacht op de deploy-workflow;
  - controleert de live link.

Een vierkant logo met slogan eronder? Snijd er een liggende versie van (merkteken + naam) en zet die in `content.json` als `logo.file`.
