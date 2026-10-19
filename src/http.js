'use strict';

// Utilitários HTTP compartilhados pelos serviços. Sem dependências externas:
// node:http para servir e fetch (nativo no Node 18) para consumir.

const LIMITE_CORPO_BYTES = 64 * 1024;

function lerJson(req) {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes = [];
    req.on('data', (parte) => {
      tamanho += parte.length;
      if (tamanho > LIMITE_CORPO_BYTES) {
        reject(Object.assign(new Error('corpo grande demais'), { codigo: 'CORPO_GRANDE_DEMAIS' }));
        req.destroy();
        return;
      }
      partes.push(parte);
    });
    req.on('end', () => {
      const texto = Buffer.concat(partes).toString('utf8');
      if (!texto) return resolve(null);
      try {
        resolve(JSON.parse(texto));
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { codigo: 'JSON_INVALIDO' }));
      }
    });
    req.on('error', reject);
  });
}

function responder(res, status, corpo, cabecalhos = {}) {
  const texto = corpo === undefined ? '' : JSON.stringify(corpo);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cabecalhos });
  res.end(texto);
}

// Faz uma requisição JSON com timeout. Nunca lança por status HTTP; lança apenas
// por falha de rede ou timeout, com `erro.tipo` = 'TIMEOUT' | 'REDE'.
async function requisitarJson(url, { metodo = 'GET', corpo, cabecalhos = {}, timeoutMs = 1000 } = {}) {
  let resposta;
  try {
    resposta = await fetch(url, {
      method: metodo,
      headers: { 'content-type': 'application/json', ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (erro) {
    const tipo = erro.name === 'TimeoutError' || erro.name === 'AbortError' ? 'TIMEOUT' : 'REDE';
    throw Object.assign(new Error(`falha ao chamar ${url}: ${erro.message}`), { tipo, cause: erro });
  }

  let texto;
  try {
    texto = await resposta.text();
  } catch (erro) {
    const tipo = erro.name === 'TimeoutError' || erro.name === 'AbortError' ? 'TIMEOUT' : 'REDE';
    throw Object.assign(new Error(`falha ao ler resposta de ${url}: ${erro.message}`), { tipo, cause: erro });
  }

  let json = null;
  let jsonValido = true;
  if (texto) {
    try {
      json = JSON.parse(texto);
    } catch {
      jsonValido = false;
    }
  }
  return { status: resposta.status, cabecalhos: resposta.headers, corpo: json, jsonValido };
}

function escutar(servidor, porta = 0) {
  return new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(porta, '127.0.0.1', () => {
      const { port } = servidor.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

function fechar(servidor) {
  return new Promise((resolve) => {
    servidor.closeAllConnections?.();
    servidor.close(() => resolve());
  });
}

module.exports = { lerJson, responder, requisitarJson, escutar, fechar };
