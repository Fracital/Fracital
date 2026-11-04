/**
 * Adsterra 300×250 banner. Their invoke.js renders with document.write, which can't run
 * after a React page has loaded, so the snippet runs as-is inside its own frame.
 * The sandbox (no allow-same-origin) keeps the ad script out of Fracital's storage and DOM;
 * ad clicks may open new tabs.
 */
const AD_KEY = "267f2250ca310d6a47a2dc5e59fc112a";
const WIDTH = 300;
const HEIGHT = 250;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>
<script>
  // The sandboxed frame has no real cookies; give invoke.js an in-memory jar so it doesn't throw.
  (function () {
    var jar = {};
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: function () { return Object.keys(jar).map(function (k) { return k + "=" + jar[k]; }).join("; "); },
      set: function (v) { var p = String(v).split(";")[0], i = p.indexOf("="); if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
    });
    try { localStorage.getItem("x"); } catch (e) {
      var mem = {};
      var store = { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); }, removeItem: function (k) { delete mem[k]; }, clear: function () { mem = {}; }, key: function (i) { return Object.keys(mem)[i] || null; }, get length() { return Object.keys(mem).length; } };
      Object.defineProperty(window, "localStorage", { configurable: true, value: store });
      Object.defineProperty(window, "sessionStorage", { configurable: true, value: store });
    }
  })();
</script>
<script>
  atOptions = {
    'key' : '${AD_KEY}',
    'format' : 'iframe',
    'height' : ${HEIGHT},
    'width' : ${WIDTH},
    'params' : {}
  };
</script>
<script src="https://www.highrevenueformat.com/${AD_KEY}/invoke.js"></script>
</body></html>`;

export const AdBanner = ({ className = "" }: { className?: string }) => (
	<iframe
		title="Advertisement"
		srcDoc={html}
		width={WIDTH}
		height={HEIGHT}
		loading="lazy"
		scrolling="no"
		sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
		className={`block shrink-0 border-0 rounded-lg ${className}`}
		style={{ width: WIDTH, height: HEIGHT, colorScheme: "normal" }}
	/>
);
