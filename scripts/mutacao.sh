#!/usr/bin/env bash
# Checagem de mutação manual: injeta defeitos plausíveis de integração no
# Serviço de Envios, roda a suíte e mostra quais testes pegaram cada um.
# O arquivo original é restaurado ao final, mesmo em caso de erro.
set -euo pipefail
cd "$(dirname "$0")/.."

ALVO=src/envios/servico.js
BACKUP=$(mktemp)
cp "$ALVO" "$BACKUP"
trap 'cp "$BACKUP" "$ALVO"; rm -f "$BACKUP"' EXIT

mutar() {
  local nome=$1 de=$2 para=$3
  cp "$BACKUP" "$ALVO"
  node -e '
    const fs = require("fs");
    const [arq, de, para] = process.argv.slice(1);
    const s = fs.readFileSync(arq, "utf8");
    if (!s.includes(de)) { console.error("trecho não encontrado: " + de); process.exit(2); }
    fs.writeFileSync(arq, s.replace(de, para));
  ' "$ALVO" "$de" "$para"
  echo "== $nome"
  local saida
  saida=$(node --test test/integracao/ 2>&1 || true)
  if grep -q '^# fail 0' <<<"$saida"; then
    echo "   SOBREVIVEU — nenhum teste pegou este defeito"
  else
    grep -E '^[[:space:]]+not ok .* - (CI|ER|CT)-[0-9]+' <<<"$saida" | sed -E 's/^[[:space:]]*not ok [0-9]+ - /   pego por /' || true
  fi
}

mutar "M1 aceita 'consentido' não booleano" \
  "if (!resposta.jsonValido || typeof resposta.corpo?.consentido !== 'boolean') return { indisponivel: true };" \
  "if (!resposta.jsonValido) return { indisponivel: true };"

mutar "M2 fail-open: erro de rede no Consentimento vira 'consentido'" \
  "    } catch {
      return { indisponivel: true };
    }" \
  "    } catch {
      return { consentido: true };
    }"

mutar "M3 memoriza a chave só depois de terminar (corrida)" \
  "      promessa = processar(corpo, chave);
      idempotencia.set(chave, { hash, promessa });" \
  "      promessa = processar(corpo, chave);
      await promessa;
      idempotencia.set(chave, { hash, promessa });"

mutar "M4 X-Request-Id muda a cada tentativa" \
  "cabecalhos: { 'x-request-id': chave }," \
  "cabecalhos: { 'x-request-id': \`\${chave}-\${tentativa}\` },"

mutar "M5 telefone sem codificação no path" \
  '${encodeURIComponent(telefone)}?canal' \
  '${telefone}?canal'

mutar "M6 repete também em 429" \
  "      if (resposta.status === 429) {" \
  "      if (resposta.status === 429 && tentativa === tentativasProvedor) {"
