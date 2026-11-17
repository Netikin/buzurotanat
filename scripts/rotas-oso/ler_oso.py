import glob, json, os, re, sys
import pypdf

pasta = sys.argv[1]
saida = {}

def num(s):
    return float(s.replace('.', '').replace(',', '.'))

for arq in sorted(glob.glob(os.path.join(pasta, '*.pdf'))):
    codigo = os.path.basename(arq)[:-4]
    r = pypdf.PdfReader(arq)
    p1 = r.pages[0].extract_text(extraction_mode='layout')
    txt_all = '\n'.join((p.extract_text() or '') for p in r.pages)
    linhas = p1.splitlines()

    info = {'codigo': codigo}
    m = re.search(r'Linha - N. e Nome\s+(.+?)\s{2,}', p1)
    info['nome_oso'] = m.group(1).strip() if m else None
    m = re.search(r'OSO - ORDEM DE SERVI.O OPERACIONAL: N.\s*([\d/]+)', p1)
    info['oso'] = m.group(1) if m else None
    m = re.search(r'LINHA\s+\S+\s+-\s+(.+?)\s*\(', p1)
    info['dia'] = m.group(1).strip() if m else None
    for chave, rot in [('extensao_km', r'Extens.o'), ('tempo_viagem_min', r'Tempo de Viagem'), ('frota', r'Frota'), ('viagens', r'N. de Viagens')]:
        m = re.search(rot + r'\s+([\d.,]+)', p1)
        info[chave] = num(m.group(1)) if m else None
    m = re.search(r'In.cio Vig.ncia\s+(\d{2}/\d{2}/\d{4})', p1)
    info['vigencia'] = m.group(1) if m else None
    m = re.search(r'Empresa\s+(.+?)\s{2,}', p1)
    info['empresa'] = m.group(1).strip() if m else None
    m = re.search(r'Asfalto\s+([\d,]+)\s+([\d,]+)', p1)
    info['km_ida'], info['km_volta'] = (num(m.group(1)), num(m.group(2))) if m else (None, None)

    # Itinerário em duas colunas: usa a posição do cabeçalho VOLTA
    ida, volta = [], []
    try:
        i0 = next(i for i, l in enumerate(linhas) if re.search(r'\bIDA\b', l) and re.search(r'\bVOLTA\b', l))
    except StopIteration:
        i0 = None
    if i0 is not None:
        col_volta = None
        for l in linhas[i0 + 1:]:
            if re.search(r'Pontos de Refer|Pavimenta', l):
                break
            if not l.strip():
                continue
            partes = [(mm.start(), mm.group().strip()) for mm in re.finditer(r'\S+(?: \S+)*', l)]
            if col_volta is None and len(partes) >= 2:
                col_volta = partes[1][0]
            for pos, texto in partes:
                if col_volta is not None and pos >= col_volta - 3:
                    volta.append(texto)
                else:
                    ida.append(texto)
    # Algumas OSOs trazem uma variante depois de '#####' (ex.: N-15 via Praia do Meio): fica só a principal
    def principal(lista):
        out = []
        for x in lista:
            if '#' in x or x.upper().startswith('EXTENS'):
                break
            out.append(x)
        return out
    info['ida'] = principal(ida)
    info['volta'] = principal(volta)

    # Horários (página 2): todos os HH:MM de partida
    horas = re.findall(r'\b([0-2]\d:[0-5]\d)(?=\d[A-Z]\d)', txt_all)
    info['partidas'] = sorted(set(horas))
    saida[codigo] = info
    print(f"{codigo}: {info['nome_oso']} | {info['dia']} | {info['extensao_km']} km ({info['km_ida']}/{info['km_volta']}) | ida {len(ida)} ruas, volta {len(volta)} | partidas {len(info['partidas'])} {info['partidas'][:1]}..{info['partidas'][-1:]}")

json.dump(saida, open(os.path.join(pasta, 'oso.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
