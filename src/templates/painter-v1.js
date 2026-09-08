const esc = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const safeColor = (value, fallback) => /^#[0-9a-f]{3,8}$/i.test(String(value || "")) ? value : fallback;

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];

function renderServices(services) {
  const items = list(services);
  if (!items.length) return "";
  return `
    <section class="service-band" id="diensten">
      <div class="wrap service-grid">
        ${items.slice(0, 6).map((service, index) => {
          const title = typeof service === "string" ? service : service.title;
          const description = typeof service === "string" ? "" : service.description;
          return `<article class="service-card reveal"><span class="service-no">0${index + 1}</span><div><h3>${esc(title)}</h3>${description ? `<p>${esc(description)}</p>` : ""}</div></article>`;
        }).join("")}
      </div>
    </section>`;
}

function renderStats(stats) {
  const items = list(stats);
  if (!items.length) return "";
  return `<div class="stats reveal">${items.slice(0, 4).map(item => `<div><strong>${esc(item.value)}</strong><span>${esc(item.label)}</span></div>`).join("")}</div>`;
}

function renderProjects(projects) {
  const items = list(projects);
  if (!items.length) return "";
  return `
    <section id="projecten">
      <div class="wrap">
        <div class="section-head reveal"><div><span class="kicker">SELECTIE</span><h2>Werk dat voor zichzelf <em>spreekt.</em></h2></div></div>
        <div class="projects">${items.slice(0, 5).map((item, index) => `
          <article class="project reveal ${index === 2 ? "project-main" : ""}">
            ${item.image_url ? `<img src="${esc(item.image_url)}" alt="${esc(item.alt || item.title || "Project")}" loading="lazy">` : `<div class="project-placeholder"></div>`}
            <div class="project-overlay"><strong>${esc(item.title || "Project")}</strong>${item.subtitle ? `<span>${esc(item.subtitle)}</span>` : ""}</div>
          </article>`).join("")}</div>
      </div>
    </section>`;
}

function renderReviews(reviews, summary) {
  const items = list(reviews);
  if (!items.length) return "";
  const summaryHtml = summary && summary.rating ? `<div class="review-summary"><strong>${esc(summary.rating)}</strong><span>${esc(summary.count ? `${summary.count} reviews` : "reviews")}</span></div>` : "";
  return `
    <section id="reviews" class="soft-section">
      <div class="wrap">
        <div class="section-head reveal"><div><span class="kicker">ERVARINGEN</span><h2>Vertrouwen dat je kunt <em>zien.</em></h2></div>${summaryHtml}</div>
        <div class="reviews">${items.slice(0, 3).map(item => `<article class="review reveal"><div class="stars">★★★★★</div><p>“${esc(item.text)}”</p><footer>${esc(item.author || "Klant")}${item.location ? ` · ${esc(item.location)}` : ""}</footer></article>`).join("")}</div>
      </div>
    </section>`;
}

function renderProcess(process) {
  const items = list(process);
  if (!items.length) return "";
  return `
    <section class="soft-section" id="werkwijze">
      <div class="wrap split">
        <div class="reveal"><span class="kicker">WERKWIJZE</span><h2>Helder van eerste contact tot <em>oplevering.</em></h2></div>
        <div class="process-list">${items.slice(0, 5).map((item, index) => `<article class="process-item reveal"><span>${String(index + 1).padStart(2, "0")}</span><div><h3>${esc(item.title)}</h3>${item.description ? `<p>${esc(item.description)}</p>` : ""}</div></article>`).join("")}</div>
      </div>
    </section>`;
}

function renderAbout(about) {
  if (!about || (!about.title && !about.text)) return "";
  return `
    <section id="over">
      <div class="wrap about-grid">
        <div class="about-art reveal"><div class="paint-sample"></div></div>
        <div class="reveal"><span class="kicker">OVER ONS</span><h2>${esc(about.title || "Vakmanschap met aandacht.")}</h2>${about.text ? `<p class="lead">${esc(about.text)}</p>` : ""}</div>
      </div>
    </section>`;
}

export function renderPainterV1(demo) {
  const cfg = demo.config || {};
  const hero = cfg.hero || {};
  const contact = cfg.contact || {};
  const about = cfg.about || {};
  const theme = demo.theme || {};
  const bg = safeColor(theme.background, "#f4f1ea");
  const ink = safeColor(theme.ink, "#1b1f1a");
  const accent = safeColor(theme.accent, "#606a58");
  const accent2 = safeColor(theme.accent2, "#a58b68");
  const seo = demo.seo || {};
  const company = demo.company_name;
  const serviceItems = list(cfg.services);
  const primaryCta = hero.cta_label || "Offerte aanvragen";
  const ctaHref = contact.phone ? `tel:${String(contact.phone).replace(/\s+/g, "")}` : contact.email ? `mailto:${contact.email}` : "#contact";

  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(seo.title || `${company} — Demo`)}</title>
<meta name="description" content="${esc(seo.description || `Interactieve website-demo voor ${company}.`)}">
<meta name="robots" content="noindex,nofollow">
<style>
:root{--bg:${bg};--ink:${ink};--accent:${accent};--accent2:${accent2};--paper:#fffdf8;--muted:color-mix(in srgb,var(--ink) 58%,transparent);--line:color-mix(in srgb,var(--ink) 12%,transparent);--shadow:0 24px 70px rgba(28,24,18,.11)}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(180deg,color-mix(in srgb,var(--bg) 94%,white),var(--bg));color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow-x:hidden}a{color:inherit;text-decoration:none}.wrap{width:min(1180px,calc(100% - 44px));margin:auto}.kicker{font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;color:var(--accent)}.reveal{opacity:0;transform:translateY(24px);transition:.7s cubic-bezier(.2,.75,.2,1)}.reveal.in{opacity:1;transform:none}.nav{position:absolute;inset:0 0 auto;z-index:20;height:82px;display:flex;align-items:center}.nav-inner{display:flex;align-items:center;justify-content:space-between}.brand{font-weight:900;letter-spacing:-.03em;font-size:22px}.navlinks{display:flex;gap:28px;font-size:11px;font-weight:800}.actions{display:flex;align-items:center;gap:10px}.btn{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:14px 19px;background:var(--accent);color:white;font-size:11px;font-weight:850;box-shadow:0 10px 30px color-mix(in srgb,var(--accent) 25%,transparent);transition:.2s}.btn:hover{transform:translateY(-2px)}.btn-ghost{background:rgba(255,255,255,.65);color:var(--ink);border:1px solid var(--line);box-shadow:none}.hero{min-height:690px;padding:126px 0 70px;position:relative;overflow:hidden}.hero:before{content:"";position:absolute;width:760px;height:760px;border-radius:50%;right:-170px;top:-260px;background:radial-gradient(circle at 35% 35%,color-mix(in srgb,var(--accent2) 88%,white),var(--accent));box-shadow:0 50px 120px rgba(0,0,0,.16)}.hero:after{content:"";position:absolute;right:-40px;top:110px;width:520px;height:300px;border-radius:50%;background:linear-gradient(115deg,rgba(255,255,255,.32),transparent 48%);transform:rotate(-13deg)}.hero-grid{position:relative;z-index:2;display:grid;grid-template-columns:1.05fr .95fr;align-items:center;min-height:480px}.hero-copy{max-width:650px}.hero h1{font:500 clamp(58px,7vw,96px)/.88 Georgia,"Times New Roman",serif;letter-spacing:-.055em;margin:18px 0 24px}.hero p{max-width:560px;font-size:16px;line-height:1.75;color:var(--muted)}.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.hero-art{min-height:430px;position:relative}.float-card{position:absolute;border-radius:18px;background:rgba(255,255,255,.88);backdrop-filter:blur(18px);border:1px solid rgba(255,255,255,.6);box-shadow:var(--shadow);padding:18px;width:170px}.float-card strong{font:600 32px Georgia,serif;display:block}.float-card span{font-size:10px;color:var(--muted)}.float-a{left:14%;top:16%}.float-b{right:1%;bottom:18%}.color-chip{position:absolute;left:38%;bottom:8%;width:180px;padding:14px;background:rgba(255,255,255,.9);border-radius:16px;box-shadow:var(--shadow);transform:rotate(-5deg)}.swatches{display:flex;gap:6px;margin-top:10px}.swatches i{display:block;width:30px;height:30px;border-radius:7px;background:var(--accent)}.swatches i:nth-child(2){background:var(--accent2)}.swatches i:nth-child(3){background:color-mix(in srgb,var(--accent) 45%,white)}.swatches i:nth-child(4){background:color-mix(in srgb,var(--accent2) 40%,white)}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:20px;overflow:hidden;margin-top:8px}.stats>div{background:rgba(255,255,255,.7);padding:18px}.stats strong{display:block;font:600 28px Georgia,serif}.stats span{font-size:10px;color:var(--muted)}section{padding:88px 0}.service-band{position:relative;z-index:3;margin-top:-34px;padding:0}.service-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.service-card{display:flex;gap:18px;background:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.8);border-radius:20px;padding:22px;box-shadow:0 14px 45px rgba(28,24,18,.08)}.service-no{font:600 24px Georgia,serif;color:var(--accent2)}.service-card h3{font-size:14px;margin:2px 0 7px}.service-card p{font-size:12px;color:var(--muted);line-height:1.55;margin:0}.section-head{display:flex;align-items:end;justify-content:space-between;gap:30px;margin-bottom:32px}.section-head h2,.split h2,.about-grid h2{font:500 clamp(42px,5vw,68px)/.96 Georgia,"Times New Roman",serif;letter-spacing:-.045em;margin:10px 0 0}.section-head em,.split em{font-style:italic}.projects{display:grid;grid-template-columns:.9fr .9fr 1.2fr .9fr .9fr;gap:12px;align-items:end}.project{height:260px;border-radius:18px;overflow:hidden;position:relative;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 35%,white),var(--accent));box-shadow:0 14px 40px rgba(0,0,0,.08)}.project-main{height:330px}.project img{width:100%;height:100%;object-fit:cover}.project-placeholder{position:absolute;inset:0;background:linear-gradient(135deg,color-mix(in srgb,var(--accent2) 30%,white),var(--accent))}.project-overlay{position:absolute;inset:auto 0 0;padding:18px;color:white;background:linear-gradient(transparent,rgba(0,0,0,.75));padding-top:80px}.project-overlay strong{display:block;font:500 18px Georgia,serif}.project-overlay span{font-size:10px}.soft-section{background:rgba(255,255,255,.32)}.split{display:grid;grid-template-columns:.8fr 1.2fr;gap:70px;align-items:start}.process-list{border-top:1px solid var(--line)}.process-item{display:grid;grid-template-columns:70px 1fr;gap:16px;padding:20px 0;border-bottom:1px solid var(--line)}.process-item>span{font:500 20px Georgia,serif;color:var(--accent2)}.process-item h3{margin:0 0 6px;font-size:14px}.process-item p{margin:0;color:var(--muted);font-size:12px;line-height:1.6}.about-grid{display:grid;grid-template-columns:1fr 1fr;gap:70px;align-items:center}.about-art{height:430px;border-radius:26px;background:linear-gradient(145deg,color-mix(in srgb,var(--accent2) 55%,white),var(--accent));position:relative;overflow:hidden}.paint-sample{position:absolute;width:78%;height:78%;left:-8%;bottom:-8%;border-radius:50%;background:radial-gradient(circle at 35% 35%,rgba(255,255,255,.7),transparent 45%),var(--accent2);filter:blur(.2px)}.lead{font-size:17px;line-height:1.8;color:var(--muted)}.reviews{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.review{background:rgba(255,255,255,.88);padding:24px;border-radius:20px}.review p{font:500 20px/1.45 Georgia,serif}.review footer{font-size:10px;color:var(--muted)}.stars{letter-spacing:.08em;color:#e0a114}.review-summary{display:flex;align-items:baseline;gap:10px}.review-summary strong{font:600 34px Georgia,serif}.review-summary span{font-size:10px;color:var(--muted)}.cta{padding:68px 0}.cta-card{background:var(--ink);color:white;border-radius:28px;padding:42px;display:grid;grid-template-columns:1.2fr .8fr;gap:30px;align-items:center}.cta h2{font:500 clamp(40px,5vw,64px)/.95 Georgia,serif;margin:8px 0 0}.cta p{color:rgba(255,255,255,.7);line-height:1.7}.cta .btn{background:white;color:var(--ink)}.contact-lines{margin-top:16px;font-size:12px;line-height:1.9;color:rgba(255,255,255,.72)}.footer{padding:40px 0 28px;border-top:1px solid var(--line)}.footer-inner{display:flex;justify-content:space-between;gap:20px;align-items:center}.footer small{color:var(--muted)}.demo-badge{position:fixed;right:14px;bottom:14px;z-index:50;background:rgba(20,20,18,.88);color:white;border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(14px);padding:9px 12px;border-radius:999px;font-size:9px;letter-spacing:.12em;text-transform:uppercase}
@media(max-width:880px){.wrap{width:calc(100% - 28px)}.navlinks{display:none}.hero{min-height:auto;padding-top:104px}.hero:before{width:540px;height:540px;right:-330px;top:-140px}.hero-grid{grid-template-columns:1fr}.hero-art{min-height:300px}.float-a{left:0}.float-b{right:0}.color-chip{left:30%}.stats{grid-template-columns:1fr 1fr}.service-grid{grid-template-columns:1fr 1fr}.projects{display:flex;overflow-x:auto;scroll-snap-type:x mandatory}.project,.project-main{min-width:78vw;height:300px;scroll-snap-align:center}.split,.about-grid,.cta-card{grid-template-columns:1fr}.reviews{grid-template-columns:1fr}.footer-inner{display:block}.footer small{display:block;margin-top:8px}}
@media(max-width:520px){.actions .btn-ghost{display:none}.brand{font-size:18px}.hero h1{font-size:52px}.hero-art{min-height:250px}.float-card{width:145px}.service-grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.cta-card{padding:28px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.reveal{opacity:1;transform:none;transition:none}.btn{transition:none}}
</style>
</head>
<body>
<nav class="nav"><div class="wrap nav-inner"><a class="brand" href="#">${esc(company)}</a><div class="navlinks">${serviceItems.length ? `<a href="#diensten">Diensten</a>` : ""}${list(cfg.projects).length ? `<a href="#projecten">Projecten</a>` : ""}${about.title || about.text ? `<a href="#over">Over ons</a>` : ""}${list(cfg.reviews).length ? `<a href="#reviews">Reviews</a>` : ""}</div><div class="actions"><a class="btn btn-ghost" href="#contact">Contact</a><a class="btn" href="${esc(ctaHref)}">${esc(primaryCta)} →</a></div></div></nav>
<header class="hero"><div class="wrap hero-grid"><div class="hero-copy reveal"><span class="kicker">${esc(hero.eyebrow || company)}</span><h1>${esc(hero.title || company)}</h1>${hero.subtitle ? `<p>${esc(hero.subtitle)}</p>` : ""}<div class="hero-actions"><a class="btn" href="${esc(ctaHref)}">${esc(primaryCta)} →</a>${list(cfg.projects).length ? `<a class="btn btn-ghost" href="#projecten">Bekijk projecten</a>` : ""}</div>${renderStats(cfg.stats)}</div><div class="hero-art reveal"><div class="float-card float-a"><strong>${esc(serviceItems[0] && (typeof serviceItems[0] === "string" ? serviceItems[0] : serviceItems[0].title) || "Vakwerk")}</strong><span>uitgelicht in deze demo</span></div><div class="float-card float-b"><strong>${esc(serviceItems[1] && (typeof serviceItems[1] === "string" ? serviceItems[1] : serviceItems[1].title) || "Aandacht")}</strong><span>helder gepresenteerd</span></div><div class="color-chip"><span class="kicker">Kleurpalet</span><div class="swatches"><i></i><i></i><i></i><i></i></div></div></div></div></header>
${renderServices(cfg.services)}
${renderProjects(cfg.projects)}
${renderProcess(cfg.process)}
${renderAbout(about)}
${renderReviews(cfg.reviews, cfg.review_summary)}
<section class="cta" id="contact"><div class="wrap"><div class="cta-card reveal"><div><span class="kicker">CONTACT</span><h2>${esc(cfg.cta?.title || `Klaar om ${company} sterker online neer te zetten?`)}</h2></div><div>${cfg.cta?.text ? `<p>${esc(cfg.cta.text)}</p>` : ""}<a class="btn" href="${esc(ctaHref)}">${esc(primaryCta)} →</a><div class="contact-lines">${contact.phone ? `<div>${esc(contact.phone)}</div>` : ""}${contact.email ? `<div>${esc(contact.email)}</div>` : ""}${contact.location ? `<div>${esc(contact.location)}</div>` : ""}</div></div></div></div></section>
<footer class="footer"><div class="wrap footer-inner"><strong>${esc(company)}</strong><small>Interactieve conceptdemo door De Website Dokter</small></div></footer>
<div class="demo-badge">Demo · niet de live website</div>
<script>const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in')}),{threshold:.08});document.querySelectorAll('.reveal').forEach(el=>io.observe(el));</script>
</body></html>`;
}
