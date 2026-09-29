// Four business criteria; evidence integrity is a gate, not a fifth criterion.
export const PROTOCOL='budget100-proof-v2';
export const normalize=s=>String(s??'').normalize('NFKC').toLowerCase()
 .replace(/[.'’ʼ]/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/gu,' ')
 .replace(/\bb\s+v\b/gu,'bv').replace(/\bn\s+v\b/gu,'nv').replace(/\bv\s+o\s+f\b/gu,'vof');
const contains=(text,part)=>part.length>=3&&(' '+text+' ').includes(' '+part+' ');
const aliases=s=>normalize(s)
 .replace(/\b(?:binnenschilderwerk|binnen schilderwerk)\b/g,'schilderen binnen')
 .replace(/\b(?:buitenschilderwerk|buiten schilderwerk)\b/g,'schilderen buiten')
 .replace(/\bschilderwerk\b/g,'schilderen');
const words=s=>new Set(aliases(s).split(' ').filter(w=>!['en','of','wij','we','in','voor','het','de','een','werkgebied','zijn','met','ook'].includes(w)));
function equivalent(claim,source){
 const a=words(claim),b=words(source);
 return a.size>=1&&[...a].every(w=>b.has(w));
}
export function anchor(quote,pages,kind){
 if(!quote||typeof quote.text!=='string'||quote.text.trim().length<3)throw Error('SOURCE_EVIDENCE_MISSING:'+kind);
 const order=[quote.page_index,...pages.map((_,i)=>i)].filter((i,n,a)=>Number.isInteger(i)&&pages[i]?.url&&a.indexOf(i)===n);
 for(const i of order){
  const text=pages[i].text||'';
  if(contains(normalize(text),normalize(quote.text)))return {text:quote.text,page_index:i,method:'NORMALIZED_SOURCE_MATCH'};
  // Bounded known vocabulary, never accept an arbitrary page index as proof.
  if(kind==='services_quote'||kind==='location_quote'){
   for(const line of text.split(/\n|(?<=[.!?])\s+/).filter(s=>s.length>=3&&s.length<=400)){
    if(equivalent(quote.text,line))return {text:line.trim(),page_index:i,method:'CONTROLLED_PARAPHRASE',original_claim:quote.text};
   }
  }
 }
 throw Error('FACT_QUOTE_NOT_FOUND:'+kind);
}
export function businessExclusion(c){
 // These describe the site's own role, not incidental words such as 'vereniging'.
 const patterns=[
  [/diensten voor schilders/i,'DIRECTORY'],
  [/belangenbehartiger voor ondernemers/i,'BUSINESS_ASSOCIATION'],
  [/vergelijk (?:gratis )?(?:schilders|offertes van schilders)/i,'COMPARISON_PLATFORM'],
  [/wij (?:zijn|vormen) (?:een|de|het) (?:landelijk[e]? )?(?:branchevereniging|ondernemersvereniging|opleidingsbedrijf)/i,'NOT_A_PAINTING_PROVIDER']
 ];
 for(const p of c.pages||[])for(const [pattern,type] of patterns){
  const m=(p.text||'').match(pattern);
  if(m)return {status:'REJECTED',reason_code:'NOT_TARGET_BUSINESS',reason:'De bron presenteert zichzelf als '+type+', niet als uitvoerend schildersbedrijf.',evidence:[{finding:m[0],source_url:p.url,observed_at:p.observed_at}],criterion:1};
 }
 return null;
}
export function captureDecision(c){
 if(!c.images?.length)throw Error('VISUAL_EVIDENCE_REQUIRED');
 return businessExclusion(c);
}
export function candidateMode({answer,review,started,reserved,replayOnly=false}){
 if(answer||review)return 'REPLAY';
 if(reserved)return 'NO_PAID_RETRY';
 if(replayOnly)return 'REPLAY_ONLY';
 if(started?.capture_recovery_used)return 'FREE_RECOVERY_EXHAUSTED';
 return started?'FREE_CAPTURE_RECOVERY':'NEW';
}
