# PDF Studio Desktop

Electron Forge + Vite로 만든 PDF 조작 데스크톱 앱입니다. PDF 병합·편집·TIFF 변환을 지원하며 React 19 + Tailwind CSS 4 기반 UI를 제공합니다.

## 주요 기능

- PDF 병합/순서 편집, 페이지 회전·삭제, TIFF → PDF 변환
- 페이지/파일 단위 드래그 앤 드롭 정렬, 그룹 접기/펼치기
- 병합 결과 미리보기 및 다운로드, 완료 후 임시 파일 정리

## 기술 스택

- Electron 39, Electron Forge 7, Vite 5
- React 19, TypeScript 5, Tailwind CSS 4
- Zustand 상태 관리, pdf-lib/pdf.js/sharp

## 개발 시작

사전 요구: Node 18+, pnpm.

```bash
pnpm install
pnpm start          # HMR 포함 개발 모드
```

## 빌드/패키징

macOS/Windows/리눅스용 패키지를 생성합니다. (macOS: zip/dmg, Windows: Squirrel exe, Linux: deb/rpm)

```bash
pnpm make           # 각 OS 별 배포 아티팩트 생성
pnpm package        # 압축된 앱 패키지 생성
```

## 프로젝트 구조 (요약)

- `src/main/` : 메인 프로세스, IPC 핸들러, 서비스
- `src/preload/` : `window.api` 브리지
- `src/renderer/` : React FSD 레이아웃 (entities/features/widgets/pages)
- `forge.config.mts` : Forge 패키징 설정 (mac dmg/zip, win squirrel, deb/rpm)

## 주요 워크플로우

- 병합 실행: UI → IPC `pdf.merge:start` → worker에서 처리 → 완료 시 미리보기 전환
- 미리보기: 다운로드 후 또는 돌아가기 시 임시 병합 파일 삭제

## 스크립트

- `pnpm start` : 개발 서버
- `pnpm make` : 플랫폼별 배포물 생성
- `pnpm package` : 패키징
- `pnpm lint` / `pnpm test` / `pnpm typecheck` : 품질 도구

## 라이선스

MIT
