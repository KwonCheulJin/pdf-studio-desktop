---
name: git-flow
description: PDF Studio Desktop 프로젝트의 Git 커밋 관리 스킬. 커밋 메시지 컨벤션 강제, 사용자 확인 후 커밋 진행. Claude Code 저작권 표시 금지. 트리거: "커밋", "git commit", "변경사항 저장", "브랜치"
---

# Git Flow

## 개요

PDF Studio Desktop 프로젝트의 Git 버전 관리 스킬입니다. 커밋 메시지 컨벤션을 강제하고, 사용자 확인 후에만 커밋합니다.

## 핵심 규칙

### 🚨 규칙 1: 사용자 확인 없이 자동 커밋 금지

**필수 워크플로우:**
1. 기능 구현 완료
2. 변경 사항 표시 (`git status` + `git diff`)
3. **사용자에게 승인 요청**
4. 승인 후 커밋 메시지 작성
5. 로컬 저장소에만 커밋
6. **자동 push 금지**

### 🚫 규칙 2: Claude Code 저작권 표시 금지

**다음 내용 절대 추가 금지:**
- `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- `Co-Authored-By: Claude <noreply@anthropic.com>`

### ✅ 규칙 3: 제목 + 본문 커밋 메시지 필수

## 커밋 메시지 형식

```
<type>(<scope>): <제목 (50자 이내)>

- 핵심 변경사항 1
- 핵심 변경사항 2
- 핵심 변경사항 3
```

### 커밋 타입

| 타입 | 용도 | 예시 |
|------|------|------|
| `feat` | 새 기능 | `feat(merge): implement PDF merge progress` |
| `fix` | 버그 수정 | `fix(ipc): correct preload channel name` |
| `refactor` | 코드 구조 개선 | `refactor(store): extract merge store logic` |
| `style` | 코드 포맷팅 | `style: apply prettier formatting` |
| `perf` | 성능 개선 | `perf(renderer): optimize thumbnail loading` |
| `docs` | 문서 | `docs: update README setup guide` |
| `test` | 테스트 추가/수정 | `test(services): add PDF merge service tests` |
| `chore` | 빌드/설정 | `chore: update dependencies` |

### 스코프 (프로젝트 특화)

| 스코프 | 대상 |
|--------|------|
| `merge` | PDF 병합 기능 |
| `edit` | PDF 편집 기능 |
| `convert` | 파일 변환 (TIFF→PDF) |
| `ipc` | IPC 채널/핸들러 |
| `main` | Main process |
| `preload` | Preload 레이어 |
| `renderer` | Renderer 레이어 |
| `ui` | UI 컴포넌트 |
| `store` | Zustand 스토어 |
| `worker` | Worker 로직 |

## 커밋 워크플로우

### Step 1: 변경 사항 확인

```bash
git status
git diff
```

### Step 2: 사용자에게 표시 후 승인 요청

```
"구현을 완료했습니다. 다음과 같이 변경되었습니다:

변경 파일:
- src/main/services/pdf-merge-service.ts (신규)
- src/preload/index.ts (수정)
- src/renderer/features/pdf-merge/model/ (수정)

주요 변경사항:
- PDF 병합 서비스 구현
- IPC 핸들러 등록
- 병합 훅 수정

커밋할까요?"
```

**사용자 승인 대기** — 승인 없이 진행 금지

### Step 3: 승인 후 커밋

```bash
git add .
git commit -m "feat(merge): implement PDF merge with progress tracking

- Create PdfMergeService with pdf-lib integration
- Add pdf.merge:start IPC handler
- Expose merge API in preload layer
- Add merge progress event (pdf.merge:progress)
- Update useMergeCommand hook for IPC integration"
```

### Step 4: push 금지

사용자가 직접 push합니다.

## 실제 예시

### 신규 기능
```bash
feat(convert): add TIFF to PDF conversion

- Create FileConverterService with sharp integration
- Add file.convert.tiff IPC channel
- Expose convertTiff API in preload layer
- Add useFileConvert hook
- Handle multi-page TIFF conversion
```

### 버그 수정
```bash
fix(edit): correct page rotation IPC channel name

- Fix channel mismatch between preload and handler
- Update channel from pdf.edit:rotate to pdf.edit:apply
- Add missing RotationDegrees type validation
```

### 리팩토링
```bash
refactor(store): separate merge store by concern

- Split merge state from selection state
- Create dedicated selection-store.ts
- Update components to use correct store hooks
- Remove duplicate state management
```

## 커밋 전 체크리스트

- [ ] `pnpm typecheck` 성공
- [ ] `pnpm lint` 오류 없음
- [ ] 사용자에게 변경 사항 표시
- [ ] **사용자 승인 완료**
- [ ] 커밋 메시지에 제목 + 본문 포함
- [ ] 본문에 3~5개 bullet point
- [ ] **Claude Code 저작권 표시 없음**
- [ ] push 자동 실행 안 함
