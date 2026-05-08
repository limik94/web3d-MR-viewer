import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

const MODEL_URL = './assets/2_ST_respirator_SET.glb';
const APP_BUILD = 'ar-palm-scale-ray-8';

const canvas = document.querySelector('#scene');
const notice = document.querySelector('#notice');
const enterArButton = document.querySelector('#enterAr');
const exitArButton = document.querySelector('#exitAr');
const toggleDesktopTestButton = document.querySelector('#toggleDesktopTest');
const clickDesktopTargetButton = document.querySelector('#clickDesktopTarget');
const runWorldUiSelfTestButton = document.querySelector('#runWorldUiSelfTest');
const scaleSlider = document.querySelector('#modelScale');
const scaleValue = document.querySelector('#scaleValue');
const resetModelButton = document.querySelector('#resetModel');
const moveStepInput = document.querySelector('#moveStep');
const moveStepValue = document.querySelector('#moveStepValue');
const modelPositionReadout = document.querySelector('#modelPosition');
const moveModelButtons = document.querySelectorAll('[data-move-axis]');
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
const copyLogsButton = document.querySelector('#copyLogs');

const originalConsole = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  log: console.log.bind(console),
};
const logLines = window.__MRLogLines || [];
const maxLogLines = 120;
const persistentLogKey = 'web3d-mr-viewer-debug-log';

restorePersistentLogs();

console.error = (...args) => {
  originalConsole.error(...args);
  addLog('console.error', args.map(formatLogValue).join(' '));
};
console.warn = (...args) => {
  originalConsole.warn(...args);
  addLog('console.warn', args.map(formatLogValue).join(' '));
};
console.log = (...args) => {
  originalConsole.log(...args);
  addLog('console.log', args.map(formatLogValue).join(' '));
};

window.addEventListener('error', (event) => {
  addLog('window.error', `${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
});
window.addEventListener('unhandledrejection', (event) => {
  addLog('promise.reject', formatLogValue(event.reason));
});

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
scene.add(camera);

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
  new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false })
);
reticle.matrixAutoUpdate = false;
reticle.renderOrder = 60;
reticle.visible = false;
scene.add(reticle);

const reticleDebugPanel = createReticleDebugPanel();
reticleDebugPanel.visible = true;
reticle.add(reticleDebugPanel);

const modelRoot = new THREE.Group();
modelRoot.position.set(0, -0.25, -1.1);
scene.add(modelRoot);

const modelContent = new THREE.Group();
modelRoot.add(modelContent);

const selectionBounds = createSelectionBounds();
selectionBounds.visible = false;
scene.add(selectionBounds);

const moveGizmo = createMoveGizmo();
moveGizmo.visible = false;
scene.add(moveGizmo);

const cameraOverlay = new THREE.Group();
cameraOverlay.name = 'Camera anchored AR debug overlay';
cameraOverlay.visible = false;
camera.add(cameraOverlay);

const worldMovePanel = createWorldMovePanel();
worldMovePanel.visible = false;
cameraOverlay.add(worldMovePanel);

const realArMenu = createWorldMovePanel('REAL AR MENU');
realArMenu.visible = false;
scene.add(realArMenu);

const leftPalmMenu = createWorldMovePanel('LEFT PALM MENU');
leftPalmMenu.visible = false;
scene.add(leftPalmMenu);

const arDebugHud = createArDebugHud();
arDebugHud.visible = false;
cameraOverlay.add(arDebugHud);

const failsafeDebugHud = createFailsafeDebugHud();
failsafeDebugHud.visible = false;
scene.add(failsafeDebugHud);

const xrVisibilityProbe = createXrVisibilityProbe();
xrVisibilityProbe.visible = false;
scene.add(xrVisibilityProbe);

const xrInteractor = createXrInteractor();
scene.add(xrInteractor.group);

const desktopTest = createDesktopTestMode();
scene.add(desktopTest.hand);

const fallbackModel = createFallbackModel();
modelContent.add(fallbackModel);
loadRespiratorModel();
setModelScale(Number(scaleSlider.value));
updateModelPositionReadout();

let hitTestSource = null;
let hitTestSourceRequested = false;
let qrStream = null;
let qrDetector = null;
let qrLoopId = null;
let lastQrResult = null;
let arSessionRequestInFlight = false;
let arButtonListenerAttached = false;
let autoPlacedOnReticle = false;
let selectedObject = null;
const latestViewerPose = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
  available: false,
};
const xrDiagnostics = {
  frameCount: 0,
  viewerPoseCount: 0,
  lastFrameLogTime: 0,
  lastMenuLogTime: 0,
};

clearLogsButton.addEventListener('click', () => {
  logLines.length = 0;
  savePersistentLogs();
  renderLogs();
  addLog('log', 'cleared');
});
copyLogsButton.addEventListener('click', copyDebugLogs);

addLog('app.module', 'main.js module started');
addLog('app.build', APP_BUILD);
logEnvironment();
initArButton();
installDebugApi();
if (new URLSearchParams(window.location.search).has('test')) {
  window.requestAnimationFrame(() => setDesktopTestMode(true));
}

renderer.xr.addEventListener('sessionstart', () => {
  addLog('xr.sessionstart', 'renderer reported session start');
  notice.textContent = 'AR 세션이 시작되었습니다. 바닥/테이블을 비춘 뒤 터치하면 모델을 배치하거나 이동 버튼으로 위치를 미세 조정할 수 있습니다.';
  enterArButton.textContent = 'AR 실행 중';
  enterArButton.disabled = true;
  exitArButton.hidden = false;
  exitArButton.disabled = false;
  document.body.classList.add('xr-active');
  captureQrPoseButton.disabled = false;
  moveGizmo.visible = false;
  worldMovePanel.visible = false;
  realArMenu.visible = false;
  arDebugHud.visible = false;
  failsafeDebugHud.visible = false;
  xrVisibilityProbe.visible = false;
  reticleDebugPanel.visible = false;
  cameraOverlay.visible = false;
  leftPalmMenu.visible = false;
  xrInteractor.group.visible = true;
  updateSelectionBounds();
  logWorldUiSelfTest();
});

renderer.xr.addEventListener('sessionend', () => {
  addLog('xr.sessionend', 'renderer reported session end');
  notice.textContent = 'AR 세션이 종료되었습니다.';
  enterArButton.textContent = 'AR 시작';
  enterArButton.disabled = false;
  exitArButton.hidden = true;
  exitArButton.disabled = false;
  document.body.classList.remove('xr-active');
  latestViewerPose.available = false;
  xrDiagnostics.frameCount = 0;
  xrDiagnostics.viewerPoseCount = 0;
  xrDiagnostics.lastFrameLogTime = 0;
  xrDiagnostics.lastMenuLogTime = 0;
  hitTestSourceRequested = false;
  autoPlacedOnReticle = false;
  hitTestSource = null;
  reticle.visible = false;
  captureQrPoseButton.disabled = true;
  moveGizmo.visible = desktopTest.enabled;
  worldMovePanel.visible = desktopTest.enabled;
  realArMenu.visible = false;
  leftPalmMenu.visible = false;
  arDebugHud.visible = desktopTest.enabled;
  failsafeDebugHud.visible = desktopTest.enabled;
  xrVisibilityProbe.visible = desktopTest.enabled;
  reticleDebugPanel.visible = desktopTest.enabled;
  cameraOverlay.visible = desktopTest.enabled;
  xrInteractor.group.visible = false;
  selectObject(null, 'session-end');
  setWorldControlHover(null);
});

const xrControllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
xrControllers.forEach((controller, index) => {
  controller.userData.index = index;
  const pointer = createPointerRay(index === 0 ? 0x38bdf8 : 0xa78bfa);
  controller.userData.pointerVisual = pointer.userData.pointerVisual;
  controller.add(pointer);
  controller.addEventListener('connected', (event) => {
    controller.userData.connected = true;
    const handedness = event.data?.handedness || `controller-${index + 1}`;
    addLog('xr.input.connected', `${handedness}; hand=${Boolean(event.data?.hand)}`);
  });
  controller.addEventListener('disconnected', () => {
    controller.userData.connected = false;
  });
  controller.addEventListener('selectstart', () => updateXrInteraction(controller, true));
  controller.addEventListener('select', () => {
    if (handleXrSelect(controller)) return;
    if (selectObjectFromSource(controller, `controller-${index}`)) return;
    if (index !== 0 || !reticle.visible) return;
    placeModelAtReticle('controller-select');
  });
  controller.addEventListener('squeezestart', () => handleXrSelect(controller));
  scene.add(controller);
});

const handFactory = new XRHandModelFactory();
const xrHands = [renderer.xr.getHand(0), renderer.xr.getHand(1)];
xrHands.forEach((hand, index) => {
  hand.userData.index = index;
  hand.add(handFactory.createHandModel(hand, 'spheres'));
  const pointer = createHandPointer(index === 0 ? 0x38bdf8 : 0xa78bfa);
  hand.userData.pointerVisual = pointer.userData.pointerVisual;
  hand.add(pointer);
  hand.addEventListener('connected', (event) => {
    hand.userData.connected = true;
    hand.userData.handedness = event.data?.handedness || '';
    addLog('xr.hand.connected', `${event.data?.handedness || `hand-${index + 1}`}; joints=${Boolean(event.data?.hand)}`);
  });
  hand.addEventListener('disconnected', () => {
    hand.userData.connected = false;
  });
  hand.addEventListener('pinchstart', () => {
    if (handleXrSelect(hand)) return;
    selectObjectFromSource(hand, `hand-${index}`);
  });
  hand.addEventListener('selectstart', () => updateXrInteraction(hand, true));
  hand.addEventListener('select', () => {
    if (handleXrSelect(hand)) return;
    selectObjectFromSource(hand, `hand-${index}`);
  });
  scene.add(hand);
});
xrInteractor.group.visible = false;

scaleSlider.addEventListener('input', () => setModelScale(Number(scaleSlider.value)));
moveStepInput.addEventListener('input', () => {
  moveStepValue.textContent = `${Number(moveStepInput.value).toFixed(2)}m`;
});
moveModelButtons.forEach((button) => {
  button.addEventListener('click', () => {
    moveModel(button.dataset.moveAxis, Number(button.dataset.moveDirection));
  });
});
resetModelButton.addEventListener('click', () => {
  resetModelPose();
});
captureQrPoseButton.addEventListener('click', captureQrPose);
startQrButton.addEventListener('click', startQrScanner);
stopQrButton.addEventListener('click', stopQrScanner);
exitArButton.addEventListener('click', endArSession);
toggleDesktopTestButton.addEventListener('click', toggleDesktopTestMode);
clickDesktopTargetButton.addEventListener('click', clickDesktopHoveredControl);
runWorldUiSelfTestButton.addEventListener('click', logWorldUiSelfTest);
canvas.addEventListener('pointermove', updateDesktopPointer);
canvas.addEventListener('click', clickDesktopHoveredControl);
window.addEventListener('resize', onResize);

renderer.setAnimationLoop((timestamp, frame) => {
  if (frame) {
    xrDiagnostics.frameCount += 1;
    updateViewerPose(frame);
    updateReticle(frame);
  }
  updateMoveGizmo();
  updateWorldMovePanel();
  updateRealArMenu();
  updateLeftPalmMenu();
  updateSelectionBounds();
  updateArDebugHud();
  updateFailsafeDebugHud();
  updateXrVisibilityProbe();
  updateReticleDebugPanel();
  updateXrInteractor();
  updateDesktopTestMode();
  logXrFrameDiagnostics();
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
  arDebugHud.visible = false;
  worldMovePanel.visible = false;
  realArMenu.visible = false;
  leftPalmMenu.visible = false;
  failsafeDebugHud.visible = false;
  xrVisibilityProbe.visible = false;
  reticleDebugPanel.visible = false;
  cameraOverlay.visible = false;
  addLog('xr.request.clean-ui', 'debug HUDs hidden; waiting for palm menu gesture');
  logWorldUiSelfTest();

  const requestOptions = {
    requiredFeatures: [],
    optionalFeatures: ['hit-test', 'local', 'local-floor', 'bounded-floor', 'dom-overlay', 'hand-tracking'],
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
    addLog('xr.domOverlay', `state=${session.domOverlayState?.type || 'not-granted'}`);
    addLog('xr.features', 'requested without required hit-test for PC emulator visibility debug');
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

async function endArSession() {
  addLog('xr.exit.button', 'Exit AR button clicked');
  const session = renderer.xr.getSession();
  if (!session) {
    addLog('xr.exit.skip', 'No active XRSession');
    notice.textContent = '종료할 AR 세션이 없습니다.';
    return;
  }

  exitArButton.disabled = true;
  notice.textContent = 'AR 세션을 종료하는 중입니다.';
  try {
    await session.end();
    addLog('xr.exit.ok', 'session.end resolved');
  } catch (error) {
    addLog('xr.exit.error', formatError(error));
    exitArButton.disabled = false;
    notice.textContent = `AR 종료 실패: ${getErrorName(error)}. 진단 로그를 확인해주세요.`;
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
    modelContent.clear();
    const model = gltf.scene;
    centerModel(model);
    modelContent.add(model);
    updateMoveGizmo();
    updateWorldMovePanel();
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
  const clamped = THREE.MathUtils.clamp(scale, Number(scaleSlider.min), Number(scaleSlider.max));
  modelRoot.scale.setScalar(clamped);
  scaleSlider.value = String(clamped);
  scaleValue.textContent = `${clamped.toFixed(2)}x`;
  updateMenuScaleControls();
  updateMoveGizmo();
  updateWorldMovePanel();
  updateSelectionBounds();
}

function moveModel(axis, direction) {
  const step = Number(moveStepInput.value) || 0.05;
  const delta = step * Math.sign(direction || 1);
  if (axis === 'x') modelRoot.position.x += delta;
  if (axis === 'y') modelRoot.position.y += delta;
  if (axis === 'z') modelRoot.position.z += delta;
  updateModelPositionReadout();
  updateMoveGizmo();
  updateWorldMovePanel();
  updateSelectionBounds();
  addLog('model.move', `${axis}${delta >= 0 ? '+' : ''}${delta.toFixed(3)} -> ${formatVector(modelRoot.position)}`);
}

function updateModelPositionReadout() {
  modelPositionReadout.textContent = formatVector(modelRoot.position);
}

function formatVector(vector) {
  return `x=${vector.x.toFixed(3)}, y=${vector.y.toFixed(3)}, z=${vector.z.toFixed(3)}`;
}

function createDesktopTestMode() {
  const hand = createPointerRay(0xfacc15);
  hand.visible = false;
  hand.name = 'Desktop simulated hand ray';
  return {
    enabled: false,
    pointerNdc: new THREE.Vector2(0.35, 0.1),
    raycaster: new THREE.Raycaster(),
    hand,
    hovered: null,
    lastHoverLabel: null,
    lastLogTime: 0,
    lastPointerEvent: null,
  };
}

function toggleDesktopTestMode() {
  setDesktopTestMode(!desktopTest.enabled);
}

function setDesktopTestMode(enabled) {
  desktopTest.enabled = enabled;
  latestViewerPose.available = false;
  desktopTest.hand.visible = enabled;
  moveGizmo.visible = enabled || renderer.xr.isPresenting;
  worldMovePanel.visible = enabled || renderer.xr.isPresenting;
  realArMenu.visible = false;
  leftPalmMenu.visible = false;
  arDebugHud.visible = enabled || renderer.xr.isPresenting;
  failsafeDebugHud.visible = enabled || renderer.xr.isPresenting;
  xrVisibilityProbe.visible = enabled || renderer.xr.isPresenting;
  reticleDebugPanel.visible = enabled || renderer.xr.isPresenting;
  cameraOverlay.visible = enabled || renderer.xr.isPresenting;
  xrInteractor.group.visible = renderer.xr.isPresenting;
  clickDesktopTargetButton.disabled = !enabled;
  toggleDesktopTestButton.textContent = enabled ? '3D 메뉴 테스트 끄기' : '3D 메뉴 테스트 켜기';
  document.body.classList.toggle('desktop-test-active', enabled);
  if (enabled) {
    notice.textContent = 'PC 테스트 모드입니다. 화면의 노란 손 ray로 3D 이동 패널을 가리키고 클릭해 조작을 확인하세요.';
    addLog('desktop.test.on', 'world menu, XYZ gizmo, simulated hand ray enabled');
    updateMoveGizmo();
    updateWorldMovePanel();
    updateArDebugHud(true);
    updateFailsafeDebugHud(true);
    logWorldUiSelfTest();
  } else {
    setWorldControlHover(null);
    notice.textContent = 'PC 테스트 모드가 꺼졌습니다.';
    addLog('desktop.test.off', 'world menu hidden outside AR');
  }
}

function installDebugApi() {
  window.__MRDebug = {
    enableDesktopTest: () => setDesktopTestMode(true),
    disableDesktopTest: () => setDesktopTestMode(false),
    selfTest: logWorldUiSelfTest,
    clickHovered: clickDesktopHoveredControl,
    logs: () => [...logLines],
    clearLogs: () => {
      logLines.length = 0;
      savePersistentLogs();
      renderLogs();
      addLog('debug.clearLogs', 'persistent logs cleared');
    },
    exportText: () => logLines.join('\n'),
    state: () => ({
      build: APP_BUILD,
      location: window.location.href,
      desktopTest: desktopTest.enabled,
      xrPresenting: renderer.xr.isPresenting,
      sessionMode: renderer.xr.getSession()?.mode || null,
      domOverlayState: renderer.xr.getSession()?.domOverlayState?.type || null,
      viewerPoseAvailable: latestViewerPose.available,
      xrFrameCount: xrDiagnostics.frameCount,
      viewerPoseCount: xrDiagnostics.viewerPoseCount,
      worldMovePanelVisible: worldMovePanel.visible,
      realArMenuVisible: realArMenu.visible,
      leftPalmMenuVisible: leftPalmMenu.visible,
      arDebugHudVisible: arDebugHud.visible,
      failsafeDebugHudVisible: failsafeDebugHud.visible,
      xrVisibilityProbeVisible: xrVisibilityProbe.visible,
      reticleDebugPanelVisible: reticleDebugPanel.visible,
      cameraOverlayVisible: cameraOverlay.visible,
      moveGizmoVisible: moveGizmo.visible,
      hovered: desktopTest.hovered?.userData?.label || xrInteractor.hovered?.userData?.label || null,
      modelPosition: formatVector(modelRoot.position),
      controls: [
        ...(worldMovePanel.userData.controls || []),
        ...(realArMenu.userData.controls || []),
        ...(leftPalmMenu.userData.controls || []),
      ].map((control) => control.userData.label),
    }),
  };
  addLog('debug.api', 'window.__MRDebug ready: state(), logs(), exportText(), clearLogs()');
}

function updateDesktopPointer(event) {
  if (!desktopTest.enabled) return;
  const rect = canvas.getBoundingClientRect();
  desktopTest.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  desktopTest.pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  desktopTest.lastPointerEvent = {
    x: Math.round(event.clientX - rect.left),
    y: Math.round(event.clientY - rect.top),
  };
}

function updateDesktopTestMode() {
  if (!desktopTest.enabled) return;
  desktopTest.raycaster.setFromCamera(desktopTest.pointerNdc, camera);
  updateDesktopHandVisual();
  const hovered = intersectWorldControls(desktopTest.raycaster);
  setWorldControlHover(hovered);
  desktopTest.hovered = hovered;

  const label = hovered?.userData?.label || 'none';
  if (label !== desktopTest.lastHoverLabel) {
    desktopTest.lastHoverLabel = label;
    addLog('desktop.hover', `${label}; pointer=${formatPointerNdc()}`);
  } else {
    const now = performance.now();
    if (now - desktopTest.lastLogTime > 2500) {
      desktopTest.lastLogTime = now;
      addLog('desktop.ray', `hover=${label}; pointer=${formatPointerNdc()}; panelVisible=${worldMovePanel.visible}`);
    }
  }
}

function updateDesktopHandVisual() {
  const origin = desktopTest.raycaster.ray.origin;
  const direction = desktopTest.raycaster.ray.direction;
  desktopTest.hand.position.copy(origin).addScaledVector(direction, 0.22);
  desktopTest.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction.clone().normalize());
}

function clickDesktopHoveredControl() {
  if (!desktopTest.enabled) return;
  const hit = intersectWorldControlHit(desktopTest.raycaster);
  const object = hit?.object || desktopTest.hovered;
  if (!object?.userData?.action) {
    addLog('desktop.click.miss', `no 3D button under pointer; pointer=${formatPointerNdc()}`);
    return;
  }
  object.userData.action(hit || { object, point: object.getWorldPosition(new THREE.Vector3()) });
  addLog('desktop.click.hit', `${object.userData.label}; ${formatVector(modelRoot.position)}`);
}

function logWorldUiSelfTest() {
  const controls = worldMovePanel.userData.controls || [];
  const box = new THREE.Box3().setFromObject(modelContent);
  const summary = [
    `desktopTest=${desktopTest.enabled}`,
    `xrPresenting=${renderer.xr.isPresenting}`,
    `panelVisible=${worldMovePanel.visible}`,
    `realArMenuVisible=${realArMenu.visible}`,
    `gizmoVisible=${moveGizmo.visible}`,
    `controls=${controls.length}`,
    `controlLabels=${controls.map((control) => control.userData.label).join(',')}`,
    `modelBoxEmpty=${box.isEmpty()}`,
    `modelPosition=${formatVector(modelRoot.position)}`,
    `pointer=${formatPointerNdc()}`,
    `hover=${desktopTest.hovered?.userData?.label || 'none'}`,
  ];
  addLog('world-ui.selftest', summary.join('; '));
}

async function copyDebugLogs() {
  const text = logLines.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    addLog('log.copy.ok', `${logLines.length} lines copied`);
  } catch (error) {
    addLog('log.copy.error', formatError(error));
  }
}

function createArDebugHud() {
  const group = new THREE.Group();
  group.frustumCulled = false;
  group.userData.lastRender = 0;

  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 0.5),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.78,
      depthTest: false,
      side: THREE.DoubleSide,
    })
  );
  background.renderOrder = 40;
  background.frustumCulled = false;
  group.add(background);

  const title = createTextSprite('AR DEBUG HUD', '#fde68a', 520, 72, 30);
  title.position.set(0, 0.205, 0.012);
  title.scale.set(0.52, 0.072, 1);
  group.add(title);

  const lines = createHudTextSprite('', '#dbeafe', 760, 360, 24);
  lines.position.set(0, -0.035, 0.014);
  lines.scale.set(0.76, 0.36, 1);
  group.userData.lines = lines;
  group.add(lines);

  return group;
}

function createFailsafeDebugHud() {
  const group = new THREE.Group();
  group.name = 'Failsafe visible debug board';
  group.userData.lastRender = 0;
  group.frustumCulled = false;
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(1.25, 0.42),
    new THREE.MeshBasicMaterial({
      color: 0x7f1d1d,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      side: THREE.DoubleSide,
    })
  );
  background.renderOrder = 80;
  background.frustumCulled = false;
  group.add(background);

  const lines = createHudTextSprite('FAILSAFE HUD BOOT', '#ffffff', 900, 260, 30);
  lines.position.z = 0.02;
  lines.scale.set(0.9, 0.26, 1);
  group.userData.lines = lines;
  group.add(lines);
  group.position.set(0, 0.02, -0.85);
  group.scale.setScalar(1);
  return group;
}

function createXrVisibilityProbe() {
  const group = new THREE.Group();
  group.name = 'XR visibility probe';
  group.frustumCulled = false;

  const colors = [0xff1744, 0xffea00, 0x00e676, 0x00b0ff];
  colors.forEach((color, index) => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.28),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.96,
        depthTest: false,
        side: THREE.DoubleSide,
      })
    );
    panel.position.set((index - 1.5) * 0.32, 0, 0);
    panel.renderOrder = 95 + index;
    panel.frustumCulled = false;
    group.add(panel);
  });

  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
  );
  marker.position.set(0, -0.28, 0.02);
  marker.renderOrder = 100;
  group.add(marker);

  return group;
}

function createReticleDebugPanel() {
  const group = new THREE.Group();
  group.name = 'Reticle anchored debug panel';
  group.userData.lastRender = 0;
  group.frustumCulled = false;

  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.36),
    new THREE.MeshBasicMaterial({
      color: 0x111827,
      transparent: true,
      opacity: 0.94,
      depthTest: false,
      side: THREE.DoubleSide,
    })
  );
  back.position.set(0, 0.01, -0.42);
  back.rotation.x = -Math.PI / 2;
  back.renderOrder = 120;
  back.frustumCulled = false;
  group.add(back);

  const colorBar = new THREE.Group();
  [0xff1744, 0xffea00, 0x00e676, 0x00b0ff].forEach((color, index) => {
    const swatch = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.035, 0.13),
      new THREE.MeshBasicMaterial({ color, depthTest: false })
    );
    swatch.position.set((index - 1.5) * 0.16, 0.035, -0.24);
    swatch.renderOrder = 130 + index;
    colorBar.add(swatch);
  });
  group.add(colorBar);

  const text = createHudTextSprite('RETICLE HUD BOOT', '#ffffff', 720, 280, 28);
  text.position.set(0, 0.025, -0.43);
  text.rotation.x = -Math.PI / 2;
  text.scale.set(0.58, 0.23, 1);
  text.renderOrder = 140;
  group.userData.text = text;
  group.add(text);

  return group;
}

function updateReticleDebugPanel(force = false) {
  if (!reticle.visible || !reticleDebugPanel.visible) return;
  const now = performance.now();
  const pulse = 1 + Math.sin(now * 0.006) * 0.08;
  reticleDebugPanel.scale.setScalar(pulse);
  if (!force && now - reticleDebugPanel.userData.lastRender < 500) return;
  reticleDebugPanel.userData.lastRender = now;
  const text = [
    `RETICLE HUD ${APP_BUILD}`,
    `xr=${renderer.xr.isPresenting} reticle=${reticle.visible}`,
    `logs=${logLines.length} menu=${worldMovePanel.visible}`,
    ...logLines.slice(-4),
  ].join('\n');
  updateHudTextSprite(reticleDebugPanel.userData.text, text);
}

function updateXrVisibilityProbe() {
  if (!xrVisibilityProbe.visible) return;
  const time = performance.now() * 0.003;
  xrVisibilityProbe.children.forEach((child, index) => {
    if (child.material) child.material.opacity = 0.72 + Math.sin(time + index) * 0.22;
  });

  if (latestViewerPose.available) {
    xrVisibilityProbe.position.copy(latestViewerPose.position).add(new THREE.Vector3(0, 0.03, -0.55).applyQuaternion(latestViewerPose.quaternion));
    xrVisibilityProbe.quaternion.copy(latestViewerPose.quaternion);
  } else {
    xrVisibilityProbe.position.set(0, 0.05, -0.55);
    xrVisibilityProbe.quaternion.identity();
  }
  xrVisibilityProbe.scale.setScalar(1);
}

function updateFailsafeDebugHud(force = false) {
  if (!failsafeDebugHud.visible) return;
  const now = performance.now();
  if (latestViewerPose.available) {
    failsafeDebugHud.position.copy(latestViewerPose.position).add(new THREE.Vector3(0, 0, -0.78).applyQuaternion(latestViewerPose.quaternion));
    failsafeDebugHud.quaternion.copy(latestViewerPose.quaternion);
  } else if (renderer.xr.isPresenting && reticle.visible) {
    failsafeDebugHud.position.setFromMatrixPosition(reticle.matrix);
    failsafeDebugHud.position.y += 0.18;
    failsafeDebugHud.quaternion.identity();
  } else {
    failsafeDebugHud.position.set(0, 0.02, -0.85);
    failsafeDebugHud.quaternion.identity();
  }
  failsafeDebugHud.scale.setScalar(1);
  if (!force && now - failsafeDebugHud.userData.lastRender < 700) return;
  failsafeDebugHud.userData.lastRender = now;
  const text = [
    `FAILSAFE HUD ${APP_BUILD}`,
    `xr=${renderer.xr.isPresenting} camChild=${arDebugHud.parent === cameraOverlay}`,
    `menu=${worldMovePanel.visible} logs=${logLines.length}`,
    ...logLines.slice(-4),
  ].join('\n');
  updateHudTextSprite(failsafeDebugHud.userData.lines, text);
}

function createHudTextSprite(text, color, width, height, fontSize) {
  const sprite = createTextSprite('', color, width, height, fontSize);
  sprite.userData.multiline = true;
  updateHudTextSprite(sprite, text);
  return sprite;
}

function updateHudTextSprite(sprite, text) {
  const { canvas: labelCanvas, context, texture, color, fontSize } = sprite.userData;
  context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  context.fillStyle = color;
  context.font = `700 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context.textAlign = 'left';
  context.textBaseline = 'top';
  const lines = text.split('\n').slice(0, 10);
  lines.forEach((line, index) => {
    context.fillText(line.slice(0, 62), 18, 16 + index * (fontSize + 8));
  });
  texture.needsUpdate = true;
}

function updateArDebugHud(force = false) {
  if (!arDebugHud.visible) return;
  const now = performance.now();
  positionInCameraOverlay(arDebugHud, 0, 0.2, -0.72, 0.82);
  if (!force && now - arDebugHud.userData.lastRender < 450) return;
  arDebugHud.userData.lastRender = now;

  const domOverlayState = renderer.xr.getSession()?.domOverlayState?.type || 'none';
  const hover = desktopTest.hovered?.userData?.label || xrInteractor.hovered?.userData?.label || 'none';
  const hudLines = [
    APP_BUILD,
    `xr=${renderer.xr.isPresenting} dom=${domOverlayState} test=${desktopTest.enabled}`,
    `menu=${worldMovePanel.visible} hud=${arDebugHud.visible} camChild=${arDebugHud.parent === cameraOverlay} hover=${hover}`,
    `model ${formatVector(modelRoot.position)}`,
    ...logLines.slice(-7),
  ];
  updateHudTextSprite(arDebugHud.userData.lines, hudLines.join('\n'));
}

function positionInCameraOverlay(group, x, y, z, scale) {
  group.position.set(x, y, z);
  group.rotation.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.setScalar(scale);
  group.frustumCulled = false;
  group.updateMatrixWorld(true);
}

function positionGroupInFrontOfCamera(group, offset, scale) {
  if (latestViewerPose.available) {
    group.position.copy(latestViewerPose.position).add(offset.clone().applyQuaternion(latestViewerPose.quaternion));
    group.quaternion.copy(latestViewerPose.quaternion);
  } else if (renderer.xr.isPresenting && reticle.visible) {
    group.position.setFromMatrixPosition(reticle.matrix);
    group.position.x += offset.x;
    group.position.y += offset.y;
    group.position.z += 0.02;
    group.quaternion.identity();
  } else {
    const cameraPosition = new THREE.Vector3();
    camera.getWorldPosition(cameraPosition);
    group.position.copy(cameraPosition).add(offset.clone().applyQuaternion(camera.quaternion));
    group.quaternion.copy(camera.quaternion);
  }
  group.scale.setScalar(scale);
}

function formatPointerNdc() {
  const pixel = desktopTest.lastPointerEvent ? `; px=${desktopTest.lastPointerEvent.x},${desktopTest.lastPointerEvent.y}` : '';
  return `ndc=${desktopTest.pointerNdc.x.toFixed(3)},${desktopTest.pointerNdc.y.toFixed(3)}${pixel}`;
}

function updateViewerPose(frame) {
  const referenceSpace = renderer.xr.getReferenceSpace();
  if (!referenceSpace) return;
  const pose = frame.getViewerPose(referenceSpace);
  const view = pose?.views?.[0];
  if (!view) return;
  const matrix = new THREE.Matrix4().fromArray(view.transform.matrix);
  const scale = new THREE.Vector3();
  matrix.decompose(latestViewerPose.position, latestViewerPose.quaternion, scale);
  latestViewerPose.available = true;
  xrDiagnostics.viewerPoseCount += 1;
}

function logXrFrameDiagnostics() {
  if (!renderer.xr.isPresenting) return;
  const now = performance.now();
  if (now - xrDiagnostics.lastFrameLogTime < 5000) return;
  xrDiagnostics.lastFrameLogTime = now;
  const session = renderer.xr.getSession();
  const inputSources = session ? Array.from(session.inputSources || []) : [];
  addLog('xr.frame', [
    `frames=${xrDiagnostics.frameCount}`,
    `poses=${xrDiagnostics.viewerPoseCount}`,
    `viewerPose=${latestViewerPose.available}`,
    `inputs=${inputSources.length}`,
    `menu=${realArMenu.visible}`,
    `overlay=${cameraOverlay.visible}`,
  ].join('; '));
  inputSources.forEach((source, index) => {
    addLog('xr.inputSource', [
      `#${index}`,
      `handed=${source.handedness || 'none'}`,
      `target=${source.targetRayMode || 'unknown'}`,
      `hand=${Boolean(source.hand)}`,
      `profiles=${(source.profiles || []).join(',')}`,
    ].join('; '));
  });
}

function createWorldMovePanel(titleText = 'SELECTED OBJECT') {
  const group = new THREE.Group();
  group.userData.controls = [];
  group.userData.scaleControls = [];
  group.userData.positionLabel = null;

  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(0.66, 0.56),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
      side: THREE.DoubleSide,
    })
  );
  background.renderOrder = 20;
  group.add(background);

  const title = createTextSprite(titleText, '#bae6fd', 420, 72, 28);
  title.position.set(0, 0.225, 0.012);
  title.scale.set(0.42, 0.072, 1);
  group.add(title);

  const positionLabel = createTextSprite(formatVector(modelRoot.position), '#e0f2fe', 520, 76, 24);
  positionLabel.position.set(0, 0.165, 0.012);
  positionLabel.scale.set(0.52, 0.076, 1);
  group.userData.positionLabel = positionLabel;
  group.add(positionLabel);

  const buttonSpecs = [
    ['X-', -0.2, 0.065, 0xef4444, () => moveModel('x', -1)],
    ['X+', -0.04, 0.065, 0xef4444, () => moveModel('x', 1)],
    ['Y-', 0.12, 0.065, 0x22c55e, () => moveModel('y', -1)],
    ['Y+', 0.28, 0.065, 0x22c55e, () => moveModel('y', 1)],
    ['Z-', -0.12, -0.03, 0x3b82f6, () => moveModel('z', -1)],
    ['Z+', 0.04, -0.03, 0x3b82f6, () => moveModel('z', 1)],
    ['RESET', 0.2, -0.03, 0xf59e0b, () => resetModelPose()],
  ];

  buttonSpecs.forEach(([label, x, y, color, action]) => {
    const button = createWorldButton(label, color, action);
    button.position.set(x, y, 0.018);
    group.userData.controls.push(button);
    group.add(button);
  });

  const scaleControl = createScaleSliderControl(group);
  scaleControl.position.set(0, -0.135, 0.018);
  group.add(scaleControl);

  const hint = createTextSprite('Aim hand ray + pinch/select', '#cbd5e1', 520, 72, 22);
  hint.position.set(0, -0.23, 0.012);
  hint.scale.set(0.52, 0.072, 1);
  group.add(hint);

  return group;
}

function createScaleSliderControl(panel) {
  const group = new THREE.Group();
  const label = createTextSprite('SCALE', '#e0f2fe', 180, 64, 26);
  label.position.set(-0.245, 0.01, 0.012);
  label.scale.set(0.18, 0.064, 1);
  group.add(label);

  const track = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.055),
    new THREE.MeshBasicMaterial({
      color: 0x334155,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      side: THREE.DoubleSide,
    })
  );
  track.position.set(0.055, 0, 0);
  track.renderOrder = 24;
  track.userData.isWorldControl = true;
  track.userData.baseColor = 0x334155;
  track.userData.label = 'SCALE';
  track.userData.action = (hit) => setScaleFromSliderHit(track, hit.point);
  track.userData.hoverOnly = true;
  panel.userData.controls.push(track);
  panel.userData.scaleControls.push(track);
  group.add(track);

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.42, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false, side: THREE.DoubleSide })
  );
  fill.position.set(0.055, 0, 0.01);
  fill.renderOrder = 25;
  group.add(fill);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xf8fafc, depthTest: false })
  );
  knob.position.z = 0.025;
  knob.renderOrder = 26;
  group.add(knob);

  const value = createTextSprite(scaleValue.textContent, '#f8fafc', 180, 64, 24);
  value.position.set(0.31, 0.005, 0.012);
  value.scale.set(0.18, 0.064, 1);
  group.add(value);

  track.userData.knob = knob;
  track.userData.fill = fill;
  track.userData.value = value;
  updateScaleSliderVisual(track);
  return group;
}

function createWorldButton(label, color, action) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const button = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.07), material);
  button.renderOrder = 24;
  button.userData.isWorldControl = true;
  button.userData.baseColor = color;
  button.userData.action = action;
  button.userData.label = label;

  const text = createTextSprite(label, '#020617', 180, 84, 42);
  text.position.z = 0.01;
  text.scale.set(0.13, 0.06, 1);
  button.add(text);
  return button;
}

function setScaleFromSliderHit(track, worldPoint) {
  const localPoint = track.worldToLocal(worldPoint.clone());
  const ratio = THREE.MathUtils.clamp((localPoint.x + 0.21) / 0.42, 0, 1);
  const min = Number(scaleSlider.min);
  const max = Number(scaleSlider.max);
  const scale = min + ratio * (max - min);
  setModelScale(scale);
  addLog('model.scale.slider', `${scale.toFixed(2)}x`);
}

function updateMenuScaleControls() {
  [worldMovePanel, realArMenu, leftPalmMenu].forEach((panel) => {
    (panel.userData.scaleControls || []).forEach(updateScaleSliderVisual);
  });
}

function updateScaleSliderVisual(track) {
  const min = Number(scaleSlider.min);
  const max = Number(scaleSlider.max);
  const scale = modelRoot.scale.x;
  const ratio = THREE.MathUtils.clamp((scale - min) / (max - min), 0, 1);
  const x = -0.21 + ratio * 0.42;
  if (track.userData.knob) track.userData.knob.position.x = track.position.x + x;
  if (track.userData.fill) {
    track.userData.fill.scale.x = Math.max(ratio, 0.03);
    track.userData.fill.position.x = track.position.x - 0.21 + (ratio * 0.42) / 2;
  }
  if (track.userData.value) updateTextSprite(track.userData.value, `${scale.toFixed(2)}x`);
}

function createTextSprite(text, color, width = 512, height = 96, fontSize = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, width / 2, height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  }));
  sprite.renderOrder = 25;
  sprite.userData.canvas = canvas;
  sprite.userData.context = context;
  sprite.userData.texture = texture;
  sprite.userData.color = color;
  sprite.userData.fontSize = fontSize;
  return sprite;
}

function updateTextSprite(sprite, text) {
  const { canvas: labelCanvas, context, texture, color, fontSize } = sprite.userData;
  context.clearRect(0, 0, labelCanvas.width, labelCanvas.height);
  context.fillStyle = color;
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, labelCanvas.width / 2, labelCanvas.height / 2 + 1);
  texture.needsUpdate = true;
}

function resetModelPose() {
  modelRoot.position.set(0, -0.25, -1.1);
  modelRoot.rotation.set(0, 0, 0);
  updateModelPositionReadout();
  updateMoveGizmo();
  updateWorldMovePanel();
  updateSelectionBounds();
  addLog('model.reset', formatVector(modelRoot.position));
}

function placeModelAtReticle(reason) {
  if (!reticle.visible) return;
  modelRoot.position.setFromMatrixPosition(reticle.matrix);
  modelRoot.quaternion.setFromRotationMatrix(reticle.matrix);
  updateModelPositionReadout();
  updateMoveGizmo();
  updateWorldMovePanel();
  updateSelectionBounds();
  addLog('model.place.reticle', `${reason}; ${formatVector(modelRoot.position)}`);
}

function selectObject(object, reason) {
  selectedObject = object;
  selectionBounds.visible = Boolean(object);
  updateSelectionBounds();
  addLog('object.select', `${reason}; selected=${Boolean(object)}`);
}

function selectObjectFromSource(source, reason) {
  if (!modelContent.children.length) return false;
  setRaycasterFromXrSource(source);
  const hits = xrInteractor.raycaster.intersectObject(modelRoot, true)
    .filter((hit) => !hit.object.userData?.isWorldControl);
  if (!hits.length) {
    addLog('object.select.miss', reason);
    return false;
  }
  selectObject(modelRoot, reason);
  return true;
}

function createSelectionBounds() {
  const group = new THREE.Group();
  group.userData.edges = [];
  const material = new THREE.MeshBasicMaterial({
    color: 0xfacc15,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  });
  for (let index = 0; index < 12; index += 1) {
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1, 10), material);
    edge.renderOrder = 70;
    group.userData.edges.push(edge);
    group.add(edge);
  }
  return group;
}

function updateSelectionBounds() {
  if (!selectedObject || !selectionBounds.visible) return;
  const box = new THREE.Box3().setFromObject(modelContent);
  if (box.isEmpty()) return;
  box.expandByScalar(0.035);
  const min = box.min;
  const max = box.max;
  const corners = [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z),
  ];
  const pairs = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  pairs.forEach(([a, b], index) => {
    placeCylinderBetween(selectionBounds.userData.edges[index], corners[a], corners[b]);
  });
}

function placeCylinderBetween(cylinder, start, end) {
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const direction = end.clone().sub(start);
  const length = direction.length();
  cylinder.position.copy(midpoint);
  cylinder.scale.set(1, Math.max(length, 0.001), 1);
  cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
}

function createMoveGizmo() {
  const group = new THREE.Group();
  const axes = [
    { name: 'X', color: 0xef4444, direction: new THREE.Vector3(1, 0, 0), rotation: new THREE.Euler(0, 0, -Math.PI / 2) },
    { name: 'Y', color: 0x22c55e, direction: new THREE.Vector3(0, 1, 0), rotation: new THREE.Euler(0, 0, 0) },
    { name: 'Z', color: 0x3b82f6, direction: new THREE.Vector3(0, 0, 1), rotation: new THREE.Euler(Math.PI / 2, 0, 0) },
  ];

  axes.forEach((axis) => {
    const arrow = new THREE.Group();
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.18, 16),
      new THREE.MeshBasicMaterial({ color: axis.color, depthTest: false })
    );
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.024, 0.055, 20),
      new THREE.MeshBasicMaterial({ color: axis.color, depthTest: false })
    );
    shaft.position.y = 0.09;
    head.position.y = 0.205;
    const label = createAxisLabel(axis.name, axis.color);
    label.position.copy(axis.direction.clone().multiplyScalar(0.28));
    arrow.add(shaft, head);
    arrow.rotation.copy(axis.rotation);
    arrow.renderOrder = 10;
    group.add(arrow, label);
  });

  const hub = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xf8fafc, depthTest: false })
  );
  hub.renderOrder = 10;
  group.add(hub);
  return group;
}

function createAxisLabel(text, color) {
  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 96;
  labelCanvas.height = 96;
  const context = labelCanvas.getContext('2d');
  context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  context.beginPath();
  context.arc(48, 48, 38, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#020617';
  context.font = '700 52px system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, 48, 50);

  const texture = new THREE.CanvasTexture(labelCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.set(0.09, 0.09, 0.09);
  sprite.renderOrder = 11;
  return sprite;
}

function updateMoveGizmo() {
  if (!moveGizmo.visible) return;
  const box = new THREE.Box3().setFromObject(modelContent);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  moveGizmo.position.set(box.max.x + Math.max(size.x * 0.12, 0.08), box.max.y + Math.max(size.y * 0.12, 0.08), box.max.z + 0.03);
  const distance = camera.position.distanceTo(moveGizmo.position);
  moveGizmo.scale.setScalar(Math.max(0.7, distance) * 0.35);
}

function updateWorldMovePanel() {
  if (!worldMovePanel.visible) return;
  if (renderer.xr.isPresenting || desktopTest.enabled) {
    positionInCameraOverlay(worldMovePanel, 0, -0.28, -0.72, 0.86);
    updateTextSprite(worldMovePanel.userData.positionLabel, formatVector(modelRoot.position));
    return;
  }

  const box = new THREE.Box3().setFromObject(modelContent);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const panelOffset = Math.max(size.x * 0.45, 0.42);
  worldMovePanel.position.set(
    box.max.x + panelOffset,
    box.max.y + Math.max(size.y * 0.22, 0.22),
    box.max.z + 0.08
  );

  const xrCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
  const cameraPosition = new THREE.Vector3();
  xrCamera.getWorldPosition(cameraPosition);
  worldMovePanel.lookAt(cameraPosition);

  const distance = cameraPosition.distanceTo(worldMovePanel.position);
  worldMovePanel.scale.setScalar(Math.max(0.82, distance * 0.52));
  updateTextSprite(worldMovePanel.userData.positionLabel, formatVector(modelRoot.position));
}

function updateRealArMenu(force = false) {
  if (!realArMenu.visible) return;
  if (latestViewerPose.available) {
    const offset = new THREE.Vector3(0, -0.24, -0.85).applyQuaternion(latestViewerPose.quaternion);
    realArMenu.position.copy(latestViewerPose.position).add(offset);
    realArMenu.quaternion.copy(latestViewerPose.quaternion);
  } else {
    realArMenu.position.set(0, -0.2, -0.9);
    realArMenu.quaternion.identity();
  }
  realArMenu.scale.setScalar(0.85);
  realArMenu.frustumCulled = false;
  updateTextSprite(realArMenu.userData.positionLabel, formatVector(modelRoot.position));
  const now = performance.now();
  if (force || now - xrDiagnostics.lastMenuLogTime > 3000) {
    xrDiagnostics.lastMenuLogTime = now;
    addLog('real-ar-menu', [
      `visible=${realArMenu.visible}`,
      `pose=${latestViewerPose.available}`,
      `pos=${formatVector(realArMenu.position)}`,
      `frames=${xrDiagnostics.frameCount}`,
      `poses=${xrDiagnostics.viewerPoseCount}`,
    ].join('; '));
  }
}

function updateLeftPalmMenu() {
  if (!renderer.xr.isPresenting) {
    leftPalmMenu.visible = false;
    return;
  }
  if (!selectedObject) {
    leftPalmMenu.visible = false;
    return;
  }
  const leftHand = xrHands.find((hand) => hand.userData.connected && hand.userData.handedness === 'left') || xrHands[0];
  if (!leftHand?.userData.connected) {
    leftPalmMenu.visible = false;
    return;
  }

  const wrist = getHandJoint(leftHand, 'wrist');
  const indexBase = getHandJoint(leftHand, 'index-finger-metacarpal');
  const pinkyBase = getHandJoint(leftHand, 'pinky-finger-metacarpal');
  if (!wrist?.visible || !indexBase?.visible || !pinkyBase?.visible) {
    leftPalmMenu.visible = false;
    return;
  }

  const wristPos = new THREE.Vector3();
  const indexPos = new THREE.Vector3();
  const pinkyPos = new THREE.Vector3();
  wrist.getWorldPosition(wristPos);
  indexBase.getWorldPosition(indexPos);
  pinkyBase.getWorldPosition(pinkyPos);

  const acrossPalm = indexPos.clone().sub(pinkyPos).normalize();
  const upPalm = indexPos.clone().add(pinkyPos).multiplyScalar(0.5).sub(wristPos).normalize();
  const palmNormal = new THREE.Vector3().crossVectors(acrossPalm, upPalm).normalize();
  const cameraPosition = latestViewerPose.available ? latestViewerPose.position.clone() : new THREE.Vector3();
  if (!latestViewerPose.available) camera.getWorldPosition(cameraPosition);
  const toCamera = cameraPosition.sub(wristPos).normalize();
  const palmFacingCamera = Math.abs(palmNormal.dot(toCamera)) > 0.42;

  leftPalmMenu.visible = palmFacingCamera;
  if (!leftPalmMenu.visible) return;

  leftPalmMenu.position.copy(wristPos)
    .add(acrossPalm.multiplyScalar(0.16))
    .add(upPalm.multiplyScalar(0.04));
  leftPalmMenu.quaternion.copy(latestViewerPose.available ? latestViewerPose.quaternion : camera.quaternion);
  leftPalmMenu.scale.setScalar(0.45);
  leftPalmMenu.frustumCulled = false;
  updateTextSprite(leftPalmMenu.userData.positionLabel, selectedObject ? formatVector(modelRoot.position) : 'object not selected');
}

function getHandJoint(hand, name) {
  return hand.joints?.[name] || hand.joints?.get?.(name);
}

function createXrInteractor() {
  const group = new THREE.Group();
  const raycaster = new THREE.Raycaster();
  raycaster.far = 6;
  return {
    group,
    raycaster,
    hovered: null,
    tempMatrix: new THREE.Matrix4(),
    tempOrigin: new THREE.Vector3(),
    tempDirection: new THREE.Vector3(),
  };
}

function createPointerRay(color) {
  const group = new THREE.Group();
  const baseLength = 1.2;
  const line = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, baseLength, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthTest: false })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.z = -baseLength / 2;
  line.renderOrder = 30;

  const origin = new THREE.Mesh(
    new THREE.SphereGeometry(0.028, 18, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false })
  );
  origin.position.z = -0.045;
  origin.scale.set(1.35, 0.8, 1);
  origin.renderOrder = 31;

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false })
  );
  tip.position.z = -baseLength;
  tip.renderOrder = 32;
  group.userData.pointerVisual = { line, tip, baseLength };
  group.add(line, origin, tip);
  return group;
}

function createHandPointer(color) {
  const group = new THREE.Group();
  const fingertip = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 16, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false })
  );
  const ray = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0025, 0.0025, 0.7, 10),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false })
  );
  const baseLength = 0.7;
  ray.rotation.x = -Math.PI / 2;
  ray.position.z = -baseLength / 2;
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.02, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false })
  );
  tip.position.z = -baseLength;
  fingertip.renderOrder = 31;
  ray.renderOrder = 30;
  tip.renderOrder = 32;
  group.userData.pointerVisual = { line: ray, tip, baseLength };
  group.add(ray, fingertip, tip);
  return group;
}

function updatePointerRayVisual(source, hitDistance) {
  const visual = source.userData.pointerVisual;
  if (!visual) return;
  const targetLength = Number.isFinite(hitDistance)
    ? THREE.MathUtils.clamp(hitDistance, 0.06, visual.baseLength)
    : visual.baseLength;
  visual.line.scale.y = targetLength / visual.baseLength;
  visual.line.position.z = -targetLength / 2;
  visual.tip.position.z = -targetLength;
  const touching = Number.isFinite(hitDistance) && hitDistance <= visual.baseLength;
  visual.tip.scale.setScalar(touching ? 1.35 : 1);
  visual.tip.material.color.setHex(touching ? 0xfacc15 : 0xffffff);
}

function updateXrInteractor() {
  if (!renderer.xr.isPresenting) return;
  const sources = [...xrHands, ...xrControllers];
  let hovered = null;
  for (const source of sources) {
    const hit = getWorldControlHitFromSource(source);
    updatePointerRayVisual(source, hit?.distance);
    if (!hovered && hit?.object) hovered = hit.object;
  }
  setWorldControlHover(hovered);
}

function updateXrInteraction(source, isPressed = false) {
  if (!renderer.xr.isPresenting) return null;
  const hit = getWorldControlHitFromSource(source);
  const hovered = hit?.object || null;
  setWorldControlHover(hovered);
  updatePointerRayVisual(source, hit?.distance);
  if (isPressed && hovered) {
    hovered.material.opacity = 1;
  }
  return hit;
}

function handleXrSelect(source) {
  const hit = updateXrInteraction(source, true);
  if (!hit?.object?.userData?.action) return false;
  hit.object.userData.action(hit);
  addLog('xr.control.select', hit.object.userData.label || 'world-control');
  return true;
}

function getWorldControlIntersection(source) {
  return getWorldControlHitFromSource(source)?.object || null;
}

function getWorldControlHitFromSource(source) {
  if (!source.userData.connected) return null;
  setRaycasterFromXrSource(source);
  return intersectWorldControlHit(xrInteractor.raycaster);
}

function intersectWorldControls(raycaster) {
  return intersectWorldControlHit(raycaster)?.object || null;
}

function intersectWorldControlHit(raycaster) {
  const controls = [
    ...(worldMovePanel.visible ? worldMovePanel.userData.controls || [] : []),
    ...(realArMenu.visible ? realArMenu.userData.controls || [] : []),
    ...(leftPalmMenu.visible ? leftPalmMenu.userData.controls || [] : []),
  ];
  if (!controls.length) return null;
  const hits = raycaster.intersectObjects(controls, false);
  return hits[0] || null;
}

function setRaycasterFromXrSource(source) {
  const fingertip = source.joints?.['index-finger-tip'] || source.joints?.get?.('index-finger-tip');
  const wrist = source.joints?.wrist || source.joints?.get?.('wrist');
  if (fingertip?.visible) {
    fingertip.getWorldPosition(xrInteractor.tempOrigin);
    if (wrist?.visible) {
      wrist.getWorldPosition(xrInteractor.tempDirection);
      xrInteractor.tempDirection.subVectors(xrInteractor.tempOrigin, xrInteractor.tempDirection).normalize();
    } else {
      source.getWorldDirection(xrInteractor.tempDirection).multiplyScalar(-1);
    }
  } else {
    xrInteractor.tempOrigin.setFromMatrixPosition(source.matrixWorld);
    xrInteractor.tempMatrix.identity().extractRotation(source.matrixWorld);
    xrInteractor.tempDirection.set(0, 0, -1).applyMatrix4(xrInteractor.tempMatrix).normalize();
  }
  xrInteractor.raycaster.set(xrInteractor.tempOrigin, xrInteractor.tempDirection);
}

function setWorldControlHover(button) {
  if (xrInteractor.hovered === button) return;
  if (xrInteractor.hovered) {
    xrInteractor.hovered.material.color.setHex(xrInteractor.hovered.userData.baseColor);
    xrInteractor.hovered.material.opacity = 0.95;
    xrInteractor.hovered.scale.setScalar(1);
  }
  xrInteractor.hovered = button;
  if (button) {
    button.material.color.setHex(0xffffff);
    button.material.opacity = 1;
    button.scale.setScalar(1.12);
  }
}

function updateReticle(frame) {
  const session = renderer.xr.getSession();
  const referenceSpace = renderer.xr.getReferenceSpace();

  if (!hitTestSourceRequested) {
    if (!session?.requestHitTestSource) {
      addLog('xr.hittest.skip', 'requestHitTestSource is unavailable');
      hitTestSourceRequested = true;
      return;
    }
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
    updateReticleDebugPanel(true);
    if (!autoPlacedOnReticle) {
      placeModelAtReticle('auto-reticle');
      autoPlacedOnReticle = true;
    }
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
  const line = `[${time}] ${label}: ${message}`;
  if (window.__MRLog) {
    window.__MRLog(label, message);
    if (!logLines.includes(line)) {
      logLines.push(line);
      if (logLines.length > maxLogLines) logLines.splice(0, logLines.length - maxLogLines);
    }
    savePersistentLogs();
  } else {
    logLines.push(line);
    if (logLines.length > maxLogLines) logLines.splice(0, logLines.length - maxLogLines);
    savePersistentLogs();
    renderLogs();
  }
}

function renderLogs() {
  debugLog.textContent = logLines.join('\n');
  debugLog.scrollTop = debugLog.scrollHeight;
}

function restorePersistentLogs() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(persistentLogKey) || '[]');
    if (Array.isArray(saved) && saved.length > 0) {
      logLines.push(...saved.slice(-maxLogLines));
    }
  } catch {
    // Ignore storage parsing errors; logging must never block boot.
  }
}

function savePersistentLogs() {
  try {
    window.localStorage.setItem(persistentLogKey, JSON.stringify(logLines.slice(-maxLogLines)));
  } catch {
    // Ignore quota/private-mode failures.
  }
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
