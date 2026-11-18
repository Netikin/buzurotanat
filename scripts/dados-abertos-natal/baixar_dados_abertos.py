"""
Baixa do Portal de Dados Abertos da Mobilidade Urbana de Natal (http://dados.natal.br, CKAN da STTU)
os arquivos de linhas, itinerários, horários, paradas e rotas de cada empresa.

Uso:
  python baixar_dados_abertos.py <pasta-de-destino>

Os arquivos são salvos como <conjunto>__<empresa>__<arquivo> (ex.: rotas__guanabara__05.kml),
o formato que importar_dados_abertos.py espera.
"""
import json, os, re, sys, urllib.request

DESTINO = sys.argv[1]
API = 'http://dados.natal.br/api/3/action'
CONJUNTOS = ['linhas', 'paradas', 'itinerarios', 'horarios', 'rotas-cidade-do-natal', 'rotas-conceicao',
             'rotas-guanabara', 'rotas-reunidas', 'rotas-santa-maria', 'rotas-transportes-via-sul']


def baixar(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'buzurota-natal'})
    return urllib.request.urlopen(req, timeout=60).read()


os.makedirs(DESTINO, exist_ok=True)
for conjunto in CONJUNTOS:
    pacote = json.loads(baixar(f'{API}/package_show?id={conjunto}'))['result']
    for recurso in pacote['resources']:
        arquivo = os.path.basename(recurso['url'])
        if conjunto.startswith('rotas-'):
            nome = f"rotas__{conjunto.replace('rotas-', '')}__{arquivo}"
        else:
            empresa = re.sub(r'[^a-z0-9]+', '-', recurso['name'].lower())
            nome = f'{conjunto}__{empresa}__{arquivo}'
        caminho = os.path.join(DESTINO, nome)
        if not os.path.exists(caminho):
            open(caminho, 'wb').write(baixar(recurso['url']))
            print('baixado', nome)
print('pronto:', DESTINO)
