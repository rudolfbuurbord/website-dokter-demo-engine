/* Kachel-template van De Website Dokters. Alle inhoud komt uit window.KACHEL (content.json). */
var K = window.KACHEL || {};
function openMenu(){document.getElementById('menu').classList.add('open');document.body.style.overflow='hidden'}
function closeMenu(){document.getElementById('menu').classList.remove('open');document.body.style.overflow=''}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeMenu()});
function $(s,r){return (r||document).querySelector(s)}
function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var ICO=K.icons||{};

/* ---------- Kachelkiezer: vragen volgen uit wat het bedrijf verkoopt ---------- */
(function(){
  var panel=$('#kzp');if(!panel)return;
  var P=K.producten||[],webshop=K.webshop;
  var TYPES={
    hout:{t:'Verwarmen',s:'Echt vuur en warmte in huis',titel:'Voor warmte in huis'},
    fornuis:{t:'Verwarmen én koken',s:'Met kookplaat en bakoven',titel:'Verwarmen én koken'},
    pellet:{t:'Automatisch stoken',s:'Pellets, met thermostaat of app',titel:'Gemak van pellets'},
    gas:{t:'Gemak van gas',s:'Vlammen met één druk op de knop',titel:'Sfeer met gas'},
    sfeer:{t:'Alleen sfeer',s:'Zonder schoorsteen',titel:'Sfeer zonder schoorsteen'},
    'buiten-koken':{t:'Koken op vuur',s:'Bakken, braden en grillen',titel:'Koken op vuur, buiten'},
    'buiten-warm':{t:'Warmte & sfeer',s:'Lange avonden in de tuin',titel:'Warmte op het terras'},
    'buiten-sfeer':{t:'Vuur om omheen te zitten',s:'Vuurschalen en driepoten',titel:'Vuur & gezelligheid'}
  };
  var BINNEN=['hout','fornuis','pellet','gas','sfeer'],BUITEN=['buiten-koken','buiten-warm','buiten-sfeer'];
  function of(t){return P.filter(function(p){return p.type===t})}
  var hasB=BINNEN.filter(function(t){return of(t).length}),hasO=BUITEN.filter(function(t){return of(t).length});
  var steps=$$('#kiezer .steps i'),total=(hasB.length&&hasO.length?1:0)+1+1,st={};
  steps.forEach(function(s,i){s.style.display=i<total?'':'none'});
  function pimg(p){return '<img class="'+(p.uitgesneden?'c':'ph-warm')+'" src="img/'+esc(p.foto)+'" alt="">'}
  function opt(a,label,sub,inner,cls){return '<button class="opt '+(cls||'')+'" data-a="'+a+'"><div class="im">'+inner+'</div><div class="tx"><b>'+label+'</b><small>'+sub+'</small></div></button>'}
  function q(no,title,opts,n){var nn=Math.min(n,3);return '<div class="q on"><span class="q-no">Vraag '+no+' van '+total+'</span><h3>'+title+'</h3><div class="opts '+(nn>2?'three':'')+'" style="--n:'+nn+'">'+opts+'</div></div>'}
  function bars(k){steps.forEach(function(b,i){b.classList.toggle('on',i<k)})}
  function typeOpts(list){return list.map(function(t){var p=of(t).filter(function(x){return x.foto})[0]||{};return opt(t,TYPES[t].t,TYPES[t].s,p.foto?pimg(p):'')}).join('')}
  function start(){st={};
    if(hasB.length&&hasO.length){panel.innerHTML=q(1,'Waar wilt u het vuur?',opt('binnen','Binnen','In de woonkamer of keuken',pimg(of(hasB[0]).filter(function(x){return x.foto})[0]||{}))+opt('buiten','Buiten','Op het terras of onder de overkapping',pimg(of(hasO[0]).filter(function(x){return x.foto})[0]||{})),2);bars(1)}
    else soort(hasB.length?'binnen':'buiten')}
  function soort(w){st.w=w;var list=w==='binnen'?hasB:hasO;var no=(hasB.length&&hasO.length)?2:1;
    if(list.length===1)return na(list[0]);
    panel.innerHTML=q(no,w==='binnen'?'Wat wilt u ermee doen?':'Wat zoekt u buiten?',typeOpts(list),list.length);bars(no)}
  function na(t){st.t=t;var withM2=of(t).filter(function(p){return p.m2}).length>1;
    if(withM2&&BINNEN.indexOf(t)>-1){var no=total;
      panel.innerHTML=q(no,'Hoe groot is de ruimte?',opt('40','Tot 60 m²','Kamer of kleine woonkamer','<span class="sq" style="width:34px;height:34px"></span>','size')+opt('90','60 tot 120 m²','Woonkamer met open keuken','<span class="sq" style="width:56px;height:56px"></span>','size')+opt('150','Meer dan 120 m²','Groot huis of hele benedenverdieping','<span class="sq" style="width:80px;height:80px"></span>','size'),3);bars(no)}
    else result(t,null)}
  function score(p,m){var s=0;if(m&&p.m2){var lo=p.m2[0],hi=p.m2[1];s+=(m>=lo&&m<=hi)?10:-Math.min(Math.abs(m-lo),Math.abs(m-hi))/10;
      var mid=(lo+hi)/2;s-=Math.abs(m-mid)/100}if(p.badge)s+=1;if(p.waarom)s+=.5;return s}
  function card(p){var specs=[p.kw,p.m2?p.m2[0]+'–'+p.m2[1]+' m²':'',p.kenmerk].filter(Boolean);
    var btn=webshop&&p.url?'<a class="btn btn-shop" href="'+esc(p.url)+'" target="_blank" rel="noopener">'+esc(K.knop_product||'Bekijk in de webshop')+'</a>':'<a class="btn btn-shop" href="#bezoek">Vraag advies over deze kachel</a>';
    return '<article class="card"><div class="im">'+(p.badge?'<span class="badge">'+esc(p.badge)+'</span>':'')+pimg(p)+'</div><div class="bd"><h3>'+esc(p.naam)+'</h3>'+(p.waarom?'<p class="why">'+esc(p.waarom)+'</p>':'')+'<div class="specs">'+specs.map(function(s){return '<span>'+esc(s)+'</span>'}).join('')+'</div>'+(p.prijs?'<div class="pr"><b>€ '+esc(p.prijs)+'</b><span class="vat">incl. btw</span></div>':'')+btn+(webshop?'<p class="alt">Twijfelt u? <a href="#bezoek">Laat '+esc(K.mensen_kort||'ons')+' u adviseren</a></p>':'')+'</div></article>'}
  function result(t,m){var list=of(t).slice().sort(function(a,b){return score(b,m)-score(a,m)}).slice(0,2);
    var as=(K.zekerheden||[]).map(function(z){return '<span>'+(ICO[z[0]]||'')+' '+esc(z[1])+'</span>'}).join('');
    panel.innerHTML='<div class="q on"><div class="res-head"><div><span class="q-no">Ons advies</span><h3 style="margin-bottom:22px">'+TYPES[t].titel+'</h3></div><button class="again" id="again">'+(ICO.back||'')+' Opnieuw kiezen</button></div><div class="res" style="grid-template-columns:repeat('+Math.min(list.length,2)+',1fr)">'+list.map(card).join('')+'</div>'+(as?'<div class="assure res-assure">'+as+'</div>':'')+'</div>';bars(total);
    $('#again').onclick=start}
  panel.addEventListener('click',function(e){var o=e.target.closest('.opt');if(!o)return;var a=o.dataset.a;
    if(a==='binnen'||a==='buiten')soort(a);else if(TYPES[a])na(a);else result(st.t,+a);
    if(innerWidth<900)panel.scrollIntoView({behavior:'smooth',block:'start'})});
  start();
})();

/* ---------- winkelstatus uit openingstijden.per_dag ---------- */
(function(){
  var pd=(K.openingstijden||{}).per_dag||{};
  function status(){var n=new Date(),d=n.getDay(),m=n.getHours()*60+n.getMinutes(),r=pd[d],txt,cl;
    if(Array.isArray(r)&&m>=r[0]&&m<r[1]){cl=r[1]-m<=30?'soon':'open';txt=cl==='soon'?'Nu open · sluit binnenkort':'Nu open'}
    else if(r==='afspraak'){cl='soon';txt='Vandaag op afspraak'}else{cl='closed';txt='Nu gesloten'}
    $$('[data-status]').forEach(function(el){el.querySelector('.dot').className='dot '+cl;el.querySelector('.st').textContent=txt})}
  status();setInterval(status,60000);
})();

/* ---------- startpakket ---------- */
(function(){var f=$('#chk');if(!f)return;function t(){var s=0;$$('input[data-p]',f).forEach(function(c){if(c.checked)s+=+c.dataset.p});$('#chkTot').textContent='€ '+s.toLocaleString('nl-NL')}f.addEventListener('change',t);t()})();

/* ---------- FAQ-chat ---------- */
(function(){
  var b=$('#chatb'),qk=$('#quick'),f=$('#chatf'),inp=$('#chati');if(!b)return;
  var FAQ=K.faq||[],asked={},busy=false;
  function t(){var d=new Date();return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2)}
  function add(cls,html){var m=document.createElement('div');m.className='msg '+cls;m.innerHTML=html+'<time>'+t()+'</time>';b.appendChild(m);b.scrollTop=b.scrollHeight}
  function chips(){qk.innerHTML='';FAQ.forEach(function(x,i){if(asked[i])return;var c=document.createElement('button');c.type='button';c.textContent=x.q;c.onclick=function(){ask(i)};qk.appendChild(c)});qk.style.display=qk.children.length?'flex':'none'}
  function reply(html){busy=true;var ty=document.createElement('div');ty.className='typing';ty.innerHTML='<i></i><i></i><i></i>';b.appendChild(ty);b.scrollTop=b.scrollHeight;
    setTimeout(function(){ty.remove();add('them',html);busy=false;chips()},900+Math.min(html.length*6,900))}
  function ask(i){if(busy)return;asked[i]=1;add('me',esc(FAQ[i].q));qk.innerHTML='';reply(FAQ[i].a)}
  f.addEventListener('submit',function(e){e.preventDefault();if(busy)return;var v=inp.value.trim();if(!v)return;inp.value='';add('me',esc(v));
    var w=v.toLowerCase(),best=-1,sc=0;FAQ.forEach(function(x,i){var s=0;(x.k||x.q).toLowerCase().split(' ').forEach(function(k){if(k.length>2&&w.indexOf(k)>-1)s++});if(s>sc){sc=s;best=i}});
    if(best>-1){asked[best]=1;reply(FAQ[best].a)}else reply('Goede vraag! Stel hem via het <a href="#bezoek">formulier onderaan</a>, dan antwoorden we u persoonlijk.')});
  var started=false;function go(){if(started)return;started=true;setTimeout(function(){reply('Hallo! 👋 Waar kunnen we u mee helpen?')},400)}
  if('IntersectionObserver' in window)new IntersectionObserver(function(es,o){if(es[0].isIntersecting){go();o.disconnect()}},{threshold:.3}).observe($('#chat'));else go();
})();

/* ---------- verhalen ---------- */
(function(){var tr=$('#track');if(!tr)return;
  $$('[data-st]').forEach(function(b){b.addEventListener('click',function(){var c=tr.querySelector('.story');tr.scrollBy({left:(c.getBoundingClientRect().width+18)*+b.dataset.st,behavior:'smooth'})})});
  if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){e.target.classList.toggle('play',e.isIntersecting)})},{threshold:.6});$$('.story',tr).forEach(function(s){io.observe(s)})}
})();

/* ---------- bezoek: tabs, dagen, tijden, formulieren ---------- */
(function(){
  $$('#planner .tabs button').forEach(function(b){b.addEventListener('click',function(){
    $$('#planner .tabs button').forEach(function(x){x.setAttribute('aria-selected',x===b)});
    $$('#planner .pane').forEach(function(p){p.classList.toggle('on',p.dataset.pane===b.dataset.tab)})})});
  var D=$('#days'),S=$('#slots'),sum=$('#sum'),pd=(K.openingstijden||{}).per_dag||{};
  if(D){
    var names=['zo','ma','di','wo','do','vr','za'],full=['zondag','maandag','dinsdag','woensdag','donderdag','vrijdag','zaterdag'],mon=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'],sel={},c=0,dt=new Date();
    while(c<10){dt.setDate(dt.getDate()+1);var w=dt.getDay(),r=pd[w];if(!r)continue;
      var b=document.createElement('button');b.type='button';b.setAttribute('aria-pressed','false');b.dataset.w=w;b.dataset.l=full[w]+' '+dt.getDate()+' '+mon[dt.getMonth()];
      b.innerHTML='<small>'+names[w]+'</small><b>'+dt.getDate()+'</b><i>'+(r==='afspraak'?'afspraak':mon[dt.getMonth()])+'</i>';D.appendChild(b);c++}
    function slots(w){var r=pd[w],a=[];if(Array.isArray(r)){for(var m=r[0];m<=r[1]-60;m+=60)a.push(('0'+Math.floor(m/60)).slice(-2)+':'+('0'+m%60).slice(-2))}else a=['10:00','13:00','15:00','19:00'];
      S.innerHTML=a.map(function(t){return '<button type="button" aria-pressed="false">'+t+'</button>'}).join('')}
    function upd(){sum.textContent=sel.d?(sel.t?'Uw bezoek: '+sel.d+' om '+sel.t+' uur.':'Kies nog een tijd op '+sel.d+'.'):'Kies een dag en tijd.'}
    D.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;$$('button',D).forEach(function(x){x.setAttribute('aria-pressed',x===b)});sel.d=b.dataset.l;sel.t=null;slots(+b.dataset.w);upd()});
    S.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;$$('button',S).forEach(function(x){x.setAttribute('aria-pressed',x===b)});sel.t=b.textContent;upd()});
    if(D.querySelector('button'))D.querySelector('button').click();
    $('#bform').addEventListener('submit',function(e){e.preventDefault();var m=this.querySelector('.pmsg');if(!sel.t){m.textContent='Kies nog een tijd.';return}
      m.textContent='Dank u wel! In de echte website krijgt u nu een bevestiging voor '+sel.d+' om '+sel.t+' uur. Dit is een voorbeeld, er is niets verstuurd.'});
  }
  function normNL(v){var s=(v||'').replace(/[^\d+]/g,'');if(s.indexOf('+31')===0)s='0'+s.slice(3);else if(s.indexOf('0031')===0)s='0'+s.slice(4);s=s.replace(/\D/g,'');if(s.length===9&&s[0]!=='0')s='0'+s;return /^0\d{9}$/.test(s)?s:null}
  ['#cform','#tform'].forEach(function(id){var f=$(id);if(!f)return;f.addEventListener('submit',function(e){e.preventDefault();var t=f.querySelector('input[type=tel]'),m=f.querySelector('.pmsg');
    if(!normNL(t.value)){m.textContent='Dat telefoonnummer klopt nog niet helemaal, bijvoorbeeld 06 12345678.';t.focus();return}
    m.textContent='Dank u wel. In de echte website komt uw aanvraag direct binnen. Dit is een voorbeeld, er is niets verstuurd.'})});
  var nb=$('#nform');if(nb)nb.addEventListener('submit',function(e){e.preventDefault();nb.parentNode.querySelector('.nmsg').textContent='Dank u wel! (voorbeeld, er is niets verstuurd)'});
})();

/* ---------- slimme vaste knop op mobiel ---------- */
(function(){var st=$('#sticky'),sb=$('#stickyBtn');if(!st)return;
  var shopHref=sb.getAttribute('href'),shopTxt=sb.textContent,isShop=!!K.webshop;
  window.addEventListener('scroll',function(){var h=innerHeight,bz=$('#bezoek'),rb=bz?bz.getBoundingClientRect():{top:1e9,bottom:-1};
    st.classList.toggle('show',scrollY>h*.8&&!(rb.top<h&&rb.bottom>0));
    if(!isShop)return;var soft=['over','verhalen','faq'].some(function(id){var e=document.getElementById(id);if(!e)return false;var r=e.getBoundingClientRect();return r.top<h*.6&&r.bottom>h*.4});
    if(soft){sb.textContent='Plan een bezoek';sb.href='#bezoek';sb.removeAttribute('target')}else{sb.textContent=shopTxt;sb.href=shopHref;sb.target='_blank'}
  },{passive:true});
})();

/* ---------- onthullen bij scrollen ---------- */
(function(){if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},{threshold:.12});$$('.reveal').forEach(function(el){io.observe(el)})}else $$('.reveal').forEach(function(el){el.classList.add('in')})})();
