#!/usr/bin/env node
/**
 * scripts/admin/criar-usuario.js
 * Cria (ou troca a senha de) uma conta da área administrativa.
 *
 * Rode no SEU computador:   node scripts/admin/criar-usuario.js
 *
 * - A senha é digitada aqui e nunca aparece na tela, no Git ou no servidor: o script gera só o
 *   HASH dela (scrypt com sal aleatório). Nem quem tem acesso ao servidor consegue descobrir a senha.
 * - Também gera a chave da verificação em duas etapas (TOTP). Cadastre-a no app autenticador do
 *   celular (Google Authenticator, Microsoft Authenticator, Authy, 2FAS...).
 * - No fim mostra a linha da conta para colocar em BUZU_ADMIN_USUARIOS (no .env do servidor ou nas
 *   variáveis de ambiente da hospedagem). Várias contas ficam separadas por ";".
 */
'use strict';

const crypto = require('crypto');
const readline = require('readline');
const { codigoTotp, base32Decodificar, PARAMS_SCRYPT } = require('../../admin/painel-servidor.js');

const ALFABETO_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Codificar(buf) {
  let bits = 0;
  let valor = 0;
  let saida = '';
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      saida += ALFABETO_B32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) saida += ALFABETO_B32[(valor << (5 - bits)) & 31];
  return saida;
}

// Uma única interface para todas as perguntas (não perde o que já foi digitado/colado)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let esconderDigitacao = false;
let perguntaAtual = '';
const escreverOriginal = rl._writeToOutput.bind(rl);
rl._writeToOutput = function (s) {
  // em perguntas de senha, mostra só a pergunta: o que é digitado não aparece na tela
  if (!esconderDigitacao || s.includes(perguntaAtual)) escreverOriginal(s);
};
const filaLinhas = [];
const esperando = [];
rl.on('line', linha => {
  const r = esperando.shift();
  if (r) r(linha);
  else filaLinhas.push(linha);
});

function perguntar(texto, oculto = false) {
  return new Promise(resolve => {
    perguntaAtual = texto;
    esconderDigitacao = oculto;
    process.stdout.write(texto);
    const entregar = resposta => {
      esconderDigitacao = false;
      if (oculto) process.stdout.write('\n');
      resolve(resposta);
    };
    if (filaLinhas.length) entregar(filaLinhas.shift());
    else esperando.push(entregar);
  });
}

function senhaForte(s) {
  return s.length >= 12 && /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
}

(async () => {
  console.log('\n=== Nova conta da área administrativa do BuzuRota ===\n');

  let usuario = '';
  while (!/^[a-z0-9._-]{3,32}$/.test(usuario)) {
    usuario = (await perguntar('Usuário (minúsculas, ex.: felipinho): ')).trim().toLowerCase();
  }
  const nome = (await perguntar('Nome exibido no painel (ex.: Felipinho): ')).trim() || usuario;

  let senha = '';
  for (;;) {
    senha = await perguntar('Senha (mín. 12 caracteres, com maiúscula, minúscula e número): ', true);
    if (!senhaForte(senha)) {
      console.log('  Senha fraca. Use 12+ caracteres misturando maiúsculas, minúsculas e números.');
      continue;
    }
    const confirma = await perguntar('Repita a senha: ', true);
    if (confirma !== senha) {
      console.log('  As senhas não conferem. Tente de novo.');
      continue;
    }
    break;
  }

  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 32, PARAMS_SCRYPT);
  const textoHash = `scrypt$${PARAMS_SCRYPT.N}$${PARAMS_SCRYPT.r}$${PARAMS_SCRYPT.p}$${sal.toString('base64')}$${hash.toString('base64')}`;
  senha = '';

  const segredo = base32Codificar(crypto.randomBytes(20));
  const rotulo = encodeURIComponent(`BuzuRota:${usuario}`);
  const uri = `otpauth://totp/${rotulo}?secret=${segredo}&issuer=BuzuRota&algorithm=SHA1&digits=6&period=30`;

  console.log('\n1) No celular, abra o app autenticador → "Adicionar conta" → "Inserir chave de configuração":');
  console.log(`   Conta: BuzuRota (${usuario})`);
  console.log(`   Chave: ${segredo.replace(/(.{4})/g, '$1 ').trim()}`);
  console.log('   Tipo:  baseado em tempo (TOTP)');
  console.log(`   (ou use este link em um gerador de QR Code offline: ${uri})`);

  // confirma que o app foi configurado certo antes de entregar a linha
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = (await perguntar('\n2) Digite o código de 6 dígitos que o app está mostrando: ')).replace(/\s/g, '');
    const chave = base32Decodificar(segredo);
    const agora = Math.floor(Date.now() / 30000);
    if ([agora - 1, agora, agora + 1].some(c => codigoTotp(chave, c) === codigo)) {
      const linha = `${usuario}:${encodeURIComponent(nome)}:${textoHash}:${segredo}`;
      console.log('\n   Código confere!\n');
      console.log('3) Coloque esta linha em BUZU_ADMIN_USUARIOS no servidor (.env ou variável de ambiente).');
      console.log('   Para mais de uma conta, junte as linhas separando por ";" (ponto e vírgula):\n');
      console.log(linha);
      console.log('\n   Importante: a linha NÃO contém a senha, mas contém a chave do autenticador.');
      console.log('   Guarde-a só no servidor e não publique no Git, em grupos ou prints.\n');
      process.exit(0);
    }
    console.log('   Código não confere. Confira o relógio do celular e tente de novo.');
  }
  console.log('\nNão foi possível confirmar o autenticador. Rode o script novamente.');
  process.exit(1);
})();
