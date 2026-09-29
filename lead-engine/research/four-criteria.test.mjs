import test from 'node:test';
import assert from 'node:assert/strict';
import {validate} from './qualified-model.mjs';
const c={images:[{}],pages:[{url:'https://example.nl/',text:'Schildersbedrijf de Schilder-Concurrent b.v\nWij schilderen binnen en buiten in Nederland.'}],contacts:[{kind:'EMAIL',value:'info@example.nl'}]};
const r={status:'ELIGIBLE',reason_code:'OUTDATED_WEBSITE',reason:'Traditionele brochure met gedateerde vormgeving.',company_name:'Schilder-Concurrent B.V.',company_match:true,services_present:true,nl_confirmed:true,closure_indication:false,email_belongs:true,email:'info@example.nl',name_quote:{text:'Schilder Concurrent BV',page_index:0},services_quote:{text:'Binnenschilderwerk en buitenschilderwerk',page_index:0},location_quote:{text:'Werkgebied Nederland',page_index:0},evidence:[{finding:'Gedateerde typografie en onrustige compositie.',screenshot_index:0}]};
test('punctuation and faithful paraphrases do not reject the lead',()=>assert.equal(validate(structuredClone(r),c).status,'ELIGIBLE'));
for(const [field,value,error] of [['company_match',false,'CRITERION_2'],['services_present',false,'CRITERION_1'],['nl_confirmed',false,'CRITERION_1'],['closure_indication',true,'CRITERION_2'],['email_belongs',false,'CRITERION_3'],['email','invented@example.nl','EMAIL_NOT_PUBLISHED']])test(field,()=>assert.throws(()=>validate({...structuredClone(r),[field]:value},c),new RegExp(error)));
test('source page cannot be invented',()=>{const x=structuredClone(r);x.name_quote.page_index=99;x.name_quote.text='Volledig verzonnen bedrijf';assert.throws(()=>validate(x,c),/FACT_QUOTE/)});
test('a modern site remains ineligible',()=>assert.equal(validate({...structuredClone(r),status:'INELIGIBLE',reason_code:'NONE'},c).status,'INELIGIBLE'));
test('operational uncertainty stays visible',()=>assert.throws(()=>validate({...structuredClone(r),status:'SKIP'},c),/INSUFFICIENT_EVIDENCE/));

