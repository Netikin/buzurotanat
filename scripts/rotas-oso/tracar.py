"""
Gera o traçado de cada linha a partir da sequência oficial de ruas (OSO/STTU),
casando os nomes com a malha viária do OpenStreetMap e buscando o menor caminho
que percorre as ruas NA ORDEM da OSO (Dijkstra em camadas: estado = (nó, índice da rua)).
"""
import heapq, json, math, re, sys, unicodedata
from collections import defaultdict

RUAS = sys.argv[1]
OSO = sys.argv[2]
SAIDA = sys.argv[3]
SO = sys.argv[4:]  # opcional: só estas linhas

ABREV = {
    'AV': 'AVENIDA', 'R': 'RUA', 'TV': 'TRAVESSA', 'TRAV': 'TRAVESSA', 'DR': 'DOUTOR', 'GOV': 'GOVERNADOR',
    'PRES': 'PRESIDENTE', 'ENG': 'ENGENHEIRO', 'PROF': 'PROFESSOR', 'PROFA': 'PROFESSORA', 'SEN': 'SENADOR',
    'CEL': 'CORONEL', 'CAP': 'CAPITAO', 'STA': 'SANTA', 'STO': 'SANTO', 'ALM': 'ALMIRANTE', 'MAL': 'MARECHAL',
    'DES': 'DESEMBARGADOR', 'DEP': 'DEPUTADO', 'GEN': 'GENERAL', 'MONS': 'MONSENHOR', 'PE': 'PADRE',
    'BACH': 'BACHAREL', 'TEN': 'TENENTE', 'VER': 'VEREADOR', 'ROD': 'RODOVIA', 'PCA': 'PRACA', 'PC': 'PRACA',
    'ESTR': 'ESTRADA', 'JOR': 'JORNALISTA', 'MIN': 'MINISTRO', 'SGT': 'SARGENTO', 'BRIG': 'BRIGADEIRO',
}
TIPOS = {'AVENIDA', 'RUA', 'TRAVESSA', 'PRACA', 'RODOVIA', 'ESTRADA', 'VIADUTO', 'PONTE', 'TUNEL', 'ALAMEDA', 'LARGO', 'VIA', 'BECO'}
VAZIAS = {'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'D'}


def normalizar(nome):
    s = unicodedata.normalize('NFKD', nome.upper()).encode('ascii', 'ignore').decode()
    s = re.sub(r'\(.*?\)', ' ', s)
    s = re.sub(r'\bBR\s*-?\s*(\d+)', r'BR\1', s)
    s = re.sub(r'\bRN\s*-?\s*(\d+)', r'RN\1', s)
    s = re.sub(r'[^A-Z0-9 ]', ' ', s)
    toks = []
    for t in s.split():
        t = ABREV.get(t, t)
        if t in VAZIAS:
            continue
        toks.append(t)
    return toks


def nucleo(toks):
    return [t for t in toks if t not in TIPOS]


def casa(oso_toks, osm_toks):
    """Pontuação de 0 a 1: quanto do nome da OSO aparece no nome do OSM (aceita iniciais abreviadas)."""
    a, b = nucleo(oso_toks), set(nucleo(osm_toks))
    if not a or not b:
        return 0.0
    ok = 0
    for t in a:
        if t in b:
            ok += 1
        elif len(t) == 1 and any(x.startswith(t) for x in b):  # "MOEMA T. DA C. LIMA"
            ok += 0.8
        elif len(t) >= 6 and any(x.startswith(t[:5]) or t.startswith(x[:5]) for x in b if len(x) >= 5):
            ok += 0.7  # grafias diferentes (TOCANTINEA x TOCANTINIA)
    tipo_a = [t for t in oso_toks if t in TIPOS]
    tipo_b = [t for t in osm_toks if t in TIPOS]
    pen = 0.85 if (tipo_a and tipo_b and tipo_a[0] != tipo_b[0]) else 1.0
    return pen * ok / len(a)


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110540)


# ---------- grafo viário ----------
dados = json.load(open(RUAS, encoding='utf-8'))
adj = defaultdict(list)  # no -> [(no2, comprimento, id_via)]
radj = defaultdict(list)  # arestas invertidas (para estender o início de trás para frente)
INF = float('inf')
vias = {}
coord = {}
for w in dados['elements']:
    t = w.get('tags', {})
    g = [(round(p['lon'], 7), round(p['lat'], 7)) for p in w.get('geometry', [])]
    if len(g) < 2:
        continue
    if t.get('highway') == 'service' and t.get('service') in ('parking_aisle', 'driveway', 'drive-through'):
        continue
    if t.get('access') in ('private', 'no') and t.get('bus') not in ('yes', 'designated') and t.get('psv') not in ('yes', 'designated'):
        continue
    nome = t.get('name') or t.get('alt_name') or t.get('ref') or ''
    nomes = [normalizar(n) for n in {t.get('name', ''), t.get('alt_name', ''), t.get('official_name', ''), t.get('old_name', ''), t.get('ref', '')} if n]
    ow = t.get('oneway', 'no')
    if t.get('junction') in ('roundabout', 'circular') and ow == 'no':
        ow = 'yes'
    if t.get('oneway:bus') == 'no' or t.get('oneway:psv') == 'no' or t.get('busway') == 'opposite_lane':
        ow = 'no'
    if t.get('highway') in ('motorway', 'motorway_link') and ow == 'no' and 'oneway' not in t:
        ow = 'yes'
    vias[w['id']] = {'nomes': nomes, 'nome': nome, 'hw': t.get('highway')}
    for i in range(len(g) - 1):
        a, b = g[i], g[i + 1]
        coord[a], coord[b] = a, b
        L = dist(a, b)
        arestas = [(a, b)] if ow in ('yes', 'true', '1') else [(b, a)] if ow == '-1' else [(a, b), (b, a)]
        for u, v in arestas:
            adj[u].append((v, L, w['id']))
            radj[v].append((u, L, w['id']))

PESO_HW = {'residential': 1.15, 'service': 1.6, 'living_street': 1.6, 'unclassified': 1.1, 'road': 1.3}


def tracar(ruas_oso, estende=True):
    alvo = [normalizar(r) for r in ruas_oso]
    n = len(alvo)
    # vias que casam com cada rua da OSO
    casa_via = {}
    for vid, v in vias.items():
        m = {}
        for k, a in enumerate(alvo):
            s = max((casa(a, b) for b in v['nomes']), default=0)
            if s >= 0.74:
                m[k] = s
        if m:
            casa_via[vid] = m
    encontradas = sorted({k for m in casa_via.values() for k in m})
    # início: nós das vias da primeira rua encontrada
    k0 = encontradas[0] if encontradas else 0
    inicio = {a for a, lst in adj.items() for (_, _, vid) in lst if k0 in casa_via.get(vid, {})}
    if not inicio:
        return None, encontradas
    INF = float('inf')
    melhor = {}
    pq = []
    for a in inicio:
        melhor[(a, k0)] = 0.0
        heapq.heappush(pq, (0.0, a, k0))
    anterior = {}
    fim = None
    ultimo = max(encontradas)
    while pq:
        d, a, k = heapq.heappop(pq)
        if d > melhor.get((a, k), INF):
            continue
        if k == ultimo:
            fim = (a, k)
            break
        for b, L, vid in adj[a]:
            m = casa_via.get(vid, {})
            hw = PESO_HW.get(vias[vid]['hw'], 1.0)
            opcoes = []
            if k in m:
                opcoes.append((k, L))
            for salto in (1, 2, 3):
                kk = k + salto
                if kk in m:
                    # pular ruas da OSO custa caro (só quando a rua não existe/está com outro nome no OSM)
                    opcoes.append((kk, L + (salto - 1) * 400))
                    break
            if not opcoes:
                opcoes.append((k, L * 3.0 * hw + 2))  # ligação por rua fora da lista (curta, de preferência)
            for kk, c in opcoes:
                nd = d + c
                if nd < melhor.get((b, kk), INF):
                    melhor[(b, kk)] = nd
                    anterior[(b, kk)] = (a, k, vid)
                    heapq.heappush(pq, (nd, b, kk))
    if not fim:
        return None, encontradas
    caminho = [fim]
    seq_vias = []
    while caminho[-1] in anterior:
        a, k, vid = anterior[caminho[-1]]
        seq_vias.append(vid)
        caminho.append((a, k))
    caminho.reverse()
    seq_vias.reverse()
    pts = [c[0] for c in caminho]
    # primeiro ponto do caminho em que cada rua da OSO passa a ser percorrida
    marcos = {}
    for (no, k) in caminho:
        if k not in marcos:
            marcos[k] = no

    # As pontas: o menor caminho entra na 1ª rua e sai da última no ponto mais conveniente,
    # cortando o trecho até o terminal. Estende pela própria rua até a extremidade (máx. 1,5 km).
    def estender(no, k, para_tras):
        grafo = radj if para_tras else adj
        dist_ = {no: 0.0}
        prev = {}
        fila = [(0.0, no)]
        while fila:
            d, a = heapq.heappop(fila)
            if d > dist_.get(a, INF):
                continue
            for b, L, vid in grafo[a]:
                if k not in casa_via.get(vid, {}):
                    continue
                nd = d + L
                if nd <= 1500 and nd < dist_.get(b, INF):
                    dist_[b] = nd
                    prev[b] = a
                    heapq.heappush(fila, (nd, b))
        alvo_ = max(dist_, key=dist_.get)
        trecho = [alvo_]
        while trecho[-1] in prev:
            trecho.append(prev[trecho[-1]])
        # trecho vai do extremo até 'no'
        return trecho if para_tras else list(reversed(trecho))

    if estende:
        pre = estender(pts[0], k0, True)       # extremo -> início
        pos = estender(pts[-1], ultimo, False)  # fim -> extremo
        pts = pre[:-1] + pts + pos[1:]
    return {'coords': pts, 'vias': seq_vias, 'marcos': marcos}, encontradas


def menor_caminho(origem, destino, limite=6000):
    """Menor caminho comum (respeitando mão de direção) — usado para fechar o ciclo no terminal."""
    if origem == destino:
        return [origem]
    distancia = {origem: 0.0}
    prev = {}
    fila = [(0.0, origem)]
    while fila:
        d, a = heapq.heappop(fila)
        if a == destino:
            break
        if d > distancia.get(a, INF) or d > limite:
            continue
        for b, L, vid in adj[a]:
            nd = d + L * PESO_HW.get(vias[vid]['hw'], 1.0)
            if nd < distancia.get(b, INF):
                distancia[b] = nd
                prev[b] = a
                heapq.heappush(fila, (nd, b))
    if destino not in prev:
        return None
    trecho = [destino]
    while trecho[-1] != origem:
        trecho.append(prev[trecho[-1]])
    return list(reversed(trecho))


def comprimento(c):
    return sum(dist(c[i - 1], c[i]) for i in range(1, len(c)))


oso = json.load(open(OSO, encoding='utf-8'))
resultado = {}
for cod, info in oso.items():
    if cod != info['codigo']:
        continue
    if SO and cod not in SO:
        continue
    ida_ruas, volta_ruas = info['ida'], info['volta']
    # Um ciclo só: terminal -> ruas da ida -> retorno -> ruas da volta; depois fecha no ponto de partida.
    r, achadas = tracar(ida_ruas + volta_ruas, estende=False)
    if not r:
        print(f'{cod}: FALHOU (ruas encontradas {len(achadas)}/{len(ida_ruas) + len(volta_ruas)})')
        continue
    pts = r['coords']
    fecho = menor_caminho(pts[-1], pts[0])
    if fecho and comprimento(fecho) < 4000:
        pts = pts + fecho[1:]
    # divide no ponto em que começa a primeira rua da volta
    n_ida = len(ida_ruas)
    ks_volta = [k for k in r['marcos'] if k >= n_ida]
    corte_no = r['marcos'][min(ks_volta)] if ks_volta else pts[len(pts) // 2]
    corte = pts.index(corte_no)
    ida, volta = pts[:corte + 1], pts[corte:]
    res = {'oso': info}
    for sentido, coords, ruas, deslocamento in (('ida', ida, ida_ruas, 0), ('volta', volta, volta_ruas, n_ida)):
        km = comprimento(coords) / 1000
        esperado = info['km_ida' if sentido == 'ida' else 'km_volta']
        desvio = (km - esperado) / esperado * 100 if esperado else 0
        nao = [ruas[k] for k in range(len(ruas)) if (k + deslocamento) not in achadas]
        print(f'{cod} {sentido}: {km:.2f} km (OSO {esperado}) desvio {desvio:+.0f}% | ruas achadas {len(ruas) - len(nao)}/{len(ruas)} | sem par: {nao[:5]}')
        marcos = [{'ordem': k - deslocamento + 1, 'logradouro': ruas[k - deslocamento], 'lng': r['marcos'][k][0], 'lat': r['marcos'][k][1]}
                  for k in sorted(r['marcos']) if deslocamento <= k < deslocamento + len(ruas)]
        res[sentido] = {'coords': coords, 'km': round(km, 3), 'desvio_pct': round(desvio, 1), 'ruas_sem_par': nao, 'ruas': marcos}
    resultado[cod] = res
json.dump(resultado, open(SAIDA, 'w', encoding='utf-8'), ensure_ascii=False)
