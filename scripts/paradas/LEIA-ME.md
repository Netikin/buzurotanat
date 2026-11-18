# Nomes e bairros das paradas

`nomear_paradas.py` troca nomes genéricos de paradas ("Via Local (Natal)", "Via Direta - …", "Parada Virtual",
só o nome da rua) por um nome que ajuda o passageiro a reconhecer o lugar, e preenche o **bairro** de todas:

1. rua + ponto de referência a até 70 m → `Av. Prudente de Morais • Hospital X`
2. rua + esquina a até 60 m → `Av. Senador Salgado Filho, esq. Av. Dão Silveira`
3. só a rua → `Av. Nevaldo Rocha`
4. sem rua conhecida: referência próxima ou a coordenada

Nomes próprios (terminais, estações, shoppings, nomes vindos do OSM) não são alterados.

```
python nomear_paradas.py ../../dados/paradas.json ruas.json pois.json bairros.json
```

Consultas Overpass (https://overpass-api.de/api/interpreter) usadas para gerar os arquivos:

- `ruas.json`: veja `scripts/rotas-oso/LEIA-ME.md`.
- `pois.json` (pontos de referência):
  ```
  [out:json][timeout:180];(
  nwr["name"]["amenity"~"^(school|university|college|hospital|clinic|place_of_worship|marketplace|bank|police|fire_station|townhall|library|bus_station|fuel|pharmacy|community_centre|courthouse|kindergarten|cinema|theatre|post_office)$"](-6.03,-35.34,-5.69,-35.14);
  nwr["name"]["shop"~"^(supermarket|mall|department_store|wholesale)$"](-6.03,-35.34,-5.69,-35.14);
  nwr["name"]["leisure"~"^(park|stadium|sports_centre)$"](-6.03,-35.34,-5.69,-35.14);
  nwr["name"]["tourism"~"^(attraction|museum|hotel)$"](-6.03,-35.34,-5.69,-35.14);
  nwr["name"]["place"="square"](-6.03,-35.34,-5.69,-35.14);
  nwr["name"]["public_transport"="station"](-6.03,-35.34,-5.69,-35.14););
  out center tags;
  ```
- `bairros.json` (os 36 bairros de Natal):
  ```
  [out:json][timeout:180];area["name"="Natal"]["admin_level"="8"]->.a;
  rel(area.a)["boundary"="administrative"]["admin_level"="10"];out geom;
  ```

Rode depois de `node scripts/aplicar-rede-transicao-2026.js` sempre que ele criar paradas novas
(elas nascem só com o nome da rua). Dados © colaboradores do OpenStreetMap (ODbL).
