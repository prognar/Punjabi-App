#!/usr/bin/env bash
# Applies the shim, migrations and seed to a throwaway database and runs the SQL tests.
# Needs a Postgres you can create databases on:  PGHOST / PGPORT / PGUSER / PGPASSWORD (defaults: local socket).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-punjabi_app_test}"
psql -qX -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -qX -v ON_ERROR_STOP=1 -d $DB"
$P -f tests/local-shim.sql
for f in migrations/*.sql; do echo "migrate $f"; $P -f "$f"; done
echo "seed"; $P -f seed.sql
$P -f tests/workflow.test.sql 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  //' | grep -E '^(ok  |ALL DATABASE|psql:|ERROR|FAIL|DETAIL|CONTEXT)' | tee /dev/stderr | grep -q 'ALL DATABASE TESTS PASSED'
