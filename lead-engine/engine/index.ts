import {createHandler,createRPC} from './api.mjs';
import {runOne} from './worker.mjs';
import {auditWebsite} from './website.mjs';
import {safeFetchDeno} from './deno-fetch.mjs';
const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const url=Deno.env.get('SUPABASE_URL')||'';
Deno.serve(createHandler({key,rpc:createRPC(url,key),run:rpc=>runOne(rpc,{audit:url=>auditWebsite(url,safeFetchDeno)})}));
