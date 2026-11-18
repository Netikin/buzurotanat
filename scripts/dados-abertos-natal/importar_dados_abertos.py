"""
Importa rotas e paradas do Portal de Dados Abertos da Mobilidade Urbana de Natal (dados.natal.br, STTU).

Os dados são de 2018 (licença Creative Commons Atribuição). Entram as linhas atuais mantidas na Rede de
Transição do edital CP 11.001/2026 que existem no portal — segundo a equipe do projeto, os itinerários
dessas linhas seguem os mesmos de 2018. Exceção: N-79 (teve alterações ainda não descritas em mapa).

Uso:
  python importar_dados_abertos.py <pasta-com-os-arquivos> <ruas-osm.json> <saida.geojson>

<pasta-com-os-arquivos>: KML/CSV baixados de http://dados.natal.br (nomes como
  rotas__guanabara__05.kml, paradas__guanabara__paradas.kml). Veja baixar_dados_abertos.py.
<ruas-osm.json>: malha viária do OpenStreetMap (Overpass, "out tags geom"), usada só para dar às
  paradas novas o nome da rua mais próxima.

Cada feature de saída é uma linha (MultiLineString [ida, volta]) com as paradas em ordem de passagem.
"""
import json, math, os, re, sys
import xml.etree.ElementTree as ET

PASTA, RUAS, SAIDA = sys.argv[1:4]
NS = '{http://www.opengis.net/kml/2.2}'

# linha 2026 -> (empresa no portal, arquivo de rota, código da linha no arquivo de paradas, extensão do edital)
LINHAS = {
    'N-05': ('guanabara', '05', '05'),
    'N-07': ('reunidas', '07', '07'),
    'N-27': ('reunidas', '27', '27'),
    'O-41A': ('conceicao', '41a', '41A'),
    'L-52': ('transportes-via-sul', '52', '52.122'),
    'O-59': ('conceicao', '59', '59'),
    'N-60': ('guanabara', '60', '60'),
    'N-70': ('guanabara', '70', '70'),
    'N-72': ('guanabara', '72', '72'),
    'N-77': ('guanabara', '77', '77'),
    'N-84': ('guanabara', '84', '84'),
    'O-24': ('santa-maria', '24', '24'),
    'L-37': ('santa-maria', '37', '37'),
    'L-51': ('transportes-via-sul', '51', '51.126'),
    # demais linhas atuais da transição presentes no portal (arquivo principal de cada linha)
    'N-02': ('guanabara', '02', '02'),
    'N-75': ('guanabara', '75a', '75A'),
    'O-21': ('conceicao', '21', '21'),
    'O-33': ('cidade-do-natal', '33', '33'),
    'O-33A': ('santa-maria', '33a', '33A'),
    'O-38': ('santa-maria', '38', '38'),
    'L-46': ('santa-maria', '46', '46'),
    'L-54': ('santa-maria', '54', '54'),
    'O-63': ('conceicao', '63', '63'),
    'O-83': ('conceicao', '83', '83'),
    '587': ('conceicao', '587', '587'),
    # N-79: fica de fora (alterações ainda não descritas em mapa)
}
# arquivo de paradas de cada empresa
ARQ_PARADAS = {
    'guanabara': 'paradas__guanabara__paradas.kml',
    'reunidas': 'paradas__reunidas__paradas.kml',
    'conceicao': 'paradas__concei-o__paradas.kml',
    'santa-maria': 'paradas__santa-maria__paradas.kml',
    'transportes-via-sul': 'paradas__via-sul__paradas.kml',
    'cidade-do-natal': 'paradas__cidade-do-natal__paradas.kml',
}


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110540)


def elementos(raiz, nome):
    """Elementos com esse nome, em qualquer namespace KML (2.1, 2.2, earth.google...)."""
    return [e for e in raiz.iter() if e.tag.split('}')[-1] == nome]


def texto_filho(e, nome):
    for c in e:
        if c.tag.split('}')[-1] == nome:
            return c.text
    return None


def trilha(arq):
    raiz = ET.parse(arq).getroot()
    pts = []
    for ls in elementos(raiz, 'LineString'):
        pts += [tuple(map(float, t.split(',')[:2])) for t in (texto_filho(ls, 'coordinates') or '').split()]
    # remove pontos repetidos seguidos
    limpo = [pts[0]] if pts else []
    for p in pts[1:]:
        if dist(p, limpo[-1]) > 0.5:
            limpo.append(p)
    return limpo


def projetar(p, coords, i0=0, i1=None):
    """(distância em m, índice fracionário) do ponto mais próximo da polilinha entre i0 e i1."""
    i1 = len(coords) - 1 if i1 is None else i1
    kx = 111320 * math.cos(math.radians(p[1]))
    melhor = (float('inf'), i0)
    for i in range(i0, i1):
        ax, ay = (coords[i][0] - p[0]) * kx, (coords[i][1] - p[1]) * 110540
        bx, by = (coords[i + 1][0] - p[0]) * kx, (coords[i + 1][1] - p[1]) * 110540
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
        d = math.hypot(ax + t * dx, ay + t * dy)
        if d < melhor[0]:
            melhor = (d, i + t)
    return melhor


def ler_paradas(arq):
    """{codigo: {'I': [(n, (lng, lat))], 'V': [...], 'RETORNO': (lng, lat), ...}}"""
    out = {}
    for pm in elementos(ET.parse(arq).getroot(), 'Placemark'):
        nm = (texto_filho(pm, 'name') or '').strip()
        cs = elementos(pm, 'coordinates')
        c = cs[0].text if cs else None
        if not c:
            continue
        xy = tuple(map(float, c.split(',')[:2]))
        m = re.match(r'^P0*(\d+)\s+([IV])\s+(\S+?)\*?$', nm)
        if m:
            out.setdefault(m.group(3).upper(), {}).setdefault(m.group(2), []).append((int(m.group(1)), xy))
            continue
        m = re.match(r'^(INICIO|RETORNO|FIM)\s+(\S+)$', nm)
        if m:
            out.setdefault(m.group(2).upper(), {})[m.group(1)] = xy
    return out


# ---------- nomes de rua (OSM) para as paradas ----------
ruas = []
for w in json.load(open(RUAS, encoding='utf-8'))['elements']:
    nome = (w.get('tags') or {}).get('name')
    g = [(p['lon'], p['lat']) for p in w.get('geometry', [])]
    if nome and len(g) > 1 and (w['tags'].get('highway') not in ('service', 'footway', 'path')):
        ruas.append((nome, g))


def rua_mais_proxima(p):
    melhor = (float('inf'), None)
    for nome, g in ruas:
        if min(abs(x - p[0]) for x, _ in g) > 0.003 or min(abs(y - p[1]) for _, y in g) > 0.003:
            continue
        d, _ = projetar(p, g)
        if d < melhor[0]:
            melhor = (d, nome)
    return melhor[1] if melhor[0] < 60 else None


paradas_por_empresa = {emp: ler_paradas(os.path.join(PASTA, arq)) for emp, arq in ARQ_PARADAS.items()}
features = []
for numero, (emp, arq_rota, cod_paradas) in LINHAS.items():
    coords = trilha(os.path.join(PASTA, f'rotas__{emp}__{arq_rota}.kml'))
    pts = paradas_por_empresa[emp].get(cod_paradas.upper(), {})
    cod_base = cod_paradas.split('.')[0].upper()
    marcos = paradas_por_empresa[emp].get(cod_base, {})
    retorno_xy = pts.get('RETORNO') or marcos.get('RETORNO')

    # Ponto de retorno: marcador RETORNO do portal; sem ele, a parada de ida de maior número
    if retorno_xy:
        _, idx_ret = projetar(retorno_xy, coords)
    else:
        ult_ida = max(pts.get('I', []), default=None)
        idx_ret = projetar(ult_ida[1], coords)[1] if ult_ida else len(coords) / 2
    # Confere o retorno: precisa ficar no "miolo" do percurso (30% a 70%) e longe do terminal.
    # Sem marcador ou com marcador fora disso, usa o ponto mais distante do terminal nesse miolo.
    acum_total = [0.0]
    for i in range(1, len(coords)):
        acum_total.append(acum_total[-1] + dist(coords[i - 1], coords[i]))
    total = acum_total[-1] or 1
    miolo = [i for i in range(len(coords)) if 0.3 <= acum_total[i] / total <= 0.7]
    mais_longe = max(miolo, key=lambda i: dist(coords[0], coords[i])) if miolo else len(coords) // 2
    i_ret = max(1, min(len(coords) - 2, round(idx_ret)))
    if not (0.3 <= acum_total[i_ret] / total <= 0.7) or dist(coords[0], coords[i_ret]) < 0.75 * dist(coords[0], coords[mais_longe]):
        retorno_xy = None  # marcador descartado
        i_ret = mais_longe
    corte = max(1, min(len(coords) - 2, i_ret))
    ida, volta = coords[:corte + 1], coords[corte:]

    # Paradas: ordenadas pela posição em que o ônibus passa (projeção no trecho do sentido)
    seq = {'IDA': [], 'VOLTA': []}
    for sentido, parte, chave in (('IDA', ida, 'I'), ('VOLTA', volta, 'V')):
        acum = [0.0]
        for i in range(1, len(parte)):
            acum.append(acum[-1] + dist(parte[i - 1], parte[i]))
        for n, xy in pts.get(chave, []):
            d, pos = projetar(xy, parte)
            if d > 60:
                continue  # parada longe da trilha (provável mudança de itinerário)
            i = min(int(pos), len(parte) - 2)
            metros = acum[i] + (pos - i) * dist(parte[i], parte[i + 1])
            seq[sentido].append({'lng': round(xy[0], 6), 'lat': round(xy[1], 6), 'metros': round(metros), 'codigo_portal': f'P{n} {chave} {cod_paradas}'})
        seq[sentido].sort(key=lambda s: s['metros'])
        for s in seq[sentido]:
            s['rua'] = rua_mais_proxima((s['lng'], s['lat']))

    km = (sum(dist(coords[i - 1], coords[i]) for i in range(1, len(coords)))) / 1000
    features.append({
        'type': 'Feature',
        'properties': {
            'numero': numero,
            'empresa_portal': emp,
            'arquivo_portal': f'rotas__{emp}__{arq_rota}.kml',
            'extensao_km': round(km, 2),
            'indice_retorno': corte,
            'paradas_ida': seq['IDA'],
            'paradas_volta': seq['VOLTA'],
        },
        'geometry': {'type': 'MultiLineString', 'coordinates': [[[round(x, 6), round(y, 6)] for x, y in ida], [[round(x, 6), round(y, 6)] for x, y in volta]]},
    })
    print(f"{numero}: {km:.2f} km | ida {len(ida)} pts, {len(seq['IDA'])} paradas | volta {len(volta)} pts, {len(seq['VOLTA'])} paradas | retorno {'marcado' if retorno_xy else 'estimado'}")

json.dump({
    'type': 'FeatureCollection',
    'fonte': 'Portal de Dados Abertos da Mobilidade Urbana de Natal (dados.natal.br) — STTU, 2018, licença CC BY. Nomes de rua: © colaboradores do OpenStreetMap.',
    'features': features,
}, open(SAIDA, 'w', encoding='utf-8'), ensure_ascii=False)
print('gravado', SAIDA)
