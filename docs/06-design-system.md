# 디자인 시스템 토큰 (v2 개선안)

- 작성일: 2026-10-12
- 상태: **제안**. 아직 코드에 적용하지 않았다.
- 정본: Claude Design 디자인 시스템 "PDF Studio" (https://claude.ai/artifact/1ASMwsuQt2SmvSACFmTTL4, 비공개). 값이 이 문서와 다르면 그 페이지의 `tokens.json`이 맞다.
- 관련 계획: [Tauri 마이그레이션 + PDF 비교 계획](plans/2026-10-tauri-migration-and-pdf-compare.md)의 P0-2(FSD 정리), P1-5(테마), Phase 3(비교 UI)

## 1. 왜 바꾸나

지금 `src/renderer/styles/index.css`는 tweakcn에서 가져온 shadcn 테마를 거의 그대로 쓴다. 문제는 다음과 같다.

| 문제 | 지금 | 영향 |
|---|---|---|
| 글꼴이 로드되지 않음 | `--font-sans: Plus Jakarta Sans`를 선언만 하고 `body`는 system-ui로 덮어씀. 한글 글리프도 없음 | 토큰과 실제 화면이 다르다 |
| 모서리가 너무 둥금 | `--radius: 1.4rem`(22.4px), `sm`도 18.4px | 문서 도구에 비해 장난감처럼 보이고, 썸네일과 카드가 같은 둥글기다 |
| 간격 단위가 어긋남 | `--spacing: 0.27rem`(4.32px) | Tailwind 간격이 모두 4px 격자에서 벗어난다 |
| 팔레트 클래스가 하드코딩됨 | `bg-black/50`, `bg-black/60`, `text-white`, `border-yellow-500` 등 약 42곳 | 테마를 바꿔도 따라오지 않는다 |
| 상태 색이 없음 | `destructive`뿐 | 완료, 주의 표시가 제각각이다 |
| 비교 기능 색이 없음 | 없음 | Phase 3 비교 뷰어에 쓸 추가/삭제/변경 색이 필요하다 |
| 쓰지 않는 변수 | `chart-*`, `sidebar-*`, `popover*` | 읽는 사람만 헷갈린다 |

## 2. 무엇을 바꾸나

**shadcn 변수 이름은 그대로 둔다.** `shared/ui`(button, dialog 등)가 `bg-primary`, `hover:bg-accent` 같은 클래스를 이미 쓰고 있으므로, 이름을 바꾸면 컴포넌트를 다 고쳐야 한다. 값만 다듬고 필요한 토큰을 더한다.

### 2.1 색

- 중립색은 primary 색상(hue 285)으로 아주 살짝 기울였다.
- `background`(앱 바탕), `canvas`(작업 영역), `paper`(PDF 페이지, 두 테마 모두 흰색)로 층을 나눴다.
- `primary`는 같은 보라 계열을 유지하되 sRGB 밖으로 나가던 채도(0.27)를 0.22로 낮췄다. 다크 테마의 `primary-foreground`는 어두운 색이다.
- `input`은 컨트롤 경계라서 바탕 대비 3:1을 맞췄다.

| 토큰 | Light | Dark | 비고 |
|---|---|---|---|
| `background` | `oklch(0.985 0.003 285)` | `oklch(0.205 0.008 285)` | 값 변경 |
| `foreground` | `oklch(0.21 0.012 285)` | `oklch(0.96 0.004 285)` | 값 변경 |
| `canvas` | `oklch(0.962 0.005 285)` | `oklch(0.175 0.007 285)` | **추가** |
| `paper` | `#ffffff` | `#ffffff` | **추가** |
| `card` | `oklch(1 0 0)` | `oklch(0.245 0.009 285)` | 값 변경 |
| `card-foreground` | = `foreground` | = `foreground` | |
| `muted` | `oklch(0.955 0.005 285)` | `oklch(0.27 0.01 285)` | 값 변경 |
| `muted-foreground` | `oklch(0.47 0.014 285)` | `oklch(0.72 0.01 285)` | 값 변경 |
| `secondary` | `oklch(0.94 0.006 285)` | `oklch(0.29 0.011 285)` | 값 변경 |
| `secondary-foreground` | = `foreground` | = `foreground` | |
| `accent` | `oklch(0.95 0.03 287)` | `oklch(0.30 0.06 287)` | 값 변경 |
| `accent-foreground` | `oklch(0.45 0.2 287)` | `oklch(0.84 0.09 290)` | 값 변경 |
| `primary` | `oklch(0.52 0.22 287)` | `oklch(0.70 0.16 290)` | 값 변경 |
| `primary-foreground` | `oklch(1 0 0)` | `oklch(0.18 0.03 287)` | 다크 값 변경 |
| `ring` | = `primary` | = `primary` | 라이트 값 변경(검정 → primary) |
| `border` | `oklch(0.905 0.008 285)` | `oklch(0.32 0.012 285)` | 값 변경 |
| `input` | `oklch(0.65 0.012 285)` | `oklch(0.52 0.012 285)` | 값 변경(3:1) |
| `destructive` | `oklch(0.56 0.2 25)` | `oklch(0.70 0.17 22)` | 값 변경 |
| `destructive-foreground` | `oklch(1 0 0)` | `oklch(0.18 0.03 25)` | 다크 값 변경 |
| `success` / `-foreground` | `oklch(0.52 0.12 155)` / 흰색 | `oklch(0.76 0.14 155)` / `oklch(0.18 0.03 155)` | **추가** |
| `warning` / `-foreground` | `oklch(0.80 0.15 80)` / `oklch(0.25 0.06 70)` | 같음(`warning`만 C 0.14) | **추가**, 채움 전용 |
| `scrim` | `#00000080` | `#000000a6` | **추가**, `bg-black/50` 대체 |
| `media-scrim` / `media-foreground` | `#00000099` / `#ffffff` | 같음 | **추가**, 썸네일 위 컨트롤 |
| `group-1`~`group-5` | Tailwind yellow/blue/green/purple/pink-500 값 그대로 | 같음 | **추가**, `group-colors.ts` 대체 |
| `diff-insert` / `-fill` | `#1f6feb` / `#1f6feb33` | 같음 | **추가**, 비교: 추가 |
| `diff-delete` / `-fill` | `#d4500f` / `#d4500f33` | 같음 | **추가**, 비교: 삭제 |
| `diff-change` / `-fill` | `#a67a00` / `#e0a80040` | 같음 | **추가**, 비교: 변경 |

**제거**: `chart-1`~`chart-5`, `sidebar*`, `popover`, `popover-foreground`(코드에서 쓰지 않음), `--font-serif`(Lora, 쓰지 않음), `--shadow-x/y/blur/spread/opacity/color`(합성용 중간값, 쓰지 않음).

> 주의: `success`와 `destructive`는 밝기가 비슷하다. 상태는 반드시 아이콘이나 낱말과 함께 표시한다. 비교 색은 파랑(추가)·주황(삭제)으로 색각 이상에서도 구분되며, 변경은 점선으로 구분한다.

### 2.2 글꼴

| 역할 | 글꼴 | 번들 |
|---|---|---|
| `--font-sans` | IBM Plex Sans KR → Apple SD Gothic Neo → Malgun Gothic → system-ui | `@fontsource/ibm-plex-sans-kr` (400, 500, 600) |
| `--font-mono` | IBM Plex Mono → ui-monospace → SF Mono → Consolas | `@fontsource/ibm-plex-mono` (400, 500) |

둘 다 OFL이며, 계획서 §1.2의 허용 목록에 들어 있다. 앱은 오프라인으로 돌아야 하므로 CDN이 아니라 npm 패키지로 번들한다.

| 스타일 | 크기/행간 | 굵기 | 쓰는 곳 |
|---|---|---|---|
| `display` | 24/32 | 600 | 빈 화면 제목 |
| `title` | 18/26 | 600 | 다이얼로그 제목 |
| `heading` | 15/22 | 600 | 파일 이름, 카드 제목 |
| `body` | 14/21 | 400 | 본문 |
| `body-strong` | 14/21 | 500 | 버튼 레이블 |
| `caption` | 12/17 | 400 | 상태바, 툴팁 |
| `label` | 12/16 | 500 | 배지, 칩 |
| `meta` (mono) | 12/16 | 400 | 파일 크기, 규격 |
| `page-number` (mono) | 11/14 | 500 | 썸네일 페이지 번호 |

### 2.3 간격, 모서리, 그림자

- **간격**: `--spacing: 0.25rem`(4px). 지금보다 모든 Tailwind 간격이 약 7.4% 줄어든다. **화면 밀도가 바뀌므로 적용 후 주요 화면을 눈으로 확인한다.**
- **모서리**: 역할별 고정값으로 바꾼다. `--radius` 하나에서 계산하던 방식을 버린다.

| 토큰 | 값 | 지금 | 쓰는 곳 |
|---|---|---|---|
| `radius-paper` | 2px | (없음) | PDF 페이지 |
| `radius-xs` | 4px | 2px(Tailwind 기본) | 배지, 체크박스 |
| `radius-sm` | 6px | 18.4px | 입력칸, 툴팁 |
| `radius-md` | 8px | 20.4px | 버튼 |
| `radius-lg` | 12px | 22.4px | 카드 |
| `radius-xl` | 16px | 26.4px | 다이얼로그 |

- **그림자**: 기존 `shadow-xs`~`shadow-xl` 값은 유지하고 `shadow-paper`(페이지 썸네일)를 더한다.

## 3. FSD 파일 배치

토큰은 앱 전체에 한 번 적용되는 설정이므로 **`app` 레이어**에 둔다. TS에서 토큰 이름이 필요하면 **`shared/config`** 에 상수로 둔다. 토큰을 쓰는 쪽(entities, features, widgets)은 Tailwind 클래스로만 참조한다.

```
src/renderer/
├─ app/
│  ├─ styles/                      # ← 지금의 src/renderer/styles/ 를 옮김
│  │  ├─ index.css                 # 진입점: tailwind, tw-animate-css, fonts, tokens, theme, base 순서로 import
│  │  ├─ fonts.css                 # @fontsource import (sans 400/500/600, mono 400/500)
│  │  ├─ tokens.css                # :root(light), .dark 의 원시 변수. 디자인 시스템 tokens.json 과 1:1
│  │  ├─ theme.css                 # @theme inline: --color-*, --radius-*, --shadow-*, --font-* 매핑
│  │  └─ base.css                  # @layer base: body, 포커스 링, 선택 영역
│  ├─ providers/
│  │  └─ theme-provider.tsx        # system|light|dark 설정, .dark 클래스 토글 (P1-5)
│  └─ index.tsx                    # import "./styles/index.css"
│
├─ shared/
│  ├─ config/
│  │  └─ theme.ts                  # THEME_MODE, GROUP_COLOR_CLASSES, DIFF_KIND 같은 토큰 이름 상수
│  └─ ui/                          # 토큰 클래스만 사용. 팔레트 클래스(bg-black/50 등) 금지
│
├─ entities/
│  ├─ pdf-page/ui/                 # bg-paper, rounded-paper, shadow-paper, bg-media-scrim
│  └─ comparison/ui/               # (Phase 3) diff-* 토큰으로 하이라이트 박스
│
└─ features/pdf-merge/model/       # group-colors 는 shared/constants → shared/config/theme.ts 로
```

규칙:
- **`app/styles` 밖에서 CSS 변수를 정의하지 않는다.** 컴포넌트의 `style={{}}`는 크기·위치 계산에만 쓴다.
- **`shared/config/theme.ts`는 이름만 갖는다.** 색 값은 CSS에만 있다(값이 두 곳에 있으면 어긋난다).
- `components.json`의 `tailwind.css`를 `src/renderer/app/styles/index.css`로, 존재하지 않는 `components` 별칭을 `@/renderer/shared/ui`로 고친다.

### 3.1 `tokens.css` 초안

```css
:root {
  --background: oklch(0.985 0.003 285);
  --foreground: oklch(0.21 0.012 285);
  --canvas: oklch(0.962 0.005 285);
  --paper: #ffffff;
  --card: oklch(1 0 0);
  --card-foreground: var(--foreground);
  --muted: oklch(0.955 0.005 285);
  --muted-foreground: oklch(0.47 0.014 285);
  --secondary: oklch(0.94 0.006 285);
  --secondary-foreground: var(--foreground);
  --accent: oklch(0.95 0.03 287);
  --accent-foreground: oklch(0.45 0.2 287);
  --primary: oklch(0.52 0.22 287);
  --primary-foreground: oklch(1 0 0);
  --ring: var(--primary);
  --border: oklch(0.905 0.008 285);
  --input: oklch(0.65 0.012 285);
  --destructive: oklch(0.56 0.2 25);
  --destructive-foreground: oklch(1 0 0);
  --success: oklch(0.52 0.12 155);
  --success-foreground: oklch(1 0 0);
  --warning: oklch(0.8 0.15 80);
  --warning-foreground: oklch(0.25 0.06 70);
  --scrim: #00000080;
  --media-scrim: #00000099;
  --media-foreground: #ffffff;
  --group-1: oklch(0.795 0.184 86.047);
  --group-2: oklch(0.623 0.214 259.815);
  --group-3: oklch(0.723 0.219 149.579);
  --group-4: oklch(0.627 0.265 303.9);
  --group-5: oklch(0.656 0.241 354.308);
  --diff-insert: #1f6feb;
  --diff-insert-fill: #1f6feb33;
  --diff-delete: #d4500f;
  --diff-delete-fill: #d4500f33;
  --diff-change: #a67a00;
  --diff-change-fill: #e0a80040;
}

.dark {
  --background: oklch(0.205 0.008 285);
  --foreground: oklch(0.96 0.004 285);
  --canvas: oklch(0.175 0.007 285);
  --card: oklch(0.245 0.009 285);
  --muted: oklch(0.27 0.01 285);
  --muted-foreground: oklch(0.72 0.01 285);
  --secondary: oklch(0.29 0.011 285);
  --accent: oklch(0.3 0.06 287);
  --accent-foreground: oklch(0.84 0.09 290);
  --primary: oklch(0.7 0.16 290);
  --primary-foreground: oklch(0.18 0.03 287);
  --border: oklch(0.32 0.012 285);
  --input: oklch(0.52 0.012 285);
  --destructive: oklch(0.7 0.17 22);
  --destructive-foreground: oklch(0.18 0.03 25);
  --success: oklch(0.76 0.14 155);
  --success-foreground: oklch(0.18 0.03 155);
  --warning: oklch(0.8 0.14 80);
  --scrim: #000000a6;
}
```

`theme.css`는 위 변수마다 `--color-<이름>: var(--<이름>)`을 두고, 모서리·그림자·글꼴을 고정값으로 선언한다(`--radius-paper: 2px` … `--radius-xl: 16px`, `--font-sans`, `--font-mono`, `--spacing: 0.25rem`).

## 4. 적용 순서 (제안)

[단계별 진행 가이드](plans/2026-10-step-guide.md)에서 1단계는 Step 2, 2~4단계는 Step 7, 5단계는 Phase 3에 들어 있다. 각 단계는 따로 커밋할 수 있다.

1. **파일 이동**: `src/renderer/styles/` → `src/renderer/app/styles/`로 옮기고 `tokens.css`, `theme.css`, `base.css`로 나눈다. 값은 그대로 둔다(동작 변화 없음). `components.json` 경로를 고친다.
2. **글꼴 번들**: `@fontsource` 두 패키지를 추가하고 `fonts.css`를 연결한다. `body`의 system-ui 덮어쓰기를 지운다.
3. **값 교체**: 2.1~2.3의 값으로 바꾸고, 쓰지 않는 변수를 지운다. 라이트·다크 주요 화면(빈 화면, 썸네일 그리드, 병합 미리보기, 다이얼로그)을 확인한다.
4. **하드코딩 제거**: 팔레트 클래스 약 42곳을 토큰 클래스로 바꾼다. `group-colors.ts`를 `shared/config/theme.ts`로 옮겨 `border-group-1`~`5`를 쓴다.
5. **(Phase 3)** 비교 뷰어에서 `diff-*` 토큰을 쓴다.

## 5. 아직 하지 않은 것

- `shared/ui` 컴포넌트는 디자인 시스템 페이지에 아직 없다. 토큰을 코드에 적용한 뒤 빌드 번들로 추가한다.
- 로고 파일이 없다.
- 크기 토큰(툴바 높이, 컨트롤 높이)은 실제 화면을 측정한 뒤 정한다.
