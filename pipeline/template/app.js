<script>
(()=>{
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* bereikbaarheid (Europe/Amsterdam) */
try{
  const p=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(new Date());
  const g=t=>p.find(x=>x.type===t)?.value, wd=g('weekday'), t=+g('hour')*60+ +g('minute'), wk=!/za|zo/i.test(wd);
  const c=(wk&&t>=450&&t<1020)?'':(wk&&t<1200&&t>=1020)?'o':'r';
  ['#live','#live2'].forEach(s=>{const e=$(s);if(e)e.className='live '+c});
}catch(e){}

/* filmstrip hero */
const F=D.film;
const film=$('#film');
const fig=f=>`<figure><img src="img/f_${f[0]}.webp" alt="${f[1]}" loading="lazy"><figcaption>${f[1]}</figcaption></figure>`;
film.innerHTML=F.map(fig).join('')+F.map(fig).join('');
if(reduce)film.style.animation='none';

/* reveal */
const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}}),{threshold:.15});
$$('.rv').forEach(el=>io.observe(el));

/* referenties */
const P=D.grid;
const grid=$('#grid');
P.forEach((p,i)=>{const b=document.createElement('button');b.className='gitem';b.type='button';b.dataset.c=p[1];b.dataset.i=i;b.setAttribute('aria-label','Bekijk foto: '+p[2]);
 b.innerHTML=`<img loading="lazy" src="img/${p[0]}.webp" alt="${p[2]}">`;b.onclick=()=>openLb(i);grid.appendChild(b)});
$$('.filters button').forEach(b=>b.onclick=()=>{$$('.filters button').forEach(x=>x.setAttribute('aria-pressed',x===b));const f=b.dataset.f;$$('.gitem').forEach(g=>g.classList.toggle('hide',f!=='all'&&g.dataset.c!==f))});
let cur=0;const lb=$('#lb');
const vis=()=>$$('.gitem:not(.hide)').map(g=>+g.dataset.i);
function openLb(i){cur=i;$('#lbimg').src=`img/${P[i][0]}.webp`;$('#lbimg').alt=P[i][2];$('#lbcap').textContent=P[i][2];lb.classList.add('on');$('#lbx').focus()}
function step(d){const v=vis();let k=v.indexOf(cur);openLb(v[(k+d+v.length)%v.length])}
$('#lbx').onclick=()=>lb.classList.remove('on');$('#lbp').onclick=()=>step(-1);$('#lbn').onclick=()=>step(1);
lb.onclick=e=>{if(e.target===lb)lb.classList.remove('on')};
addEventListener('keydown',e=>{if(!lb.classList.contains('on'))return;if(e.key==='Escape')lb.classList.remove('on');if(e.key==='ArrowRight')step(1);if(e.key==='ArrowLeft')step(-1)});

/* diensten (teksten van smidts-schilders.nl) */
const S=D.services;
const sr=$('#srows');
S.forEach((s,i)=>{const d=document.createElement('div');d.className='srow';
 d.innerHTML=`<div class="srow-in"><span class="no">0${i+1}</span><div><h3>${s[0]}</h3><p class="s">${s[2]}</p>
 <button class="more" type="button" aria-expanded="false">Bekijk meer <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button></div>
 <div class="thumb"><img loading="lazy" src="img/${s[5]}.webp" alt="${s[1]}"></div></div>
 <div class="sdetail"><div><div class="sd-in"><span class="sp"></span><p class="full">${s[3]}</p><div><ul>${s[4].map(x=>`<li>${x}</li>`).join('')}</ul>
 <a class="btn btn-red" href="#offerte" data-chip="${s[6]}">Offerte voor ${s[1].toLowerCase()}</a></div></div></div></div>`;
 const btn=d.querySelector('.more');btn.onclick=()=>{const o=d.classList.toggle('open');btn.setAttribute('aria-expanded',o);btn.firstChild.textContent=o?'Minder ':'Bekijk meer '};
 d.querySelector('[data-chip]').onclick=e=>{$('#'+e.currentTarget.dataset.chip).checked=true};sr.appendChild(d)});
$$('.who-card').forEach(a=>a.addEventListener('click',()=>{$('#'+a.dataset.u).checked=true}));

/* scroll */
function onScroll(){$('#mbar').classList.toggle('on',scrollY>500);$('#nav').classList.toggle('scrolled',scrollY>40)}
addEventListener('scroll',onScroll,{passive:true});onScroll();

/* postcode */
$('#pcform').onsubmit=e=>{e.preventDefault();const v=$('#pc').value.replace(/\s/g,''),n=parseInt(v.slice(0,4),10),o=$('#pcout');
 if(!/^\d{4}/.test(v)){o.style.color='#B4471A';o.textContent='Vul de 4 cijfers van uw postcode in.';return}
 const near=D.pc.some(r=>n>=r[0]&&n<=r[1]);
 o.style.color=near?'#1E7B45':'var(--text)';o.textContent=near?'✓ Goed nieuws: u valt binnen ons werkgebied.':'Net buiten ons vaste gebied. Bel gerust, vaak kan het toch.'};

/* reviews: voorbeeld (geen reviews op de huidige site) */
const R=D.reviews;
const card=r=>`<article class="rcard"><span class="stars">★★★★★</span><p>“${r[1]}”</p><div class="who"><span class="av">${r[0][0]}</span><div><b>${r[0]}</b><small>${D.reviewsExample?'Voorbeeldreview':(D.reviewsSource||'Google-review')}</small></div></div></article>`;
$('#t1').innerHTML=R.slice(0,4).concat(R.slice(4,6)).map(card).join('').repeat(reduce?1:2);
$('#t2').innerHTML=R.slice(6).concat(R.slice(0,4)).map(card).join('').repeat(reduce?1:2);

/* formulier */
function normTel(v){let d=v.replace(/[^\d+]/g,'');if(d.startsWith('+31'))d='0'+d.slice(3);else if(d.startsWith('0031'))d='0'+d.slice(4);d=d.replace(/\D/g,'');return /^0\d{9}$/.test(d)?d:null}
$('#files').onchange=e=>{const n=e.target.files.length;$('#upl').textContent=n?`${n} foto${n>1?"'s":''} toegevoegd`:"Foto's toevoegen (optioneel)"};
function err(id,msg){$('#f-'+id).classList.toggle('err',!!msg);$('#e-'+id).textContent=msg||''}
$('#qf').onsubmit=e=>{e.preventDefault();let ok=true;
 const w=$('#wat').value.trim(),n=$('#naam').value.trim(),t=normTel($('#tel').value);
 err('wat',w.length<5?'Vertel in een paar woorden wat er moet gebeuren.':'');if(w.length<5)ok=false;
 err('naam',!n?'Hoe mogen we u noemen?':'');if(!n)ok=false;
 err('tel',!t?'Dit nummer klopt nog niet helemaal. Bijvoorbeeld 06 12345678.':'');if(!t)ok=false;
 if(!ok){($('.field.err textarea')||$('.field.err input')).focus();return}
 $('#doneT').textContent=`Bedankt, ${n.split(' ')[0]}!`;$('#doneTel').textContent=t.startsWith('06')?t.replace(/^(\d{2})(\d{4})(\d{4})$/,'$1-$2$3'):t.replace(/^(\d{3})(\d{3})(\d{2})(\d{2})$/,'$1 $2 $3 $4');
 $('#qfFields').style.display='none';$('#done').classList.add('on');$('#offerte').scrollIntoView({behavior:reduce?'auto':'smooth'})};
$('#again').onclick=()=>{$('#qf').reset();$('#done').classList.remove('on');$('#qfFields').style.display=''};

/* FAQ-chat */
const Q=D.faq;
const chat=$('#chat'),qs=$('#qs');
function add(c,h){const m=document.createElement('div');m.className='msg '+c;m.innerHTML=h;chat.appendChild(m);chat.scrollTop=chat.scrollHeight;return m}
add('j',D.faqHello);
let busy=false;
Q.forEach(q=>{const b=document.createElement('button');b.type='button';b.textContent=q[0];
 b.onclick=()=>{if(busy)return;busy=true;b.classList.add('asked');add('u',q[0]);const t=add('j','<span class="typing"><i></i><i></i><i></i></span>');t.style.padding='0';
  setTimeout(()=>{t.style.padding='';t.innerHTML=q[1];chat.scrollTop=chat.scrollHeight;busy=false},reduce?0:900);
  if(innerWidth<900)$('.phone').scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'})};qs.appendChild(b)});
})();
</script>
</body>
</html>
