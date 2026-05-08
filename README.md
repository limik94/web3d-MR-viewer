# Web3D MR Viewer

Meta Quest 3의 브라우저에서 실행할 수 있는 아주 간단한 Web MR 예제입니다.

## 기능

- `assets/2_ST_respirator_SET.glb` GLB 모델 로드 및 화면/AR 공간 배치
- 슬라이더로 GLB 모델 크기 조절
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
5. `모델 크기` 슬라이더로 크기 조절
6. `QR 카메라 시작`으로 QR 정보 읽기
7. reticle을 QR 위치에 맞춘 뒤 `현재 Reticle 위치를 QR 좌표로 저장` 클릭
