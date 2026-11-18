# Dados abertos da STTU (dados.natal.br)

O **Portal da Transparência da Mobilidade Urbana de Natal** (https://dadosabertos.natal.br) publica, no
CKAN em http://dados.natal.br, dados de **linhas, itinerários, horários, paradas e rotas** de cada empresa.
Licença: Creative Commons Atribuição — cite a fonte (STTU / dados.natal.br).

**Atenção:** os arquivos são de **novembro de 2018** e não foram atualizados desde então. Segundo a equipe
do projeto, as linhas atuais mantidas na Rede de Transição seguem os mesmos itinerários de 2018, então
usamos a rota de todas as que existem no portal (25 linhas), **exceto a N-79**, que teve alterações ainda
não descritas em mapa. O site mostra a extensão da trilha de 2018 ao lado da extensão do edital.
Sem arquivo no portal: N-15 e 585.

O que cada arquivo traz:
- `rotas__<empresa>__<linha>.kml`: trilha de GPS do ônibus (ida e volta, na ordem em que ele anda).
- `paradas__<empresa>__paradas.kml`: paradas de cada linha, nomeadas `P<nº> <I|V> <linha>`
  (I = ida, V = volta), mais os marcadores `INICIO`, `RETORNO` e `FIM` de cada linha.
- `linhas`, `itinerarios`, `horarios` (CSV, ISO-8859-1): dados de 2018, não usados no site.

## Como atualizar

```
python baixar_dados_abertos.py <pasta>
python importar_dados_abertos.py <pasta> <ruas-osm.json> ../../dados/rotas-dadosabertos-2018.geojson
node ../aplicar-rede-transicao-2026.js
```

`ruas-osm.json` é a malha viária do OpenStreetMap (consulta Overpass em `scripts/rotas-oso/LEIA-ME.md`),
usada para dar às paradas o nome da rua mais próxima.

`aplicar-rede-transicao-2026.js` (etapa 2c) usa a trilha como **rota de dias úteis e sábados**
(aos domingos vale a OSO, quando houver), cria as paradas que ainda não existem (ids `DA-…`),
reaproveita as que estão a até 20 m e troca nomes genéricos ("Via Local (Natal)") pelo nome da rua.
