# Blog All-in-One 1차 MVP

블로그 운영을 위한 콘텐츠 초안 생성 도구의 실행 가능한 MVP 뼈대입니다. 이번 단계는 실제 AI 완성형 기능보다 화면 구조, 메뉴 이동, 로컬 임시 저장 흐름을 빠르게 확인하는 데 초점을 둡니다.

## 실행 방법

Windows PowerShell에서 `npm.ps1` 실행 정책 오류가 나면 `npm` 대신 `npm.cmd`를 사용합니다.

1. 의존성 설치

```bash
npm.cmd run install:all
```

2. 프론트엔드 실행

```bash
npm.cmd run dev:frontend
```

브라우저에서 `http://127.0.0.1:5173`으로 접속합니다.

3. 백엔드 실행

```bash
npm.cmd run dev:backend
```

백엔드 상태 확인 주소는 `http://localhost:4000/api/health`입니다.

## 폴더 구조

```text
a-blog-allinone
├─ frontend/            # Vite + React + Tailwind 화면
│  ├─ src/components/   # 공통 레이아웃, 상태 배지
│  ├─ src/lib/          # 로컬 저장, 목업 생성 로직
│  ├─ src/pages/        # 대시보드, 콘텐츠 메이커, 보관함, 설정
│  └─ src/styles/       # 전역 Tailwind 스타일
├─ backend/             # Node.js + Express API 뼈대
│  └─ src/
│     ├─ api/           # API 라우터
│     └─ services/      # 콘텐츠 생성 서비스
├─ shared/              # 프론트/백엔드 공용 MVP 설정
└─ docs/                # 기획/아키텍처/상세 명세 문서
```

## 1차 MVP 범위

- 주제 추천 3개
- 포스팅 제목 후보 3개
- 본문 초안 1개
- 해시태그 10개
- 기본 대시보드
- 로컬 브라우저 저장소 기반 초안 보관
- 입력 전, 입력 완료, 생성 중, 생성 완료, 수정 중, 저장됨, 복사 완료 상태 표시

## 아직 미구현인 항목

- 실제 Gemini/OpenAI 등 AI API 연결
- 댓글/대댓글 자동화 본체
- 외부 블로그 발행 자동화
- 서버 DB 저장
- 로그인/계정 관리
- 고급 설정의 실제 연동 기능

## 현재 저장 정책

1차 MVP는 브라우저 `localStorage`에 초안을 저장합니다. 같은 브라우저에서는 새로고침 후에도 보관함에서 초안을 다시 열 수 있지만, 다른 PC나 다른 브라우저와 동기화되지는 않습니다.
