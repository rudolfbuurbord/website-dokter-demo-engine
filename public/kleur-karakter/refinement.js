(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const behavior = () => reduced.matches ? 'auto' : 'smooth';
  const track = document.querySelector('.project-track');
  const cards = [...track.querySelectorAll('.project-card')];
  let active = 1, scrollTimer;
  function markProject(index) {
    active = index;
    cards.forEach((card, i) => {card.classList.toggle('active',i===index);card.setAttribute('aria-pressed',String(i===index));});
    document.querySelector('#project-count').textContent = String(index+1).padStart(2,'0');
  }
  function centerProject(index, instant=false) {
    markProject((index+cards.length)%cards.length);
    const card=cards[active];
    track.scrollTo({left:card.offsetLeft-(track.clientWidth-card.offsetWidth)/2,behavior:instant?'auto':behavior()});
  }
  cards.forEach((card,i)=>{
    card.addEventListener('click',()=>centerProject(i));
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();centerProject(i)}});
  });
  document.querySelectorAll('[data-direction]').forEach(button=>button.addEventListener('click',()=>centerProject(active+Number(button.dataset.direction))));
  track.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();centerProject(active+(e.key==='ArrowRight'?1:-1))}});
  track.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{
    const center=track.scrollLeft+track.clientWidth/2;
    let nearest=0;
    cards.forEach((card,i)=>{if(Math.abs(card.offsetLeft+card.offsetWidth/2-center)<Math.abs(cards[nearest].offsetLeft+cards[nearest].offsetWidth/2-center))nearest=i});
    markProject(nearest);
  },140)},{passive:true});
  requestAnimationFrame(()=>centerProject(1,true));
  new ResizeObserver(()=>centerProject(active,true)).observe(track);
  const scenes=[
    {key:'room',eyebrow:'01 / De hele ruimte',title:'Van kaal<br>naar <em>karakter.</em>',description:'Van onbewerkt beton naar een rustige, geschilderde woonkamer. Dezelfde ruimte, hetzelfde licht — het verschil zit in het oppervlak.',before:'Illustratie: woonkamer met onbewerkt beton',after:'Illustratie: dezelfde woonkamer met geschilderde wanden'},
    {key:'detail',eyebrow:'02 / Het zit in de details',title:'Een lijn.<br>Een groot <em>verschil.</em>',description:'Een rafelige aansluiting of een haarscherpe verflijn. Bekijk van dichtbij wat zorgvuldig afplakken en nauwkeurig afwerken kunnen betekenen.',before:'Illustratie: onregelmatige verfrand langs het plafond',after:'Illustratie: dezelfde aansluiting met een strakke verflijn'},
    {key:'frame',eyebrow:'03 / Aandacht voor houtwerk',title:'Van verweerd<br>naar <em>verzorgd.</em>',description:'Afgebladderde verf maakt plaats voor een gladde laklaag. Een zorgvuldig voorbereid kozijn laat zien hoeveel verschil de afwerking maakt.',before:'Illustratie: kozijn met verweerde en afgebladderde verf',after:'Illustratie: hetzelfde kozijn met een gladde laklaag'}
  ];
  const compare=document.querySelector('.compare'),range=compare.querySelector('input');
  const before=compare.querySelector('.compare-before img'),after=compare.querySelector('.compare-after-image');
  const tabs=[...document.querySelectorAll('[data-scene]')],status=document.querySelector('.comparison-status');
  let scene=0,request=0;
  const positions=[50,50,50];
  function setPosition(value){compare.style.setProperty('--position',value+'%');range.value=value;positions[scene]=Number(value);range.setAttribute('aria-valuetext',value+' procent van het voor-beeld zichtbaar')}
  range.addEventListener('input',()=>setPosition(range.value));setPosition(50);
  const cache=new Map();
  const embedded=JSON.parse(document.querySelector('#inline-media')?.textContent||'{}');
  const imageURL=name=>embedded[name]||'/kleur-karakter/media/'+name+'.webp';
  function getImage(src){if(!cache.has(src)){const image=new Image();image.src=src;cache.set(src,image.decode())}return cache.get(src)}
  async function selectScene(index){
    index=(index+scenes.length)%scenes.length;const ticket=++request,s=scenes[index];
    const beforeSrc=imageURL(s.key+'-before'),afterSrc=imageURL(s.key+'-after');
    status.textContent='';
    const loading=setTimeout(()=>{if(ticket===request)status.textContent='Vergelijking laden…'},200);
    try{await Promise.all([getImage(beforeSrc),getImage(afterSrc)]);if(ticket!==request)return;
      before.src=beforeSrc;after.src=afterSrc;before.alt=s.before;after.alt=s.after;scene=index;
      document.querySelector('.ba-eyebrow').textContent=s.eyebrow;
      document.querySelector('#before-title').innerHTML=s.title;
      document.querySelector('.ba-description').textContent=s.description;
      document.querySelector('.compare-count').textContent=String(index+1).padStart(2,'0')+' / 03';
      tabs.forEach((tab,i)=>tab.setAttribute('aria-pressed',String(i===index)));setPosition(positions[index]);
      const copy=document.querySelector('.ba-copy');copy.classList.remove('comparison-copy-enter');requestAnimationFrame(()=>copy.classList.add('comparison-copy-enter'));
      status.textContent='';
    }catch{if(ticket===request)status.textContent='Dit beeld kon niet laden. Kies het onderwerp opnieuw om te proberen.';cache.delete(beforeSrc);cache.delete(afterSrc)}finally{clearTimeout(loading)}
  }
  tabs.forEach((tab,i)=>tab.addEventListener('click',()=>selectScene(i)));
  document.querySelector('.compare-prev').addEventListener('click',()=>selectScene(scene-1));
  document.querySelector('.compare-next').addEventListener('click',()=>selectScene(scene+1));
  // Swipe between comparisons on the caption, keeping the image itself reserved for the before/after control.
  const caption=document.querySelector('.comparison-caption');let touchStart;
  caption.addEventListener('touchstart',e=>{touchStart=e.changedTouches[0].clientX},{passive:true});
  caption.addEventListener('touchend',e=>{const delta=e.changedTouches[0].clientX-touchStart;if(Math.abs(delta)>45)selectScene(scene+(delta<0?1:-1))},{passive:true});
  const menu=document.querySelector('#site-menu'),toggle=document.querySelector('.menu-toggle');
  function closeMenu(){menu.classList.remove('is-open');toggle.setAttribute('aria-expanded','false')}
  toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';menu.classList.toggle('is-open',open);toggle.setAttribute('aria-expanded',String(open))});
  menu.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu()});
  document.addEventListener('click',e=>{if(!e.target.closest('.site-nav'))closeMenu()});
  const dialog=document.querySelector('#enquiry-dialog');
  document.querySelector('.open-enquiry').addEventListener('click',()=>dialog.showModal());
  document.querySelector('.close-dialog').addEventListener('click',()=>dialog.close());
  document.querySelector('.contact-demo').addEventListener('click',()=>{document.querySelector('.contact-note').textContent='In deze conceptdemo is nog geen echt telefoonnummer gekoppeld.'});
  document.querySelector('#enquiry-form').addEventListener('submit',e=>{e.preventDefault();document.querySelector('.form-feedback').textContent='Je aanvraag is compleet ingevuld. Dit is een demo: je gegevens zijn niet verstuurd of opgeslagen.'});
})();
