# HWP Cloud

브라우저에서 한글(HWP·HWPX) 문서를 열고 편집하는 웹 앱입니다. 한글의 달인(master-of-hwp)에서 AI 코파일럿을 뺀 SaaS 버전입니다.

- 편집 엔진은 [rhwp](https://github.com/edwardkim/rhwp)(MIT) WebAssembly 빌드이며, 문서는 브라우저 밖으로 나가지 않습니다.
- 템플릿은 구글 로그인 후 Firebase Firestore에 저장되고 본인만 볼 수 있습니다.
- AI는 [Aside](https://aside.com) 브라우저의 AI를 씁니다. 오른쪽 **Aside 도구**에 문단 번호와 표가 글자로 나오고, 그 번호로 고칩니다. 편집기 도구 버튼은 Aside 화면 정보에서 빠져 있습니다. 자바스크립트가 되면 `hwpCloud.help()`, 안내는 `/llms.txt`입니다.

## 실행

```bash
npm install
npm run build:editor   # rhwp 편집기를 public/editor 로 빌드 (최초 1회, rhwp 업데이트 시)
npm run dev            # http://localhost:5173
```

`build:editor`는 `../master-of-hwp-main/vendor/rhwp-main/rhwp-studio`를 사용합니다. 다른 위치라면 `RHWP_STUDIO_DIR`로 지정하세요.

Firebase 값(`.env.local`)이 없으면 **로컬 모드**로 동작합니다. 로그인 없이 템플릿이 이 브라우저(IndexedDB)에만 저장됩니다.

## Firebase 연결

1. `.env.example`을 `.env.local`로 복사하고 웹 앱 설정값을 넣습니다.
2. Firebase 콘솔 > Authentication > 로그인 방법에서 **Google**을 사용 설정합니다.
3. 배포 도메인을 Authentication > 설정 > 승인된 도메인에 추가합니다. `localhost`는 기본으로 포함됩니다.
4. Firestore 규칙을 배포합니다. 사이트 파일은 Vercel이 배포합니다.

```bash
npm run deploy:rules   # Firestore 규칙
```

## Vercel

루트에서 Vite로 빌드하면 `dist`가 나갑니다. 편집기 파일은 `public/editor`에 포함되어 있어 배포 빌드가 rhwp 소스를 다시 빌드하지 않습니다. Vercel 환경 변수에 `.env.example`과 같은 `VITE_FIREBASE_*` 네 개를 넣습니다. Vite는 빌드 시점에 이 값을 넣으므로, 변수를 바꾼 뒤에는 다시 배포해야 합니다.

## 데이터 구조

```
users/{uid}/templates/{templateId}         이름, 설명, 파일명, 형식(hwp|hwpx), 크기, chunkCount, createdAt
users/{uid}/templates/{templateId}/chunks/{n}  파일 바이트 (700KB 단위)
```

Firestore 문서는 1MB 제한이 있어 파일을 조각으로 나눠 저장합니다. Cloud Storage를 쓰지 않으므로 무료(Spark) 요금제에서 동작합니다. 템플릿 하나는 최대 20MB입니다. 보안 규칙(`firestore.rules`)은 로그인한 본인 경로만 읽고 쓰도록 막습니다.

## 알려진 제한

- **내려받기와 템플릿 저장은 HWP 형식입니다.** 편집기가 아직 HWPX로 내보내지 못해, HWPX 문서도 편집 후에는 `.hwp`로 저장됩니다. ("파일에서 추가"로 올린 HWPX 원본은 그대로 HWPX로 보관됩니다.)
- **문서 텍스트 패널에는 표 안의 글자가 빠집니다.** 찾아 바꾸기는 표 안까지 적용됩니다.
- 편집기 글꼴 파일은 포함되어 있지 않아 시스템 글꼴로 대체 표시됩니다.
