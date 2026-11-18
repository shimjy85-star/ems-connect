# 2026-11-18 검증 기록

- TypeScript/Vite 빌드 성공.
- 관리자 JWT subject 및 authenticated 역할로 배차 → 운행 → 완료 RPC 실행 성공.
- 기존 가상 예약을 트랜잭션 안에서 사용하고 ROLLBACK하여 원복.
- 24시간 경과 배차 차단, 취소 조건 실행, confirmed 보존, 병원 subject의 배차 차단 검증 통과.
- cron.job 및 job_run_details: active=true, 매분 실행, succeeded 확인.
- Vercel production dpl_GbRZYneZV9kXUMkVDdzmNQterGER READY; k119.vercel.app 별칭 연결 확인.
- 관리자 브라우저 로그인 만료로 실제 운영 버튼의 화면 테스트는 로그인 후 진행 필요.
- 동시 요청 부하 시험과 휴대폰 푸시 알림 검증은 하지 않음.
- 기존 lint 경고 1건(set-state-in-effect), 번들 크기 경고 있음.
