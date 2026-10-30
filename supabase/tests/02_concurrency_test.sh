#!/usr/bin/env bash
# 30 students submit at the same moment (and one student fires 5 duplicate taps),
# while the teacher closes the question. Verifies: no lost answers, no duplicates,
# nothing accepted after Close, and scores applied exactly once.
# Usage: PSQL="psql -h localhost -U postgres -d qr" ./02_concurrency_test.sh   (local test DB only)
set -euo pipefail
PSQL=${PSQL:-"psql -h /home/pgt -p 55432 -U postgres -d qr"}
q() { $PSQL -qtAX -v ON_ERROR_STOP=1 -c "$1"; }
claims() { echo "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"is_anonymous\":$2}', false); set role authenticated;"; }
T=a0000000-0000-0000-0000-000000000001

QUIZ=$(q "select id from quizzes limit 1")
SID=$(q "$(claims $T false) select (host_game('$QUIZ','timed')).id" | tail -1)
PIN=$(q "select pin from game_sessions where id='$SID'")
for i in $(seq -w 1 30); do
  U=c0000000-0000-0000-0000-0000000000$i
  q "insert into auth.users values ('$U') on conflict do nothing"
  q "$(claims $U true) select join_game('$PIN','Kid$i')" >/dev/null
done
q "$(claims $T false) select host_control('$SID','start'); select host_control('$SID','next');" >/dev/null

# everyone answers at once (+5 duplicate taps from Kid01)
for i in $(seq -w 1 30); do
  U=c0000000-0000-0000-0000-0000000000$i
  q "$(claims $U true) select submit_answer('$SID',0,1)" >/dev/null &
done
for k in 1 2 3 4 5; do
  q "$(claims c0000000-0000-0000-0000-000000000001 true) select submit_answer('$SID',0,0)" >/dev/null &
done
wait
q "$(claims $T false) select host_control('$SID','close');" >/dev/null
LATE=$(q "$(claims c0000000-0000-0000-0000-000000000002 true) select submit_answer('$SID',0,1)->>'reason'" | tail -1)
q "$(claims $T false) select host_control('$SID','reveal'); select host_control('$SID','reveal');" >/dev/null

N=$(q "select count(*) from answers where session_id='$SID'")
D=$(q "select count(*) from (select participant_id from answers where session_id='$SID' group by 1 having count(*)>1) x")
S=$(q "select count(*) from participants where session_id='$SID' and score = (select points from answers a where a.participant_id = participants.id)")
echo "answers stored: $N (expect 30) | duplicates: $D (expect 0) | late answer: $LATE (expect answers_closed) | players scored exactly once: $S (expect 30)"
[[ $N == 30 && $D == 0 && $LATE == answers_closed && $S == 30 ]] && echo "=== CONCURRENCY TEST PASSED ===" || { echo "=== CONCURRENCY TEST FAILED ==="; exit 1; }
