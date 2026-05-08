import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.164.1/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/loaders/GLTFLoader.js';

const MODEL_URL = './assets/2_ST_respirator_SET.glb';

const canvas = document.querySelector('#scene');
const notice = document.querySelector('#notice');
const enterArButton = document.querySelector('#enterAr');
const scaleSlider = document.querySelector('#modelScale');
const scaleValue = document.querySelector('#scaleValue');
const resetModelButton = document.querySelector('#resetModel');
const captureQrPoseButton = document.querySelector('#captureQrPose');
const startQrButton = document.querySelector('#startQr');
const stopQrButton = document.querySelector('#stopQr');
const qrVideo = document.querySelector('#qrVideo');
const qrCanvas = document.querySelector('#qrCanvas');
const qrText = document.querySelector('#qrText');
const qrImageCoords = document.querySelector('#qrImageCoords');
const qrWorldCoords = document.querySelector('#qrWorldCoords');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const ambientLight = new THREE.HemisphereLight(0xffffff, 0x334155, 1.4);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.6);
directionalLight.position.set(1, 3, 2);
scene.add(directionalLight);

const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.105, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

const modelRoot = new THREE.Group();
modelRoot.position.set(0, -0.25, -1.1);
scene.add(modelRoot);

const fallbackModel = createFallbackModel();
modelRoot.add(fallbackModel);
loadRespiratorModel();
setModelScale(Number(scaleSlider.value));

let hitTestSource = null;
let hitTestSourceRequested = false;
let qrStream = null;
let qrDetector = null;
let qrLoopId = null;
let lastQrResult = null;

initArButton();

renderer.xr.addEventListener('sessionstart', () => {
  notice.textContent = 'AR 세션이 시작되었습니다. 바닥/테이블을 비춘 뒤 터치하면 모델을 배치할 수 있습니다.';
  enterArButton.textContent = 'AR 실행 중';
  enterArButton.disabled = true;
  captureQrPoseButton.disabled = false;
});

renderer.xr.addEventListener('sessionend', () => {
  notice.textContent = 'AR 세션이 종료되었습니다.';
  enterArButton.textContent = 'AR 시작';
  enterArButton.disabled = false;
  hitTestSourceRequested = false;
  hitTestSource = null;
  reticle.visible = false;
  captureQrPoseButton.disabled = true;
});

renderer.xr.getController(0).addEventListener('select', () => {
  if (!reticle.visible) return;
  modelRoot.position.setFromMatrixPosition(reticle.matrix);
  modelRoot.quaternion.setFromRotationMatrix(reticle.matrix);
});

scaleSlider.addEventListener('input', () => setModelScale(Number(scaleSlider.value)));
resetModelButton.addEventListener('click', () => {
  modelRoot.position.set(0, -0.25, -1.1);
  modelRoot.rotation.set(0, 0, 0);
});
captureQrPoseButton.addEventListener('click', captureQrPose);
startQrButton.addEventListener('click', startQrScanner);
stopQrButton.addEventListener('click', stopQrScanner);
window.addEventListener('resize', onResize);

renderer.setAnimationLoop((timestamp, frame) => {
  if (frame) updateReticle(frame);
  renderer.render(scene, camera);
});

async function initArButton() {
  if (!navigator.xr) {
    enterArButton.disabled = true;
    enterArButton.textContent = 'AR 미지원';
    notice.textContent = '이 브라우저에서 WebXR AR을 찾을 수 없습니다. Meta Quest Browser의 HTTPS 주소에서 다시 열어주세요.';
    return;
  }

  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) {
      enterArButton.disabled = true;
      enterArButton.textContent = 'AR 미지원';
      notice.textContent = '현재 브라우저가 immersive-ar 세션을 지원하지 않습니다. Quest Browser에서 WebXR 설정을 확인해주세요.';
      return;
    }
    enterArButton.textContent = 'AR 시작';
  } catch (error) {
    console.warn('WebXR support check failed:', error);
    enterArButton.textContent = 'AR 시작';
  }

  enterArButton.addEventListener('click', startArSession);
}

async function startArSession() {
  if (!navigator.xr) return;
  enterArButton.disabled = true;
  enterArButton.textContent = 'AR 시작 중...';

  try {
    const session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['local-floor', 'dom-overlay'],
      domOverlay: { root: document.body },
    });
    await renderer.xr.setSession(session);
  } catch (error) {
    console.error('AR session failed:', error);
    enterArButton.disabled = false;
    enterArButton.textContent = 'AR 시작';
    notice.textContent = 'AR 세션을 시작하지 못했습니다. Quest Browser 권한, WebXR 지원, HTTPS 주소를 확인해주세요.';
  }
}

function createFallbackModel() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.28, 0.36),
    new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.45, metalness: 0.1 })
  );
  const label = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.02, 0.38),
    new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 })
  );
  label.position.y = 0.16;
  const connector = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 0.28, 24),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.35, metalness: 0.3 })
  );
  connector.rotation.z = Math.PI / 2;
  connector.position.x = 0.44;
  group.add(body, label, connector);
  return group;
}

async function loadRespiratorModel() {
  const loader = new GLTFLoader();
  try {
    const gltf = await loader.loadAsync(MODEL_URL);
    modelRoot.clear();
    const model = gltf.scene;
    centerModel(model);
    modelRoot.add(model);
    notice.innerHTML = `모델을 불러왔습니다: <strong>${MODEL_URL}</strong>`;
  } catch (error) {
    console.warn('GLB load failed:', error);
    notice.innerHTML = `GLB 파일을 찾을 수 없어 대체 모델을 표시합니다. 배포 전 <code>${MODEL_URL}</code>에 파일을 추가하세요.`;
  }
}

function centerModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  model.position.sub(center);
  model.scale.multiplyScalar(1 / maxAxis);
}

function setModelScale(scale) {
  modelRoot.scale.setScalar(scale);
  scaleValue.textContent = `${scale.toFixed(2)}x`;
}

function updateReticle(frame) {
  const session = renderer.xr.getSession();
  const referenceSpace = renderer.xr.getReferenceSpace();

  if (!hitTestSourceRequested) {
    session.requestReferenceSpace('viewer').then((viewerSpace) => {
      session.requestHitTestSource({ space: viewerSpace }).then((source) => {
        hitTestSource = source;
      });
    });
    hitTestSourceRequested = true;
  }

  if (!hitTestSource) return;
  const hitTestResults = frame.getHitTestResults(hitTestSource);
  if (hitTestResults.length > 0) {
    const pose = hitTestResults[0].getPose(referenceSpace);
    reticle.visible = true;
    reticle.matrix.fromArray(pose.transform.matrix);
  } else {
    reticle.visible = false;
  }
}

async function startQrScanner() {
  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    qrVideo.srcObject = qrStream;
    await qrVideo.play();
    qrVideo.classList.add('active');
    startQrButton.disabled = true;
    stopQrButton.disabled = false;

    if ('BarcodeDetector' in window) {
      qrDetector = new BarcodeDetector({ formats: ['qr_code'] });
    }
    scanQrFrame();
  } catch (error) {
    qrText.textContent = '카메라를 시작할 수 없습니다. Quest Browser 권한과 HTTPS 배포 주소를 확인하세요.';
    console.error('QR camera failed:', error);
  }
}

function stopQrScanner() {
  if (qrLoopId) cancelAnimationFrame(qrLoopId);
  qrLoopId = null;
  qrDetector = null;
  qrVideo.pause();
  qrVideo.classList.remove('active');
  qrStream?.getTracks().forEach((track) => track.stop());
  qrStream = null;
  startQrButton.disabled = false;
  stopQrButton.disabled = true;
}

async function scanQrFrame() {
  if (!qrStream || qrVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    qrLoopId = requestAnimationFrame(scanQrFrame);
    return;
  }

  qrCanvas.width = qrVideo.videoWidth;
  qrCanvas.height = qrVideo.videoHeight;
  const ctx = qrCanvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(qrVideo, 0, 0, qrCanvas.width, qrCanvas.height);

  let result = null;
  if (qrDetector) {
    const codes = await qrDetector.detect(qrCanvas);
    if (codes.length > 0) {
      const code = codes[0];
      result = {
        text: code.rawValue,
        corners: code.cornerPoints.map(({ x, y }) => ({ x, y })),
      };
    }
  } else if (window.jsQR) {
    const image = ctx.getImageData(0, 0, qrCanvas.width, qrCanvas.height);
    const code = window.jsQR(image.data, image.width, image.height);
    if (code) {
      result = {
        text: code.data,
        corners: [code.location.topLeftCorner, code.location.topRightCorner, code.location.bottomRightCorner, code.location.bottomLeftCorner],
      };
    }
  }

  if (result) updateQrReadout(result);
  qrLoopId = requestAnimationFrame(scanQrFrame);
}

function updateQrReadout(result) {
  lastQrResult = result;
  const center = result.corners.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  center.x /= result.corners.length;
  center.y /= result.corners.length;
  const normalized = {
    x: (center.x / qrCanvas.width) * 2 - 1,
    y: -((center.y / qrCanvas.height) * 2 - 1),
  };

  qrText.textContent = result.text;
  qrImageCoords.textContent = [
    `center(px): x=${center.x.toFixed(1)}, y=${center.y.toFixed(1)}`,
    `center(NDC): x=${normalized.x.toFixed(3)}, y=${normalized.y.toFixed(3)}`,
    `corners(px): ${result.corners.map((p) => `(${p.x.toFixed(0)}, ${p.y.toFixed(0)})`).join(' ')}`,
  ].join('\n');
}

function captureQrPose() {
  if (!reticle.visible) {
    qrWorldCoords.textContent = 'Reticle이 보이지 않습니다. 바닥/테이블/QR 근처 표면을 비춘 뒤 다시 시도하세요.';
    return;
  }
  const position = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(reticle.matrix);
  const matrix = reticle.matrix.elements.map((value) => Number(value).toFixed(4));
  qrWorldCoords.textContent = [
    lastQrResult ? `linked QR: ${lastQrResult.text}` : 'linked QR: 아직 QR 내용 없음',
    `position(m): x=${position.x.toFixed(3)}, y=${position.y.toFixed(3)}, z=${position.z.toFixed(3)}`,
    `quaternion: x=${quaternion.x.toFixed(3)}, y=${quaternion.y.toFixed(3)}, z=${quaternion.z.toFixed(3)}, w=${quaternion.w.toFixed(3)}`,
    `matrix: [${matrix.join(', ')}]`,
  ].join('\n');
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
