# 디자인 시스템 토큰 (v2)

- 작성일: 2026-10-12
- 상태: **적용됨** (2026-10-13, 진행 가이드 Step 7). 실제 값과 이 문서가 다른 점은 [§6](#6-적용-결과와-문서와-다른-점)에 적었다.
- 정본: Claude Design 디자인 시스템 "PDF Studio" (https://claude.ai/artifact/1ASMwsuQt2SmvSACFmTTL4, 비공개). 값이 이 문서와 다르면 그 페이지의 `tokens.json`이 맞다.
- 관련 계획: [Tauri 마이그레이션 + PDF 비교 계획](plans/2026-10-tauri-migration-and-pdf-compare.md)의 P0-2(FSD 정리), P1-5(테마), Phase 3(비교 UI)

## 1. 왜 바꾸나

적용 전 `src/renderer/styles/index.css`는 tweakcn에서 가져온 shadcn 테마를 거의 그대로 쓴다. 문제는 다음과 같다.

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
| `paper-line` | `oklch(0.88 0.006 285)` | 같음 | **추가**(Step 24), 종이(`paper`) 위 그림 속 글줄. 종이가 두 테마 모두 흰색이라 값도 같다 |
| `card` | `oklch(1 0 0)` | `oklch(0.245 0.009 285)` | 값 변경 |
| `card-foreground` | = `foreground` | = `foreground` | |
| `card-inset` | `oklch(0.975 0.003 285)` | `oklch(0.26 0.009 285)` | **추가**(Step 25), 카드 안에 들어간 옅은 면(파일 슬롯 바탕, 표 머리). 다크 값은 아래 주석 |
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
| `success-subtle` / `-foreground` | `oklch(0.95 0.04 155)` / `oklch(0.42 0.1 155)` | `oklch(0.3 0.05 155)` / `oklch(0.84 0.1 155)` | **추가**(Step 25), "준비됨" 같은 옅은 성공 배지(바탕·글자). `success`는 채움 전용이라 따로 둔다 |
| `warning` / `-foreground` | `oklch(0.80 0.15 80)` / `oklch(0.25 0.06 70)` | 같음(`warning`만 C 0.14) | **추가**, 채움 전용 |
| `scrim` | `#00000080` | `#000000a6` | **추가**, `bg-black/50` 대체 |
| `media-scrim` / `media-foreground` | `#00000099` / `#ffffff` | 같음 | **추가**, 썸네일 위 컨트롤 |
| `group-1`~`group-5` | Tailwind yellow/blue/green/purple/pink-500 값 그대로 | 같음 | **추가**, `group-colors.ts` 대체 |
| `diff-insert` / `-fill` | `#1f6feb` / `#1f6feb33` | 같음 | **추가**, 비교: 추가 |
| `diff-delete` / `-fill` | `#d4500f` / `#d4500f33` | 같음 | **추가**, 비교: 삭제 |
| `diff-change` / `-fill` | `#a67a00` / `#e0a80040` | 같음 | **추가**, 비교: 변경 |

**제거**: `chart-1`~`chart-5`, `sidebar*`, `popover`, `popover-foreground`(코드에서 쓰지 않음), `--font-serif`(Lora, 쓰지 않음), `--shadow-x/y/blur/spread/opacity/color`(합성용 중간값, 쓰지 않음).

> 다크 값 근거(Step 25): 시안에 다크 화면이 없어 기존 다크 팔레트 규칙에서 정했다. 다크 팔레트는 카드 위의 면(`muted` 0.27, `secondary` 0.29)을 카드(0.245)보다 **밝게** 올리고, 그 간격은 라이트(카드 1 → `muted` 0.955, 0.045)의 약 절반(0.025)이다. `card-inset`은 라이트에서 카드와 `muted` 사이(카드에서 0.025)이므로 다크도 같은 비율로 카드에서 0.014 올린 0.26(채도는 카드와 같은 0.009)이다. `success-subtle`은 옅은 primary 면인 `accent`의 다크 규칙(바탕 L 0.30·낮은 채도, 글자 L 0.84)을 hue 155에 그대로 옮겼다. 글자 대비는 라이트·다크 모두 4.5:1을 넘는다.

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

- **그림자**: 기존 `shadow-xs`~`shadow-xl` 값은 유지하고 `shadow-paper`(페이지 썸네일)를 더한다. 값은 화면 시안 HTML의 종이 그림자 `0px 0px 0px 1px rgba(0, 0, 0, 0.06), 0px 1px 2px 0px rgba(0, 0, 0, 0.12)`다(Step 24에서 홈 카드 그림에 처음 씀).

## 3. FSD 파일 배치

토큰은 앱 전체에 한 번 적용되는 설정이므로 **`app` 레이어**에 둔다. TS에서 토큰 이름이 필요하면 **`shared/config`** 에 상수로 둔다. 토큰을 쓰는 쪽(entities, features, widgets)은 Tailwind 클래스로만 참조한다.

```
src/renderer/
├─ app/
│  ├─ styles/                      # 앱 전역 스타일(fonts, tokens, theme, base)
│  │  ├─ index.css                 # 진입점: tailwind, tw-animate-css, fonts, tokens, theme, base 순서로 import
│  │  ├─ fonts.css                 # @fontsource import (sans 400/500/600, mono 400/500)
│  │  ├─ tokens.css                # :root(light), .dark 의 원시 변수. 디자인 시스템 tokens.json 과 1:1
│  │  ├─ theme.css                 # @custom-variant dark, @theme inline: --color-*, --radius-*, --shadow-*, --font-* 매핑
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
│  └─ comparison/ui/               # (Phase 3) diff-* 토큰으로 하이라이트 박스
│
└─ features/pdf-merge/
   ├─ ui/                          # 문서·페이지 카드: bg-paper, rounded-paper, shadow-paper, bg-media-scrim
   └─ model/                       # group-colors 는 shared/constants → shared/config/theme.ts 로
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
  --paper-line: oklch(0.88 0.006 285);
  --card: oklch(1 0 0);
  --card-foreground: var(--foreground);
  --card-inset: oklch(0.975 0.003 285);
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
  --success-subtle: oklch(0.95 0.04 155);
  --success-subtle-foreground: oklch(0.42 0.1 155);
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
  --card-inset: oklch(0.26 0.009 285);
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
  --success-subtle: oklch(0.3 0.05 155);
  --success-subtle-foreground: oklch(0.84 0.1 155);
  --warning: oklch(0.8 0.14 80);
  --scrim: #000000a6;
}
```

`theme.css`는 위 변수마다 `--color-<이름>: var(--<이름>)`을 두고, 모서리·그림자·글꼴을 고정값으로 선언한다(`--radius-paper: 2px` … `--radius-xl: 16px`, `--font-sans`, `--font-mono`, `--spacing: 0.25rem`).

## 4. 적용 순서

[단계별 진행 가이드](plans/2026-10-step-guide.md)에서 1단계는 Step 2, 2~4단계는 Step 7, 5단계는 Phase 3에 들어 있다. 각 단계는 따로 커밋할 수 있다.

1. **파일 이동**(완료): `src/renderer/styles/` → `src/renderer/app/styles/`로 옮기고 `tokens.css`, `theme.css`, `base.css`로 나눈다. 값은 그대로 둔다(동작 변화 없음). `components.json` 경로를 고친다.
2. **글꼴 번들**(완료): `@fontsource` 두 패키지를 추가하고 `fonts.css`를 연결한다. `body`의 system-ui 덮어쓰기를 지운다.
3. **값 교체**(완료): 2.1~2.3의 값으로 바꾸고, 쓰지 않는 변수를 지운다. 라이트·다크 주요 화면(빈 화면, 썸네일 그리드, 병합 미리보기, 다이얼로그)을 확인한다.
4. **하드코딩 제거**(완료): 팔레트 클래스 약 42곳을 토큰 클래스로 바꾼다. `group-colors.ts`를 `shared/config/theme.ts`로 옮겨 `border-group-1`~`5`를 쓴다.
5. **(Phase 3)** 비교 뷰어에서 `diff-*` 토큰을 쓴다.

## 5. 아직 하지 않은 것

- `shared/ui` 컴포넌트는 디자인 시스템 페이지에 아직 없다. 토큰을 코드에 적용한 뒤 빌드 번들로 추가한다.
- 로고 파일이 없다.
- 크기 토큰(툴바 높이, 컨트롤 높이)은 실제 화면을 측정한 뒤 정한다.
- 글자 스타일(§2.2 `display`~`page-number`) 토큰, 모서리 역할 맞추기(아래 §6)

## 6. 적용 결과와 문서와 다른 점

정본 `tokens.json`을 가져올 수 없어 이 문서의 §2·§3.1 값을 그대로 넣었다. 문서에 없는 값은 지어내지 않고 기존 값을 두었다.

- **배치**: 색은 `tokens.css`(`:root`/`.dark`)와 `theme.css`의 `@theme inline`(`--color-*: var(--*)`), 테마와 상관없는 글꼴·`--spacing`·모서리·그림자·자간은 `theme.css`의 `@theme`(고정값)에 둔다. 다크 블록은 색만 다시 정의한다.
- **글꼴 스택**: §2.2 순서 끝에 일반 글꼴(`sans-serif`, `monospace`)을 하나 더 두었다. `@fontsource` CSS가 `woff2`와 `woff`를 함께 가리켜 빌드에 둘 다 자산 파일로 나간다(작은 파일은 `data:`로 인라인, CSP `font-src 'self' data:` 안).
- **그대로 둔 값**: 그림자 `shadow-2xs`~`shadow-2xl`(기존 값), 자간 `--tracking-normal: -0.025em`과 파생 값(문서에 없음).
- **넣지 않은 것**: 글자 스타일 토큰(§3.1·`theme.css` 설명에 없음). `shadow-paper`와 `paper-line`은 Step 24에서 시안 HTML 값으로 넣었다(§6.1).
- **새 토큰 중 아직 쓰지 않는 것**: `canvas`, `paper`, `success`, `warning`, `diff-*`. 화면에 붙이는 일은 해당 화면을 고칠 때(비교 뷰어는 Phase 3) 한다.
- **모서리**: 임의값 `rounded-[4px]`는 같은 4px인 `rounded-xs`로만 바꿨다. §2.3 "쓰는 곳"과 다른 곳이 남아 있다 — 버튼 `rounded-lg`(12px, 문서는 `md` 8px), 다이얼로그 `rounded-xs`(4px, 문서는 `xl` 16px), 페이지 썸네일 `rounded-paper` 미사용.
- **팔레트 클래스 → 토큰** (실제 팔레트 클래스 34개, 임의값 14개): `bg-black/60` → `bg-media-scrim`, `bg-black/50` → `bg-scrim`, `text-white`·`bg-white/20`(썸네일 위 버튼) → `media-foreground`, 오류 화면의 `red-*`·`gray-*` → `destructive`·`muted-foreground`, `group-colors.ts` → `shared/config/theme.ts`의 `GROUP_COLOR_CLASSES`(`border-group-1`~`5`).
- **모양이 바뀐 곳**: 썸네일 위 삭제 버튼 hover는 빨간 글자(`text-red-400`) 대신 `bg-destructive` + `text-destructive-foreground` 채움이다(어두운 막 위에서 라이트 `destructive` 글자는 대비가 모자람). 공용 체크박스 테두리는 `border-white/50` 대신 `border-input`이고(툴바 체크박스가 라이트에서 보이게), 썸네일 위 체크박스만 `border-media-foreground/50`을 넘긴다.
- **남은 임의값**: 크기·위치 계산용 `max-h-[70vh]`, `h-[80vh]`, `h-[calc(100%-48px)]`, `max-w-[calc(100%-2rem)]`, `transition-[left,top]`. 글자 크기 `text-[15px]/5.5`(§2.2 `heading` 15/22, 홈 상단바 앱 이름·비교 슬롯 파일 이름 — 글자 스타일 토큰이 없어서), `text-[13px]`(비교 슬롯 "교체", 시안 13px — §6.1 표의 글자 13px). 색 임의값은 없다. 크기 토큰은 §5대로 화면을 잰 뒤 정한다.
- **간격**: 그리드 카드 크기·간격은 JS 상수(`shared/constants/grid-layout.ts`, px)라 `--spacing` 변경과 상관없다. Tailwind 간격(패딩·높이)만 약 7.4% 줄었다.
- **검증**: `e2e/design-tokens.spec.ts` — 본문 글꼴과 실제 로드, 라이트·다크 본문 대비 4.5:1 이상, 키보드 포커스 링(링 색과 배경 3:1 이상).

### 6.1 화면 시안 HTML과 토큰 대조 (Step 24)

화면 시안(로컬 `design-files/artboards/01~09-*.html`, 레포 캡처 `docs/resource/design/`)은 CSS 변수 없이 값을 요소마다 직접 쓴다. 그 값을 모아 이 문서·`tokens.css`·`theme.css`와 맞춰 봤다. 시안에는 다크 화면이 없어 라이트 값만 대조했다.

**토큰과 같은 값** — `background`, `foreground`, `canvas`, `paper`·`card`(`#ffffff` = `oklch(1 0 0)`), `muted`, `muted-foreground`, `secondary`, `accent`, `accent-foreground`, `primary`, `primary-foreground`, `border`, `input`, `destructive`, `success`, `scrim`(`#00000080`), `group-1`~`3`, `diff-*` 6개. 그림자 `0 2px 3px /0.08` = `shadow-xs`(모드 탭), `…/0.16, 0 1px 2px -1px` = `shadow-sm`(카드), `…, 0 4px 6px -1px` = `shadow-lg`(토스트), `…, 0 8px 10px -1px` = `shadow-xl`(플로팅 바·대화상자). 모서리 2·4·6·8·12·16px과 `9999px` = `radius-paper`·`xs`·`sm`·`md`·`lg`·`xl`·`full`. 글꼴은 같은 두 가족(IBM Plex Sans KR·Mono).

**토큰에 없던 값**

| 시안 값 | 시안 | 쓰는 곳 | 처리 |
|---|---|---|---|
| `oklch(0.88 0.006 285)` | 1 | 홈 카드 그림의 글줄 | `paper-line`으로 **추가**(Step 24) |
| `0 0 0 1px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.12)` | 1~6 | 종이(페이지·그림 속 문서) | `shadow-paper`로 **추가**(Step 24) |
| `0 0 0 1px rgba(0,0,0,.06)`(테두리만) | 1, 7, 8 | 뒤에 깔린 종이, 진행·실패 화면의 유령 카드 | 넣지 않음. 홈은 `shadow-paper`로 대신(아래 그림자가 1px 더 있다) |
| `oklch(0.92 0.005 285)`, `oklch(0.85 0.008 285)` | 2, 5, 6 | 병합 카드·내보내기 미리보기의 가짜 썸네일 글줄 | 넣지 않음. 실제 화면은 pdf.js로 그린 페이지라 필요 없다 |
| `oklch(0.9 0.005 285)`, `oklch(0.82 0.008 285)`, `oklch(0.85 0.006 285)` | 3, 4, 5 | 반복 줄 제외 미니 그림, 리포트 미리보기 글줄 | 그 화면(Step 26·29)에서 `paper-line`으로 모을지 정한다 |
| `oklch(0.975 0.003 285)` | 3, 4 | 파일 슬롯 바탕, 옵션 표 머리, 차이 목록 묶음 머리(옅은 면) | `card-inset`으로 **추가**(Step 25, §2.1). 옵션 표·차이 목록도 이 토큰을 쓴다 |
| `oklch(0.95 0.04 155)` / `oklch(0.42 0.1 155)` | 3 | "준비됨" 배지(옅은 성공 바탕·글자) | `success-subtle` / `-foreground`로 **추가**(Step 25, §2.1) |
| `oklch(0.95 0.03 25)` | 8 | 실패 아이콘 원 바탕(옅은 `destructive`) | 없음 |
| `oklch(0.62 0.13 285)` + 불투명도 0.45 | 4 | 연결선 평상시 색(계획서 §7.1 "중립 마커색") | 없음. 연결선(Step 28) |
| 모서리 3px | 3 | 페이지 범위 입력칸의 A·B 배지(16px) | 없음 |
| 글자 13px, mono 28/32 | 2, 3, 6, 7 | 툴바 작은 버튼·"전체 선택"·"교체", 진행률 큰 숫자 | §2.2 글자 스타일에 없음 |
| 자간 0(본문), `-0.01em`(홈 제목) | 전체 | 본문 | 앱은 전역 `--tracking-normal: -0.025em`이라 글자가 조금 더 좁다(§6 "그대로 둔 값") |
| 루트 글자 14/21 | 전체 | 본문 | §2.2 `body`와 같다. 앱은 `body`에 크기를 두지 않아(16px) 화면마다 `text-sm/5.25`로 맞춘다 |

**시안에 있지만 넣지 않은 것** — 비교 화면 머리(시안 3)의 "최근 결과" 버튼. 지금은 열어 볼 비교 결과가 없어(결과 화면은 Step 27) 누를 곳이 없는 버튼이 되므로 결과 화면과 함께 넣는다.

### 6.2 병합 화면: 시안 2·6·7·8과 지금 화면 (Step 24, 고치지 않음)

계획서 D10대로 병합 화면은 모드 탭만 더했다. 아래는 Playwright 헤드리스 캡처(1280×800)와 시안 PNG를 나란히 놓고 본 차이다. 고칠지는 따로 정한다.

툴바(시안 2·6)
- 모드 탭: 시안은 `[병합 | 비교 | 번역]`, 앱은 `[병합 | 비교]`(번역은 Phase 6).
- "전체 선택": 시안은 체크박스 + "전체 선택" 글자(13px), 앱은 체크박스만(툴팁).
- "전체 삭제": 시안은 13px 보통 굵기·모서리 6px, 앱은 12px 굵게·모서리 12px(`Button size="sm"`).
- "파일 추가"·"병합": 시안은 높이 36px·모서리 8px·굵기 500(병합 좌우 20px), 앱은 40px·12px·굵게(16px). 버튼 모서리는 §6 "모서리" 항목과 같은 문제다.
- 머리: 시안은 `min-height: 64px` + 줄바꿈, 앱은 `h-16` 고정.

카드 그리드(시안 2·6)
- 배치: 시안은 `auto-fill, minmax(180px, 1fr)`·간격·여백 24px로 가로를 채운다(1280에서 6열). 앱은 JS 카드 크기 240px 고정 + 가운데 정렬(1280에서 4열).
- 선택 표시: 시안은 고른 카드만 20px primary 체크 사각형 + 2px primary 테두리. 앱은 `media-scrim` 바탕 위 체크박스 + 얇은 primary 테두리이고, 마우스를 올리면 카드 위 동작 버튼이 보인다.
- 카드 아래 둘째 줄: 시안은 쪽수("5페이지"), 앱은 쪽 범위("1-3").
- 펼친 페이지 카드(시안 6): 시안은 아래에 mono 11px 한 줄 "invoice · p. 1", 체크박스가 늘 보이고(빈 칸은 1.5px `input` 테두리), 파일 그룹 테두리 2px. 앱은 파일 이름·쪽 번호 두 줄, 체크박스는 골랐거나 마우스를 올렸을 때만, 그룹 테두리 1px.
- 삭제된 페이지(시안 6): 시안은 2px `input` 점선 + 글자 흐림(0.35) + 회색(`muted`) "삭제됨" 배지 + primary 테두리 "복원". 앱은 1px 점선 + 빨간(`destructive`) "삭제됨" 배지 + 회색(`secondary`) "복원".
- 접힌 문서 카드(시안 6): 시안은 썸네일 왼쪽 아래 "1쪽 삭제됨" 배지 + 캡션 "4페이지 (1-2, 4-5)". 앱은 카드 안 "1쪽 삭제됨" + 캡션 쪽 범위("1, 3").

플로팅 바(시안 2·6)
- 구성: 시안은 선택 수 · 동작 · 확대 막대 · 테마를 한 막대에 늘 함께 둔다. 앱은 고른 것이 있으면 확대 막대를 빼고 선택 동작 + 테마만 둔다.
- 문구: 시안 "2개 파일 선택", "2개 페이지 선택 (삭제됨 1)". 앱 "2개 파일 선택됨", "2개 페이지 선택됨"(삭제 수 없음).
- 순서: 시안 삭제 → 왼쪽 회전 → 오른쪽 회전 → 병합하기 → 선택 해제(복원은 맨 앞, primary 테두리). 앱 반시계 → 시계 → 삭제 → 복원(ghost) → 병합하기 | 선택 해제.

상태바(시안 2·6)
- 시안 6은 "전체 페이지: 9 (삭제 2)"처럼 삭제 수를 함께 보인다. 앱은 삭제를 뺀 수만 보인다.
- 앱은 오른쪽에 "오픈소스 라이선스" 버튼이 더 있다(모든 화면).

진행 화면(시안 7)
- 막: 시안은 `scrim`(#00000080)으로 어둡게 덮고 뒤는 유령 카드. 앱은 `bg-background/80` + 흐림으로 밝게 덮는다.
- 머리: 시안 "병합하는 중" + mono 28px 퍼센트. 앱은 회전 아이콘 + "PDF 병합 중..." + 16px 굵은 퍼센트.
- 단계 행: 시안은 이름(진행·완료는 굵게) + 세부("6 / 6개 파일", "27 / 43쪽 · 회전 적용", "임시 파일에 쓰기") + mono 퍼센트 + 6px 막대, 끝난 막대는 `success`. 앱은 이름 + 퍼센트 + 막대(모두 `primary`), 세부 없음.
- 아래: 시안은 "취소하면 만들던 파일은 지워요. 원본은 그대로예요." 안내 + 테두리 "취소". 앱은 안내 없이 회색 "취소".
- 크기: 시안 너비 520px·패딩 24/28px, 앱 384px(`w-96`)·패딩 28/32px.

실패 화면(시안 8)
- 아이콘: 시안은 36px 원(옅은 `destructive` 바탕) 안에 아이콘, 앱은 원 없이 아이콘만.
- 말투: 시안 "병합하지 못했어요"(해요체), 앱 "병합하지 못했습니다".
- 본문: 시안은 파일 이름(굵게) + 원인 + 해결 방법 한 문단. 앱은 코드 문구 한 줄("암호가 걸린 PDF는 열 수 없습니다.").
- 세부: 시안은 회색 띠 한 줄 "멈춘 곳: 페이지 합치기 · 12 / 43쪽" + 오른쪽 mono 코드. 앱은 세 줄 목록(멈춘 단계·문제 파일·오류 코드)이고 쪽 진행 수가 없다. 시안의 코드 `PDF-ENCRYPTED`는 예시이고 앱은 바인딩 코드(`PASSWORD_PROTECTED`)를 보인다.
- 버튼: 시안 "이 파일 빼기"(ghost) · "닫기"(테두리) · "다시 시도". 앱 "닫기"(ghost) · "이 파일 빼기"(회색) · "다시 시도".
- 막: 진행 화면과 같다(시안은 어둡고 앱은 밝다).
- 토스트: 시안은 흰 카드 + 경고 아이콘 + ✕ "scan_0412.tif를 열지 못해 건너뛰었어요". 앱은 sonner 오류 토스트 `"<이름>" 파일을 열 수 없습니다.` + 코드 문구 설명.

### 6.3 비교 파일 슬롯: 시안 3 위쪽과 지금 화면 (Step 25)

Playwright 헤드리스(WebKit, 1280×800) 캡처를 시안 PNG와 나란히 보고, 시안 HTML을 같은 브라우저로 그려 상자 위치를 잰 값과 앱을 맞췄다.

- **같은 곳**: 머리(높이 64px, 모드 탭·"새 비교"·안내 글), 문서 카드(x 24·y 84, 1232×274, 모서리 16px), 슬롯 머리(A·B 22px 배지 모서리 4px, 제목 굵게, "준비됨" 배지 `success-subtle`), 슬롯 몸통(555×202, 모서리 12px, `card-inset` 바탕, `border` 테두리), 썸네일 자리(44×62, `paper`·`radius-paper`·`shadow-paper`), 이름(15/22 굵게, 넘치면 말줄임), 크기·쪽수(mono 12/16 `muted-foreground`, "1.1 MB · 18쪽"), "교체"(높이 28px, 모서리 6px, 13px), 맞바꾸기(40px 원, x 620·y 233), 상태바 왼쪽 "A 18쪽 | B 19쪽".
- **슬롯 높이**: 시안 HTML은 `box-sizing` 기본값(content-box)이라 `min-height: 168px`에 패딩 32px·테두리 2px가 더해져 202px로 그려진다. 앱(border-box)은 202px(`min-h-50.5`)로 맞췄다.
- **다른 곳**: 모드 탭에 번역이 없다(§6.2와 같다). "최근 결과" 버튼이 없다(§6.1). 썸네일은 시안의 빈 종이 대신 첫 쪽을 그린다. 상태바 오른쪽에 "오픈소스 라이선스" 버튼이 더 있다(모든 화면). 아래 "실행 전 옵션" 카드와 실행 줄은 Step 26에서 더한다. 자간은 앱 전역 `-0.025em`이라 이름이 시안보다 조금 좁다(§6.1).
- **시안에 없는 상태(앱이 정함)**: 빈 슬롯은 같은 크기의 점선 버튼(테두리 `input` — 누르는 컨트롤이라 3:1, 바탕 `card-inset`, 아이콘 + "PDF 고르기" + "또는 여기에 끌어다 놓기")이고 "준비됨" 배지가 없다. 파일을 끌어 슬롯 위에 올리면 그 슬롯만 `primary` 테두리 + `accent` 바탕이다. 둘 다 비면 맞바꾸기 버튼은 흐리게 막힌다. 상태바의 빈 슬롯은 "A 비어 있음"이다.

