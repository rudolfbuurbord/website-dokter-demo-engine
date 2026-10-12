(() => {
  'use strict';
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const smooth=(a,b,v)=>{const x=clamp((v-a)/(b-a));return x*x*(3-2*x)};
  const ease=t=>1-Math.pow(1-clamp(t),3);
  const journey=$('.hero-journey'),hero=$('.hero'),art=$('.hero-art'),world=$('#paint-world');
  const ctx=world.getContext('2d'),source=document.createElement('canvas'),sc=source.getContext('2d',{willReadFrequently:true});
  source.width=768;source.height=432;
  const video=$('#ring-video'),poster=$('.sphere-poster');
  let W=0,H=0,dpr=1,heroH=0,artY=0,artH=0,artW=0,ready=false,lastFrame=-1,live=false,started=0,opening=true,raf=0;
  let panelTop=0,panelH=0,proofTop=0;
  function measure(){
    W=journey.clientWidth;H=journey.offsetHeight;heroH=hero.offsetHeight;
    const r=art.getBoundingClientRect(),j=journey.getBoundingClientRect();
    artY=r.top-j.top;artH=r.height;artW=r.width;
    dpr=Math.min(devicePixelRatio||1,1.5);world.width=Math.round(W*dpr);world.height=Math.round(H*dpr);
    world.style.width=W+'px';world.style.height=H+'px';ctx.setTransform(dpr,0,0,dpr,0,0);
    const p=$('#voor-na').getBoundingClientRect();panelTop=p.top+scrollY;panelH=p.height;
    proofTop=$('#reviews').getBoundingClientRect().top+scrollY;
    requestDraw();
  }
  function keyVideo(){
    if(video.readyState<2||Math.floor(video.currentTime*24)===lastFrame)return;
    lastFrame=Math.floor(video.currentTime*24);sc.drawImage(video,0,0,768,432);
    const f=sc.getImageData(0,0,768,432),p=f.data;
    for(let y=0;y<432;y++)for(let x=0;x<768;x++){
      const i=(y*768+x)*4,c=p[i]-Math.max(p[i+1],p[i+2]);
      let a=smooth(12,39,c);
      const core=((x-384)/156)**2+((y-199)/163)**2;
      if(core<1)a=Math.max(a,1-smooth(.85,1,core));
      // Neutral studio floor and shadow are outside the object, never painted into the page.
      if(y>393)a=0;
      p[i+3]=Math.round(a*255);
    }
    sc.putImageData(f,0,0);ready=true;
  }
  function acceptPoster(){
    if(poster.naturalWidth){sc.clearRect(0,0,768,432);sc.drawImage(poster,0,0,768,432);ready=true;journey.classList.add('paint-ready');requestDraw()}
  }
  poster.addEventListener('load',acceptPoster);if(poster.complete)acceptPoster();
  function startVideo(){
    if(reduce.matches)return;
    if(!video.src){video.src=video.dataset.src;video.load()}
    if(live&&!document.hidden)video.play().catch(()=>{});
  }
  video.addEventListener('loadeddata',()=>{keyVideo();journey.classList.add('paint-ready');startVideo();requestDraw()});
  video.addEventListener('error',()=>{video.dataset.fallback='poster';acceptPoster()});
  video.addEventListener('seeked',()=>{keyVideo();requestDraw()});
  new IntersectionObserver(entries=>{live=entries[0].isIntersecting;if(live){startVideo();requestDraw()}else video.pause()},{rootMargin:'100px'}).observe(journey);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)video.pause();else{startVideo();requestDraw()}});
  document.addEventListener('pointerdown',startVideo,{passive:true,once:true});
  function requestDraw(){if(!raf)raf=requestAnimationFrame(draw)}
  function draw(now){
    raf=0;
    const sy=Math.max(0,-journey.getBoundingClientRect().top),vh=innerHeight;
    const t=reduce.matches?0:smooth(heroH*.12,heroH*.92,sy);
    const intro=opening&&!reduce.matches?ease((now-started)/1450):1;
    if(intro>=1&&opening){opening=false;journey.classList.remove('opening')}
    hero.style.setProperty('--hero-copy-opacity',String(1-smooth(.05,.34,t)));
    $('.hero-bottom').style.pointerEvents=t>.34?'none':'';
    // One source texture drives both the floating sphere and the paint transition.
    if(ready&&live&&!reduce.matches){
      keyVideo();ctx.clearRect(0,0,W,H);
      const base=Math.min(artH/432,artW/560,(W-24)/734);
      const initial=Math.min(1.65,(W*.97)/(734*base));
      const z=1+(initial-1)*(1-intro);
      const scale=base*z;
      const motion=1-smooth(0,.28,t);
      const cy=artY+artH/2+sy*.60-(artH*.45+65)*(1-intro)+Math.sin(now*.00049)*3*motion;
      const cx=W/2+Math.sin(now*.00031)*2*motion;
      const spread=smooth(.30,.88,t),stretch=smooth(.02,.42,t)*(1-smooth(.56,.95,t));
      const flatten=smooth(.64,1,t);
      const dw=768*scale*(1+spread*.23),dh=432*scale;
      const top=cy-dh/2;
      // The lower pool is connected to the stretching lower hemisphere.
      if(t>.24){
        const radius=(.12+spread*1.0)*W;
        const floor=Math.min(H,cy+dh*.40+stretch*dh*.32);
        const crest=cy+dh*.30-(spread*.15*dh);
        const finalTop=heroH*.57;
        const poolTop=crest*(1-flatten)+finalTop*flatten;
        ctx.fillStyle='#cc542f';ctx.beginPath();ctx.moveTo(cx-radius,H+3);ctx.lineTo(cx-radius,floor);
        ctx.bezierCurveTo(cx-radius,floor,cx-radius*.48,poolTop,cx,poolTop);
        ctx.bezierCurveTo(cx+radius*.48,poolTop,cx+radius,floor,cx+radius,floor);ctx.lineTo(cx+radius,H+3);ctx.closePath();ctx.fill();
      }
      ctx.save();ctx.globalAlpha=1-smooth(.68,.97,t);
      // Horizontal strips retain the original ring and reflections while the lower surface stretches.
      for(let y=0;y<432;y+=2){
        const lower=clamp((y-206)/182),fall=lower*lower;
        const widening=1+spread*fall*3.8;
        const width=dw*widening;
        const destY=top+y*scale+fall*stretch*dh*.56;
        const stripH=2*scale*(1+lower*stretch*2.66)+.12;
        ctx.drawImage(source,0,y,768,2,cx-width/2,destY,width,stripH);
      }
      ctx.restore();
      if(t>.30&&t<.98){
        ctx.save();ctx.globalCompositeOperation='source-atop';
        const glow=ctx.createLinearGradient(0,cy-dh*.03,0,cy+dh*.5);
        glow.addColorStop(0,'rgba(204,84,47,0)');glow.addColorStop(1,'rgba(204,84,47,'+smooth(.30,.70,t)+')');
        const radius=W*(.1+spread*.7);ctx.fillStyle=glow;
        ctx.fillRect(0,cy-dh*.03,W,H-cy+dh*.03);ctx.restore();
      }
    }
    // Reviews enter only once there is a stable orange reading surface.
    const pp=smooth(vh*.94,vh*.40,vh-(proofTop-scrollY));
    $$('.proof-card').forEach((card,i)=>{const entered=reduce.matches?1:smooth(0,1,(vh-(proofTop-scrollY)-90-i*35)/260);card.style.setProperty('--card-entry',(1-entered)*28+'px');card.style.setProperty('--card-opacity',.3+.7*entered)});
    const panelP=reduce.matches?1:smooth(0,vh*.5,vh-(panelTop-scrollY));
    const panel=$('#voor-na');panel.style.setProperty('--panel-inset',(1-panelP)*(W<761?18:44)+'px');panel.style.setProperty('--panel-radius',(1-panelP)*44+'px');
    panel.style.setProperty('--ba-opacity',String(.2+.8*smooth(.12,.62,panelP)));panel.style.setProperty('--ba-y',(1-panelP)*24+'px');
    panel.style.setProperty('--media-opacity',String(.35+.65*smooth(.30,.85,panelP)));panel.style.setProperty('--media-scale',String(.94+.06*panelP));
    if(live&&!document.hidden&&!reduce.matches)requestDraw();
  }
  addEventListener('scroll',()=>{if(scrollY>20&&opening){opening=false;journey.classList.remove('opening')}requestDraw()},{passive:true});
  new ResizeObserver(measure).observe(hero);
  new ResizeObserver(()=>{panelTop=$('#voor-na').getBoundingClientRect().top+scrollY;requestDraw()}).observe(document.querySelector('main'));
  addEventListener('resize',measure);document.fonts.ready.then(measure);
  reduce.addEventListener('change',()=>{if(reduce.matches){video.pause();hero.style.setProperty('--hero-copy-opacity',1)}else startVideo();measure()});
  started=performance.now();if(!reduce.matches&&scrollY<20)journey.classList.add('opening');else opening=false;measure();
  // Review carousel: native touch scrolling and explicit controls, never autoplay.
  const track=$('.proof-track'),cards=$$('.proof-card');let review=0;
  function goReview(i){review=clamp(i,0,cards.length-1);track.scrollTo({left:cards[review].offsetLeft-cards[0].offsetLeft,behavior:reduce.matches?'auto':'smooth'})}
  $$('[data-review-step]').forEach(b=>b.addEventListener('click',()=>goReview((review+Number(b.dataset.reviewStep)+cards.length)%cards.length)));
  track.addEventListener('scroll',()=>{let best=0;cards.forEach((c,i)=>{if(Math.abs(c.offsetLeft-cards[0].offsetLeft-track.scrollLeft)<Math.abs(cards[best].offsetLeft-cards[0].offsetLeft-track.scrollLeft))best=i});review=best;$('#review-position').textContent=String(best+1).padStart(2,'0')+' / 03'},{passive:true});
  track.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();goReview((review+(e.key==='ArrowRight'?1:-1)+3)%3)}});
  $$('[data-review]').forEach(b=>b.addEventListener('click',()=>{$('#review-full').textContent=cards[Number(b.dataset.review)].querySelector('blockquote').textContent;$('#review-dialog').showModal()}));
  $('.close-review').addEventListener('click',()=>$('#review-dialog').close());
  // A single set of service cards powers the desktop gallery and mobile sample fan.
  const swatches=$$('.service-swatch'),deck=$('.swatch-deck');let current=0,pointer=null;
  $$('.service-swatch img').forEach(img=>img.draggable=false);
  function selectService(i){
    current=(i+swatches.length)%swatches.length;
    swatches.forEach((card,j)=>{const d=(j-current+swatches.length)%swatches.length;card.classList.toggle('active',d===0);card.classList.toggle('behind-one',d===1);card.classList.toggle('behind-two',d===2);card.inert=d!==0;card.style.removeProperty('--drag-x');card.style.removeProperty('--drag-r');if(d!==0){card.querySelector('.swatch-details').hidden=true;card.querySelector('.expand-service').setAttribute('aria-expanded','false');card.querySelector('.expand-service span').textContent='＋'}});
    $$('[data-service]').forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.service)===current)));
    $('.swatch-count').textContent=String(current+1).padStart(2,'0')+' / 04';
    requestAnimationFrame(measure);
  }
  $$('[data-service]').forEach(b=>{b.addEventListener('click',()=>selectService(Number(b.dataset.service)));b.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'&&W>760)selectService(Number(b.dataset.service))})});
  $$('.expand-service').forEach(b=>b.addEventListener('click',()=>{const open=b.getAttribute('aria-expanded')!=='true';b.setAttribute('aria-expanded',String(open));b.querySelector('span').textContent=open?'−':'＋';document.getElementById(b.getAttribute('aria-controls')).hidden=!open;requestAnimationFrame(measure)}));
  deck.addEventListener('pointerdown',e=>{if(W>760||e.target.closest('button,a'))return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,dx:0,h:false}});
  deck.addEventListener('pointermove',e=>{if(!pointer||e.pointerId!==pointer.id)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(!pointer.h&&Math.abs(dy)>Math.abs(dx)&&Math.abs(dy)>8){pointer=null;return}if(Math.abs(dx)>10){pointer.h=true;deck.setPointerCapture(e.pointerId);pointer.dx=dx;swatches[current].style.setProperty('--drag-x',clamp(dx,-150,150)+'px');swatches[current].style.setProperty('--drag-r',dx/30+'deg')}});
  const resetPointer=()=>{if(!pointer)return;const p=pointer;pointer=null;if(p.h&&Math.abs(p.dx)>45)selectService(current+(p.dx<0?1:-1));else selectService(current)};
  deck.addEventListener('pointerup',resetPointer);deck.addEventListener('pointercancel',()=>{pointer=null;selectService(current)});
  deck.addEventListener('keydown',e=>{if(e.target.closest('button,a'))return;if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();selectService(current+(e.key==='ArrowRight'?1:-1))}});
  new IntersectionObserver((entries,o)=>{if(entries.some(e=>e.isIntersecting)){deck.classList.add('fan-entry');o.disconnect()}},{threshold:.4}).observe(deck);
  selectService(0);
  $$('[data-enquiry]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();$('#enquiry-dialog').showModal()}));
})();
