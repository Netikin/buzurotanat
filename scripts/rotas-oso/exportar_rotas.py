"""Converte os traçados gerados (tracados.json) no arquivo do site dados/rotas-oso-sttu.geojson.
Só exporta a linha se a extensão traçada ficar a até 15% da extensão oficial da OSO nos dois sentidos."""
import json, re, sys

tracados = json.load(open(sys.argv[1], encoding='utf-8'))
saida = sys.argv[2]
LIMITE = float(sys.argv[3]) if len(sys.argv) > 3 else 15.0

MINUSC = {'DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'VIA'}


def titulo(s):
    s = re.sub(r'\s+', ' ', s.strip())
    out = []
    for i, p in enumerate(s.split(' ')):
        partes = p.split('/')
        out.append('/'.join(
            (x.lower() if (x.upper() in MINUSC and i > 0) else (x if re.match(r'^[A-Z]{1,3}-?\d', x) else x[:1].upper() + x[1:].lower()))
            for x in partes))
    return ' '.join(out)


features, recusadas = [], []
for cod, r in tracados.items():
    oso = r['oso']
    ida, volta = r.get('ida'), r.get('volta')
    if not ida or not volta:
        recusadas.append(f'{cod}: sem traçado em um dos sentidos')
        continue
    if abs(ida['desvio_pct']) > LIMITE or abs(volta['desvio_pct']) > LIMITE:
        recusadas.append(f"{cod}: desvio ida {ida['desvio_pct']:+.0f}% / volta {volta['desvio_pct']:+.0f}%")
        continue
    nome = re.sub(r'^\S+\s*-\s*', '', oso['nome_oso'] or '')
    rua = lambda x: {'logradouro': titulo(x['logradouro']), 'lat': round(x['lat'], 6), 'lng': round(x['lng'], 6)}
    features.append({
        'type': 'Feature',
        'properties': {
            'numero': cod,
            'oso': oso['oso'],
            'vigencia': oso['vigencia'],
            'empresa_atual': titulo(oso['empresa'] or ''),
            'nome_oso': titulo(nome),
            'extensao_oso_km': oso['extensao_km'],
            'extensao_tracado_km': round(ida['km'] + volta['km'], 2),
            'desvio_ida_pct': ida['desvio_pct'],
            'desvio_volta_pct': volta['desvio_pct'],
            'ruas_sem_correspondencia': ida['ruas_sem_par'] + volta['ruas_sem_par'],
            'ruas_ida': [rua(x) for x in ida['ruas']],
            'ruas_volta': [rua(x) for x in volta['ruas']],
        },
        'geometry': {'type': 'MultiLineString', 'coordinates': [
            [[round(c[0], 6), round(c[1], 6)] for c in ida['coords']],
            [[round(c[0], 6), round(c[1], 6)] for c in volta['coords']],
        ]},
    })

json.dump({
    'type': 'FeatureCollection',
    'fonte': 'Itinerários oficiais das Ordens de Serviço Operacional (OSO) da STTU/Natal, traçados sobre o mapa viário © colaboradores do OpenStreetMap (ODbL)',
    'features': features,
}, open(saida, 'w', encoding='utf-8'), ensure_ascii=False)
print('exportadas:', ' '.join(f['properties']['numero'] for f in features))
print('recusadas:', *recusadas, sep='\n  ')
