const $ = s => document.querySelector(s);
const STORES = {amazon:"Amazon", target:"Target", walmart:"Walmart"};
const TAGS = {best:"Best overall", cheapest:"Lowest price", top_rated:"Top rated", fastest:"Fastest"};

let state = {items:[], errors:{}, query:"", loading:false, seq:0};
const local = {
  get(k){ try { return localStorage.getItem(k) } catch { return null } },
  set(k, v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v) } catch {} },
};

/* ---- where the server is ----
   This page sits at a fixed address; the Mac that does the searching is reached
   through a tunnel whose address can change when it restarts. endpoint.json
   always names the current one. Served by the Mac itself (local testing), the
   page just talks to its own origin. */
const SELF_HOSTED = !location.hostname.endsWith("github.io");
let base = SELF_HOSTED ? "" : local.get("am_base");
async function findBase(){
  if (SELF_HOSTED) return "";
  const r = await fetch("endpoint.json?t=" + Date.now(), {cache:"no-store"});
  base = (await r.json()).url.replace(/\/$/, "");
  local.set("am_base", base);
  return base;
}
// A remembered address can be a retired one; check the current one on every open.
if (!SELF_HOSTED) findBase().catch(() => {});
async function api(path, opts = {}){
  const go = () => fetch(base + "/" + path, {...opts, headers:{...(opts.headers || {}), Authorization:"Bearer " + (local.get("am_token") || "")}});
  let r;
  try {
    if (base == null) await findBase();
    r = await go();
    if (r.status >= 502 && !SELF_HOSTED) throw new Error("tunnel moved");
  } catch (e){
    if (SELF_HOSTED) throw new Error("The search server is not answering.");
    try { await findBase(); r = await go() } catch { throw new Error("The search server is not answering. It may be restarting; try again in a minute.") }
  }
  if (r.status === 401){ gate(true); throw new Error("Password needed") }
  return r;
}

/* ---- password gate ---- */
function gate(show){
  $("#gate").hidden = !show;
  if (show){ local.set("am_token", null); setTimeout(() => $("#pw").focus(), 50) }
}
$("#gate").addEventListener("submit", async e => {
  e.preventDefault();
  $("#gateerr").textContent = "";
  // Copying the whole text message brings its "Amatarmart password:" label along.
  const password = $("#pw").value.trim().replace(/^amatarmart password:\s*/i, "");
  const send = async () => {
    const r = await fetch(base + "/api/login", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({password})});
    // Only the server itself says 200, 401 or 429. Anything else is a broken
    // route (old address, Mac asleep), never a wrong password.
    if (![200, 401, 429].includes(r.status)) throw new Error("answer " + r.status);
    return r;
  };
  let r;
  try {
    if (base == null) await findBase();
    try { r = await send() } catch { await findBase(); r = await send() }
  } catch (err){
    const host = base ? new URL(base, location.href).host : "no address";
    $("#gateerr").textContent = "Cannot reach the search server (" + host + ": " + (err.message || err) + "). Try again in a minute.";
    return;
  }
  if (r.status === 429){ $("#gateerr").textContent = "Too many tries. Wait a few minutes."; return }
  if (r.status === 401){ $("#gateerr").textContent = "That is not it. Try again."; $("#pw").select(); return }
  local.set("am_token", (await r.json()).token);
  $("#pw").value = ""; gate(false); loadRecent();
  if (state.query) search(state.query); else $("#q").focus();
});

/* ---- rendering ---- */
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const logo = s => `<span class="logo ${s}" title="${STORES[s]}"><img src="logos/${s}.svg" alt="${STORES[s]}"></span>`;
const money = n => "$" + Number(n).toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
const count = n => n >= 1e6 ? (n/1e6).toFixed(1).replace(/\.0$/,"") + "M" : n >= 1e4 ? Math.round(n/1e3) + "K" : n >= 1e3 ? (n/1e3).toFixed(1).replace(/\.0$/,"") + "K" : String(n);
const stars = r => `<span class="stars" aria-hidden="true"><i style="width:${Math.max(0, Math.min(100, r/5*100))}%"></i></span>`;

/* The date or day word in a store's delivery line is the part people scan for. */
const DATE = "(?:[A-Z][a-z]{2,8}\\.? \\d{1,2}(?: ?- ?(?:[A-Z][a-z]{2,8}\\.? )?\\d{1,2})?)";
const SHIP_RE = new RegExp(`\\b(today|tomorrow|overnight|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? ${DATE}|${DATE}|in \\d+\\+? (?:day|hour)s?)\\b`, "g");
const shipHTML = t => t ? esc(t).replace(SHIP_RE, "<b>$1</b>") : "";

function rateHTML(it){
  if (it.rating == null) return "";
  const n = it.reviews != null ? `<span class="n">${it.store === "amazon" ? "(" + count(it.reviews) + ")" : count(it.reviews)}</span>` : "";
  const lead = it.store === "amazon" ? `<span>${it.rating.toFixed(1)}</span>` : "";
  return `<div class="rate" aria-label="${it.rating} out of 5, ${it.reviews ?? 0} reviews">${lead}${stars(it.rating)}${n}</div>`;
}
function tagsHTML(it){
  const t = (it.tags || []).map(k => `<span class="tag ${k}">${TAGS[k]}</span>`).join("");
  return t ? `<div class="tags">${t}</div>` : "";
}

/* Each store's row follows that store's own app: what leads, what is bold, which color means "deal". */
const SKIN = {
  amazon(it){
    const [d, c] = it.price.toFixed(2).split(".");
    const b = it.badges || [];
    const flag = b.find(x => /best seller|overall pick|amazon'?s choice/i.test(x));
    const bought = b.find(x => /bought/i.test(x));
    const prime = b.some(x => /prime/i.test(x));
    return `${flag ? `<span class="abadge ${/best/i.test(flag) ? "bs" : ""}">${esc(flag)}</span>` : ""}
      <p class="title">${esc(it.title)}</p>
      ${rateHTML(it)}
      ${bought ? `<div class="bought">${esc(bought)}</div>` : ""}
      <div class="price"><span class="now"><sup>$</sup>${Number(d).toLocaleString("en-US")}<sup>${c}</sup></span>
        ${it.list_price > it.price ? `<span class="was">List: <s>${money(it.list_price)}</s></span>` : ""}
        ${it.unit_price_text ? `<span class="was">(${esc(it.unit_price_text)})</span>` : ""}</div>
      ${it.ship_text || prime ? `<div class="ship">${prime ? '<span class="prime">prime</span> ' : ""}${shipHTML(it.ship_text)}</div>` : ""}`;
  },
  walmart(it){
    const b = it.badges || [];
    const flag = b.find(x => /rollback|clearance|reduced|best seller|popular|deal/i.test(x));
    const deal = it.list_price > it.price;
    return `${flag ? `<span class="wflag ${/rollback|clearance|reduced/i.test(flag) ? "red" : ""}">${esc(flag)}</span>` : ""}
      <div class="price"><span class="now ${deal ? "deal" : ""}">${deal ? "Now " : ""}${money(it.price)}</span>
        ${deal ? `<span class="was">${money(it.list_price)}</span>` : ""}
        ${it.unit_price_text ? `<span class="sub">${esc(it.unit_price_text)}</span>` : ""}</div>
      <p class="title">${esc(it.title)}</p>
      ${rateHTML(it)}
      ${it.ship_text ? `<div class="ship">${shipHTML(it.ship_text)}</div>` : ""}
      ${it.pickup_text ? `<div class="sub">${esc(it.pickup_text)}</div>` : ""}`;
  },
  target(it){
    const b = it.badges || [];
    const flag = b.find(x => /sale|clearance|deal|bestseller|best seller|new/i.test(x));
    const deal = it.list_price > it.price;
    return `${flag ? `<span class="tflag">${esc(flag)}</span>` : ""}
      ${it.brand ? `<div class="brandline">${esc(it.brand)}</div>` : ""}
      <p class="title">${esc(it.title)}</p>
      ${rateHTML(it)}
      <div class="price"><span class="now ${deal ? "deal" : ""}">${money(it.price)}</span>
        ${deal ? `<span class="was">reg <s>${money(it.list_price)}</s></span>` : ""}</div>
      ${it.eff_price < it.price ? `<div class="sub">${money(it.eff_price)} with Circle Card</div>` : ""}
      ${it.ship_text ? `<div class="ship">${shipHTML(it.ship_text)}</div>` : ""}
      ${it.pickup_text ? `<div class="sub">${esc(it.pickup_text)}</div>` : ""}`;
  },
};

/* A plain https product link: iOS hands it to the store's app when that app is installed. */
const rowHTML = it => `<article class="row ${it.store} ${it.relevant === false ? "dim" : ""}">
  <a href="${esc(it.url)}" target="_blank" rel="noopener" aria-label="Open in ${STORES[it.store]}: ${esc(it.title)}">
    <div class="pic"><img class="p" src="${esc(it.image)}" alt="" loading="lazy" decoding="async">${logo(it.store)}</div>
    <div class="body">${tagsHTML(it)}${SKIN[it.store](it)}</div>
  </a></article>`;

function render(){
  const el = $("#results");
  document.body.classList.toggle("has-results", state.loading || !!state.query);
  $("#home").hidden = state.loading || !!state.query;
  if (state.loading){
    el.innerHTML = `<div class="status"><span class="looking">${Object.keys(STORES).map(logo).join("")}</span> Checking all three stores</div>` +
      Array(6).fill('<div class="sk"><i class="p"></i><div><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i></div></div>').join("");
    return;
  }
  if (!state.query){ el.innerHTML = ""; return }
  if (state.error){ el.innerHTML = `<div class="empty"><b>Could not search</b>${esc(state.error)}</div>`; return }
  const failed = Object.keys(state.errors);
  let html = "";
  if (state.fromLink) html += `<div class="status">From your link: <b>${esc(state.query)}</b></div>`;
  if (failed.length) html += `<div class="warn"><span>${failed.map(s => STORES[s] || s).join(" and ")} did not answer.</span><button id="retry">Try again</button></div>`;
  html += state.items.length ? state.items.map(rowHTML).join("")
    : `<div class="empty"><b>Nothing found</b>Try fewer or different words.</div>`;
  el.innerHTML = html;
}

async function search(q, {fresh} = {}){
  q = q.trim();
  if (!q) return;
  const seq = ++state.seq;
  $("#q").value = q; $("#form").classList.add("filled"); $("#q").blur();
  Object.assign(state, {loading:true, query:q, items:[], errors:{}, fromLink:false, error:""});
  render(); scrollTo(0, 0);
  history.replaceState(null, "", "?q=" + encodeURIComponent(q));
  try {
    const r = await api("api/search?q=" + encodeURIComponent(q) + (fresh ? "&fresh=1" : ""));
    if (seq !== state.seq) return;
    if (!r.ok){ const e = await r.json().catch(() => ({})); throw new Error(typeof e.detail === "string" ? e.detail : "Search failed") }
    const d = await r.json();
    Object.assign(state, {loading:false, items:d.items, errors:d.errors || {}, query:d.query, fromLink:d.from_link});
    if (d.from_link) $("#q").value = d.query;
  } catch (e){
    if (seq !== state.seq) return;
    Object.assign(state, {loading:false, error:e.message});
  }
  render(); loadRecent();
}

function reset(){
  state.seq++;
  Object.assign(state, {loading:false, query:"", items:[], errors:{}, error:""});
  $("#q").value = ""; $("#form").classList.remove("filled");
  history.replaceState(null, "", location.pathname);
  render();
}

async function loadRecent(){
  try {
    const r = await (await api("api/recent")).json();
    $("#recent").innerHTML = r.slice(0, 8).map(q => `<button>${esc(q)}</button>`).join("");
  } catch {}
}

$("#form").addEventListener("submit", e => { e.preventDefault(); search($("#q").value) });
$("#q").addEventListener("input", e => $("#form").classList.toggle("filled", !!e.target.value));
$("#q").addEventListener("paste", () => setTimeout(() => { if (/https?:\/\//.test($("#q").value)) search($("#q").value) }, 0));
$("#clear").addEventListener("click", () => { reset(); $("#q").focus() });
$("#recent").addEventListener("click", e => { if (e.target.tagName === "BUTTON") search(e.target.textContent) });
$("#results").addEventListener("click", e => { if (e.target.id === "retry") search(state.query, {fresh:true}) });
addEventListener("scroll", () => $("#hdr").classList.toggle("stuck", scrollY > 4), {passive:true});

render();
if (!local.get("am_token")) gate(true); else loadRecent();
const q0 = new URLSearchParams(location.search).get("q");
if (q0 && local.get("am_token")) search(q0);
