// Tiny static server for the repo root, used by the browser checks.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json"};
module.exports = function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
      res.writeHead(200, {"Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store"});
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve({server, base: `http://127.0.0.1:${server.address().port}`}));
  });
};
