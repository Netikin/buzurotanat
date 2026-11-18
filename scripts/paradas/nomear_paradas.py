"""
Dá nome às paradas que estão com nomes genéricos ("Via Local (Natal)", "Parada Virtual", só o nome da rua...)
e preenche o bairro de todas, usando dados do OpenStreetMap:

  1. Rua da parada + ponto de referência a até 70 m   -> "Avenida X • Escola Y"
  2. sem referência: rua + esquina a até 60 m          -> "Avenida X, esq. Rua Y"
  3. só a rua                                           -> "Avenida X"
  4. sem rua conhecida: coordenada                      -> "Parada (-5.81234, -35.20123)"

Nomes "de verdade" (terminais, estações, shoppings, nomes vindos do OSM) não são trocados.

Uso:
  python nomear_paradas.py <paradas.json> <ruas.json> <pois.json> <bairros.json>

ruas.json / pois.json / bairros.json: consultas Overpass (veja LEIA-ME.md nesta pasta).
"""
import json, math, re, sys, unicodedata

ARQ_PARADAS, ARQ_RUAS, ARQ_POIS, ARQ_BAIRROS = sys.argv[1:5]

GENERICO = re.compile(
    r'^(via local|via direta|shopping via direta|parada( revisada| virtual| de [oô]nibus)?|ponto sobre|ponto de parada)\b'
    r'|alternativo/opcional|^parada \(|^parada \d',
    re.I,
)


def sem_acento(s):
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()


def dist(a, b):
    return math.hypot((a[0] - b[0]) * 111320 * math.cos(math.radians(a[1])), (a[1] - b[1]) * 110540)


def dist_segmento(p, a, b):
    kx = 111320 * math.cos(math.radians(p[1]))
    ax, ay = (a[0] - p[0]) * kx, (a[1] - p[1]) * 110540
    bx, by = (b[0] - p[0]) * kx, (b[1] - p[1]) * 110540
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy or 1e-9
    t = max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
    return math.hypot(ax + t * dx, ay + t * dy)


CEL = 0.002


def chave(x, y):
    return (int(math.floor(x / CEL)), int(math.floor(y / CEL)))


# ---------- ruas ----------
ruas = []  # (nome, geometria, hierarquia)
PESO = {'trunk': 0, 'primary': 0, 'secondary': 1, 'tertiary': 2, 'unclassified': 3, 'residential': 3}
grade_ruas = {}
for w in json.load(open(ARQ_RUAS, encoding='utf-8'))['elements']:
    t = w.get('tags') or {}
    nome = t.get('name')
    hw = t.get('highway', '')
    if not nome or hw in ('service', 'footway', 'path', 'cycleway', 'steps', 'pedestrian'):
        continue
    g = [(p['lon'], p['lat']) for p in w.get('geometry', [])]
    if len(g) < 2:
        continue
    idx = len(ruas)
    ruas.append((nome, g, PESO.get(hw.replace('_link', ''), 4)))
    for x, y in g:
        grade_ruas.setdefault(chave(x, y), set()).add(idx)


def ruas_perto(p, raio_cel=1):
    cx, cy = chave(*p)
    out = set()
    for dx in range(-raio_cel, raio_cel + 1):
        for dy in range(-raio_cel, raio_cel + 1):
            out |= grade_ruas.get((cx + dx, cy + dy), set())
    return out


def distancias_ruas(p):
    """[(distância, nome, hierarquia)] por nome de rua, da mais próxima para a mais distante."""
    melhor = {}
    for i in ruas_perto(p):
        nome, g, peso = ruas[i]
        d = min(dist_segmento(p, g[k], g[k + 1]) for k in range(len(g) - 1))
        if nome not in melhor or d < melhor[nome][0]:
            melhor[nome] = (d, nome, peso)
    return sorted(melhor.values())


# ---------- pontos de referência ----------
pois = []
grade_pois = {}
for e in json.load(open(ARQ_POIS, encoding='utf-8'))['elements']:
    t = e.get('tags') or {}
    nome = (t.get('name') or '').strip()
    if not nome or len(nome) > 60:
        continue
    c = (e['lon'], e['lat']) if 'lon' in e else ((e['center']['lon'], e['center']['lat']) if 'center' in e else None)
    if not c:
        continue
    idx = len(pois)
    pois.append((nome, c))
    grade_pois.setdefault(chave(*c), []).append(idx)


def poi_perto(p, raio=70):
    cx, cy = chave(*p)
    melhor = None
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for i in grade_pois.get((cx + dx, cy + dy), []):
                d = dist(p, pois[i][1])
                if d <= raio and (not melhor or d < melhor[0]):
                    melhor = (d, pois[i][0])
    return melhor[1] if melhor else None


# ---------- bairros ----------
bairros = []
for r in json.load(open(ARQ_BAIRROS, encoding='utf-8'))['elements']:
    t = r.get('tags') or {}
    if t.get('admin_level') != '10' or not t.get('name'):
        continue
    aneis = [[(p['lon'], p['lat']) for p in m.get('geometry', [])] for m in r.get('members', []) if m.get('role') == 'outer' and m.get('geometry')]
    # junta os trechos do contorno externo em anéis fechados
    pts = [pt for anel in aneis for pt in anel]
    if pts:
        bairros.append((t['name'], aneis, (min(x for x, _ in pts), min(y for _, y in pts), max(x for x, _ in pts), max(y for _, y in pts))))


def dentro(p, poligono):
    x, y = p
    dentro_ = False
    for i in range(len(poligono)):
        x1, y1 = poligono[i]
        x2, y2 = poligono[(i + 1) % len(poligono)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            dentro_ = not dentro_
    return dentro_


def montar_aneis(trechos):
    """Encadeia trechos de contorno (membros 'outer') em anéis."""
    trechos = [list(t) for t in trechos if len(t) > 1]
    aneis = []
    while trechos:
        anel = trechos.pop(0)
        mudou = True
        while mudou and dist(anel[0], anel[-1]) > 1:
            mudou = False
            for i, t in enumerate(trechos):
                if dist(anel[-1], t[0]) < 1:
                    anel += t[1:]
                elif dist(anel[-1], t[-1]) < 1:
                    anel += t[::-1][1:]
                elif dist(anel[0], t[-1]) < 1:
                    anel = t[:-1] + anel
                elif dist(anel[0], t[0]) < 1:
                    anel = t[::-1][:-1] + anel
                else:
                    continue
                trechos.pop(i)
                mudou = True
                break
        aneis.append(anel)
    return aneis


bairros = [(n, montar_aneis(a), bb) for n, a, bb in bairros]


def bairro_de(p):
    for nome, aneis, (x0, y0, x1, y1) in bairros:
        if x0 <= p[0] <= x1 and y0 <= p[1] <= y1 and any(dentro(p, anel) for anel in aneis):
            return nome
    return None


def abreviar(nome):
    return re.sub(r'^Avenida ', 'Av. ', nome)


# ---------- aplica ----------
paradas = json.load(open(ARQ_PARADAS, encoding='utf-8'))
ruas_de_paradas = set()
renomeadas = bairros_preenchidos = 0
exemplos = []
for f in paradas['features']:
    pr = f['properties']
    p = tuple(f['geometry']['coordinates'][:2])
    b = bairro_de(p)
    if b and pr.get('bairro') != b:
        pr['bairro'] = b
        bairros_preenchidos += 1
    elif not b and not pr.get('bairro'):
        pr['bairro'] = 'Natal'

    nome = (pr.get('nome') or '').strip()
    proximas = distancias_ruas(p)
    rua = proximas[0][1] if proximas and proximas[0][0] <= 35 else None
    so_nome_de_rua = rua and sem_acento(nome) in {sem_acento(r[1]) for r in proximas[:3]}
    eh_terminal = re.search(r'terminal|esta[cç][aã]o', nome, re.I)
    if eh_terminal or not (GENERICO.search(nome) or so_nome_de_rua or not nome or nome == pr.get('logradouro')):
        continue

    if rua:
        ref = poi_perto(p)
        if ref and sem_acento(ref) != sem_acento(rua):
            novo = f'{abreviar(rua)} • {ref}'
        else:
            esquina = next((r for r in proximas[1:] if r[0] <= 60 and sem_acento(r[1]) != sem_acento(rua)), None)
            novo = f'{abreviar(rua)}, esq. {abreviar(esquina[1])}' if esquina else abreviar(rua)
        pr['logradouro'] = rua
        if ref:
            pr['referencia'] = ref
    else:
        ref = poi_perto(p, 120)
        novo = ref if ref else f'Parada ({p[1]:.5f}, {p[0]:.5f})'
    if novo != nome:
        if len(exemplos) < 12:
            exemplos.append(f'{nome!r} -> {novo!r}')
        pr['nome'] = novo
        renomeadas += 1

json.dump(paradas, open(ARQ_PARADAS, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
print(f'paradas renomeadas: {renomeadas} | bairro preenchido/corrigido: {bairros_preenchidos} | bairros carregados: {len(bairros)}')
print('\n'.join(exemplos))
