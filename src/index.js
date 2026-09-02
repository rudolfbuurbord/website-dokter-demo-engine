export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return new Response("De Website Dokter Demo Engine", {
        headers: { "content-type": "text/plain; charset=UTF-8" }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
