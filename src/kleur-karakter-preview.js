// Isolated review deployment: no Supabase bindings or production renderer changes.
export default {
  async fetch(request, env) {
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405});
    const url=new URL(request.url);
    if(url.pathname==='/')return Response.redirect(new URL('/kleur-karakter',url),302);
    if(url.pathname==='/kleur-karakter'||url.pathname==='/kleur-karakter/')url.pathname='/';
    else if(url.pathname.startsWith('/kleur-karakter/'))url.pathname=url.pathname.slice('/kleur-karakter'.length);
    else return new Response('Not found',{status:404});
    const response=await env.ASSETS.fetch(new Request(url,request));
    const headers=new Headers(response.headers);headers.set('x-robots-tag','noindex, nofollow');headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','strict-origin-when-cross-origin');
    return new Response(response.body,{status:response.status,headers});
  }
};
