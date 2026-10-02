const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbw-wxkf1XzXM-tvhj-tsmDVdHdgI5YcWI63yj7W3RQyee7mrWmi2h88bvIykQq0Jb50FQ/exec';

// Requests bigger than this (a member photo, for example) can't ride in a web address,
// so they are sent to the Apps Script as a POST body instead. Everything else is unchanged.
const LARGE_REQUEST_CHARS = 1500;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonReply(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      // Read the parameters from a POST body or a GET query string
      let params = {};
      if (request.method === 'POST') {
        const body = await request.text();
        try { params = JSON.parse(body); } catch { params = Object.fromEntries(new URLSearchParams(body)); }
      } else {
        params = Object.fromEntries(new URL(request.url).searchParams);
      }

      // Forward to Apps Script (server to server, so no browser CORS limits)
      const payload = JSON.stringify(params);
      let response;
      if (request.method === 'POST' && payload.length > LARGE_REQUEST_CHARS) {
        response = await fetch(APPS_SCRIPT_URL, {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8', 'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Worker/1.0)' },
          body: payload
        });
      } else {
        const url = new URL(APPS_SCRIPT_URL);
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        response = await fetch(url.toString(), {
          redirect: 'follow',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Cloudflare-Worker/1.0)' }
        });
      }
      const text = (await response.text()).trim();

      // An HTML page means Google sent a sign-in or error page instead of data
      if (text.startsWith('<')) {
        return jsonReply({ success: false, error: 'Apps Script returned a web page instead of data. Check the deployment is set to Anyone and has a new version.' }, 502);
      }

      // Unwrap ONLY a true JSONP reply like  callbackName({...});
      // A plain JSON reply is passed through untouched, even if it contains parentheses.
      const jsonp = text.match(/^[A-Za-z_$][\w$.]*\(([\s\S]*)\)\s*;?$/);
      const json = jsonp ? jsonp[1] : text;

      return new Response(json, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return jsonReply({ success: false, error: e.message }, 500);
    }
  }
};
