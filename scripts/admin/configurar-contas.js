#!/usr/bin/env node
/**
 * scripts/admin/configurar-contas.js
 * Configura de uma vez as contas da área administrativa (fase de testes: usuário e senha).
 *
 * Uso (na pasta do projeto):
 *     npm run admin:contas
 *   ou
 *     node scripts/admin/configurar-contas.js
 *
 * O script já sabe quais são as contas (wesly e felipinho): ele só pede a senha de cada uma.
 * As senhas são combinadas entre vocês em particular — elas NÃO ficam no GitHub, porque o
 * repositório é público e qualquer pessoa conseguiria entrar no painel.
 *
 * O que ele faz sozinho:
 *   1. Gera o hash de cada senha (a senha em si não é salva em lugar nenhum).
 *   2. Cria/atualiza o arquivo .env (fora do Git) com BUZU_PAINEL_CAMINHO e BUZU_ADMIN_USUARIOS,
 *      mantendo o resto do arquivo como está.
 *   3. Mostra a linha pronta para colar nas variáveis de ambiente da hospedagem.
 *
 * Também aceita as senhas direto no comando (útil na hospedagem):
 *     node scripts/admin/configurar-contas.js --wesly=SENHA --felipinho=SENHA
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { PARAMS_SCRYPT } = require('../../admin/painel-servidor.js');

const CONTAS = [
  { usuario: 'wesly', nome: 'Wesly' },
  { usuario: 'felipinho', nome: 'Felipinho' }
];
const CAMINHO_PAINEL = 'use-admin';
const ARQ_ENV = path.join(__dirname, '..', '..', '.env');

function linhaDaConta(usuario, nome, senha) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, sal, 32, PARAMS_SCRYPT);
  return `${usuario}:${encodeURIComponent(nome)}:scrypt$${PARAMS_SCRYPT.N}$${PARAMS_SCRYPT.r}$${PARAMS_SCRYPT.p}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

/** Atualiza (ou acrescenta) CHAVE=valor no .env sem mexer no resto do arquivo */
function definirNoEnv(texto, chave, valor) {
  const linha = `${chave}=${valor}`;
  const re = new RegExp(`^${chave}=.*$`, 'm');
  if (re.test(texto)) return texto.replace(re, () => linha);
  return `${texto.replace(/\s*$/, '')}\n${linha}\n`;
}

// ---- perguntas no terminal (senha não aparece enquanto é digitada) ----
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) });
let esconder = false;
let perguntaAtual = '';
const escrever = rl._writeToOutput.bind(rl);
rl._writeToOutput = s => {
  if (!esconder || s.includes(perguntaAtual)) escrever(s);
};
const fila = [];
const esperando = [];
rl.on('line', l => {
  const r = esperando.shift();
  if (r) r(l);
  else fila.push(l);
});
function perguntarSenha(texto) {
  return new Promise(resolve => {
    perguntaAtual = texto;
    esconder = true;
    process.stdout.write(texto);
    const entregar = v => {
      esconder = false;
      process.stdout.write('\n');
      resolve(v);
    };
    if (fila.length) entregar(fila.shift());
    else esperando.push(entregar);
  });
}

(async () => {
  console.log('\n=== Contas da área administrativa do BuzuRota ===');
  console.log(`Painel: /${CAMINHO_PAINEL}   •   Contas: ${CONTAS.map(c => c.usuario).join(', ')}\n`);

  const argumentos = Object.fromEntries(
    process.argv
      .slice(2)
      .map(a => a.match(/^--([a-z0-9._-]+)=(.*)$/i))
      .filter(Boolean)
      .map(m => [m[1].toLowerCase(), m[2]])
  );

  const linhas = [];
  for (const c of CONTAS) {
    let senha = argumentos[c.usuario];
    while (!senha) {
      senha = await perguntarSenha(`Senha de ${c.usuario}: `);
      if (!senha) console.log('  A senha não pode ficar vazia.');
    }
    linhas.push(linhaDaConta(c.usuario, c.nome, senha));
  }
  rl.close();

  const valor = linhas.join(';');
  let env = fs.existsSync(ARQ_ENV) ? fs.readFileSync(ARQ_ENV, 'utf8') : '# Configuração local da área administrativa (este arquivo fica fora do Git)\n';
  env = definirNoEnv(env, 'BUZU_PAINEL_CAMINHO', CAMINHO_PAINEL);
  env = definirNoEnv(env, 'BUZU_ADMIN_USUARIOS', valor);
  fs.writeFileSync(ARQ_ENV, env, 'utf8');

  console.log('\nPronto! Arquivo .env atualizado.');
  console.log('  • Reinicie o servidor (npm start) e entre em /use-admin com o usuário e a senha.');
  console.log('\nNa HOSPEDAGEM (se ela usa variáveis de ambiente em vez do arquivo .env), cadastre:');
  console.log(`  BUZU_PAINEL_CAMINHO=${CAMINHO_PAINEL}`);
  console.log(`  BUZU_ADMIN_USUARIOS=${valor}`);
  console.log('\n(A linha acima tem só o hash das senhas, não as senhas. Mesmo assim, não publique no Git.)\n');
})();
