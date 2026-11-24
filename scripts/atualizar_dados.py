#!/usr/bin/env python3
"""
Gera os dados do Painel Legislativo a partir dos Dados Abertos da Câmara dos Deputados.

Saídas:
  data/deputados.json   deputados em exercício + números da legislatura atual (cartões, ranking)
  data/deps/{id}.json   todas as proposições de cada deputado, em todos os mandatos
                        (usadas no detalhe do deputado, com filtro por mandato e por ano)

Fontes (públicas, sem autenticação):
  - API:      https://dadosabertos.camara.leg.br/api/v2/deputados  (em exercício e por legislatura)
  - Arquivos: https://dadosabertos.camara.leg.br/arquivos/proposicoes/csv/proposicoes-{ano}.csv
              https://dadosabertos.camara.leg.br/arquivos/proposicoesAutores/csv/proposicoesAutores-{ano}.csv

Uso:  python3 scripts/atualizar_dados.py                     (usa cache em data/raw se existir)
      python3 scripts/atualizar_dados.py --refresh           (baixa tudo de novo)
      python3 scripts/atualizar_dados.py --refresh-recentes  (baixa de novo só a legislatura atual,
                                                              emendas e cota; anos antigos do cache)
"""
import csv
import io
import json
import unicodedata
import zipfile
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path

csv.field_size_limit(sys.maxsize)

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "deputados.json"
OUT_DEPS = ROOT / "data" / "deps"

API = "https://dadosabertos.camara.leg.br/api/v2"
ARQ = "https://dadosabertos.camara.leg.br/arquivos"
LEGISLATURA_ATUAL = 57
PRIMEIRA_LEGISLATURA = 48            # 1987–1991
ANO_INICIAL = 1987
ANOS = list(range(ANO_INICIAL, date.today().year + 1))
ANO_RECENTE = 2023  # início da legislatura atual
REFRESH = "--refresh" in sys.argv
# --refresh-recentes: baixa de novo só o que muda com frequência (legislatura atual, emendas, cota)
# e reaproveita do cache os anos antigos. Usado na atualização automática semanal.
REFRESH_RECENTES = "--refresh-recentes" in sys.argv
URL_EMENDAS = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO"
URL_COTA = "https://www.camara.leg.br/cotas/Ano-{ano}.csv.zip"
# Emendas ao orçamento do ano Y são apresentadas no ano Y-1: o mandato atual (desde fev/2023)
# é autor das emendas dos orçamentos de 2024 em diante.
PRIMEIRO_ORCAMENTO_DO_MANDATO = 2024

# ---------------------------------------------------------------- categorias
PROJETOS = {"PL", "PLP", "PEC", "PDL", "PRC", "PLV", "PLN"}
REQUERIMENTOS = {"REQ", "RIC", "INC", "RCP"}


def eh_emenda(sigla: str) -> bool:
    return sigla.startswith("EM") or sigla in {"ESB", "EMS", "SBE"}


def grupo_de(tipo: str) -> str:
    if eh_emenda(tipo):
        return "emenda"
    if tipo in REQUERIMENTOS:
        return "req"
    if tipo in PROJETOS:
        return "proj"
    return "outro"


def classificar_situacao(sit: str) -> str:
    s = (sit or "").lower()
    if "norma jurídica" in s or "transformad" in s:
        return "lei"
    if any(k in s for k in ("sanção", "promulgação", "apreciação pelo senado",
                            "remetida ao senado", "enviada ao senado", "envio ao senado",
                            "envio ao executivo", "aprovad")):
        return "aprovado"
    if any(k in s for k in ("arquivad", "arquivo", "tramitação finalizada", "retirad",
                            "prejudicad", "rejeitad",
                            "devolvid", "vetad", "perdeu a eficácia", "inadmitid")):
        return "encerrado"
    return "tramitando"


def legislatura_da_data(iso: str) -> int:
    """Legislaturas começam em 1º de fevereiro, a cada 4 anos desde 1987 (48ª)."""
    ano = int(iso[:4]) - (1 if iso[5:10] < "02-01" else 0)
    return PRIMEIRA_LEGISLATURA + (ano - ANO_INICIAL) // 4


def periodo(leg: int):
    ini = ANO_INICIAL + (leg - PRIMEIRA_LEGISLATURA) * 4
    return f"{ini}-02-01", f"{ini + 4}-01-31"


# ---------------------------------------------------------------- utilitários
def get_json(url: str):
    req = urllib.request.Request(url, headers={"Accept": "application/json",
                                               "User-Agent": "painel-deputados/1.0"})
    for tentativa in range(5):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            print(f"  erro ({e}); nova tentativa…", file=sys.stderr)
            time.sleep(2 + tentativa * 2)
    raise RuntimeError(f"falha ao obter {url}")


def paginar(url: str):
    itens = []
    while url:
        j = get_json(url)
        itens.extend(j["dados"])
        url = next((l["href"] for l in j["links"] if l["rel"] == "next"), None)
    return itens


def baixar(url: str, destino: Path, recente: bool = False):
    """Baixa para o cache; devolve None se o arquivo não existir na Câmara."""
    if destino.exists() and not (REFRESH or (REFRESH_RECENTES and recente)):
        return destino
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".part")
    print(f"  baixando {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "painel-deputados/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r, open(tmp, "wb") as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print("    (não disponível)")
            return None
        raise
    tmp.rename(destino)
    return destino


def ler_csv(path: Path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f, delimiter=";")


def sem_acento(txt: str) -> str:
    txt = unicodedata.normalize("NFD", txt or "")
    return "".join(c for c in txt if unicodedata.category(c) != "Mn").upper().strip()


def valor_br(txt: str) -> float:
    try:
        return float((txt or "0").replace(".", "").replace(",", "."))
    except ValueError:
        return 0.0


# ---------------------------------------------------------------- etapas
def deputados_em_exercicio():
    print("1/6 Deputados em exercício (API)…")
    deps = paginar(f"{API}/deputados?ordem=ASC&ordenarPor=nome&itens=100")
    print(f"  {len(deps)} deputados")
    return deps


def mandatos(ids):
    print("2/6 Mandatos de cada deputado (API, por legislatura)…")
    por_dep = defaultdict(set)
    for leg in range(PRIMEIRA_LEGISLATURA, LEGISLATURA_ATUAL + 1):
        for d in paginar(f"{API}/deputados?idLegislatura={leg}&itens=100"):
            if d["id"] in ids:
                por_dep[d["id"]].add(leg)
    return por_dep


def carregar_autorias(ids_deputados):
    print("3/6 Autorias (arquivos anuais)…")
    autorias = defaultdict(dict)  # idDep -> {idProp: ordemAssinatura}
    for ano in ANOS:
        p = baixar(f"{ARQ}/proposicoesAutores/csv/proposicoesAutores-{ano}.csv",
                   RAW / f"proposicoesAutores-{ano}.csv", recente=ano >= ANO_RECENTE)
        if not p:
            continue
        for row in ler_csv(p):
            dep = row.get("idDeputadoAutor")
            if not dep or int(dep) not in ids_deputados or row.get("proponente") != "1":
                continue
            ordem = int(row.get("ordemAssinatura") or 99)
            atual = autorias[int(dep)].get(row["idProposicao"], 99)
            autorias[int(dep)][row["idProposicao"]] = min(atual, ordem)
    return autorias


def carregar_proposicoes(necessarias):
    print("4/6 Proposições (arquivos anuais)…")
    props = {}
    for ano in ANOS:
        p = baixar(f"{ARQ}/proposicoes/csv/proposicoes-{ano}.csv", RAW / f"proposicoes-{ano}.csv", recente=ano >= ANO_RECENTE)
        if not p:
            continue
        for row in ler_csv(p):
            if row["id"] not in necessarias:
                continue
            data_ap = (row.get("dataApresentacao") or "")[:10]
            if len(data_ap) != 10:
                continue
            props[row["id"]] = {
                "tipo": row["siglaTipo"],
                "numero": row["numero"],
                "ano": row["ano"],
                "ementa": " ".join((row["ementa"] or "").split())[:280],
                "situacao": row["ultimoStatus_descricaoSituacao"],
                "data": data_ap,
            }
    print(f"  {len(props)} proposições de autoria dos deputados atuais")
    return props


def carregar_emendas_orcamento(deps):
    """Emendas individuais ao orçamento (Portal da Transparência), ligadas ao deputado pelo nome."""
    print("5/6 Emendas ao orçamento (Portal da Transparência)…")
    z = baixar(URL_EMENDAS, RAW / "emendas" / "EmendasParlamentares.zip", recente=True)
    por_nome = {sem_acento(d["nome"]): d["id"] for d in deps}
    res = defaultdict(lambda: {"empenhado": 0.0, "pago": 0.0, "qtd": 0, "anos": defaultdict(float)})
    with zipfile.ZipFile(z) as zf, zf.open("EmendasParlamentares.csv") as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";"):
            if not r["Tipo de Emenda"].startswith("Emenda Individual"):
                continue
            ano = int(r["Ano da Emenda"] or 0)
            dep = por_nome.get(sem_acento(r["Nome do Autor da Emenda"]))
            if not dep or ano < PRIMEIRO_ORCAMENTO_DO_MANDATO:
                continue
            pago = valor_br(r["Valor Pago"]) + valor_br(r["Valor Restos A Pagar Pagos"])
            e = res[dep]
            e["empenhado"] += valor_br(r["Valor Empenhado"])
            e["pago"] += pago
            e["qtd"] += 1
            e["anos"][ano] += pago
    print(f"  {len(res)} deputados com emendas individuais desde o orçamento de {PRIMEIRO_ORCAMENTO_DO_MANDATO}")
    return res


def carregar_cota(ids):
    """Gastos da cota parlamentar (CEAP) por deputado, da legislatura atual."""
    print("6/6 Cota parlamentar (Câmara)…")
    inicio = int(periodo(LEGISLATURA_ATUAL)[0][:4])
    res = defaultdict(lambda: {"total": 0.0, "meses": set(), "anos": defaultdict(float)})
    for ano in range(inicio, date.today().year + 1):
        z = baixar(URL_COTA.format(ano=ano), RAW / "cotas" / f"Ano-{ano}.csv.zip", recente=True)
        if not z:
            continue
        with zipfile.ZipFile(z) as zf, zf.open(f"Ano-{ano}.csv") as f:
            for r in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"), delimiter=";"):
                dep = int(r["ideCadastro"]) if r["ideCadastro"].isdigit() else None
                if dep not in ids:
                    continue
                v = float(r["vlrLiquido"] or 0)
                c = res[dep]
                c["total"] += v
                c["anos"][ano] += v
                c["meses"].add((ano, r["numMes"]))
    return res


def main():
    deps = deputados_em_exercicio()
    ids = {d["id"] for d in deps}
    mand = mandatos(ids)
    autorias = carregar_autorias(ids)
    necessarias = {pid for a in autorias.values() for pid in a}
    props = carregar_proposicoes(necessarias)
    emendas_orc = carregar_emendas_orcamento(deps)
    cota = carregar_cota(ids)

    inicio_atual, _ = periodo(LEGISLATURA_ATUAL)
    situacoes = Counter()
    unicos = defaultdict(set)  # métricas da legislatura atual sem dupla contagem de coautoria
    saida = []
    OUT_DEPS.mkdir(parents=True, exist_ok=True)

    for d in deps:
        c, por_tipo, lista = Counter(), Counter(), []
        legs_com_props = set()
        for pid, ordem in autorias.get(d["id"], {}).items():
            p = props.get(pid)
            if not p:
                continue
            tipo, cat, grupo = p["tipo"], classificar_situacao(p["situacao"]), grupo_de(p["tipo"])
            leg = legislatura_da_data(p["data"])
            legs_com_props.add(leg)
            # [id, tipo, numero, ano, data, situacao, grupo, categoria, 1º autor, ementa]
            lista.append([int(pid), tipo, p["numero"], p["ano"], p["data"], p["situacao"],
                          grupo, cat, 1 if ordem == 1 else 0, p["ementa"]])
            if grupo == "proj":
                c["carreira_projetos"] += 1
            if p["data"] < inicio_atual:
                continue
            # ---- números da legislatura atual (cartões, ranking, comparação)
            situacoes[p["situacao"]] += 1
            por_tipo[tipo] += 1
            c["total"] += 1
            if ordem == 1:
                c["autorPrincipal"] += 1
            if grupo == "emenda":
                c["emendas"] += 1
                unicos["emendas"].add(pid)
            elif grupo == "req":
                c["requerimentos"] += 1
            elif grupo == "proj":
                c["projetos"] += 1
                c[f"proj_{cat}"] += 1
                unicos["projetos"].add(pid)
                unicos[cat].add(pid)
                if tipo == "PEC":
                    c["pecs"] += 1

        lista.sort(key=lambda x: (x[4], x[0]), reverse=True)
        (OUT_DEPS / f"{d['id']}.json").write_text(
            json.dumps(lista, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

        legs = sorted(mand.get(d["id"], set()) | {LEGISLATURA_ATUAL}, reverse=True)
        saida.append({
            "id": d["id"],
            "nome": d["nome"],
            "partido": d["siglaPartido"],
            "uf": d["siglaUf"],
            "foto": d["urlFoto"],
            "email": d.get("email"),
            "mandatos": legs,
            "total": c["total"],
            "autorPrincipal": c["autorPrincipal"],
            "projetos": c["projetos"],
            "pecs": c["pecs"],
            "emendas": c["emendas"],
            "requerimentos": c["requerimentos"],
            "leis": c["proj_lei"],
            "aprovados": c["proj_lei"] + c["proj_aprovado"],
            "tramitando": c["proj_tramitando"],
            "encerrados": c["proj_encerrado"],
            "projetosCarreira": c["carreira_projetos"],
            "recursosEmpenhados": round(emendas_orc[d["id"]]["empenhado"]) if d["id"] in emendas_orc else 0,
            "recursosPagos": round(emendas_orc[d["id"]]["pago"]) if d["id"] in emendas_orc else 0,
            "recursosAno": {a: round(v) for a, v in sorted(emendas_orc[d["id"]]["anos"].items())} if d["id"] in emendas_orc else {},
            "cota": round(cota[d["id"]]["total"]) if d["id"] in cota else 0,
            "cotaMeses": len(cota[d["id"]]["meses"]) if d["id"] in cota else 0,
            "cotaAno": {a: round(v) for a, v in sorted(cota[d["id"]]["anos"].items())} if d["id"] in cota else {},
            "porTipo": dict(por_tipo.most_common()),
        })

    legislaturas = {leg: dict(zip(("inicio", "fim"), periodo(leg)))
                    for leg in range(PRIMEIRA_LEGISLATURA, LEGISLATURA_ATUAL + 1)}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "atualizadoEm": datetime.now().isoformat(timespec="seconds"),
        "inicioLegislatura": inicio_atual,
        "primeiroOrcamento": PRIMEIRO_ORCAMENTO_DO_MANDATO,
        "legislatura": LEGISLATURA_ATUAL,
        "legislaturas": legislaturas,
        "resumo": {
            "deputados": len(saida),
            "projetos": len(unicos["projetos"]),
            "aprovados": len(unicos["lei"]) + len(unicos["aprovado"]),
            "leis": len(unicos["lei"]),
            "tramitando": len(unicos["tramitando"]),
            "emendas": len(unicos["emendas"]),
        },
        "deputados": saida,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nOK → {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    print("\nSituações mais comuns na legislatura atual (para conferência):")
    for s, n in situacoes.most_common(15):
        print(f"  {n:>7}  [{classificar_situacao(s):<10}] {s}")


if __name__ == "__main__":
    main()
