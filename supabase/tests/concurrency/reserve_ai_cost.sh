#!/usr/bin/env bash
# Concurrency test for the AI cost cap (test J, parallel sessions).
#
# Many LLM calls for the same subscriber reserve their cost at the same
# moment; the cap must still hold exactly. Fires N parallel sessions, each
# calling public.reserve_ai_cost, against a paid Starter subscriber that has
# already spent $14.90 of its $15 cap with every call estimated at $0.01:
# exactly 10 may be allowed, never more. Then settles them in parallel and
# checks the recorded spend.
#
# LOCAL / TEST DATABASES ONLY — it creates (and removes) its own fixture
# tenant. Usage: DATABASE_URL=postgres://… supabase/tests/concurrency/reserve_ai_cost.sh
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL to a local/test database}"
N="${N:-40}"
TENANT="00000000-0000-4000-8000-00000000c0c0"
PSQL=(psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAt)

cleanup() { "${PSQL[@]}" -c "delete from public.tenants where id = '$TENANT'" >/dev/null; }
trap cleanup EXIT
cleanup

"${PSQL[@]}" <<SQL
insert into public.tenants (id, slug, business_name, business_type_key, status, currency)
values ('$TENANT', 'usage-concurrency', '{"en":"Usage Concurrency"}', 'restaurant', 'active', 'USD');
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end)
values ('$TENANT', 'starter', 'active', now() - interval '20 days', now() - interval '1 day', now() - interval '1 day' + interval '1 month');
insert into public.ai_usage_periods (tenant_id, period_start, ai_cost_usd)
select '$TENANT', current_period_start, 14.90 from public.subscriptions where tenant_id = '$TENANT';
SQL

LIMIT=$("${PSQL[@]}" -c "select app.usage_snapshot('$TENANT', false) ->> 'ai_cost_limit'")
EXPECTED=$("${PSQL[@]}" -c "select floor(($LIMIT - 14.90) / 0.01)::int")

OUT=$(mktemp -d)
for i in $(seq 1 "$N"); do
  "${PSQL[@]}" -c "select public.reserve_ai_cost('$TENANT', 0.01)" >"$OUT/$i" &
done
wait

ALLOWED=$(grep -l '"allowed": true' "$OUT"/* | wc -l)
DENIED=$(grep -l '"reason": "ai_cost_limit"' "$OUT"/* | wc -l)
echo "parallel reservations: $N, allowed: $ALLOWED, denied: $DENIED (cap \$$LIMIT, expected allowed: $EXPECTED)"
[ "$ALLOWED" -eq "$EXPECTED" ] || { echo "FAIL: allowed $ALLOWED, expected $EXPECTED"; exit 1; }
[ $((ALLOWED + DENIED)) -eq "$N" ] || { echo "FAIL: some calls neither allowed nor denied"; exit 1; }

# Settle every allowed reservation in parallel with its actual cost.
for f in $(grep -l '"allowed": true' "$OUT"/*); do
  ID=$(sed -E 's/.*"reservation_id": "([^"]+)".*/\1/' "$f")
  "${PSQL[@]}" -c "select public.settle_ai_cost('$TENANT', '$ID', 0.01)" >/dev/null &
done
wait

SPENT=$("${PSQL[@]}" -c "select app.usage_snapshot('$TENANT', false) ->> 'ai_cost_used'")
RESERVED=$("${PSQL[@]}" -c "select app.usage_snapshot('$TENANT', false) ->> 'ai_cost_reserved'")
echo "spent after settling: \$$SPENT, still reserved: \$$RESERVED"
[ "$("${PSQL[@]}" -c "select ($SPENT)::numeric <= ($LIMIT)::numeric")" = "t" ] || { echo "FAIL: spend exceeded the cap"; exit 1; }
[ "$("${PSQL[@]}" -c "select ($RESERVED)::numeric = 0")" = "t" ] || { echo "FAIL: reservations left behind"; exit 1; }
NEXT=$("${PSQL[@]}" -c "select public.reserve_ai_cost('$TENANT', 0.01) ->> 'allowed'")
[ "$NEXT" = "false" ] || { echo "FAIL: a call was allowed after the cap was reached"; exit 1; }
rm -rf "$OUT"
echo "PASS"
