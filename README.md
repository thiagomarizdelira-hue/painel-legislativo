# Painel Legislativo

Painel independente sobre a produção legislativa dos **deputados federais em exercício**: projetos apresentados, aprovados, leis, emendas, PECs e requerimentos. Também traz recursos das emendas ao orçamento, gastos da cota parlamentar e uma nota de desempenho.

> Projeto independente, sem vínculo com a Câmara dos Deputados. Todos os dados são públicos.

## Funcionalidades

- Cartões dos 513 deputados com busca, filtros por partido/UF e ordenação
- Detalhe de cada deputado com listas clicáveis (leis, aprovados, emendas, PECs…) e filtro por **mandato** (desde 1987) e **ano**
- **Comparação** lado a lado de 2 ou 3 deputados, também por mandato e ano
- **Competição**: nota de 0 a 100, pódio, faixas (Excelente/Bom/Regular/Baixo) e pesos ajustáveis
- Instalável como app (PWA)

## Fontes de dados

- [Dados Abertos da Câmara dos Deputados](https://dadosabertos.camara.leg.br): deputados, mandatos, proposições e autorias
- [Portal da Transparência](https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares): emendas parlamentares ao orçamento
- [Cota parlamentar (CEAP)](https://www.camara.leg.br/transparencia/gastos-parlamentares): gastos declarados

Os dados são atualizados automaticamente toda segunda-feira pelo GitHub Actions (`.github/workflows/publicar.yml`). Para atualizar na hora: aba **Actions** → *Atualizar dados e publicar* → **Run workflow**.

## Rodar no computador

```bash
python3 scripts/atualizar_dados.py   # baixa os dados (~1,5 GB na primeira vez) e gera data/
python3 -m http.server 8080          # abra http://localhost:8080
```

## Metodologia

A metodologia completa está na seção **Sobre os dados** do site. A nota de desempenho mede volume e resultado registrados nos dados abertos, não a qualidade das propostas.
