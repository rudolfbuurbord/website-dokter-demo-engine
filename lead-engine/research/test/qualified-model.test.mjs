import test from 'node:test';import assert from 'node:assert/strict';
import {validate,body,PROMPT} from '../qualified-model.mjs';
const c={pages:[{url:'https://test.invalid/',text:'Test Schilders schilderwerk in Nederland Amsterdam'}],images:[{bytes:Buffer.from('test'),url:'https://test.invalid/',label:'top'}],contacts:[{kind:'EMAIL',value:'info@test.invalid'}],limitations:[]};
const r={status:'ELIGIBLE',reason_code:'OUTDATED_WEBSITE',reason:'Traditionele gedateerde brochurevormgeving.',company_name:'Test Schilders',company_match:true,services_present:true,nl_confirmed:true,closure_indication:false,email_belongs:true,email:'info@test.invalid',name_quote:{text:'Test Schilders',page_index:0},services_quote:{text:'schilderwerk',page_index:0},location_quote:{text:'Nederland Amsterdam',page_index:0},evidence:[{finding:'De smalle tekstkolommen en zware kaders ogen gedateerd.',screenshot_index:0}]};
test('sourced facts and visual evidence accepted',()=>assert.equal(validate(r,c).status,'ELIGIBLE'));
test('invented email or quotation rejected',()=>{assert.throws(()=>validate({...r,email:'invented@test.invalid'},c),/EMAIL_NOT_PUBLISHED/);assert.throws(()=>validate({...r,location_quote:{text:'Rotterdam',page_index:0}},c),/FACT_QUOTE/);});
test('closure and unavailable image cannot qualify',()=>{assert.throws(()=>validate({...r,closure_indication:true},c),/FACTS/);assert.throws(()=>validate(r,{...c,images:[]}),/VISUAL/);});
test('modern rejection cannot carry outdated reason',()=>assert.throws(()=>validate({...r,status:'INELIGIBLE'},c),/CONTRADICTORY/));
test('compact prompt applies basic boundary without embedding all histories',()=>{assert.ok(PROMPT.includes('te basic'));assert.ok(JSON.stringify(body(c)).length<12000);});
