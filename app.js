const PAGE = 24;
const fmt = new Intl.NumberFormat("pt-BR");
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const LABEL = {
  aprovados: "aprovados", leis: "leis", projetos: "projetos",
  emendas: "emendas", tramitando: "em tramitação", total: "proposições",
};
const COLORS = { leis: "var(--law)", aprov: "var(--ok)", tram: "var(--wip)", enc: "var(--closed)" };

let DATA = null;
let shown = PAGE;
let rankMetric = "aprovados";
let partySort = { k: "projetos", dir: -1 };

init();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

async function init() {
  try {
    DATA = await fetch("data/deputados.json").then((r) => r.json());
  } catch {
    $("#grid").innerHTML = `<p class="empty">Não foi possível carregar <code>data/deputados.json</code>. Rode <code>python3 scripts/atualizar_dados.py</code> e sirva a pasta com <code>python3 -m http.server</code>.</p>`;
    return;
  }
  renderHero();
  fillFilters();
  bind();
  renderRank();
  renderGrid();
  renderParties();
  initCompetition();
  initCompare();
}

function renderHero() {
  const r = DATA.resumo;
  const items = [
    [r.deputados, "Deputados em exercício"],
    [r.projetos, "Projetos apresentados"],
    [r.aprovados, "Projetos aprovados"],
    [r.leis, "Viraram lei"],
    [r.tramitando, "Em tramitação"],
    [r.emendas, "Emendas"],
  ];
  $("#kpis").innerHTML = items.map(([v, l]) => `<div class="kpi"><b>${fmt.format(v)}</b><span>${l}</span></div>`).join("");
  $("#hero-leg").textContent = `${DATA.legislatura}ª Legislatura · desde ${br(DATA.inicioLegislatura)}`;
  $("#updated").textContent = `Base atualizada em ${new Date(DATA.atualizadoEm).toLocaleString("pt-BR")}. Totais acima sem dupla contagem de coautoria.`;
  $("#m-inicio").textContent = br(DATA.inicioLegislatura);
}

function fillFilters() {
  const uniq = (k) => [...new Set(DATA.deputados.map((d) => d[k]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#f-partido").insertAdjacentHTML("beforeend", uniq("partido").map((p) => `<option>${esc(p)}</option>`).join(""));
  $("#f-uf").insertAdjacentHTML("beforeend", uniq("uf").map((p) => `<option>${esc(p)}</option>`).join(""));
}

function bind() {
  ["#f-busca", "#f-partido", "#f-uf", "#f-ordem"].forEach((s) =>
    $(s).addEventListener("input", () => { shown = PAGE; renderGrid(); }));
  $("#btn-more").addEventListener("click", () => { shown += PAGE; renderGrid(); });
  $("#rank-metric").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    rankMetric = b.dataset.m;
    document.querySelectorAll("#rank-metric button").forEach((x) => x.classList.toggle("on", x === b));
    renderRank();
  });
  document.addEventListener("click", (e) => {
    const c = e.target.closest("[data-cmp]");
    if (c) { e.stopPropagation(); toggleCompare(+c.dataset.cmp); return; }
    const el = e.target.closest("[data-dep]");
    if (el) openDeputy(+el.dataset.dep);
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("[data-cmp]")) return;
    const el = e.target.closest?.("[data-dep]");
    if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openDeputy(+el.dataset.dep); }
  });
  $("#tbl-partidos thead").addEventListener("click", (e) => {
    const th = e.target.closest("th"); if (!th) return;
    const k = th.dataset.k;
    partySort = { k, dir: partySort.k === k ? -partySort.dir : (k === "partido" ? 1 : -1) };
    renderParties();
  });
  $("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest(".m-close")) $("#modal").close(); });
}

const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function filtered() {
  const q = norm($("#f-busca").value.trim());
  const p = $("#f-partido").value, uf = $("#f-uf").value, o = $("#f-ordem").value;
  const list = DATA.deputados.filter((d) =>
    (!q || norm(d.nome).includes(q)) && (!p || d.partido === p) && (!uf || d.uf === uf));
  return list.sort((a, b) => o === "nome" ? a.nome.localeCompare(b.nome, "pt-BR") : b[o] - a[o] || a.nome.localeCompare(b.nome, "pt-BR"));
}

function renderGrid() {
  const list = filtered();
  $("#dep-count").textContent = `(${fmt.format(list.length)})`;
  $("#grid").innerHTML = list.length
    ? list.slice(0, shown).map(card).join("")
    : `<p class="empty">Nenhum deputado encontrado com esses filtros.</p>`;
  $("#btn-more").style.display = list.length > shown ? "" : "none";
}

function statusBar(d) {
  const t = d.projetos || 1;
  const seg = [[d.leis, COLORS.leis], [d.aprovados - d.leis, COLORS.aprov], [d.tramitando, COLORS.tram], [d.encerrados, COLORS.enc]];
  return `<div class="bar" title="Leis ${d.leis} · Aprovados ${d.aprovados} · Em tramitação ${d.tramitando} · Encerrados ${d.encerrados}">${
    seg.map(([v, c]) => `<i style="width:${(v / t) * 100}%;background:${c}"></i>`).join("")}</div>`;
}

function card(d) {
  return `<article class="card" data-dep="${d.id}" tabindex="0" aria-label="${esc(d.nome)}">
    <div class="card-top">
      <img loading="lazy" src="${esc(d.foto)}" alt="" onerror="this.style.visibility='hidden'">
      <div><h3>${esc(d.nome)}</h3><span class="tag">${esc(d.partido)} · ${esc(d.uf)}</span></div>
      ${cmpButton(d.id)}
    </div>
    <div class="stats">
      <div><b>${fmt.format(d.projetos)}</b><span>Projetos</span></div>
      <div><b>${fmt.format(d.aprovados)}</b><span>Aprovados</span></div>
      <div><b>${fmt.format(d.leis)}</b><span>Leis</span></div>
    </div>
    ${statusBar(d)}
    <div class="card-foot"><span>${fmt.format(d.tramitando)} em tramitação</span><span>${fmt.format(d.emendas)} emendas</span></div>
  </article>`;
}

function renderRank() {
  const top = [...DATA.deputados].sort((a, b) => b[rankMetric] - a[rankMetric]).slice(0, 10);
  $("#rank").innerHTML = top.map((d) => `<li data-dep="${d.id}" tabindex="0">
    <img loading="lazy" src="${esc(d.foto)}" alt="">
    <div class="who"><b>${esc(d.nome)}</b><small>${esc(d.partido)} · ${esc(d.uf)}</small></div>
    <span class="val">${fmt.format(d[rankMetric])}</span></li>`).join("");
}

function renderParties() {
  const map = {};
  for (const d of DATA.deputados) {
    const p = (map[d.partido] ??= { partido: d.partido, deputados: 0, projetos: 0, aprovados: 0, leis: 0, tramitando: 0, emendas: 0 });
    p.deputados++; p.projetos += d.projetos; p.aprovados += d.aprovados; p.leis += d.leis; p.tramitando += d.tramitando; p.emendas += d.emendas;
  }
  const rows = Object.values(map).map((p) => ({ ...p, media: p.projetos / p.deputados }));
  const { k, dir } = partySort;
  rows.sort((a, b) => (k === "partido" ? a.partido.localeCompare(b.partido) : a[k] - b[k]) * dir);
  document.querySelectorAll("#tbl-partidos th").forEach((th) => th.classList.toggle("sorted", th.dataset.k === k));
  $("#tbl-partidos tbody").innerHTML = rows.map((p) => `<tr>
    <td><b>${esc(p.partido)}</b></td><td>${p.deputados}</td><td>${fmt.format(p.projetos)}</td>
    <td>${fmt.format(p.aprovados)}</td><td>${fmt.format(p.leis)}</td><td>${fmt.format(p.tramitando)}</td>
    <td>${fmt.format(p.emendas)}</td><td>${p.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</td></tr>`).join("");
}

let modalCtl = null;
async function openDeputy(id) {
  const d = DATA.deputados.find((x) => x.id === id);
  if (!d) return;
  const legs = d.mandatos || [DATA.legislatura];
  $("#modal-body").innerHTML = `
    <div class="m-head">
      <img src="${esc(d.foto)}" alt="">
      <div>
        <h2>${esc(d.nome)}</h2>
        <p>${esc(d.partido)} · ${esc(d.uf)}${d.email ? ` · <a href="mailto:${esc(d.email)}">${esc(d.email)}</a>` : ""}</p>
        <p>${legs.length} mandato${legs.length > 1 ? "s" : ""} na Câmara · <a href="https://www.camara.leg.br/deputados/${d.id}" target="_blank" rel="noopener">Perfil oficial ↗</a></p>
        <p class="m-cmp">${cmpButton(d.id, true)}</p>
      </div>
      <button class="m-close" aria-label="Fechar" autofocus>×</button>
    </div>
    <div class="m-content">
      ${scoreCard(d)}
      <div class="period">
        <div class="period-row"><span class="period-label">Mandato</span><div class="chips" id="p-legs">
          ${legs.map((l) => `<button data-leg="${l}">${legLabel(l)}</button>`).join("")}
          ${legs.length > 1 ? `<button data-leg="all">Toda a carreira</button>` : ""}
        </div></div>
        <div class="period-row"><span class="period-label">Ano</span><div class="chips" id="p-years"></div></div>
        <div class="ychart" id="p-chart" aria-label="Proposições por ano"></div>
        <p class="period-sum" id="p-sum"></p>
      </div>
      <p class="hint">Clique em qualquer número ou tipo para ver a lista completa.</p>
      <div class="m-kpis" id="m-kpis"></div>
      <h3>Situação dos projetos</h3>
      <div id="m-status"></div>
      <div class="legend">
        <span><i style="background:${COLORS.leis}"></i>Leis</span><span><i style="background:${COLORS.aprov}"></i>Aprovados (aguardando Senado/sanção)</span>
        <span><i style="background:${COLORS.tram}"></i>Em tramitação</span><span><i style="background:${COLORS.enc}"></i>Encerrados</span>
      </div>
      <h3 id="m-types-title">Proposições por tipo</h3>
      <div class="types" id="m-types"></div>
      <div class="m-list" id="m-list">
        <div class="m-list-head"><h3 id="m-list-title">Carregando…</h3><input type="search" id="m-q" placeholder="Filtrar por número ou assunto…" aria-label="Filtrar lista"></div>
        <ul class="props" id="m-props"><li class="loading">Carregando proposições…</li></ul>
        <div class="more"><button class="btn ghost" id="m-more" hidden>Mostrar mais</button></div>
      </div>
    </div>`;
  $("#modal").showModal();
  $("#modal").scrollTop = 0;

  // estado: mandato escolhido, anos marcados (vazio = todos), filtro da lista
  const st = { leg: DATA.legislatura, years: new Set(), f: "projetos", shown: LIST_PAGE, items: null, allTypes: false };
  const body = $("#modal-body");
  modalCtl?.abort(); // remove os ouvintes do deputado aberto antes
  modalCtl = new AbortController();
  const sig = { signal: modalCtl.signal };

  body.addEventListener("click", (e) => {
    const lg = e.target.closest("[data-leg]");
    if (lg) { st.leg = lg.dataset.leg === "all" ? "all" : +lg.dataset.leg; st.years.clear(); st.shown = LIST_PAGE; refresh(); return; }
    const yr = e.target.closest("[data-year]");
    if (yr) {
      const y = yr.dataset.year;
      if (y === "all") st.years.clear();
      else if (st.years.has(+y)) st.years.delete(+y);
      else st.years.add(+y);
      st.shown = LIST_PAGE; refresh(); return;
    }
    const b = e.target.closest("[data-f]");
    if (b) { st.f = b.dataset.f; st.shown = LIST_PAGE; $("#m-q").value = ""; drawList(true); markFilter(); return; }
    if (e.target.id === "m-more") { st.shown += LIST_PAGE; drawList(); }
    if (e.target.id === "m-all-types") { st.allTypes = true; drawTypes(scoped()); markFilter(); }
  }, sig);
  $("#m-q").addEventListener("input", () => { st.shown = LIST_PAGE; drawList(); });

  try {
    st.items = await loadList(id);
    if (modalCtl.signal !== sig.signal) return; // outro deputado foi aberto enquanto carregava
  } catch {
    $("#m-list-title").textContent = "Lista indisponível";
    $("#m-props").innerHTML = `<li class="loading">Não foi possível carregar <code>data/deps/${id}.json</code>. Rode o script de atualização.</li>`;
    return;
  }
  refresh();

  function inLeg(p) { return st.leg === "all" || p.leg === st.leg; }
  function scoped() { return st.items.filter((p) => inLeg(p) && (!st.years.size || st.years.has(p.y))); }

  function yearsOfScope() {
    const set = new Set(st.items.filter(inLeg).map((p) => p.y));
    if (st.leg !== "all") {
      const ini = +DATA.legislaturas[st.leg].inicio.slice(0, 4);
      const fim = Math.min(+DATA.legislaturas[st.leg].fim.slice(0, 4) - 1, new Date().getFullYear());
      for (let y = ini; y <= fim; y++) set.add(y);
    }
    return [...set].sort((a, b) => a - b);
  }

  function refresh() {
    body.querySelectorAll("[data-leg]").forEach((b) => b.classList.toggle("on", String(st.leg) === b.dataset.leg));
    const years = yearsOfScope();
    for (const y of [...st.years]) if (!years.includes(y)) st.years.delete(y);
    $("#p-years").innerHTML = `<button data-year="all" class="${st.years.size ? "" : "on"}">Todos</button>` +
      years.map((y) => `<button data-year="${y}" class="${st.years.has(y) ? "on" : ""}">${y}</button>`).join("");
    drawChart(years);

    const list = scoped();
    const c = counts(list);
    const per = st.leg === "all" ? "toda a carreira" : `${legLabel(st.leg)}`;
    const ys = [...st.years].sort();
    $("#p-sum").innerHTML = `Mostrando <b>${per}</b>${ys.length ? ` · ${ys.length === 1 ? "ano" : "anos"} <b>${ys.join(", ")}</b>` : ""}: ${fmt.format(c.total)} proposições.`;
    $("#m-kpis").innerHTML = FILTERS.map(([k, label]) => `<button data-f="${k}"><b>${fmt.format(c[k])}</b><span>${label}</span></button>`).join("");
    $("#m-status").innerHTML = statusBar(c).replace('class="bar"', 'class="bar" style="height:12px;margin:0"');
    drawTypes(list, c);
    drawList();
    markFilter();
  }

  function drawChart(years) {
    const per = new Map(years.map((y) => [y, { proj: 0, emenda: 0, outro: 0 }]));
    for (const p of st.items) if (inLeg(p) && per.has(p.y)) per.get(p.y)[p.grupo === "proj" ? "proj" : p.grupo === "emenda" ? "emenda" : "outro"]++;
    const max = Math.max(1, ...[...per.values()].map((v) => v.proj + v.emenda + v.outro));
    $("#p-chart").innerHTML = `<div class="ycols">${years.map((y) => {
      const v = per.get(y), tot = v.proj + v.emenda + v.outro;
      const h = (n) => (n / max) * 100;
      return `<button class="ycol ${st.years.has(y) ? "on" : ""} ${st.years.size && !st.years.has(y) ? "dim" : ""}" data-year="${y}" title="${y}: ${fmt.format(v.proj)} projetos, ${fmt.format(v.emenda)} emendas, ${fmt.format(v.outro)} outras">
        <span class="ytot">${tot ? fmt.format(tot) : ""}</span>
        <span class="ystack"><i class="p" style="height:${h(v.proj)}%"></i><i class="e" style="height:${h(v.emenda)}%"></i><i class="o" style="height:${h(v.outro)}%"></i></span>
        <span class="ylab">${years.length > 16 ? `’${String(y).slice(2)}` : y}</span></button>`;
    }).join("")}</div>
    <div class="legend"><span><i style="background:var(--green-600)"></i>Projetos</span><span><i style="background:var(--gold)"></i>Emendas</span><span><i style="background:#c9d3ce"></i>Outras (requerimentos, pareceres…)</span><span>Clique numa coluna para filtrar o ano</span></div>`;
  }

  function drawTypes(list, c = counts(list)) {
    const tipos = Object.entries(list.reduce((m, p) => ((m[p.tipo] = (m[p.tipo] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
    const max = tipos[0]?.[1] || 1;
    const vis = st.allTypes ? tipos : tipos.slice(0, 10);
    $("#m-types-title").innerHTML = `Proposições por tipo <small style="color:var(--muted);font-weight:400">(${fmt.format(c.total)} no período, ${fmt.format(c.principal)} como primeiro autor)</small>`;
    $("#m-types").innerHTML = (vis.length ? vis.map(([t, n]) => `<button class="row" data-f="tipo:${esc(t)}" title="${esc(TIPOS[t] || t)}"><b>${esc(t)}</b><div class="track"><i style="width:${(n / max) * 100}%"></i></div><span>${fmt.format(n)}</span></button>`).join("") : `<p class="loading">Nenhuma proposição no período.</p>`)
      + (tipos.length > vis.length ? `<button class="link" id="m-all-types">Ver todos os ${tipos.length} tipos</button>` : "");
  }

  function markFilter() { body.querySelectorAll("[data-f]").forEach((b) => b.classList.toggle("on", b.dataset.f === st.f)); }

  function drawList(scroll) {
    if (!st.items) return;
    const q = norm($("#m-q").value.trim());
    const base = scoped().filter(matcher(st.f));
    const list = q ? base.filter((p) => norm(`${p.tipo} ${p.numero}/${p.ano} ${p.ementa} ${p.situacao}`).includes(q)) : base;
    $("#m-list-title").innerHTML = `${esc(filterLabel(st.f))} <span class="count">(${fmt.format(list.length)}${q ? ` de ${fmt.format(base.length)}` : ""})</span>`;
    $("#m-props").innerHTML = list.length ? list.slice(0, st.shown).map(propItem).join("") : `<li class="loading">Nenhuma proposição nesta categoria no período escolhido.</li>`;
    $("#m-more").hidden = list.length <= st.shown;
    if (scroll) $("#m-list").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function legOf(iso) {
  for (const [leg, r] of Object.entries(DATA.legislaturas)) if (iso >= r.inicio && iso <= r.fim) return +leg;
  return null;
}

function legLabel(leg) {
  const r = DATA.legislaturas[leg];
  const txt = `${r.inicio.slice(0, 4)}–${r.fim.slice(0, 4)}`;
  return leg === DATA.legislatura ? `${txt} · atual` : txt;
}

function counts(list) {
  const c = { projetos: 0, aprovados: 0, leis: 0, tramitando: 0, encerrados: 0, pecs: 0, emendas: 0, requerimentos: 0, total: list.length, principal: 0 };
  for (const p of list) {
    if (p.principal) c.principal++;
    if (p.grupo === "emenda") c.emendas++;
    else if (p.grupo === "req") c.requerimentos++;
    else if (p.grupo === "proj") {
      c.projetos++;
      if (p.tipo === "PEC") c.pecs++;
      if (p.cat === "lei") { c.leis++; c.aprovados++; }
      else if (p.cat === "aprovado") c.aprovados++;
      else if (p.cat === "tramitando") c.tramitando++;
      else c.encerrados++;
    }
  }
  return c;
}

const LIST_PAGE = 30;
const FILTERS = [
  ["projetos", "Projetos apresentados"], ["aprovados", "Aprovados"], ["leis", "Viraram lei"],
  ["tramitando", "Em tramitação"], ["encerrados", "Arquivados/encerrados"], ["pecs", "PECs"],
  ["emendas", "Emendas"], ["requerimentos", "Requerimentos"], ["total", "Todas as proposições"],
];
const TIPOS = {
  PL: "Projeto de Lei", PLP: "Projeto de Lei Complementar", PEC: "Proposta de Emenda à Constituição",
  PDL: "Projeto de Decreto Legislativo", PRC: "Projeto de Resolução", REQ: "Requerimento",
  RIC: "Requerimento de Informação", INC: "Indicação", RCP: "Requerimento de CPI",
  EMC: "Emenda na Comissão", EMP: "Emenda de Plenário", EMR: "Emenda de Relator", EMA: "Emenda Aglutinativa",
  ESB: "Emenda ao Substitutivo", EMS: "Emenda Substitutiva", PRL: "Parecer de Relator", PRLP: "Parecer Preliminar",
  PRLE: "Parecer às Emendas", SBT: "Substitutivo", SBR: "Subemenda de Relator", RPD: "Requerimento de Plenário",
  RDF: "Redação Final", DTQ: "Destaque", VTS: "Voto em Separado", PPP: "Parecer Proferido em Plenário",
  PEP: "Parecer às Emendas de Plenário", REC: "Recurso", DOC: "Documento",
};
const SIT_CLASS = { lei: "s-lei", aprovado: "s-aprov", tramitando: "s-tram", encerrado: "s-enc" };
const SIT_LABEL = { lei: "Virou lei", aprovado: "Aprovado", tramitando: "Em tramitação", encerrado: "Encerrado" };

const listCache = new Map();
async function loadList(id) {
  if (!listCache.has(id)) {
    const rows = await fetch(`data/deps/${id}.json`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    listCache.set(id, rows.map(([pid, tipo, numero, ano, data, situacao, grupo, cat, principal, ementa]) =>
      ({ id: pid, tipo, numero, ano, data, situacao, grupo, cat, principal, ementa, y: +data.slice(0, 4), leg: legOf(data) })));
  }
  return listCache.get(id);
}

function matcher(f) {
  if (f.startsWith("tipo:")) { const t = f.slice(5); return (p) => p.tipo === t; }
  return {
    projetos: (p) => p.grupo === "proj",
    aprovados: (p) => p.grupo === "proj" && (p.cat === "lei" || p.cat === "aprovado"),
    leis: (p) => p.grupo === "proj" && p.cat === "lei",
    tramitando: (p) => p.grupo === "proj" && p.cat === "tramitando",
    encerrados: (p) => p.grupo === "proj" && p.cat === "encerrado",
    pecs: (p) => p.tipo === "PEC",
    emendas: (p) => p.grupo === "emenda",
    requerimentos: (p) => p.grupo === "req",
    total: () => true,
  }[f] || (() => true);
}

function filterLabel(f) {
  if (f.startsWith("tipo:")) { const t = f.slice(5); return TIPOS[t] ? `${TIPOS[t]} (${t})` : t; }
  return (FILTERS.find(([k]) => k === f) || [, f])[1];
}

function propItem(p) {
  const nome = p.ano && p.ano !== "0" ? `${p.tipo} ${p.numero}/${p.ano}` : `${p.tipo} ${p.numero}`;
  return `<li>
    <div class="p-top">
      <a href="https://www.camara.leg.br/propostas-legislativas/${p.id}" target="_blank" rel="noopener">${esc(nome)} ↗</a>
      <span class="badge ${SIT_CLASS[p.cat]}">${SIT_LABEL[p.cat]}</span>
    </div>
    <p>${esc(p.ementa) || "<i>Sem ementa</i>"}</p>
    <small>Apresentada em ${br(p.data)}${p.situacao ? ` · ${esc(p.situacao)}` : ""}${p.principal ? " · primeiro autor" : " · coautor"}</small>
  </li>`;
}

function br(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }

/* ================================================================ comparação */
const CMP_MAX = 3;
let cmp = [];

const CMP_ROWS = [
  ["projetos", "Projetos apresentados"],
  ["aprovados", "Projetos aprovados"],
  ["leis", "Viraram lei"],
  ["taxa", "Taxa de aprovação", (c) => (c.projetos ? c.aprovados / c.projetos : 0), (v) => pct(v)],
  ["tramitando", "Em tramitação"],
  ["encerrados", "Arquivados ou encerrados", null, null, true],
  ["pecs", "PECs"],
  ["emendas", "Emendas"],
  ["requerimentos", "Requerimentos"],
  ["total", "Todas as proposições"],
  ["principal", "Como primeiro autor", (c) => (c.total ? c.principal / c.total : 0), (v) => pct(v)],
];
const pct = (v) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const depById = (id) => DATA.deputados.find((x) => x.id === id);

function cmpButton(id, big) {
  const on = cmp.includes(id);
  return `<button class="cmp-btn${on ? " on" : ""}${big ? " big" : ""}" data-cmp="${id}" aria-pressed="${on}" title="${on ? "Remover da comparação" : "Adicionar à comparação"}">${on ? "✓ Comparando" : "+ Comparar"}</button>`;
}

function initCompare() {
  try { cmp = JSON.parse(localStorage.getItem("cmp") || "[]").filter((id) => depById(id)).slice(0, CMP_MAX); } catch { cmp = []; }
  const m = location.hash.match(/^#comparar=([\d,]+)/);
  if (m) cmp = m[1].split(",").map(Number).filter((id) => depById(id)).slice(0, CMP_MAX);
  const mm = location.hash.match(/[&]mandato=(all|\d+)/), ma = location.hash.match(/[&]anos=([\d,]+)/);
  if (mm) cmpPeriod.leg = mm[1] === "all" ? "all" : +mm[1];
  if (ma) ma[1].split(",").forEach((y) => cmpPeriod.years.add(+y));

  $("#cmp-go").addEventListener("click", openCompare);
  $("#cmp-clear").addEventListener("click", () => { cmp = []; syncCompare(); });
  $("#nav-cmp").addEventListener("click", (e) => { e.preventDefault(); openCompare(); });
  $("#cmp-chips").addEventListener("click", (e) => {
    const x = e.target.closest("[data-rm]"); if (x) toggleCompare(+x.dataset.rm);
  });
  $("#cmp-modal").addEventListener("click", (e) => {
    if (e.target.id === "cmp-modal" || e.target.closest(".m-close")) return $("#cmp-modal").close();
    const rm = e.target.closest("[data-rm]");
    if (rm) { toggleCompare(+rm.dataset.rm); return; }
    const det = e.target.closest("[data-open]");
    if (det) { $("#cmp-modal").close(); openDeputy(+det.dataset.open); return; }
    if (e.target.id === "cmp-share") return shareCompare();
    const lg = e.target.closest("[data-cleg]");
    if (lg) { cmpPeriod.leg = lg.dataset.cleg === "all" ? "all" : +lg.dataset.cleg; cmpPeriod.years.clear(); return renderCompare(); }
    const yr = e.target.closest("[data-cyear]");
    if (yr) {
      const y = yr.dataset.cyear;
      if (y === "all") cmpPeriod.years.clear();
      else if (cmpPeriod.years.has(+y)) cmpPeriod.years.delete(+y);
      else cmpPeriod.years.add(+y);
      return renderCompare();
    }
  });
  $("#cmp-modal").addEventListener("close", () => {
    if (location.hash.startsWith("#comparar")) history.replaceState(null, "", location.pathname);
  });
  syncCompare();
  if (m && cmp.length) openCompare();
}

function toggleCompare(id) {
  if (cmp.includes(id)) cmp = cmp.filter((x) => x !== id);
  else if (cmp.length >= CMP_MAX) return toast(`Você pode comparar até ${CMP_MAX} deputados. Remova um para adicionar outro.`);
  else cmp.push(id);
  syncCompare();
}

function syncCompare() {
  try { localStorage.setItem("cmp", JSON.stringify(cmp)); } catch {}
  document.querySelectorAll("[data-cmp]").forEach((b) => {
    const id = +b.dataset.cmp;
    b.outerHTML = cmpButton(id, b.classList.contains("big"));
  });
  $("#cmp-tray").hidden = cmp.length === 0;
  document.body.classList.toggle("has-tray", cmp.length > 0);
  $("#cmp-chips").innerHTML = cmp.map((id) => { const d = depById(id); return `<span class="chip"><img src="${esc(d.foto)}" alt="">${esc(d.nome)}<button data-rm="${id}" aria-label="Remover ${esc(d.nome)}">×</button></span>`; }).join("")
    + (cmp.length < CMP_MAX ? `<span class="chip ghost">${cmp.length < 2 ? "Escolha mais um deputado" : "Pode adicionar mais um"}</span>` : "");
  $("#cmp-go").disabled = cmp.length < 2;
  $("#cmp-go").textContent = `Comparar (${cmp.length})`;
  if ($("#cmp-modal").open) renderCompare();
}

// período da comparação: mandato (legislatura ou "all") + anos marcados (vazio = todos)
const cmpPeriod = { leg: null, years: new Set() };
let cmpToken = 0;

function openCompare() {
  renderCompare();
  if (!$("#cmp-modal").open) $("#cmp-modal").showModal();
}

function cmpLegOptions(deps) {
  const set = new Set([DATA.legislatura]);
  deps.forEach((d) => (d.mandatos || []).forEach((l) => set.add(l)));
  return [...set].sort((a, b) => b - a);
}

function cmpYears(lists) {
  const { leg } = cmpPeriod;
  const set = new Set();
  if (leg === "all") lists.forEach((l) => l.forEach((p) => set.add(p.y)));
  else {
    const r = DATA.legislaturas[leg];
    const ini = +r.inicio.slice(0, 4), fim = Math.min(+r.fim.slice(0, 4) - 1, new Date().getFullYear());
    for (let y = ini; y <= fim; y++) set.add(y);
    lists.forEach((l) => l.forEach((p) => { if (p.leg === leg) set.add(p.y); }));
  }
  return [...set].sort((a, b) => a - b);
}

async function renderCompare() {
  const token = ++cmpToken;
  const deps = cmp.map(depById);
  if (cmpPeriod.leg === null) cmpPeriod.leg = DATA.legislatura;
  const legOpts = cmpLegOptions(deps);
  if (cmpPeriod.leg !== "all" && !legOpts.includes(cmpPeriod.leg)) { cmpPeriod.leg = DATA.legislatura; cmpPeriod.years.clear(); }

  const opts = DATA.deputados.filter((d) => !cmp.includes(d.id))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((d) => `<option value="${esc(d.nome)} (${esc(d.partido)}-${esc(d.uf)})"></option>`).join("");
  const adder = cmp.length < CMP_MAX ? `
    <div class="cmp-add">
      <input id="cmp-search" list="cmp-list" placeholder="Digite o nome de um deputado para adicionar…" aria-label="Adicionar deputado à comparação">
      <datalist id="cmp-list">${opts}</datalist>
    </div>` : "";

  const shell = (inner) => `
    <div class="m-head cmp-head">
      <div><h2>Comparar deputados</h2><p>Escolha de 2 a ${CMP_MAX} deputados e o período: um mandato, anos específicos ou a carreira toda.</p></div>
      ${deps.length >= 2 ? `<button class="btn ghost sm light" id="cmp-share">Copiar link</button>` : ""}
      <button class="m-close" aria-label="Fechar" autofocus>×</button>
    </div>
    <div class="m-content">
      ${adder}
      ${deps.length < 2 ? `<p class="empty">${deps.length ? "Adicione mais um deputado para comparar." : "Nenhum deputado selecionado. Use a busca acima ou o botão “+ Comparar” nos cartões."}</p>` : ""}
      ${inner}
    </div>`;

  let lists = [];
  if (deps.length) {
    if (!deps.every((d) => listCache.has(d.id))) $("#cmp-body").innerHTML = shell(`<p class="loading">Carregando proposições…</p>`);
    try { lists = await Promise.all(deps.map((d) => loadList(d.id))); }
    catch { if (token === cmpToken) $("#cmp-body").innerHTML = shell(`<p class="empty">Não foi possível carregar as proposições.</p>`); return; }
    if (token !== cmpToken) return; // outra renderização começou enquanto carregava
  }

  let inner = "";
  if (deps.length) {
    const { leg, years: ysel } = cmpPeriod;
    const years = cmpYears(lists);
    for (const y of [...ysel]) if (!years.includes(y)) ysel.delete(y);
    const inScope = (p) => (leg === "all" || p.leg === leg) && (!ysel.size || ysel.has(p.y));
    const scoped = lists.map((l) => l.filter(inScope));
    const cs = scoped.map(counts);
    const semMandato = deps.map((d) => leg !== "all" && !(d.mandatos || []).includes(leg));
    const cols = deps.length;

    const period = `
      <div class="period">
        <div class="period-row"><span class="period-label">Mandato</span><div class="chips">
          ${legOpts.map((l) => `<button data-cleg="${l}" class="${leg === l ? "on" : ""}">${legLabel(l)}</button>`).join("")}
          <button data-cleg="all" class="${leg === "all" ? "on" : ""}">Toda a carreira</button>
        </div></div>
        <div class="period-row"><span class="period-label">Ano</span><div class="chips">
          <button data-cyear="all" class="${ysel.size ? "" : "on"}">Todos</button>
          ${years.map((y) => `<button data-cyear="${y}" class="${ysel.has(y) ? "on" : ""}">${y}</button>`).join("")}
        </div></div>
        <p class="period-sum">Comparando <b>${leg === "all" ? "toda a carreira" : legLabel(leg)}</b>${ysel.size ? ` · ${ysel.size === 1 ? "ano" : "anos"} <b>${[...ysel].sort().join(", ")}</b>` : ""}. Clique em vários anos para somá-los.</p>
      </div>`;

    const head = deps.map((d, i) => `<th>
      <div class="cmp-who">
        <img src="${esc(d.foto)}" alt="">
        <b>${esc(d.nome)}</b><span class="tag">${esc(d.partido)} · ${esc(d.uf)}</span>
        ${semMandato[i] ? `<span class="tag warn">Sem mandato neste período</span>` : ""}
        <div class="cmp-actions"><button class="link" data-open="${d.id}">Ver detalhes</button><button class="link danger" data-rm="${d.id}">Remover</button></div>
      </div></th>`).join("");

    const rows = CMP_ROWS.map(([k, label, get, show, lowerIsBetter]) => {
      const vals = cs.map((c) => (get ? get(c) : c[k]));
      const max = Math.max(...vals, 0);
      const best = cols > 1 && vals.some((v) => v !== vals[0]) ? (lowerIsBetter ? Math.min(...vals) : max) : null;
      return `<tr><th scope="row">${label}</th>${vals.map((v) => `<td class="${v === best && !lowerIsBetter ? "best" : ""}">
        <b>${show ? show(v) : fmt.format(v)}</b><div class="cmp-bar"><i style="width:${max ? (v / max) * 100 : 0}%"></i></div></td>`).join("")}</tr>`;
    }).join("");

    // projetos e emendas por ano, mesma escala para todos os deputados
    const yearsShown = ysel.size ? years.filter((y) => ysel.has(y)) : years;
    const perYear = lists.map((l) => {
      const m = new Map(yearsShown.map((y) => [y, { proj: 0, emenda: 0 }]));
      for (const p of l) if ((leg === "all" || p.leg === leg) && m.has(p.y)) {
        if (p.grupo === "proj") m.get(p.y).proj++; else if (p.grupo === "emenda") m.get(p.y).emenda++;
      }
      return m;
    });
    const ymax = Math.max(1, ...perYear.flatMap((m) => [...m.values()].map((v) => v.proj + v.emenda)));
    const yearRow = `<tr><th scope="row">Projetos e emendas por ano</th>${perYear.map((m) => `<td><div class="mini-cols">${
      [...m.entries()].map(([y, v]) => `<button class="mini-col ${ysel.has(y) ? "on" : ""}" data-cyear="${y}" title="${y}: ${fmt.format(v.proj)} projetos, ${fmt.format(v.emenda)} emendas">
        <span class="mstack"><i class="p" style="height:${(v.proj / ymax) * 100}%"></i><i class="e" style="height:${(v.emenda / ymax) * 100}%"></i></span>
        <span class="mlab">${yearsShown.length > 8 ? `’${String(y).slice(2)}` : y}</span></button>`).join("")}</div></td>`).join("")}</tr>`;

    const status = `<tr><th scope="row">Situação dos projetos</th>${cs.map((c) => `<td>${statusBar(c).replace('class="bar"', 'class="bar" style="margin:4px 0 0;height:10px"')}</td>`).join("")}</tr>`;
    const tipos = `<tr><th scope="row">Tipos mais frequentes</th>${scoped.map((l) => {
      const t = Object.entries(l.reduce((m, p) => ((m[p.tipo] = (m[p.tipo] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
      return `<td><div class="cmp-types">${t.length ? t.map(([k, n]) => `<span title="${esc(TIPOS[k] || k)}">${esc(k)} <b>${fmt.format(n)}</b></span>`).join("") : `<span class="muted">—</span>`}</div></td>`;
    }).join("")}</tr>`;

    inner = `${period}<div class="cmp-table-wrap"><table class="cmp-table cols-${cols}">
      <thead><tr><th class="cmp-corner"></th>${head}</tr></thead>
      <tbody>${scoreRows(deps)}${rows}${yearRow}${status}${tipos}</tbody></table></div>
      <div class="legend"><span><i style="background:var(--green-600)"></i>Projetos</span><span><i style="background:var(--gold)"></i>Emendas</span><span><i style="background:${COLORS.leis}"></i>Leis</span><span><i style="background:${COLORS.aprov}"></i>Aprovados</span><span><i style="background:${COLORS.tram}"></i>Em tramitação</span><span><i style="background:${COLORS.enc}"></i>Encerrados</span><span>★ maior valor da linha</span></div>`;
  }

  const scrollTop = $("#cmp-modal").scrollTop;
  $("#cmp-body").innerHTML = shell(inner);
  $("#cmp-modal").scrollTop = scrollTop;

  const inp = $("#cmp-search");
  if (inp) inp.addEventListener("change", () => {
    const d = DATA.deputados.find((x) => `${x.nome} (${x.partido}-${x.uf})` === inp.value);
    if (d) toggleCompare(d.id); else toast("Escolha um nome da lista.");
  });
}

async function shareCompare() {
  let hash = `#comparar=${cmp.join(",")}`;
  if (cmpPeriod.leg !== DATA.legislatura) hash += `&mandato=${cmpPeriod.leg}`;
  if (cmpPeriod.years.size) hash += `&anos=${[...cmpPeriod.years].sort().join(",")}`;
  const url = `${location.origin}${location.pathname}${hash}`;
  history.replaceState(null, "", hash);
  try { await navigator.clipboard.writeText(url); toast("Link da comparação copiado (com o período escolhido)."); }
  catch { toast("Link na barra de endereço."); }
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  (document.querySelector("dialog[open]") || document.body).appendChild(t); // fica acima de janelas abertas
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ================================================================ competição / nota de desempenho */
const COMP = [
  // chave, nome, peso padrão, explicação, frase quando vai mal, frase quando vai bem
  ["producao", "Produção de projetos", 20, "Quantidade de projetos apresentados (PL, PLP, PEC, PDL, PRC).", "Apresenta poucos projetos", "Apresenta muitos projetos"],
  ["aprovacao", "Projetos aprovados e leis", 30, "Projetos aprovados na Câmara; os que viraram lei contam em dobro.", "Aprova poucos projetos", "Aprova muitos projetos"],
  ["eficiencia", "Taxa de aprovação", 15, "Parte dos projetos que foi aprovada (com ajuste para quem apresentou poucos).", "Pouco do que apresenta é aprovado", "Boa parte do que apresenta é aprovado"],
  ["emendas", "Emendas a projetos", 10, "Emendas apresentadas a projetos em tramitação (EMC, EMP, EMR…).", "Usa pouco as emendas a projetos", "Atua muito com emendas a projetos"],
  ["recursos", "Recursos pagos (emendas ao orçamento)", 15, "Valor efetivamente pago das emendas individuais ao orçamento, em proporção ao maior valor.", "Levou poucos recursos via emendas ao orçamento", "Levou muitos recursos via emendas ao orçamento"],
  ["cota", "Economia da cota parlamentar", 10, "Gasto médio mensal da cota parlamentar: quem gasta menos recebe nota maior.", "Gasta a cota acima da maioria", "Gasta pouco da cota parlamentar"],
];
const CLASSES = [
  [75, "Excelente", "cl-exc"], [55, "Bom", "cl-bom"], [35, "Regular", "cl-reg"], [0, "Baixo", "cl-bai"],
];
const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlShort = (v) => v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : brl(v);
const classOf = (score) => CLASSES.find(([min]) => score >= min);
let weights = Object.fromEntries(COMP.map(([k, , w]) => [k, w]));
const comp = { shown: 25, filter: "" };

function percentiles(values, invert) {
  // posição relativa 0–100, empates recebem a média das posições
  const idx = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const out = new Array(values.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const p = values.length > 1 ? (((i + j) / 2) / (values.length - 1)) * 100 : 50;
    for (let k = i; k <= j; k++) out[idx[k][1]] = invert ? 100 - p : p;
    i = j + 1;
  }
  return out;
}

let ajusteTempo = true;

function computeScores() {
  const ds = DATA.deputados;
  // tempo em exercício estimado pelos meses com gasto de cota (mínimo de 12 para não inflar quem chegou agora)
  const mesesMax = Math.max(1, ...ds.map((d) => d.cotaMeses));
  const fator = (d) => (ajusteTempo ? mesesMax / Math.min(mesesMax, Math.max(12, d.cotaMeses)) : 1);
  const raw = {
    producao: ds.map((d) => d.projetos * fator(d)),
    aprovacao: ds.map((d) => (d.aprovados + d.leis) * fator(d)),
    eficiencia: ds.map((d) => (d.aprovados + 0.5) / (d.projetos + 15)),
    emendas: ds.map((d) => d.emendas * fator(d)),
    cota: ds.map((d) => (d.cotaMeses ? d.cota / d.cotaMeses : 0)),
  };
  // recursos: com ajuste, média por orçamento em que o deputado teve emendas pagas (cada ano tem cota parecida)
  const rec = ds.map((d) => {
    if (!ajusteTempo) return d.recursosPagos;
    const anos = Object.values(d.recursosAno || {}).filter((v) => v > 0).length;
    return anos ? d.recursosPagos / anos : 0;
  });
  const maxRec = Math.max(1, ...rec);
  const parts = {
    producao: percentiles(raw.producao), aprovacao: percentiles(raw.aprovacao), eficiencia: percentiles(raw.eficiencia),
    emendas: percentiles(raw.emendas), cota: percentiles(raw.cota, true),
    recursos: rec.map((v) => Math.min(100, (v / maxRec) * 100)),
  };
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  ds.forEach((d, i) => {
    d.comp = Object.fromEntries(COMP.map(([k]) => [k, parts[k][i]]));
    d.cotaMes = raw.cota[i];
    d.score = COMP.reduce((acc, [k]) => acc + d.comp[k] * weights[k], 0) / wsum;
  });
  [...ds].sort((a, b) => b.score - a.score).forEach((d, i) => { d.pos = i + 1; });
}

function initCompetition() {
  try { const w = JSON.parse(localStorage.getItem("pesos") || "null"); if (w) COMP.forEach(([k]) => { if (typeof w[k] === "number") weights[k] = w[k]; }); } catch {}
  try { ajusteTempo = localStorage.getItem("ajusteTempo") !== "0"; } catch {}
  computeScores();
  const uniq = (k) => [...new Set(DATA.deputados.map((d) => d[k]))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("#c-partido").insertAdjacentHTML("beforeend", uniq("partido").map((p) => `<option>${esc(p)}</option>`).join(""));
  $("#c-uf").insertAdjacentHTML("beforeend", uniq("uf").map((p) => `<option>${esc(p)}</option>`).join(""));
  $("#c-ordem").innerHTML = `<option value="score">Maior nota</option><option value="-score">Menor nota</option>` +
    COMP.map(([k, n]) => `<option value="c:${k}">${n}</option>`).join("") +
    `<option value="recursosPagos">Mais recursos pagos (R$)</option><option value="cotaMes">Maior gasto de cota</option>`;
  ["#c-busca", "#c-partido", "#c-uf", "#c-ordem"].forEach((s) => $(s).addEventListener("input", () => { comp.shown = 25; renderLeague(); }));
  $("#c-more").addEventListener("click", () => { comp.shown += 25; renderLeague(); });
  $("#classes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cls]"); if (!b) return;
    comp.filter = comp.filter === b.dataset.cls ? "" : b.dataset.cls; comp.shown = 25; renderLeague();
  });
  $("#weights-body").addEventListener("input", (e) => {
    if (e.target.id === "w-tempo") {
      ajusteTempo = e.target.checked;
      try { localStorage.setItem("ajusteTempo", ajusteTempo ? "1" : "0"); } catch {}
      return rescore();
    }
    const k = e.target.dataset.w; if (!k) return;
    weights[k] = +e.target.value;
    try { localStorage.setItem("pesos", JSON.stringify(weights)); } catch {}
    rescore();
  });
  $("#weights-body").addEventListener("click", (e) => {
    if (e.target.id !== "w-reset") return;
    weights = Object.fromEntries(COMP.map(([k, , w]) => [k, w]));
    try { localStorage.removeItem("pesos"); } catch {}
    renderWeights(); rescore();
  });
  renderWeights();
  renderCompetition();
}

function rescore() {
  computeScores();
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  COMP.forEach(([k]) => { const el = $(`#w-val-${k}`); if (el) el.textContent = `${Math.round((weights[k] / wsum) * 100)}%`; });
  renderCompetition();
}

function renderWeights() {
  const wsum = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  $("#weights-body").innerHTML = `<p class="hint">Cada indicador vai de 0 a 100. A nota final é a média ponderada pelos pesos abaixo. Arraste para dar mais ou menos importância a cada um (zero ignora o indicador).</p>
    <div class="w-grid">${COMP.map(([k, n, , exp]) => `<label class="w-item">
      <span class="w-top"><b>${n}</b><span class="w-val" id="w-val-${k}">${Math.round((weights[k] / wsum) * 100)}%</span></span>
      <input type="range" min="0" max="50" step="5" value="${weights[k]}" data-w="${k}" aria-label="Peso de ${n}">
      <small>${exp}</small></label>`).join("")}</div>
    <label class="w-tempo"><input type="checkbox" id="w-tempo" ${ajusteTempo ? "checked" : ""}> <span><b>Compensar o tempo em exercício</b><small>Quem assumiu depois (suplentes) ou se afastou (ministros, licenças) tem projetos, aprovações, emendas e recursos proporcionalizados aos meses de mandato, estimados pelos meses com gasto de cota (mínimo de 12).</small></span></label>
    <button class="btn ghost sm" id="w-reset">Voltar aos pesos padrão</button>`;
}

function renderCompetition() {
  const top = [...DATA.deputados].sort((a, b) => a.pos - b.pos).slice(0, 3);
  const order = [1, 0, 2]; // 2º, 1º, 3º
  $("#podium").innerHTML = order.map((i) => {
    const d = top[i]; if (!d) return "";
    return `<div class="pod pod-${i + 1}" data-dep="${d.id}" tabindex="0">
      <img src="${esc(d.foto)}" alt=""><b>${esc(d.nome)}</b><small>${esc(d.partido)} · ${esc(d.uf)}</small>
      <span class="pod-score">${scoreFmt(d.score)}</span><span class="pod-step">${i + 1}º</span></div>`;
  }).join("");
  const counts = Object.fromEntries(CLASSES.map(([, n]) => [n, 0]));
  DATA.deputados.forEach((d) => counts[classOf(d.score)[1]]++);
  $("#classes").innerHTML = CLASSES.map(([min, n, cls], i) => {
    const max = i ? CLASSES[i - 1][0] : 100;
    return `<button class="cls-chip ${cls} ${comp.filter === n ? "on" : ""}" data-cls="${n}"><b>${counts[n]}</b> ${n} <small>${min}–${max}</small></button>`;
  }).join("");
  renderLeague();
}

const scoreFmt = (v) => Math.round(v).toString();

function renderLeague() {
  const q = norm($("#c-busca").value.trim()), p = $("#c-partido").value, uf = $("#c-uf").value, o = $("#c-ordem").value;
  let list = DATA.deputados.filter((d) => (!q || norm(d.nome).includes(q)) && (!p || d.partido === p) && (!uf || d.uf === uf)
    && (!comp.filter || classOf(d.score)[1] === comp.filter));
  const key = (d) => o === "score" ? d.score : o === "-score" ? -d.score : o.startsWith("c:") ? d.comp[o.slice(2)] : d[o];
  list.sort((a, b) => key(b) - key(a) || a.pos - b.pos);
  document.querySelectorAll("#classes [data-cls]").forEach((b) => b.classList.toggle("on", b.dataset.cls === comp.filter));
  $("#league tbody").innerHTML = list.length ? list.slice(0, comp.shown).map((d) => {
    const [, cls, css] = classOf(d.score);
    return `<tr data-dep="${d.id}" tabindex="0">
      <td class="pos">${d.pos}º</td>
      <td class="who-cell"><img loading="lazy" src="${esc(d.foto)}" alt=""><span><b>${esc(d.nome)}</b><small>${esc(d.partido)} · ${esc(d.uf)}</small></span></td>
      <td><div class="score-cell"><span class="score-num ${css}">${scoreFmt(d.score)}</span><span class="score-bar"><i class="${css}" style="width:${d.score}%"></i></span></div></td>
      <td>${fmt.format(d.projetos)}</td><td>${fmt.format(d.aprovados)}</td><td>${fmt.format(d.leis)}</td><td>${fmt.format(d.emendas)}</td>
      <td>${brlShort(d.recursosPagos)}</td><td>${brlShort(d.cotaMes)}</td>
      <td><span class="cls-tag ${css}">${cls}</span></td></tr>`;
  }).join("") : `<tr><td colspan="10" class="empty">Nenhum deputado com esses filtros.</td></tr>`;
  $("#c-more").style.display = list.length > comp.shown ? "" : "none";
}

function verdict(v) { return v >= 66 ? ["Acima da média", "v-up"] : v >= 33 ? ["Na média", "v-mid"] : ["Abaixo da média", "v-down"]; }

function scoreCard(d) {
  if (d.score == null) return "";
  const [, cls, css] = classOf(d.score);
  const total = DATA.deputados.length;
  const fortes = COMP.filter(([k]) => weights[k] > 0 && d.comp[k] >= 66).map(([, , , , , bom]) => bom);
  const fracos = COMP.filter(([k]) => weights[k] > 0 && d.comp[k] < 33).map(([, , , , ruim]) => ruim);
  const detail = {
    producao: `${fmt.format(d.projetos)} projetos`,
    aprovacao: `${fmt.format(d.aprovados)} aprovados · ${fmt.format(d.leis)} leis`,
    eficiencia: d.projetos ? `${pct(d.aprovados / d.projetos)} aprovados` : "nenhum projeto",
    emendas: `${fmt.format(d.emendas)} emendas`,
    recursos: `${brl(d.recursosPagos)} pagos de ${brl(d.recursosEmpenhados)} empenhados`,
    cota: `${brl(d.cotaMes)} por mês · ${brl(d.cota)} no mandato`,
  };
  const anos = Object.keys({ ...d.recursosAno, ...d.cotaAno }).sort();
  return `<div class="scorecard">
    <div class="sc-head">
      <div class="sc-score ${css}"><b>${scoreFmt(d.score)}</b><span>de 100</span></div>
      <div class="sc-title">
        <h3>Boletim do mandato atual · <span class="cls-tag ${css}">${cls}</span></h3>
        <p>${d.pos}º lugar entre ${total} deputados · cerca de ${d.cotaMeses} meses em exercício${ajusteTempo ? " (nota compensada pelo tempo)" : ""}. ${fracos.length ? `Pontos de atenção: <b>${fracos.join("; ").toLowerCase()}</b>.` : "Nenhum indicador abaixo da média."}${fortes.length ? ` Destaques: ${fortes.join("; ").toLowerCase()}.` : ""}</p>
      </div>
    </div>
    <div class="sc-rows">${COMP.map(([k, n, , exp]) => {
      const v = d.comp[k], [vt, vc] = verdict(v);
      return `<div class="sc-row ${weights[k] ? "" : "off"}" title="${esc(exp)}">
        <span class="sc-name">${n}<small>${detail[k]}</small></span>
        <span class="sc-track"><i class="${vc}" style="width:${v}%"></i></span>
        <span class="sc-val">${Math.round(v)}</span><span class="sc-verdict ${vc}">${weights[k] ? vt : "peso zero"}</span></div>`;
    }).join("")}</div>
    ${anos.length ? `<div class="sc-years"><span>Por ano:</span>${anos.map((a) => `<span><b>${a}</b> recursos ${brlShort(d.recursosAno[a] || 0)} · cota ${brlShort(d.cotaAno[a] || 0)}</span>`).join("")}</div>` : ""}
    <p class="sc-note">A nota compara volume e resultados registrados nos dados abertos com os demais deputados, não a qualidade das propostas. Os pesos podem ser ajustados na seção Competição.</p>
  </div>`;
}

function scoreRows(deps) {
  if (deps[0]?.score == null) return "";
  const line = (label, vals, show, lowerBetter) => {
    const max = Math.max(...vals, 0);
    const best = deps.length > 1 && vals.some((v) => v !== vals[0]) ? (lowerBetter ? Math.min(...vals) : max) : null;
    return `<tr class="score-row"><th scope="row">${label}</th>${vals.map((v) => `<td class="${v === best ? "best" : ""}"><b>${show(v)}</b><div class="cmp-bar"><i style="width:${max ? (v / max) * 100 : 0}%"></i></div></td>`).join("")}</tr>`;
  };
  return line("Nota de desempenho <small>(mandato atual)</small>", deps.map((d) => d.score), (v) => `${scoreFmt(v)} · ${classOf(v)[1]}`)
    + line("Recursos pagos <small>(emendas ao orçamento, mandato atual)</small>", deps.map((d) => d.recursosPagos), brlShort)
    + line("Cota por mês <small>(menor é melhor)</small>", deps.map((d) => d.cotaMes), brlShort, true);
}
