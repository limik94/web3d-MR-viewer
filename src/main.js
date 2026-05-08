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
const debugLog = document.querySelector('#debugLog');
const clearLogsButton = document.querySelector('#clearLogs');

const originalConsole = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  log: console.log.bind(console),
};
const logLines = [];
const maxLogLines = 120;

console.error = (...args) => {
  originalConsole.error(...args);
  addLog('console.error', args.map(formatLogValue).join(' '));
};
console.warn = (...args) => {
  originalConsole.warn(...args);
  addLog('console.warn', args.map(formatLogValue).join(' '));
};

window.addEventListener('error', (event) => {
  addLog('window.error', `${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
});
window.addEventListener('unhandledrejection', (event) => {
  addLog('promise.reject', formatLogValue(event.reason));
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  addLog('webgl', 'renderer created');
} catch (error) {
  addLog('webgl.error', formatError(error));
  notice.textContent = 'WebGL 렌더러 초기화에 실패했습니다. 진단 로그를 확인해주세요.';
  throw error;
}
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
let arSessionRequestInFlight = false;
let arButtonListenerAttached = false;

clearLogsButton.addEventListener('click', () => {
  logLines.length = 0;
  renderLogs();
  addLog('log', 'cleared');
});

logEnvironment();
initArButton();

renderer.xr.addEventListener('sessionstart', () => {
  addLog('xr.sessionstart', 'renderer reported session start');
  notice.textContent = 'AR 세션이 시작되었습니다. 바닥/테이블을 비춘 뒤 터치하면 모델을 배치할 수 있습니다.';
  enterArButton.textContent = 'AR 실행 중';
  enterArButton.disabled = true;
  captureQrPoseButton.disabled = false;
});

renderer.xr.addEventListener('sessionend', () => {
  addLog('xr.sessionend', 'renderer reported session end');
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
  addLog('xr.init', 'checking WebXR availability');
  attachArButtonListener();
  if (!navigator.xr) {
    enterArButton.disabled = true;
    enterArButton.textContent = 'AR 미지원';
    notice.textContent = '이 브라우저에서 WebXR AR을 찾을 수 없습니다. Meta Quest Browser의 HTTPS 주소에서 다시 열어주세요.';
    addLog('xr.init.fail', 'navigator.xr is missing');
    return;
  }

  try {
    addLog('xr.support', 'calling isSessionSupported("immersive-ar")');
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    addLog('xr.support.result', `immersive-ar=${supported}`);
    if (!supported) {
      enterArButton.disabled = true;
      enterArButton.textContent = 'AR 미지원';
      notice.textContent = '현재 브라우저가 immersive-ar 세션을 지원하지 않습니다. Quest Browser에서 WebXR 설정을 확인해주세요.';
      addLog('xr.init.fail', 'immersive-ar is not supported');
      return;
    }
    enterArButton.textContent = 'AR 시작';
  } catch (error) {
    addLog('xr.support.error', formatError(error));
    enterArButton.textContent = 'AR 시작';
  }

  addLog('xr.init.ok', 'AR button is ready');
}

function attachArButtonListener() {
  if (arButtonListenerAttached) return;
  enterArButton.addEventListener('click', startArSession);
  arButtonListenerAttached = true;
  addLog('xr.button.listener', 'click listener attached');
}

async function startArSession() {
  addLog('xr.button', 'AR start button clicked');
  if (arSessionRequestInFlight) {
    addLog('xr.button.skip', 'session request is already in flight');
    return;
  }
  if (!navigator.xr) {
    addLog('xr.request.abort', 'navigator.xr is missing at click time');
    return;
  }
  arSessionRequestInFlight = true;
  enterArButton.disabled = true;
  enterArButton.textContent = 'AR 시작 중...';

  const requestOptions = {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['local-floor', 'dom-overlay'],
    domOverlay: { root: document.body },
  };
  const waitingLogId = window.setTimeout(() => {
    addLog('xr.request.waiting', 'requestSession has not resolved after 8 seconds. Check for a hidden permission prompt or blocked immersive AR.');
  }, 8000);

  try {
    addLog('xr.request', `requestSession immersive-ar ${JSON.stringify({
      requiredFeatures: requestOptions.requiredFeatures,
      optionalFeatures: requestOptions.optionalFeatures,
      hasDomOverlayRoot: Boolean(requestOptions.domOverlay?.root),
    })}`);
    const session = await navigator.xr.requestSession('immersive-ar', requestOptions);
    addLog('xr.request.ok', `session granted; mode=${session.mode || 'unknown'}`);
    session.addEventListener('end', () => addLog('xr.native.end', 'XRSession end event'));
    session.addEventListener('visibilitychange', () => addLog('xr.visibility', session.visibilityState || 'unknown'));
    addLog('xr.renderer.setSession', 'calling renderer.xr.setSession');
    await renderer.xr.setSession(session);
    addLog('xr.renderer.ok', 'renderer session attached');
  } catch (error) {
    addLog('xr.request.error', formatError(error));
    enterArButton.disabled = false;
    enterArButton.textContent = 'AR 시작';
    notice.textContent = `AR 세션을 시작하지 못했습니다: ${getErrorName(error)}. 진단 로그를 확인해주세요.`;
  } finally {
    window.clearTimeout(waitingLogId);
    arSessionRequestInFlight = false;
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
    addLog('model.load', MODEL_URL);
    const gltf = await loader.loadAsync(MODEL_URL);
    modelRoot.clear();
    const model = gltf.scene;
    centerModel(model);
    modelRoot.add(model);
    notice.innerHTML = `모델을 불러왔습니다: <strong>${MODEL_URL}</strong>`;
    addLog('model.load.ok', MODEL_URL);
  } catch (error) {
    addLog('model.load.error', formatError(error));
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
    addLog('xr.hittest', 'requesting viewer reference space');
    session.requestReferenceSpace('viewer').then((viewerSpace) => {
      addLog('xr.hittest', 'requesting hit test source');
      session.requestHitTestSource({ space: viewerSpace }).then((source) => {
        hitTestSource = source;
        addLog('xr.hittest.ok', 'hit test source ready');
      }).catch((error) => {
        addLog('xr.hittest.error', formatError(error));
      });
    }).catch((error) => {
      addLog('xr.refspace.error', formatError(error));
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
    addLog('qr.camera', 'requesting environment camera');
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
      addLog('qr.detector', 'BarcodeDetector enabled');
    } else {
      addLog('qr.detector', 'using jsQR fallback');
    }
    scanQrFrame();
  } catch (error) {
    qrText.textContent = '카메라를 시작할 수 없습니다. Quest Browser 권한과 HTTPS 배포 주소를 확인하세요.';
    addLog('qr.camera.error', formatError(error));
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
  addLog('resize', `${window.innerWidth}x${window.innerHeight}`);
}

function logEnvironment() {
  addLog('boot', `app loaded ${new Date().toISOString()}`);
  addLog('url', window.location.href);
  addLog('context', `secure=${window.isSecureContext}; protocol=${window.location.protocol}`);
  addLog('ua', navigator.userAgent);
  addLog('screen', `${window.innerWidth}x${window.innerHeight}; dpr=${window.devicePixelRatio}`);
  addLog('features', [
    `navigator.xr=${Boolean(navigator.xr)}`,
    `mediaDevices=${Boolean(navigator.mediaDevices?.getUserMedia)}`,
    `BarcodeDetector=${'BarcodeDetector' in window}`,
    `jsQR=${Boolean(window.jsQR)}`,
    `webgl=${Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'))}`,
  ].join('; '));
}

function addLog(label, message) {
  const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  logLines.push(`[${time}] ${label}: ${message}`);
  if (logLines.length > maxLogLines) logLines.splice(0, logLines.length - maxLogLines);
  renderLogs();
}

function renderLogs() {
  debugLog.textContent = logLines.join('\n');
  debugLog.scrollTop = debugLog.scrollHeight;
}

function formatError(error) {
  if (!error) return 'unknown error';
  const name = getErrorName(error);
  const message = error.message || String(error);
  const details = [];
  if (error.code) details.push(`code=${error.code}`);
  if (error.name) details.push(`name=${error.name}`);
  return `${name}: ${message}${details.length ? ` (${details.join(', ')})` : ''}`;
}

function getErrorName(error) {
  return error?.name || error?.constructor?.name || 'Error';
}

function formatLogValue(value) {
  if (value instanceof Error) return formatError(value);
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
