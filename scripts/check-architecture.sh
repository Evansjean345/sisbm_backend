#!/usr/bin/env bash
#
# =============================================================================
#  Contrôle de la règle de dépendance (Clean Architecture)
#
#  Les dépendances pointent TOUJOURS vers l'intérieur :
#
#      presentation ──▶ application ──▶ domain
#             │              │
#             └──────────────┴──▶ infrastructure
#
#  L'organisation par couches rend ce contrôle trivial : une commande par
#  couche. À brancher en CI — une violation doit casser le build, pas être
#  découverte six mois plus tard.
# =============================================================================
set -uo pipefail

FAIL=0
red()  { printf '\033[31m✗ %s\033[0m\n' "$1"; FAIL=1; }
green(){ printf '\033[32m✓ %s\033[0m\n' "$1"; }

check() { # <libellé> <motif> <répertoire...>
  local label="$1" pattern="$2"; shift 2
  local hits
  hits=$(grep -rlE "$pattern" --include='*.ts' "$@" 2>/dev/null || true)
  if [ -n "$hits" ]; then
    red "$label"
    echo "$hits" | sed 's/^/     /'
  else
    green "$label"
  fi
}

echo "Règle de dépendance"
echo "───────────────────"

# Le domaine ne connaît RIEN du monde extérieur.
check "domain n'importe aucun framework" \
      "from '(@adonisjs|luxon|pg|bullmq|mqtt|ioredis)" app/domain

check "domain n'importe aucune autre couche" \
      "from '#(application|infrastructure|presentation|config|start)" app/domain

# L'application ne connaît que le domaine (+ le décorateur d'injection).
check "application n'importe pas infrastructure/presentation" \
      "from '#(infrastructure|presentation)" app/application

check "application n'importe pas Lucid" \
      "from '@adonisjs/lucid" app/application

# Le domaine et l'application ne touchent pas la base directement.
check "aucun accès direct à la base hors infrastructure" \
      "services/db'" app/domain app/application app/presentation

echo
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32mArchitecture conforme.\033[0m\n'
else
  printf '\033[31mViolations détectées — corriger avant de fusionner.\033[0m\n'
fi
exit "$FAIL"