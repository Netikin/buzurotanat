/**
 * js/card-linha.js
 * Gera um cartão PNG (1080×1350) no estilo "Letreiro Acolhedor" para qualquer linha,
 * pronto para compartilhar no WhatsApp ou publicar nos Stories.
 * 100% local via <canvas>, sem dependências externas.
 */
window.BuzuCardLinha = (function () {
  'use strict';

  const LARGURA = 1080;
  const ALTURA = 1350;
  const COR_MARCA = '#12355B';
  const COR_MARCA_ESCURA = '#0B2340';
  const COR_SOL = '#FFC94A';
  const COR_FUNDO = '#EEF4FB';
  const COR_CARTAO = '#FFFFFF';
  const COR_SUAVE = '#E9F1FB';
  const COR_LINHA_BORDA = '#D3E0F0';
  const COR_TINTA = '#12355B';
  const COR_SUB = '#4D6687';

  function retanguloArredondado(ctx, x, y, w, h, r) {
    const raio = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + raio, y);
    ctx.arcTo(x + w, y, x + w, y + h, raio);
    ctx.arcTo(x + w, y + h, x, y + h, raio);
    ctx.arcTo(x, y + h, x, y, raio);
    ctx.arcTo(x, y, x + w, y, raio);
    ctx.closePath();
  }

  function quebrarLinhas(ctx, texto, larguraMax, maxLinhas) {
    const palavras = String(texto || '').trim().split(/\s+/).filter(Boolean);
    if (!palavras.length) return [];
    const linhas = [];
    let atual = '';
    for (const p of palavras) {
      const teste = atual ? `${atual} ${p}` : p;
      if (ctx.measureText(teste).width <= larguraMax || !atual) {
        atual = teste;
      } else {
        linhas.push(atual);
        atual = p;
        if (linhas.length >= maxLinhas - 1) break;
      }
    }
    if (atual) linhas.push(atual);

    // Se sobraram palavras além do limite, adiciona reticências na última linha
    const usadas = linhas.join(' ').split(/\s+/).length;
    if (usadas < palavras.length && linhas.length > 0) {
      let ultima = linhas[linhas.length - 1];
      while (ultima.length > 3 && ctx.measureText(`${ultima}…`).width > larguraMax) {
        ultima = ultima.slice(0, -1).trimEnd();
      }
      linhas[linhas.length - 1] = `${ultima}…`;
    }
    return linhas.slice(0, maxLinhas);
  }

  function formatarNumero(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('pt-BR') : '—';
  }

  function montarLinhasFuncionamento(linha) {
    const op = linha.operacao || null;
    if (!op) {
      const dias = linha.dias_disponiveis || ['dias_uteis_sabados'];
      return [
        {
          rotulo: 'Dias úteis e sáb.',
          frota: null,
          intervalo: dias.includes('dias_uteis_sabados') ? 'Opera' : 'Não opera',
          viagens: '—',
          naoOpera: !dias.includes('dias_uteis_sabados')
        },
        {
          rotulo: 'Dom. e feriados',
          frota: null,
          intervalo: dias.includes('domingos_feriados') ? 'Opera' : 'Não opera',
          viagens: '—',
          naoOpera: !dias.includes('domingos_feriados')
        }
      ];
    }

    const vd = op.viagens_dia || null;
    const fmtInt = v => (v === null ? 'Madrugada' : v ? `${Math.round(v)} min` : '—');
    const fazer = (rotulo, frota, intervalo, viagens) => ({
      rotulo,
      frota: frota ? formatarNumero(frota) : '—',
      intervalo: fmtInt(intervalo),
      viagens: typeof viagens === 'number' ? formatarNumero(viagens) : '—',
      naoOpera: !frota && !intervalo,
      _raw: { frota, intervalo, viagens }
    });

    const du = fazer('Dias úteis', op.frota_du, op.intervalo_du, vd?.du);
    const sab = fazer('Sábado', op.frota_sab, op.intervalo_sab, vd?.sab);
    const dom = fazer('Dom. e feriados', op.frota_dom, op.intervalo_dom, vd?.dom);

    if (
      du._raw.frota === sab._raw.frota &&
      du._raw.intervalo === sab._raw.intervalo &&
      du._raw.viagens === sab._raw.viagens
    ) {
      return [{ ...du, rotulo: 'Dias úteis e sáb.' }, dom];
    }
    return [du, sab, dom];
  }

  function textoOperacaoResumo(linha) {
    if (linha.tipo === 'noturna') return 'Madrugada (0h às 4h)';
    const dias = linha.dias_disponiveis || ['dias_uteis_sabados'];
    const u = dias.includes('dias_uteis_sabados');
    const d = dias.includes('domingos_feriados');
    if (u && d) return 'Todos os dias';
    if (u) return 'Dias úteis e sáb.';
    if (d) return 'Dom. e feriados';
    return 'Consultar edital';
  }

  function desenharCard(canvas, dados) {
    const { linha, categoria, regiao, kmTotal, ruasIda } = dados;
    const ctx = canvas.getContext('2d');
    canvas.width = LARGURA;
    canvas.height = ALTURA;

    const corLinha = /^#[0-9a-f]{6}$/i.test(String(linha.cor || '')) ? linha.cor : COR_SOL;

    // 1. Fundo geral
    ctx.fillStyle = COR_FUNDO;
    ctx.fillRect(0, 0, LARGURA, ALTURA);

    // 2. Cabeçalho azul profundo (estilo letreiro)
    const alturaTopo = 420;
    ctx.fillStyle = COR_MARCA;
    ctx.fillRect(0, 0, LARGURA, alturaTopo);

    // Faixa inferior do cabeçalho na cor da linha
    ctx.fillStyle = corLinha;
    ctx.fillRect(0, alturaTopo - 14, LARGURA, 14);

    // Marca BUZU Rota (topo esquerdo)
    const padX = 64;
    retanguloArredondado(ctx, padX, 52, 118, 52, 14);
    ctx.fillStyle = COR_MARCA_ESCURA;
    ctx.fill();
    ctx.strokeStyle = '#2C5B92';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '700 32px "Archivo Narrow", "Arial Narrow", sans-serif';
    ctx.fillStyle = COR_SOL;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText('BUZU', padX + 59, 79);

    ctx.font = '900 36px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.fillText('Rota', padX + 132, 79);

    // Selo superior direito
    const seloTopo = 'NOVA REDE • NATAL 2026';
    ctx.font = '800 22px "Nunito", system-ui, sans-serif';
    const wSelo = ctx.measureText(seloTopo).width + 44;
    retanguloArredondado(ctx, LARGURA - padX - wSelo, 56, wSelo, 44, 22);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.fill();
    ctx.fillStyle = '#DCE8F6';
    ctx.textAlign = 'center';
    ctx.fillText(seloTopo, LARGURA - padX - wSelo / 2, 79);

    // Placa do número da linha (Letreiro)
    const numTexto = String(linha.numero || '').trim();
    ctx.font = '700 72px "Archivo Narrow", "Arial Narrow", sans-serif';
    const wPlaca = Math.max(170, ctx.measureText(numTexto).width + 58);
    const hPlaca = 114;
    const yPlaca = 148;

    retanguloArredondado(ctx, padX, yPlaca, wPlaca, hPlaca, 22);
    ctx.fillStyle = COR_MARCA_ESCURA;
    ctx.fill();
    ctx.strokeStyle = '#2C5B92';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Friso colorido na base do letreiro
    ctx.save();
    retanguloArredondado(ctx, padX, yPlaca, wPlaca, hPlaca, 22);
    ctx.clip();
    ctx.fillStyle = corLinha;
    ctx.fillRect(padX, yPlaca + hPlaca - 14, wPlaca, 14);
    ctx.restore();

    ctx.fillStyle = COR_SOL;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(numTexto, padX + wPlaca / 2, yPlaca + hPlaca / 2 - 4);

    // Nome da linha ao lado do letreiro
    const xNome = padX + wPlaca + 32;
    const wNome = LARGURA - padX - xNome;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '900 40px "Nunito", system-ui, sans-serif';
    let linhasNome = quebrarLinhas(ctx, linha.nome, wNome, 3);
    let tamNome = 40;
    let altLinhaNome = 48;
    if (linhasNome.length >= 3) {
      tamNome = 34;
      altLinhaNome = 42;
      ctx.font = `900 ${tamNome}px "Nunito", system-ui, sans-serif`;
      linhasNome = quebrarLinhas(ctx, linha.nome, wNome, 3);
    }
    ctx.fillStyle = '#FFFFFF';
    const yNomeIni = yPlaca + Math.max(0, (hPlaca - linhasNome.length * altLinhaNome) / 2);
    linhasNome.forEach((ln, i) => {
      ctx.fillText(ln, xNome, yNomeIni + i * altLinhaNome);
    });

    // Pílulas de categoria e região no rodapé do cabeçalho
    const tags = [categoria, regiao].filter(Boolean);
    let xTag = padX;
    const yTag = 316;
    ctx.font = '800 24px "Nunito", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const tag of tags) {
      const wt = ctx.measureText(tag).width + 38;
      if (xTag + wt > LARGURA - padX) break;
      retanguloArredondado(ctx, xTag, yTag, wt, 48, 24);
      ctx.fillStyle = xTag === padX ? COR_SOL : 'rgba(255, 255, 255, 0.14)';
      ctx.fill();
      ctx.fillStyle = xTag === padX ? COR_TINTA : '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.fillText(tag, xTag + wt / 2, yTag + 25);
      xTag += wt + 14;
    }

    // 3. Ficha rápida (2×2 cartões)
    let yAtual = alturaTopo + 36;
    const gap = 22;
    const wCard = (LARGURA - padX * 2 - gap) / 2;
    const hFicha = 122;
    const kmTexto = kmTotal > 0 ? `${kmTotal.toFixed(2).replace('.', ',')} km` : 'Em atualização';
    const veiculoTexto = linha.operacao?.veiculo || 'Padrão acessível';
    const fichas = [
      { rotulo: 'Tarifa de referência', valor: 'R$ 5,20', destaque: true },
      { rotulo: 'Extensão (ida e volta)', valor: kmTexto },
      { rotulo: 'Tipo de ônibus', valor: veiculoTexto },
      { rotulo: 'Funcionamento', valor: textoOperacaoResumo(linha) }
    ];

    fichas.forEach((item, idx) => {
      const col = idx % 2;
      const lin = Math.floor(idx / 2);
      const x = padX + col * (wCard + gap);
      const y = yAtual + lin * (hFicha + gap);

      retanguloArredondado(ctx, x, y, wCard, hFicha, 24);
      ctx.fillStyle = COR_CARTAO;
      ctx.fill();
      ctx.strokeStyle = COR_LINHA_BORDA;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '800 22px "Nunito", system-ui, sans-serif';
      ctx.fillStyle = COR_SUB;
      ctx.fillText(item.rotulo, x + 28, y + 24);

      ctx.font = item.destaque ? '900 42px "Nunito", system-ui, sans-serif' : '900 30px "Nunito", system-ui, sans-serif';
      ctx.fillStyle = COR_TINTA;
      const valLinhas = quebrarLinhas(ctx, item.valor, wCard - 56, 1);
      ctx.fillText(valLinhas[0] || '—', x + 28, item.destaque ? y + 58 : y + 64);
    });

    yAtual += hFicha * 2 + gap + 30;

    // 4. Tabela de Funcionamento
    const linhasFunc = montarLinhasFuncionamento(linha);
    const hCabTab = 58;
    const hLinTab = 66;
    const hTab = 56 + hCabTab + linhasFunc.length * hLinTab;

    retanguloArredondado(ctx, padX, yAtual, LARGURA - padX * 2, hTab, 24);
    ctx.fillStyle = COR_CARTAO;
    ctx.fill();
    ctx.strokeStyle = COR_LINHA_BORDA;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '900 26px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = COR_TINTA;
    ctx.fillText('Intervalos e operação previstos no edital', padX + 28, yAtual + 30);

    const yTabTopo = yAtual + 56;
    const wTab = LARGURA - padX * 2;
    ctx.fillStyle = COR_SUAVE;
    ctx.fillRect(padX + 2, yTabTopo, wTab - 4, hCabTab);

    const cols = [
      { titulo: 'Dia', x: padX + 28, align: 'left' },
      { titulo: 'Ônibus', x: padX + wTab * 0.48, align: 'center' },
      { titulo: 'A cada', x: padX + wTab * 0.69, align: 'center' },
      { titulo: 'Viagens/dia', x: padX + wTab * 0.89, align: 'center' }
    ];

    ctx.font = '800 21px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = COR_SUB;
    cols.forEach(c => {
      ctx.textAlign = c.align;
      ctx.fillText(c.titulo, c.x, yTabTopo + hCabTab / 2);
    });

    linhasFunc.forEach((row, i) => {
      const yRow = yTabTopo + hCabTab + i * hLinTab;
      if (i > 0) {
        ctx.strokeStyle = COR_LINHA_BORDA;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(padX + 18, yRow);
        ctx.lineTo(LARGURA - padX - 18, yRow);
        ctx.stroke();
      }
      const cy = yRow + hLinTab / 2;
      ctx.textAlign = 'left';
      ctx.font = '900 24px "Nunito", system-ui, sans-serif';
      ctx.fillStyle = COR_TINTA;
      ctx.fillText(row.rotulo, cols[0].x, cy);

      if (row.naoOpera) {
        ctx.textAlign = 'center';
        ctx.font = '800 23px "Nunito", system-ui, sans-serif';
        ctx.fillStyle = COR_SUB;
        ctx.fillText('Não opera', padX + wTab * 0.69, cy);
      } else {
        ctx.textAlign = 'center';
        ctx.font = '900 26px "Nunito", system-ui, sans-serif';
        ctx.fillStyle = COR_TINTA;
        ctx.fillText(row.frota || '—', cols[1].x, cy);
        ctx.fillText(row.intervalo || '—', cols[2].x, cy);
        ctx.fillText(row.viagens || '—', cols[3].x, cy);
      }
    });

    yAtual += hTab + 28;

    // 5. Principais vias (ou aviso do trajeto)
    const yRodape = ALTURA - 146;
    const espacoRestante = yRodape - yAtual - 24;
    if (espacoRestante >= 120) {
      const nomesRuas = Array.from(
        new Set(
          (ruasIda || [])
            .map(r => String(r?.logradouro || '').trim())
            .filter(Boolean)
        )
      );
      const resumoVias =
        nomesRuas.length > 0
          ? nomesRuas.slice(0, 8).join('  →  ')
          : 'Veja o traçado completo, sentido ida e volta, paradas e integrações no mapa interativo.';

      retanguloArredondado(ctx, padX, yAtual, LARGURA - padX * 2, espacoRestante, 24);
      ctx.fillStyle = COR_CARTAO;
      ctx.fill();
      ctx.strokeStyle = COR_LINHA_BORDA;
      ctx.lineWidth = 3;
      ctx.stroke();

      // Barra vertical na cor da linha
      retanguloArredondado(ctx, padX + 20, yAtual + 22, 10, espacoRestante - 44, 5);
      ctx.fillStyle = corLinha;
      ctx.fill();

      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.font = '900 22px "Nunito", system-ui, sans-serif';
      ctx.fillStyle = COR_SUB;
      ctx.fillText(nomesRuas.length > 0 ? 'Principais vias (sentido ida)' : 'Mapa e itinerário completo', padX + 48, yAtual + 24);

      ctx.font = '800 24px "Nunito", system-ui, sans-serif';
      ctx.fillStyle = COR_TINTA;
      const maxLin = Math.max(2, Math.floor((espacoRestante - 72) / 34));
      const linhasVias = quebrarLinhas(ctx, resumoVias, LARGURA - padX * 2 - 76, maxLin);
      linhasVias.forEach((ln, i) => {
        ctx.fillText(ln, padX + 48, yAtual + 58 + i * 34);
      });
    }

    // 6. Rodapé institucional (rotasnatal.com.br)
    ctx.fillStyle = COR_MARCA;
    ctx.fillRect(0, yRodape, LARGURA, ALTURA - yRodape);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '900 34px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = COR_SOL;
    ctx.fillText('rotasnatal.com.br', padX, yRodape + 32);

    ctx.font = '700 22px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = '#DCE8F6';
    ctx.fillText('Mapa interativo, paradas e Como Chegar', padX, yRodape + 78);

    ctx.textAlign = 'right';
    ctx.font = '800 21px "Nunito", system-ui, sans-serif';
    ctx.fillStyle = '#A9BCD6';
    ctx.fillText('Edital CP 11.001/2026 (STTU)', LARGURA - padX, yRodape + 40);
    ctx.font = '700 20px "Nunito", system-ui, sans-serif';
    ctx.fillText('Portal independente • BuzuRota Natal', LARGURA - padX, yRodape + 76);
  }

  async function baixarCardLinha(dados) {
    if (document.fonts && document.fonts.ready) {
      try {
        await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))]);
      } catch (_e) {}
    }

    const canvas = document.createElement('canvas');
    desenharCard(canvas, dados);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Não foi possível gerar a imagem do card.');

    const slug = String(dados.linha?.numero || 'linha')
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    const nomeArq = `buzurota-linha-${slug}.png`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = nomeArq;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return nomeArq;
  }

  return { baixarCardLinha };
})();
