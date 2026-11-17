# EMS CONNECT

구급차 예약 및 배차 관리 웹 앱의 첫 번째 화면 기반입니다. 기존 Supabase 프로젝트를 재사용하며, 이 저장소에는 데이터베이스 변경 SQL이나 비밀키를 두지 않습니다.

## 처음 실행하기

PowerShell에서 프로젝트 폴더를 연 다음 아래 명령을 실행합니다.

```powershell
npm.cmd install
npm.cmd run dev
```

터미널에 표시되는 `http://localhost:...` 주소를 브라우저에서 엽니다.

처음 한 번 설치한 뒤에는 프로젝트 폴더의 `start-ems-connect.cmd`를 더블클릭하면 개발 서버와 브라우저 화면이 열립니다. 서버 터미널은 화면을 사용하는 동안 열어 두고, 종료할 때 `Ctrl+C`를 누릅니다.

## Supabase 로컬 설정

`.env.example`을 `.env.local`로 복사하고, `VITE_SUPABASE_ANON_KEY`에 Supabase의 **publishable/anon 키**를 입력합니다. PowerShell에서는 다음과 같이 복사할 수 있습니다.

```powershell
Copy-Item .env.example .env.local
```

이 키는 브라우저에 전달될 수 있으므로 공개용 키만 사용합니다.

`service_role` 또는 secret 키는 프런트엔드 변수나 소스 코드에 넣지 마세요. `.env.local`은 Git에서 제외됩니다.

접속 정보를 설정하지 않으면 샘플 데이터 없이 대시보드와 병원 직원 예약 화면 초안을 볼 수 있습니다. 접속 정보를 설정하면 기존 계정 로그인과 RLS가 허용하는 예약 조회가 활성화됩니다. 병원 직원이 예약 폼을 제출하면 현재의 `hospital_create_own_reservation` 정책 조건에 맞춰 `requested` 상태로 저장을 요청합니다. 앱은 DB 권한이나 RLS 정책을 바꾸지 않으며, 배차·차량 화면은 기존 권한을 확인한 뒤 연결합니다.

예약 관리는 최근 기록을 25건씩 불러오며, `이전 예약 더 불러오기`를 눌러 오래된 예약을 추가로 조회할 수 있습니다. 목록 검색과 상태 필터는 현재 화면에 불러온 기록에 적용됩니다.
