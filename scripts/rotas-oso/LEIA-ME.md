# Traçados das linhas atuais (OSO da STTU)

As linhas do sistema atual que continuam na Rede de Transição (N-02, O-59, L-54…) não têm
arquivo de mapa oficial. Mas a STTU publica, para cada linha, a **Ordem de Serviço Operacional (OSO)**
em PDF, com o itinerário rua por rua (ida e volta), a extensão e os horários.

**Atenção:** as OSOs publicadas são a programação de **domingos e feriados** (tarifa gratuita, com itinerários de integração).
Por isso o site usa esses traçados só no dia "Domingos e feriados" — e só para linhas que o edital prevê operando aos domingos.
A rota de dias úteis e sábados das linhas atuais ainda não foi divulgada.

Página das OSOs:
https://www.natal.rn.gov.br/sttu/oso

Estes scripts transformam essas listas de ruas em traçado no mapa:

1. `ler_oso.py <pasta-com-os-pdfs>` lê os PDFs (nomeados pelo código da linha, ex.: `N-02.pdf`)
   e gera `oso.json` com nome, extensão, vigência e as ruas de ida e volta.
2. `tracar.py <ruas.json> <oso.json> <saida.json>` traça o ciclo completo (terminal → ruas da ida → retorno → ruas da volta → terminal) na malha viária do OpenStreetMap
   (`ruas.json`, baixado pela Overpass API), percorrendo as ruas **na ordem da OSO** e
   respeitando as mãos de direção. Mostra a extensão encontrada e a diferença para a extensão oficial.
3. `exportar_rotas.py <saida.json> ../../dados/rotas-oso-sttu.geojson` grava o arquivo do site.
   Uma linha só é exportada se a extensão traçada ficar a até 15% da oficial nos dois sentidos.
4. `node scripts/aplicar-rede-transicao-2026.js` incorpora os traçados, liga as paradas a até 25 m
   do trajeto e publica a rota só em "Domingos e feriados" (situação "parcial": rota só de domingo).

Requer Python 3 com `pypdf` (`pip install pypdf`).

Para baixar a malha viária (Natal e Parnamirim):

```
[out:json][timeout:180];
way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road|busway|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](-6.03,-35.34,-5.69,-35.14);
out tags geom;
```

O traçado é uma reconstrução: confira no mapa antes de publicar. Dados viários © colaboradores do
OpenStreetMap (ODbL).
