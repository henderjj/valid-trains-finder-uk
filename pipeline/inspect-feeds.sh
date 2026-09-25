# Temporary check.
set -u
cat public/data/operators.json; echo
npm run -s data:check -- KGX EDB 2026-12-21 | grep -E "Change times|^[A-Z0-9]{3} " | head -20
