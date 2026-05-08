# Web3D MR Viewer

Meta Quest 3의 브라우저에서 실행할 수 있는 아주 간단한 Web MR 예제입니다.

## 기능

- `assets/2_ST_respirator_SET.glb` GLB 모델 로드 및 화면/AR 공간 배치
- 슬라이더로 GLB 모델 크기 조절
- AR 오버레이의 XYZ 버튼으로 GLB 모델 위치 미세 이동
- 오브젝트 오른쪽 위에 표시되는 XYZ 이동 기즈모
- AR 세션 내부에 표시되는 3D 이동 패널
- WebXR 손 추적 지원 기기에서는 가상 손 모델 표시
- 손/컨트롤러 ray가 가리키는 3D 버튼을 pinch/select로 눌러 선택 오브젝트 이동
- PC 브라우저에서 3D 이동 패널과 가상 손 ray를 검증하는 테스트 모드
- 진단 로그 화면 출력 및 복사
- AR 세션 안에서 HTML 오버레이가 사라져도 보이는 카메라 고정 3D 디버그 HUD
- WebXR hit-test reticle을 이용한 AR 공간 재배치
- QR 코드 내용 읽기
  - `BarcodeDetector` 지원 브라우저는 기본 감지 API 사용
  - 미지원 브라우저는 `jsQR` CDN 폴백 사용
- QR의 이미지 좌표와 사용자가 reticle로 저장한 WebXR 좌표 표시

> 참고: 현재 일반 WebXR AR 세션에서는 보안/개인정보 보호 정책 때문에 passthrough 카메라 프레임을 직접 분석해 QR의 6DoF 포즈를 자동 산출하기 어렵습니다. 이 예제는 QR 내용은 카메라 권한으로 읽고, QR의 3D 좌표는 사용자가 reticle을 QR 위치에 맞춘 뒤 저장하는 방식입니다.

## GLB 파일 배치

사용자가 제공한 `2_ST_respirator_SET.glb` 파일을 아래 경로에 넣으면 앱이 자동으로 불러옵니다.

```text
assets/2_ST_respirator_SET.glb
```

파일이 없으면 배포/테스트가 가능하도록 대체 3D 박스 모델이 표시됩니다.

## 로컬 실행

정적 파일 서버만 있으면 실행됩니다.

```bash
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080`을 엽니다. 실제 Meta Quest 3 WebXR AR 실행과 카메라 권한은 HTTPS 주소에서 테스트하세요.

## PC 테스트 모드

일반 PC 브라우저에서는 WebXR AR 세션이 없어도 3D 메뉴와 손 ray 조작을 확인할 수 있습니다.

1. `http://localhost:8080/?test=1`로 열거나 화면의 `3D 메뉴 테스트 켜기`를 클릭합니다.
2. 화면 안의 노란 가상 손 ray로 오브젝트 오른쪽 위 3D 이동 패널을 가리킵니다.
3. 마우스 클릭 또는 `가리킨 버튼 실행`으로 X/Y/Z 버튼을 실행합니다.
4. `3D 메뉴 상태 로그 출력`과 `진단 로그`의 `복사` 버튼으로 상태/로그를 확인합니다.
5. 브라우저 콘솔에서는 `window.__MRDebug.state()`, `window.__MRDebug.selfTest()`, `window.__MRDebug.logs()`를 사용할 수 있습니다.

## AR 메뉴/로그가 보이지 않을 때

PC WebXR 시뮬레이터와 일부 브라우저는 immersive AR 안에서 HTML `dom-overlay`를 표시하지 않을 수 있습니다. 이 앱은 그래서 AR 시작 요청 시점부터 WebGL 장면 안에 `AR DEBUG HUD`와 3D 이동 메뉴를 카메라 앞에 직접 표시합니다.

- GitHub Pages에서 테스트 중이라면 먼저 페이지 HTML에 `src/main.js?v=real-webxr-floating-menu-6`가 포함되어 있는지 확인합니다. `src/main.js`만 보이면 이전 배포본을 보고 있는 상태입니다.
- AR 화면 안에서 `xr-visible-geometry-debug-4` 또는 `FAILSAFE HUD`가 보이는지 확인합니다.
- 화면 중앙 근처의 빨강/노랑/초록/파랑 진단판과 흰 구가 보이는지 확인합니다.
- 파란 reticle 근처의 `RETICLE HUD`가 보이는지 확인합니다.
- reticle이 처음 잡히면 모델이 자동으로 reticle 위치에 배치됩니다.
- 실제 WebXR AR 기기에서는 디버그 HUD 대신 선택 표시와 왼손 손바닥 메뉴만 표시합니다.
- 손/컨트롤러 ray로 모델을 pinch/select 하면 모델이 선택되고 노란 두께감 있는 edge bounds가 나타납니다.
- 선택 후 왼손 손바닥을 뒤집어 카메라 쪽으로 보이면 손바닥 옆에 `LEFT PALM MENU`가 열립니다.
- `LEFT PALM MENU`의 X/Y/Z 버튼으로 선택된 모델 위치를 이동합니다.
- 아래쪽의 `SELECTED OBJECT` 3D 메뉴에서 X/Y/Z 버튼이 보이는지 확인합니다.
- HUD의 `dom=none`은 HTML 오버레이가 차단된 상태라는 뜻이며, 이 경우 WebGL 3D HUD를 기준으로 디버깅합니다.
- 컬러 진단판도 보이지 않으면 현재 AR 화면이 앱 WebGL 렌더 레이어를 표시하지 못하거나, 배포/캐시가 이전 코드일 가능성이 큽니다.
- 아무것도 보이지 않으면 일반 페이지에서 `?test=1`로 열고 `window.__MRDebug.state()`와 `window.__MRDebug.logs()`부터 확인합니다.

## GitHub Pages 배포

이 저장소에는 `.github/workflows/pages.yml` 워크플로가 포함되어 있습니다.

1. 변경사항을 GitHub 기본 브랜치에 push합니다.
2. GitHub 저장소의 **Settings → Pages**에서 Source를 **GitHub Actions**로 설정합니다.
3. Actions의 `Deploy static MR page to GitHub Pages` 실행이 끝나면 발급된 Pages URL을 Meta Quest 3 Browser에서 엽니다.
4. `Enter AR` 버튼을 눌러 MR 모드를 시작합니다.

## Quest 3 사용 순서

1. Meta Quest Browser로 GitHub Pages HTTPS URL 접속
2. `Enter AR` 클릭
3. 바닥이나 테이블을 비춰 reticle 표시
4. 컨트롤러 트리거/화면 탭으로 GLB 모델 배치
5. 오브젝트 오른쪽 위의 3D 이동 패널을 손 ray 또는 컨트롤러 ray로 가리킴
6. 손 pinch/select 또는 컨트롤러 트리거로 X/Y/Z 버튼을 눌러 위치 미세 조정
7. `모델 크기` 슬라이더로 크기 조절
8. `QR 카메라 시작`으로 QR 정보 읽기
9. reticle을 QR 위치에 맞춘 뒤 `현재 Reticle 위치를 QR 좌표로 저장` 클릭
