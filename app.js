(function () {
  "use strict";

  const TWO_PI = Math.PI * 2;
  const DEG = Math.PI / 180;
  const constants = {
    g: 9.81,
    psiToPa: 6894.76,
    sampleCount: 240,
    animationMsPerTurn: 1500
  };

  const defaults = {
    heightMm: 1000,
    radiusMm: 4,
    muPsi: 400,
    massKg: 0.3,
    torqueNm: 0.0415,
    maxTurns: 6,
    currentTurns: 0,
    mode: "force_twist",
    showReference: true,
    cameraAzimuth: -36,
    cameraElevation: 24
  };

  const ranges = {
    heightMm: { min: 200, max: 1000, step: 1, digits: 0 },
    radiusMm: { min: 2, max: 30, step: 0.01, digits: 2 },
    muPsi: { min: 50, max: 2000, step: 1, digits: 0 },
    massKg: { min: 0, max: 2, step: 0.001, digits: 3 },
    torqueNm: { min: 0, max: 0.2, step: 0.0001, digits: 4 },
    maxTurns: { min: 1, max: 15, step: 1, digits: 0 }
  };

  const els = {};
  let state = Object.assign({}, defaults);
  let cachedData = null;
  let animationFrame = 0;
  let dragState = null;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindControls();
    els.pauseBtn.disabled = true;
    syncControls();
    resizeAndRender();

    window.addEventListener("resize", resizeAndRender);
    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(resizeAndRender);
      observer.observe(els.sceneCanvas);
      observer.observe(els.chartCanvas);
    }
  }

  function cacheElements() {
    Object.assign(els, {
      heightRange: document.getElementById("heightRange"),
      heightNumber: document.getElementById("heightNumber"),
      radiusRange: document.getElementById("radiusRange"),
      radiusNumber: document.getElementById("radiusNumber"),
      muRange: document.getElementById("muRange"),
      muNumber: document.getElementById("muNumber"),
      massRange: document.getElementById("massRange"),
      massNumber: document.getElementById("massNumber"),
      torqueRange: document.getElementById("torqueRange"),
      torqueNumber: document.getElementById("torqueNumber"),
      maxTurnsRange: document.getElementById("maxTurnsRange"),
      maxTurnsNumber: document.getElementById("maxTurnsNumber"),
      turnsRange: document.getElementById("turnsRange"),
      turnsOutput: document.getElementById("turnsOutput"),
      showReference: document.getElementById("showReference"),
      playBtn: document.getElementById("playBtn"),
      pauseBtn: document.getElementById("pauseBtn"),
      resetBtn: document.getElementById("resetBtn"),
      csvBtn: document.getElementById("csvBtn"),
      pngBtn: document.getElementById("pngBtn"),
      sceneCanvas: document.getElementById("sceneCanvas"),
      chartCanvas: document.getElementById("chartCanvas"),
      statusDot: document.getElementById("statusDot"),
      statusText: document.getElementById("statusText"),
      angleBadge: document.getElementById("angleBadge"),
      heightReadout: document.getElementById("heightReadout"),
      radiusReadout: document.getElementById("radiusReadout"),
      elongationReadout: document.getElementById("elongationReadout"),
      twistElongationReadout: document.getElementById("twistElongationReadout"),
      relativeHeightReadout: document.getElementById("relativeHeightReadout"),
      initialVolumeReadout: document.getElementById("initialVolumeReadout"),
      currentVolumeReadout: document.getElementById("currentVolumeReadout"),
      volumeRatioReadout: document.getElementById("volumeRatioReadout"),
      forceReadout: document.getElementById("forceReadout")
    });
  }

  function bindControls() {
    bindPair("heightMm", els.heightRange, els.heightNumber);
    bindPair("radiusMm", els.radiusRange, els.radiusNumber);
    bindPair("muPsi", els.muRange, els.muNumber);
    bindPair("massKg", els.massRange, els.massNumber);
    bindPair("torqueNm", els.torqueRange, els.torqueNumber);
    bindPair("maxTurns", els.maxTurnsRange, els.maxTurnsNumber);

    els.turnsRange.addEventListener("input", function () {
      stopAnimation(false);
      state.currentTurns = clamp(parseFloat(els.turnsRange.value), 0, state.maxTurns);
      renderAll("평형 계산 완료");
    });

    document.querySelectorAll("input[name='mode']").forEach(function (radio) {
      radio.addEventListener("change", function () {
        state.mode = radio.value;
        renderAll("계산 모드 변경");
      });
    });

    els.showReference.addEventListener("change", function () {
      state.showReference = els.showReference.checked;
      renderAll("표시 옵션 변경");
    });

    els.playBtn.addEventListener("click", playAnimation);
    els.pauseBtn.addEventListener("click", function () {
      stopAnimation(true);
    });
    els.resetBtn.addEventListener("click", resetApp);
    els.csvBtn.addEventListener("click", downloadCsv);
    els.pngBtn.addEventListener("click", downloadPng);

    els.sceneCanvas.addEventListener("pointerdown", beginSceneDrag);
    window.addEventListener("pointermove", moveSceneDrag);
    window.addEventListener("pointerup", endSceneDrag);
  }

  function bindPair(key, rangeEl, numberEl) {
    const applyValue = function (raw) {
      stopAnimation(false);
      const spec = ranges[key];
      let value = clamp(parseFloat(raw), spec.min, spec.max);
      if (!Number.isFinite(value)) {
        value = defaults[key];
      }
      if (key === "maxTurns") {
        value = Math.round(value);
        state.currentTurns = clamp(state.currentTurns, 0, value);
        els.turnsRange.max = String(value);
      }
      state[key] = value;
      syncControls();
      renderAll("평형 계산 완료");
    };

    rangeEl.addEventListener("input", function () {
      applyValue(rangeEl.value);
    });
    numberEl.addEventListener("change", function () {
      applyValue(numberEl.value);
    });
  }

  function syncControls() {
    setPairValue(els.heightRange, els.heightNumber, state.heightMm, ranges.heightMm.digits);
    setPairValue(els.radiusRange, els.radiusNumber, state.radiusMm, ranges.radiusMm.digits);
    setPairValue(els.muRange, els.muNumber, state.muPsi, ranges.muPsi.digits);
    setPairValue(els.massRange, els.massNumber, state.massKg, ranges.massKg.digits);
    setPairValue(els.torqueRange, els.torqueNumber, state.torqueNm, ranges.torqueNm.digits);
    setPairValue(els.maxTurnsRange, els.maxTurnsNumber, state.maxTurns, ranges.maxTurns.digits);

    updateTurnControls(state.currentTurns, state.mode === "torque_control");
    els.showReference.checked = state.showReference;

    document.querySelectorAll("input[name='mode']").forEach(function (radio) {
      radio.checked = radio.value === state.mode;
    });
  }

  function setPairValue(rangeEl, numberEl, value, digits) {
    const text = formatNumber(value, digits);
    rangeEl.value = text;
    numberEl.value = text;
  }

  function updateTurnControls(turns, isResultOnly) {
    const max = Math.max(state.maxTurns, turns, 0.01);
    els.turnsRange.disabled = isResultOnly;
    els.turnsRange.max = formatNumber(max, 2);
    els.turnsRange.value = formatNumber(clamp(turns, 0, max), 2);
    els.turnsOutput.textContent = `${formatNumber(turns, 2)} turns / ${formatNumber(turns * 360, 0)} deg`;
    els.angleBadge.textContent = `theta = ${formatNumber(turns, 2)} turns`;
  }

  function resetApp() {
    stopAnimation(false);
    state = Object.assign({}, defaults);
    syncControls();
    renderAll("초기화 완료");
  }

  function playAnimation() {
    if (animationFrame) {
      return;
    }
    if (state.mode === "torque_control") {
      playTorqueAnimation();
      return;
    }
    const from = state.currentTurns >= state.maxTurns ? 0 : state.currentTurns;
    const to = state.maxTurns;
    const start = performance.now();
    const duration = Math.max(3000, constants.animationMsPerTurn * (to - from));

    state.currentTurns = from;
    els.playBtn.disabled = true;
    els.pauseBtn.disabled = false;
    setStatus("애니메이션 재생 중", true);

    function tick(now) {
      const t = clamp((now - start) / duration, 0, 1);
      state.currentTurns = from + (to - from) * easeInOut(t);
      syncControls();
      renderCore();
      if (t < 1) {
        animationFrame = requestAnimationFrame(tick);
      } else {
        animationFrame = 0;
        els.playBtn.disabled = false;
        els.pauseBtn.disabled = true;
        setStatus("애니메이션 완료", false);
        renderAll("애니메이션 완료");
      }
    }

    animationFrame = requestAnimationFrame(tick);
  }

  function playTorqueAnimation() {
    const params = getParams();
    const fallbackTorque = torqueForTwist(params, state.maxTurns * TWO_PI);
    const target = state.torqueNm > 0 ? state.torqueNm : fallbackTorque;
    const targetState = computeTorqueState(params, target);
    const start = performance.now();
    const duration = Math.max(3000, constants.animationMsPerTurn * Math.max(targetState.turns, 1));

    els.playBtn.disabled = true;
    els.pauseBtn.disabled = false;
    setStatus("토크 애니메이션 재생 중", true);

    function tick(now) {
      const t = clamp((now - start) / duration, 0, 1);
      state.torqueNm = target * easeInOut(t);
      syncControls();
      cachedData = computePoyntingData(getParams());
      renderCore();
      if (t < 1) {
        animationFrame = requestAnimationFrame(tick);
      } else {
        state.torqueNm = target;
        animationFrame = 0;
        els.playBtn.disabled = false;
        els.pauseBtn.disabled = true;
        setStatus("애니메이션 완료", false);
        renderAll("애니메이션 완료");
      }
    }

    animationFrame = requestAnimationFrame(tick);
  }

  function stopAnimation(updateStatus) {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      els.playBtn.disabled = false;
      els.pauseBtn.disabled = true;
      if (updateStatus) {
        setStatus("일시정지됨", false);
      }
    }
  }

  function beginSceneDrag(event) {
    els.sceneCanvas.setPointerCapture(event.pointerId);
    dragState = {
      x: event.clientX,
      y: event.clientY,
      azimuth: state.cameraAzimuth,
      elevation: state.cameraElevation
    };
  }

  function moveSceneDrag(event) {
    if (!dragState) {
      return;
    }
    const dx = event.clientX - dragState.x;
    const dy = event.clientY - dragState.y;
    state.cameraAzimuth = dragState.azimuth + dx * 0.35;
    state.cameraElevation = clamp(dragState.elevation - dy * 0.22, 8, 48);
    renderCore();
  }

  function endSceneDrag() {
    dragState = null;
  }

  function resizeAndRender() {
    fitCanvas(els.sceneCanvas);
    fitCanvas(els.chartCanvas);
    renderAll("준비됨");
  }

  function renderAll(statusText) {
    syncControls();
    cachedData = computePoyntingData(getParams());
    renderCore();
    setStatus(statusText, Boolean(animationFrame));
  }

  function renderCore() {
    if (!cachedData) {
      cachedData = computePoyntingData(getParams());
    }
    const params = getParams();
    const active = computeActiveState(params, state.currentTurns);
    updateTurnControls(active.turns, params.mode === "torque_control");
    drawScene(params, active);
    drawCharts(params, cachedData, active);
    updateReadouts(params, active, cachedData);
  }

  function getParams() {
    const height = state.heightMm / 1000;
    const radius = state.radiusMm / 1000;
    const muPa = state.muPsi * constants.psiToPa;
    return {
      heightMm: state.heightMm,
      height,
      radiusMm: state.radiusMm,
      radius,
      muPsi: state.muPsi,
      muPa,
      massKg: state.massKg,
      forceN: state.massKg * constants.g,
      torqueNm: state.torqueNm,
      maxTurns: state.maxTurns,
      mode: state.mode,
      showReference: state.showReference
    };
  }

  function computePoyntingData(params) {
    const data = {
      turns: [],
      thetaRad: [],
      unloadedHeightM: [],
      loadedHeightM: [],
      unloadedRadiusM: [],
      loadedRadiusM: [],
      unloadedDeltaMm: [],
      loadedDeltaMm: [],
      unloadedTwistDeltaMm: [],
      loadedTwistDeltaMm: [],
      approxDeltaMm: [],
      torqueNm: [],
      torqueTurns: [],
      torqueHeightM: [],
      torqueRadiusM: [],
      torqueDeltaMm: [],
      torqueTwistDeltaMm: [],
      initialVolumeM3: Math.PI * params.radius * params.radius * params.height
    };

    const aParam = getLoadParameter(params);
    const torqueMax = Math.max(params.torqueNm, torqueForTwist(params, params.maxTurns * TWO_PI), 0.0001);
    let loadedZero = 0;
    let unloadedZero = 0;
    let torqueZero = 0;

    for (let i = 0; i < constants.sampleCount; i += 1) {
      const turns = params.maxTurns * i / (constants.sampleCount - 1);
      const theta = turns * TWO_PI;
      const bParam = Math.pow(params.radius * theta, 2) / (4 * params.height * params.height);
      const unloadedHeight = params.height * Math.pow(1 + bParam, 1 / 3);
      const loadedHeight = params.height * solveLoadedLambda(aParam, bParam);
      const unloadedRadius = Math.sqrt(params.height / unloadedHeight) * params.radius;
      const loadedRadius = Math.sqrt(params.height / loadedHeight) * params.radius;
      const torque = torqueMax * i / (constants.sampleCount - 1);
      const torqueState = computeTorqueState(params, torque, aParam);

      if (i === 0) {
        loadedZero = loadedHeight;
        unloadedZero = unloadedHeight;
        torqueZero = torqueState.heightM;
      }

      data.turns.push(turns);
      data.thetaRad.push(theta);
      data.unloadedHeightM.push(unloadedHeight);
      data.loadedHeightM.push(loadedHeight);
      data.unloadedRadiusM.push(unloadedRadius);
      data.loadedRadiusM.push(loadedRadius);
      data.unloadedDeltaMm.push((unloadedHeight - params.height) * 1000);
      data.loadedDeltaMm.push((loadedHeight - params.height) * 1000);
      data.unloadedTwistDeltaMm.push((unloadedHeight - unloadedZero) * 1000);
      data.loadedTwistDeltaMm.push((loadedHeight - loadedZero) * 1000);
      data.approxDeltaMm.push((params.radius * params.radius * theta * theta / (12 * params.height)) * 1000);
      data.torqueNm.push(torque);
      data.torqueTurns.push(torqueState.turns);
      data.torqueHeightM.push(torqueState.heightM);
      data.torqueRadiusM.push(torqueState.radiusM);
      data.torqueDeltaMm.push((torqueState.heightM - params.height) * 1000);
      data.torqueTwistDeltaMm.push((torqueState.heightM - torqueZero) * 1000);
    }

    data.loadedZeroHeightM = loadedZero;
    data.torqueZeroHeightM = torqueZero;
    data.torqueMaxNm = torqueMax;
    return data;
  }

  function computeActiveState(params, turns) {
    const inputTheta = turns * TWO_PI;
    const bParam = Math.pow(params.radius * inputTheta, 2) / (4 * params.height * params.height);
    const aParam = getLoadParameter(params);
    const unloadedHeight = params.height * Math.pow(1 + bParam, 1 / 3);
    const loadedHeight = params.height * solveLoadedLambda(aParam, bParam);
    const loadedZeroHeight = params.height * solveLoadedLambda(aParam, 0);
    const torqueState = computeTorqueState(params, params.torqueNm, aParam);
    const unloadedRadius = Math.sqrt(params.height / unloadedHeight) * params.radius;
    const loadedRadius = Math.sqrt(params.height / loadedHeight) * params.radius;
    let theta = inputTheta;
    let activeTurns = turns;
    let height = loadedHeight;
    let radius = loadedRadius;
    let baselineHeight = loadedZeroHeight;

    if (params.mode === "twist_only") {
      height = unloadedHeight;
      radius = unloadedRadius;
      baselineHeight = params.height;
    } else if (params.mode === "torque_control") {
      theta = torqueState.thetaRad;
      activeTurns = torqueState.turns;
      height = torqueState.heightM;
      radius = torqueState.radiusM;
      baselineHeight = loadedZeroHeight;
    }

    return {
      turns: activeTurns,
      thetaRad: theta,
      heightM: height,
      radiusM: radius,
      deltaMm: (height - params.height) * 1000,
      twistDeltaMm: (height - baselineHeight) * 1000,
      relativeHeight: height / params.height,
      volumeM3: Math.PI * radius * radius * height,
      unloadedHeightM: unloadedHeight,
      loadedHeightM: loadedHeight,
      loadedZeroHeightM: loadedZeroHeight,
      unloadedRadiusM: unloadedRadius,
      loadedRadiusM: loadedRadius,
      torqueNm: params.mode === "torque_control" ? params.torqueNm : torqueForTwist(params, theta),
      approxDeltaMm: (params.radius * params.radius * theta * theta / (12 * params.height)) * 1000
    };
  }

  function getLoadParameter(params) {
    return params.forceN === 0 ? 0 : params.forceN / (params.muPa * Math.PI * params.radius * params.radius);
  }

  function computeTorqueState(params, torqueNm, aParam) {
    const loadParam = typeof aParam === "number" ? aParam : getLoadParameter(params);
    const torqueParam = torqueNm === 0 ? 0 : torqueNm * torqueNm / (params.muPa * params.muPa * Math.PI * Math.PI * Math.pow(params.radius, 6));
    const height = params.height * solveLoadedLambda(loadParam + torqueParam, 0);
    const radius = Math.sqrt(params.height / height) * params.radius;
    const theta = torqueNm === 0 ? 0 : 2 * height * torqueNm / (params.muPa * Math.PI * Math.pow(params.radius, 4));

    return {
      turns: theta / TWO_PI,
      thetaRad: theta,
      heightM: height,
      radiusM: radius
    };
  }

  function torqueForTwist(params, theta) {
    if (theta === 0) {
      return 0;
    }
    const bParam = Math.pow(params.radius * theta, 2) / (4 * params.height * params.height);
    const height = params.height * solveLoadedLambda(getLoadParameter(params), bParam);
    return params.muPa * Math.PI * Math.pow(params.radius, 4) * theta / (2 * height);
  }

  function solveLoadedLambda(aParam, bParam) {
    const f = function (lambda) {
      return lambda * lambda * lambda - aParam * lambda * lambda - (1 + bParam);
    };
    let low = 1;
    let high = Math.max(2, aParam + 2, Math.cbrt(1 + bParam) + aParam + 1);

    while (f(high) < 0 && high < 1e6) {
      high *= 2;
    }

    for (let i = 0; i < 80; i += 1) {
      const mid = (low + high) / 2;
      if (f(mid) < 0) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return Math.max(1, high);
  }

  function updateReadouts(params, active, data) {
    els.heightReadout.textContent = `${formatNumber(active.heightM, 5)} m`;
    els.radiusReadout.textContent = `${formatNumber(active.radiusM * 1000, 4)} mm`;
    els.elongationReadout.textContent = `${formatNumber(active.deltaMm, 4)} mm`;
    els.twistElongationReadout.textContent = `${formatNumber(active.twistDeltaMm, 4)} mm`;
    els.relativeHeightReadout.textContent = formatNumber(active.relativeHeight, 4);
    els.initialVolumeReadout.textContent = `${formatExponential(data.initialVolumeM3)} m^3`;
    els.currentVolumeReadout.textContent = `${formatExponential(active.volumeM3)} m^3`;
    els.volumeRatioReadout.textContent = formatNumber(active.volumeM3 / data.initialVolumeM3, 4);
    els.forceReadout.textContent = `${formatNumber(params.forceN, 3)} N`;
  }

  function drawScene(params, active) {
    const canvas = els.sceneCanvas;
    const ctx = canvas.getContext("2d");
    const size = getCanvasSize(canvas);
    ctx.clearRect(0, 0, size.width, size.height);
    drawSceneBackground(ctx, size.width, size.height);

    const radialScale = Math.min(Math.max(0.10 * params.height / params.radius, 1), 30);
    const referenceRadius = params.radius * radialScale;
    const activeRadius = active.radiusM * radialScale;
    const projector = makeProjector(size.width, size.height, params, active, radialScale);

    drawGrid(ctx, projector, Math.max(referenceRadius, activeRadius), params.height);

    if (params.showReference) {
      drawCylinder(ctx, projector, referenceRadius, params.height, 0, [126, 130, 130], 0.22, "#737a78");
    }

    drawCylinder(ctx, projector, activeRadius, active.heightM, active.thetaRad, [222, 123, 47], 0.88, "#743e14");
    drawHelix(ctx, projector, activeRadius, active.heightM, active.thetaRad);
    drawTwistArc(ctx, projector, activeRadius, active.heightM, active.thetaRad);
    drawRulers(ctx, projector, params.height, active.heightM, Math.max(referenceRadius, activeRadius));
    drawSceneOverlay(ctx, params, active, radialScale, size.width);
  }

  function drawSceneBackground(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#fffdf7");
    gradient.addColorStop(1, "#f3eadb");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function makeProjector(width, height, params, active, radialScale) {
    const azimuth = state.cameraAzimuth * DEG;
    const elevation = state.cameraElevation * DEG;
    const xyLim = Math.max(params.radius * radialScale, active.radiusM * radialScale) * 3.2;
    const zMin = -0.10 * params.height;
    const zMax = Math.max(params.height, active.heightM) * 1.22;

    function rawProject(x, y, z) {
      const x1 = Math.cos(azimuth) * x - Math.sin(azimuth) * y;
      const y1 = Math.sin(azimuth) * x + Math.cos(azimuth) * y;
      const sx = x1;
      const sy = Math.sin(elevation) * y1 - Math.cos(elevation) * z;
      const depth = Math.cos(elevation) * y1 + Math.sin(elevation) * z;
      return { x: sx, y: sy, depth };
    }

    const corners = [];
    [-xyLim, xyLim].forEach(function (x) {
      [-xyLim, xyLim].forEach(function (y) {
        [zMin, zMax].forEach(function (z) {
          corners.push(rawProject(x, y, z));
        });
      });
    });

    const bounds = corners.reduce(function (acc, point) {
      return {
        minX: Math.min(acc.minX, point.x),
        maxX: Math.max(acc.maxX, point.x),
        minY: Math.min(acc.minY, point.y),
        maxY: Math.max(acc.maxY, point.y)
      };
    }, { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    const pad = Math.max(26, Math.min(width, height) * 0.07);
    const scale = Math.min(
      (width - pad * 2) / Math.max(0.001, bounds.maxX - bounds.minX),
      (height - pad * 2) / Math.max(0.001, bounds.maxY - bounds.minY)
    );
    const offsetX = (width - (bounds.minX + bounds.maxX) * scale) / 2;
    const offsetY = (height - (bounds.minY + bounds.maxY) * scale) / 2;

    return {
      project: function (x, y, z) {
        const point = rawProject(x, y, z);
        return {
          x: offsetX + point.x * scale,
          y: offsetY + point.y * scale,
          depth: point.depth
        };
      }
    };
  }

  function drawGrid(ctx, projector, radius, height) {
    const span = Math.max(radius * 3.2, height * 0.26);
    ctx.save();
    ctx.strokeStyle = "rgba(72, 82, 82, 0.16)";
    ctx.lineWidth = 1;
    for (let i = -4; i <= 4; i += 1) {
      const t = span * i / 4;
      drawProjectedLine(ctx, projector, -span, t, 0, span, t, 0);
      drawProjectedLine(ctx, projector, t, -span, 0, t, span, 0);
    }
    ctx.restore();
  }

  function drawCylinder(ctx, projector, radius, height, twist, rgb, alpha, outlineColor) {
    const uCount = 68;
    const vCount = 36;
    const quads = [];

    for (let j = 0; j < vCount; j += 1) {
      const v0 = j / vCount;
      const v1 = (j + 1) / vCount;
      for (let i = 0; i < uCount; i += 1) {
        const u0 = TWO_PI * i / uCount;
        const u1 = TWO_PI * (i + 1) / uCount;
        const p0 = cylinderPoint(projector, radius, height, twist, u0, v0);
        const p1 = cylinderPoint(projector, radius, height, twist, u1, v0);
        const p2 = cylinderPoint(projector, radius, height, twist, u1, v1);
        const p3 = cylinderPoint(projector, radius, height, twist, u0, v1);
        const normalAngle = (u0 + u1) / 2 + twist * (v0 + v1) / 2;
        const light = clamp(0.72 + 0.24 * Math.cos(normalAngle - state.cameraAzimuth * DEG), 0.52, 1);
        quads.push({
          points: [p0, p1, p2, p3],
          depth: (p0.depth + p1.depth + p2.depth + p3.depth) / 4,
          color: `rgba(${Math.round(rgb[0] * light)}, ${Math.round(rgb[1] * light)}, ${Math.round(rgb[2] * light)}, ${alpha})`
        });
      }
    }

    quads.sort(function (a, b) {
      return a.depth - b.depth;
    });

    ctx.save();
    quads.forEach(function (quad) {
      ctx.beginPath();
      ctx.moveTo(quad.points[0].x, quad.points[0].y);
      for (let i = 1; i < quad.points.length; i += 1) {
        ctx.lineTo(quad.points[i].x, quad.points[i].y);
      }
      ctx.closePath();
      ctx.fillStyle = quad.color;
      ctx.fill();
    });

    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 1.4;
    drawRing(ctx, projector, radius, height, twist, 0);
    drawRing(ctx, projector, radius, height, twist, 1);
    ctx.restore();
  }

  function cylinderPoint(projector, radius, height, twist, u, v) {
    const angle = u + twist * v;
    return projector.project(radius * Math.cos(angle), radius * Math.sin(angle), height * v);
  }

  function drawRing(ctx, projector, radius, height, twist, v) {
    ctx.beginPath();
    for (let i = 0; i <= 96; i += 1) {
      const u = TWO_PI * i / 96;
      const point = cylinderPoint(projector, radius, height, twist, u, v);
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();
  }

  function drawHelix(ctx, projector, radius, height, twist) {
    ctx.save();
    ctx.strokeStyle = "#1f5fa8";
    ctx.fillStyle = "#1f5fa8";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i <= 90; i += 1) {
      const v = i / 90;
      const point = projector.project(radius * Math.cos(twist * v), radius * Math.sin(twist * v), height * v);
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();

    for (let i = 0; i <= 12; i += 1) {
      const v = i / 12;
      const point = projector.project(radius * Math.cos(twist * v), radius * Math.sin(twist * v), height * v);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3.2, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTwistArc(ctx, projector, radius, height, theta) {
    const arcRadius = radius * 1.65;
    const z = height * 1.08;
    const arc = Math.min(Math.max(theta, 0.01), 1.45 * Math.PI);
    ctx.save();
    ctx.strokeStyle = "rgba(34, 42, 42, 0.78)";
    ctx.fillStyle = "rgba(34, 42, 42, 0.78)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 52; i += 1) {
      const angle = Math.PI * 0.50 + arc * i / 52;
      const point = projector.project(arcRadius * Math.cos(angle), arcRadius * Math.sin(angle), z);
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.stroke();

    const endAngle = Math.PI * 0.50 + arc;
    const tip = projector.project(arcRadius * Math.cos(endAngle), arcRadius * Math.sin(endAngle), z);
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 4, 0, TWO_PI);
    ctx.fill();

    const label = projector.project(arcRadius * 0.35, arcRadius * 1.02, z * 1.01);
    ctx.font = "800 16px Inter, system-ui, sans-serif";
    ctx.fillText("theta", label.x, label.y);
    ctx.restore();
  }

  function drawRulers(ctx, projector, referenceHeight, activeHeight, radius) {
    const x1 = -radius * 2.25;
    const y1 = -radius * 1.45;
    const x2 = radius * 2.05;

    ctx.save();
    ctx.font = "800 12px Inter, system-ui, sans-serif";
    ctx.strokeStyle = "rgba(34, 42, 42, 0.78)";
    ctx.fillStyle = "rgba(34, 42, 42, 0.82)";
    ctx.lineWidth = 2;
    drawProjectedLine(ctx, projector, x1, y1, 0, x1, y1, referenceHeight);
    let label = projector.project(x1 * 1.02, y1, referenceHeight * 0.5);
    ctx.fillText(`H = ${formatNumber(referenceHeight, 3)} m`, label.x + 4, label.y);

    ctx.strokeStyle = "rgba(223, 123, 47, 0.92)";
    ctx.fillStyle = "rgba(168, 79, 22, 0.95)";
    drawProjectedLine(ctx, projector, x2, 0, 0, x2, 0, activeHeight);
    label = projector.project(x2 * 1.04, 0, activeHeight * 0.52);
    ctx.fillText(`h = ${formatNumber(activeHeight, 4)} m`, label.x + 4, label.y);
    ctx.restore();
  }

  function drawSceneOverlay(ctx, params, active, radialScale, width) {
    ctx.save();
    ctx.font = "800 12px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    const modeText = params.mode === "twist_only"
      ? "무하중 비틀림"
      : params.mode === "torque_control"
        ? "토크 제어"
        : "하중 + 비틀림";
    const lines = [
      modeText,
      `theta = ${formatNumber(active.turns * 360, 1)} deg`,
      `시각화용 반지름 ${formatNumber(radialScale, 1)}x`,
      "실제 비율 아님"
    ];
    const boxWidth = 196;
    const x = width - boxWidth - 18;
    let y = 18;
    ctx.fillStyle = "rgba(255, 253, 248, 0.86)";
    ctx.strokeStyle = "rgba(217, 210, 196, 0.95)";
    roundRect(ctx, x, y, boxWidth, 92, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#263030";
    lines.forEach(function (line) {
      ctx.fillText(line, x + 12, y + 11);
      y += 19;
    });
    ctx.restore();
  }

  function drawProjectedLine(ctx, projector, x0, y0, z0, x1, y1, z1) {
    const p0 = projector.project(x0, y0, z0);
    const p1 = projector.project(x1, y1, z1);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  function drawCharts(params, data, active) {
    const canvas = els.chartCanvas;
    const ctx = canvas.getContext("2d");
    const size = getCanvasSize(canvas);
    ctx.clearRect(0, 0, size.width, size.height);
    ctx.fillStyle = "#fffdf8";
    ctx.fillRect(0, 0, size.width, size.height);

    const gap = 22;
    const chartHeight = (size.height - gap * 2 - 18) / 3;
    const chartWidth = size.width;

    if (params.mode === "torque_control") {
      drawSingleChart(ctx, {
        x: 0,
        y: 0,
        w: chartWidth,
        h: chartHeight,
        title: "토크 제어: 총 신장과 추가 신장",
        yLabel: "mm",
        xLabel: "M (N m)",
        xMax: data.torqueMaxNm,
        xFormatter: formatCompact,
        series: [
          { values: data.torqueDeltaMm, color: "#c84a38", dash: [], label: "h-H" },
          { values: data.torqueTwistDeltaMm, color: "#2f7b68", dash: [6, 4], label: "h-h(0)" }
        ],
        activeY: active.deltaMm,
        activeX: params.torqueNm,
        xValues: data.torqueNm,
        showLegend: true,
        legendWidth: 128,
        legendStep: 62
      });

      drawSingleChart(ctx, {
        x: 0,
        y: chartHeight + gap,
        w: chartWidth,
        h: chartHeight,
        title: "결과 비틀림  theta / 2pi",
        yLabel: "turns",
        xLabel: "M (N m)",
        xMax: data.torqueMaxNm,
        xFormatter: formatCompact,
        series: [
          { values: data.torqueTurns, color: "#2368a8", dash: [], label: "theta" }
        ],
        activeY: active.turns,
        activeX: params.torqueNm,
        xValues: data.torqueNm
      });

      drawSingleChart(ctx, {
        x: 0,
        y: (chartHeight + gap) * 2,
        w: chartWidth,
        h: chartHeight,
        title: "반지름  r",
        yLabel: "mm",
        xLabel: "M (N m)",
        xMax: data.torqueMaxNm,
        xFormatter: formatCompact,
        series: [
          { values: data.torqueRadiusM.map(function (v) { return v * 1000; }), color: "#c84a38", dash: [], label: "토크" }
        ],
        activeY: active.radiusM * 1000,
        activeX: params.torqueNm,
        xValues: data.torqueNm
      });
      return;
    }

    drawSingleChart(ctx, {
      x: 0,
      y: 0,
      w: chartWidth,
      h: chartHeight,
      title: "총 신장과 실험 기준 추가 신장",
      yLabel: "mm",
      xLabel: "turns",
      xMax: params.maxTurns,
      series: [
        { values: data.unloadedDeltaMm, color: "#2368a8", dash: [7, 5], label: "Eq.13" },
        { values: data.loadedDeltaMm, color: "#c84a38", dash: [], label: "Eq.15" },
        { values: data.loadedTwistDeltaMm, color: "#2f7b68", dash: [6, 4], label: "추가" },
        { values: data.approxDeltaMm, color: "#263030", dash: [2, 4], label: "Eq.14" }
      ],
      activeY: active.deltaMm,
      activeX: active.turns,
      xValues: data.turns,
      showLegend: true,
      legendWidth: 228,
      legendStep: 56
    });

    drawSingleChart(ctx, {
      x: 0,
      y: chartHeight + gap,
      w: chartWidth,
      h: chartHeight,
      title: "상대 높이  h / H",
      yLabel: "ratio",
      xLabel: "turns",
      xMax: params.maxTurns,
      series: [
        { values: data.unloadedHeightM.map(function (v) { return v / params.height; }), color: "#2368a8", dash: [7, 5], label: "무하중" },
        { values: data.loadedHeightM.map(function (v) { return v / params.height; }), color: "#c84a38", dash: [], label: "하중" }
      ],
      activeY: active.relativeHeight,
      activeX: active.turns,
      xValues: data.turns
    });

    drawSingleChart(ctx, {
      x: 0,
      y: (chartHeight + gap) * 2,
      w: chartWidth,
      h: chartHeight,
      title: "반지름  r",
      yLabel: "mm",
      xLabel: "turns",
      xMax: params.maxTurns,
      series: [
        { values: data.unloadedRadiusM.map(function (v) { return v * 1000; }), color: "#2368a8", dash: [7, 5], label: "무하중" },
        { values: data.loadedRadiusM.map(function (v) { return v * 1000; }), color: "#c84a38", dash: [], label: "하중" }
      ],
      activeY: active.radiusM * 1000,
      activeX: active.turns,
      xValues: data.turns
    });
  }

  function drawSingleChart(ctx, config) {
    const left = 58;
    const right = 18;
    const top = 28;
    const bottom = 34;
    const plot = {
      x: config.x + left,
      y: config.y + top,
      w: config.w - left - right,
      h: config.h - top - bottom
    };
    const values = [config.activeY];
    config.series.forEach(function (series) {
      series.values.forEach(function (value) {
        values.push(value);
      });
    });
    let yMin = Math.min.apply(null, values);
    let yMax = Math.max.apply(null, values);
    if (Math.abs(yMax - yMin) < 1e-12) {
      yMax += 1;
      yMin -= 1;
    }
    const pad = (yMax - yMin) * 0.12;
    yMin -= pad;
    yMax += pad;

    const xToPx = function (x) {
      return plot.x + (x / Math.max(config.xMax, 0.000001)) * plot.w;
    };
    const yToPx = function (y) {
      return plot.y + plot.h - ((y - yMin) / (yMax - yMin)) * plot.h;
    };

    ctx.save();
    ctx.fillStyle = "#222a2a";
    ctx.font = "900 13px Inter, system-ui, sans-serif";
    ctx.fillText(config.title, config.x + 8, config.y + 15);
    ctx.font = "800 11px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#657070";
    ctx.fillText(config.yLabel, config.x + 8, plot.y + 12);

    ctx.strokeStyle = "#d9d2c4";
    ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
    ctx.fillStyle = "rgba(245, 241, 234, 0.45)";
    ctx.fillRect(plot.x, plot.y, plot.w, plot.h);

    ctx.strokeStyle = "rgba(101, 112, 112, 0.22)";
    ctx.fillStyle = "#657070";
    ctx.font = "800 10px Inter, system-ui, sans-serif";
    for (let i = 0; i <= 4; i += 1) {
      const y = plot.y + plot.h * i / 4;
      const value = yMax - (yMax - yMin) * i / 4;
      ctx.beginPath();
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.w, y);
      ctx.stroke();
      ctx.fillText(formatCompact(value), config.x + 8, y + 3);
    }
    for (let i = 0; i <= 4; i += 1) {
      const x = plot.x + plot.w * i / 4;
      const value = config.xMax * i / 4;
      const label = config.xFormatter ? config.xFormatter(value) : formatNumber(value, value % 1 === 0 ? 0 : 1);
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      ctx.fillText(label, x - 7, plot.y + plot.h + 18);
    }
    if (config.xLabel) {
      ctx.fillText(config.xLabel, plot.x + plot.w - 42, plot.y + plot.h + 31);
    }

    config.series.forEach(function (series) {
      ctx.beginPath();
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2.2;
      ctx.setLineDash(series.dash);
      series.values.forEach(function (value, i) {
        const x = xToPx(config.xValues[i]);
        const y = yToPx(value);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
    });

    const activeX = xToPx(config.activeX);
    const activeY = yToPx(config.activeY);
    ctx.strokeStyle = "rgba(34, 42, 42, 0.72)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(activeX, plot.y);
    ctx.lineTo(activeX, plot.y + plot.h);
    ctx.stroke();
    ctx.fillStyle = "#ffd45c";
    ctx.strokeStyle = "#222a2a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(activeX, activeY, 5, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();

    if (config.showLegend) {
      let x = plot.x + plot.w - (config.legendWidth || 172);
      const y = config.y + 13;
      const step = config.legendStep || 58;
      config.series.forEach(function (series) {
        ctx.strokeStyle = series.color;
        ctx.lineWidth = 2.2;
        ctx.setLineDash(series.dash);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 22, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#354040";
        ctx.font = "800 10px Inter, system-ui, sans-serif";
        ctx.fillText(series.label, x + 27, y + 3);
        x += step;
      });
    }

    ctx.restore();
  }

  function downloadCsv() {
    const params = getParams();
    const data = cachedData || computePoyntingData(params);
    const active = computeActiveState(params, state.currentTurns);
    const rows = [];
    const modeText = params.mode === "twist_only"
      ? "무하중 비틀림"
      : params.mode === "torque_control"
        ? "토크 제어"
        : "하중 + 비틀림";

    rows.push(["section", "key", "value", "unit"]);
    rows.push(["metadata", "calculation_mode", modeText, ""]);
    rows.push(["metadata", "display_turns", active.turns, "turns"]);
    rows.push(["metadata", "display_theta", active.thetaRad, "rad"]);
    rows.push(["metadata", "initial_height", params.heightMm, "mm"]);
    rows.push(["metadata", "initial_radius", params.radiusMm, "mm"]);
    rows.push(["metadata", "shear_modulus", params.muPsi, "psi"]);
    rows.push(["metadata", "mass", params.massKg, "kg"]);
    rows.push(["metadata", "force", params.forceN, "N"]);
    rows.push(["metadata", "control_torque", params.torqueNm, "N m"]);
    rows.push(["metadata", "active_height", active.heightM, "m"]);
    rows.push(["metadata", "active_radius", active.radiusM * 1000, "mm"]);
    rows.push(["metadata", "active_total_delta_h_minus_H", active.deltaMm, "mm"]);
    rows.push(["metadata", "active_twist_delta_h_minus_h0", active.twistDeltaMm, "mm"]);
    rows.push([]);
    rows.push(["section", "equation", "expression", "note"]);
    rows.push(["equations", "Eq. 13 unloaded twist", "h = H*(1 + Re^2*theta^2/(4*H^2))^(1/3)", ""]);
    rows.push(["equations", "Eq. 14 slender approximation", "h - H ~= Re^2*theta^2/(12*H)", ""]);
    rows.push(["equations", "Eq. 15 loaded twist", "(h/H)^3 - F/(mu*pi*Re^2)*(h/H)^2 - (1 + Re^2*theta^2/(4*H^2)) = 0", ""]);
    rows.push(["equations", "Torque control", "(h/H)^3 - (F/(mu*pi*Re^2) + M^2/(mu^2*pi^2*Re^6))*(h/H)^2 - 1 = 0; theta = 2*h*M/(mu*pi*Re^4)", ""]);
    rows.push([]);
    rows.push([
      "turns",
      "theta_rad",
      "unloaded_height_m",
      "loaded_height_m",
      "unloaded_delta_mm",
      "loaded_delta_mm",
      "unloaded_twist_only_delta_mm",
      "loaded_twist_only_delta_mm",
      "approximation_delta_mm"
    ]);

    data.turns.forEach(function (turns, i) {
      rows.push([
        turns,
        data.thetaRad[i],
        data.unloadedHeightM[i],
        data.loadedHeightM[i],
        data.unloadedDeltaMm[i],
        data.loadedDeltaMm[i],
        data.unloadedTwistDeltaMm[i],
        data.loadedTwistDeltaMm[i],
        data.approxDeltaMm[i]
      ]);
    });

    rows.push([]);
    rows.push([
      "torque_Nm",
      "result_turns",
      "result_theta_rad",
      "torque_height_m",
      "torque_radius_mm",
      "torque_total_delta_mm",
      "torque_twist_delta_mm"
    ]);

    data.torqueNm.forEach(function (torque, i) {
      rows.push([
        torque,
        data.torqueTurns[i],
        data.torqueTurns[i] * TWO_PI,
        data.torqueHeightM[i],
        data.torqueRadiusM[i] * 1000,
        data.torqueDeltaMm[i],
        data.torqueTwistDeltaMm[i]
      ]);
    });

    const csv = rows.map(function (row) {
      return row.map(csvCell).join(",");
    }).join("\n");
    const name = buildFileName("poynting_results", "csv");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), name);
    setStatus("CSV 저장 완료", false);
  }

  function downloadPng() {
    els.sceneCanvas.toBlob(function (blob) {
      if (!blob) {
        setStatus("그림 저장 실패", false);
        return;
      }
      downloadBlob(blob, buildFileName("poynting_scene", "png"));
      setStatus("그림 저장 완료", false);
    }, "image/png");
  }

  function buildFileName(prefix, extension) {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
    return `${prefix}_${stamp}_H${formatNumber(state.heightMm, 0)}mm_R${formatNumber(state.radiusMm, 2)}mm_mu${formatNumber(state.muPsi, 0)}_m${formatNumber(state.massKg, 2)}_M${formatNumber(state.torqueNm, 4)}Nm_T${state.maxTurns}.${extension}`;
  }

  function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    if (value === undefined || value === null) {
      return "";
    }
    const text = String(value).replace(/"/g, '""');
    return `"${text}"`;
  }

  function setStatus(text, playing) {
    els.statusText.textContent = text;
    els.statusDot.classList.toggle("is-playing", playing);
  }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function getCanvasSize(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return {
      width: canvas.width / dpr,
      height: canvas.height / dpr
    };
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value, digits) {
    return Number(value).toFixed(digits);
  }

  function formatCompact(value) {
    const abs = Math.abs(value);
    if (abs >= 100 || abs === 0) {
      return value.toFixed(0);
    }
    if (abs >= 10) {
      return value.toFixed(1);
    }
    if (abs >= 1) {
      return value.toFixed(2);
    }
    return value.toFixed(3);
  }

  function formatExponential(value) {
    return Number(value).toExponential(4);
  }
})();
