(function () {
  "use strict";

  const TWO_PI = Math.PI * 2;
  const DEG = Math.PI / 180;
  const constants = {
    g: 9.81,
    psiToPa: 6894.76,
    sampleCount: 240,
    twistControlMaxTurns: 6,
    torqueControlMaxNm: 0.04143536
  };

  const defaults = {
    heightMm: 1000,
    radiusMm: 4,
    muPsi: 400,
    massKg: 0.3,
    currentTurns: 0,
    currentTorqueNm: 0,
    mode: "force_twist",
    cameraAzimuth: -36,
    cameraElevation: 24
  };

  const ranges = {
    heightMm: { min: 200, max: 1000, step: 1, digits: 0 },
    radiusMm: { min: 2, max: 30, step: 0.01, digits: 2 },
    muPsi: { min: 50, max: 2000, step: 1, digits: 0 },
    massKg: { min: 0, max: 2, step: 0.001, digits: 3 }
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
      turnsRange: document.getElementById("turnsRange"),
      controlSliderLabel: document.getElementById("controlSliderLabel"),
      turnsOutput: document.getElementById("turnsOutput"),
      controlMinLabel: document.getElementById("controlMinLabel"),
      controlMaxLabel: document.getElementById("controlMaxLabel"),
      playBtn: document.getElementById("playBtn"),
      pauseBtn: document.getElementById("pauseBtn"),
      resetBtn: document.getElementById("resetBtn"),
      sceneCanvas: document.getElementById("sceneCanvas"),
      chartCanvas: document.getElementById("chartCanvas"),
      angleBadge: document.getElementById("angleBadge"),
      heightReadout: document.getElementById("heightReadout"),
      radiusReadout: document.getElementById("radiusReadout"),
      elongationReadout: document.getElementById("elongationReadout"),
      twistDeltaReadout: document.getElementById("twistDeltaReadout"),
      relativeHeightReadout: document.getElementById("relativeHeightReadout"),
      initialVolumeReadout: document.getElementById("initialVolumeReadout"),
      currentVolumeReadout: document.getElementById("currentVolumeReadout"),
      volumeRatioReadout: document.getElementById("volumeRatioReadout"),
      forceReadout: document.getElementById("forceReadout"),
      torqueReadout: document.getElementById("torqueReadout")
    });
  }

  function bindControls() {
    bindPair("heightMm", els.heightRange, els.heightNumber);
    bindPair("radiusMm", els.radiusRange, els.radiusNumber);
    bindPair("muPsi", els.muRange, els.muNumber);
    bindPair("massKg", els.massRange, els.massNumber);

    els.turnsRange.addEventListener("input", function () {
      stopAnimation(false);
      if (state.mode === "torque_control") {
        state.currentTorqueNm = clamp(parseFloat(els.turnsRange.value), 0, constants.torqueControlMaxNm);
      } else {
        state.currentTurns = clamp(parseFloat(els.turnsRange.value), 0, constants.twistControlMaxTurns);
      }
      renderAll("평형 계산 완료");
    });

    document.querySelectorAll("input[name='mode']").forEach(function (radio) {
      radio.addEventListener("change", function () {
        state.mode = radio.value;
        renderAll("계산 모드 변경");
      });
    });

    els.playBtn.addEventListener("click", playAnimation);
    els.pauseBtn.addEventListener("click", function () {
      stopAnimation(true);
    });
    els.resetBtn.addEventListener("click", resetApp);

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

    if (state.mode === "torque_control") {
      state.currentTorqueNm = clamp(state.currentTorqueNm, 0, constants.torqueControlMaxNm);
      const params = getParams();
      const active = computeActiveState(params);
      const sliderMax = Math.max(constants.torqueControlMaxNm, 0.0001);
      els.controlSliderLabel.textContent = "현재 토크";
      els.turnsRange.max = formatNumber(sliderMax, 6);
      els.turnsRange.step = formatNumber(Math.max(sliderMax / 400, 0.000001), 6);
      els.turnsRange.value = formatNumber(state.currentTorqueNm, 6);
      els.turnsOutput.textContent = `${formatNumber(state.currentTorqueNm, 6)} N m / ${formatNumber(active.turns, 2)} turns`;
      els.controlMinLabel.textContent = "0";
      els.controlMaxLabel.textContent = `${formatNumber(sliderMax, 6)} N m`;
      els.angleBadge.textContent = `M = ${formatNumber(state.currentTorqueNm, 6)} N m`;
    } else {
      state.currentTurns = clamp(state.currentTurns, 0, constants.twistControlMaxTurns);
      els.controlSliderLabel.textContent = "현재 비틀림";
      els.turnsRange.max = String(constants.twistControlMaxTurns);
      els.turnsRange.step = "0.01";
      els.turnsRange.value = formatNumber(state.currentTurns, 2);
      els.turnsOutput.textContent = `${formatNumber(state.currentTurns, 2)} turns / ${formatNumber(state.currentTurns * 360, 0)} deg`;
      els.controlMinLabel.textContent = "0";
      els.controlMaxLabel.textContent = `${formatNumber(constants.twistControlMaxTurns, 0)} turns`;
      els.angleBadge.textContent = `theta = ${formatNumber(state.currentTurns, 2)} turns`;
    }
    document.querySelectorAll("input[name='mode']").forEach(function (radio) {
      radio.checked = radio.value === state.mode;
    });
  }

  function setPairValue(rangeEl, numberEl, value, digits) {
    const text = formatNumber(value, digits);
    rangeEl.value = text;
    numberEl.value = text;
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
    const torqueMode = state.mode === "torque_control";
    const current = torqueMode ? state.currentTorqueNm : state.currentTurns;
    const maxControl = torqueMode ? constants.torqueControlMaxNm : constants.twistControlMaxTurns;
    const from = current >= maxControl ? 0 : current;
    const to = maxControl;
    const start = performance.now();
    const duration = torqueMode ? 4200 : Math.max(1800, 620 * (to - from));

    if (torqueMode) {
      state.currentTorqueNm = from;
    } else {
      state.currentTurns = from;
    }
    els.playBtn.disabled = true;
    els.pauseBtn.disabled = false;
    setStatus("애니메이션 재생 중", true);

    function tick(now) {
      const t = clamp((now - start) / duration, 0, 1);
      if (torqueMode) {
        state.currentTorqueNm = from + (to - from) * easeInOut(t);
      } else {
        state.currentTurns = from + (to - from) * easeInOut(t);
      }
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
    const active = computeActiveState(params);
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
      maxTurns: constants.twistControlMaxTurns,
      maxTorqueNm: constants.torqueControlMaxNm,
      mode: state.mode
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
      requiredTorqueNm: [],
      torqueNm: [],
      torqueThetaRad: [],
      torqueTurns: [],
      torqueHeightM: [],
      torqueRadiusM: [],
      torqueDeltaMm: [],
      torqueTwistDeltaMm: [],
      initialVolumeM3: Math.PI * params.radius * params.radius * params.height
    };

    const aParam = forceCoefficient(params);
    let loadedZero = 0;
    let unloadedZero = 0;
    let torqueZero = 0;

    for (let i = 0; i < constants.sampleCount; i += 1) {
      const turns = params.maxTurns * i / (constants.sampleCount - 1);
      const twist = computeTwistResponse(params, turns, aParam);
      const torqueNm = params.maxTorqueNm * i / (constants.sampleCount - 1);
      const torque = computeTorqueResponse(params, torqueNm, aParam);

      if (i === 0) {
        loadedZero = twist.loadedHeight;
        unloadedZero = twist.unloadedHeight;
        torqueZero = torque.height;
      }

      data.turns.push(turns);
      data.thetaRad.push(twist.theta);
      data.unloadedHeightM.push(twist.unloadedHeight);
      data.loadedHeightM.push(twist.loadedHeight);
      data.unloadedRadiusM.push(twist.unloadedRadius);
      data.loadedRadiusM.push(twist.loadedRadius);
      data.unloadedDeltaMm.push((twist.unloadedHeight - params.height) * 1000);
      data.loadedDeltaMm.push((twist.loadedHeight - params.height) * 1000);
      data.unloadedTwistDeltaMm.push((twist.unloadedHeight - unloadedZero) * 1000);
      data.loadedTwistDeltaMm.push((twist.loadedHeight - loadedZero) * 1000);
      data.approxDeltaMm.push(twist.approxDeltaMm);
      data.requiredTorqueNm.push(twist.requiredTorqueNm);
      data.torqueNm.push(torqueNm);
      data.torqueThetaRad.push(torque.theta);
      data.torqueTurns.push(torque.turns);
      data.torqueHeightM.push(torque.height);
      data.torqueRadiusM.push(torque.radius);
      data.torqueDeltaMm.push((torque.height - params.height) * 1000);
      data.torqueTwistDeltaMm.push((torque.height - torqueZero) * 1000);
    }

    return data;
  }

  function computeActiveState(params) {
    const aParam = forceCoefficient(params);
    if (params.mode === "torque_control") {
      const torque = computeTorqueResponse(params, state.currentTorqueNm, aParam);
      const zeroTorque = computeTorqueResponse(params, 0, aParam);
      return {
        controlX: state.currentTorqueNm,
        turns: torque.turns,
        thetaRad: torque.theta,
        torqueNm: state.currentTorqueNm,
        heightM: torque.height,
        radiusM: torque.radius,
        deltaMm: (torque.height - params.height) * 1000,
        twistDeltaMm: (torque.height - zeroTorque.height) * 1000,
        relativeHeight: torque.height / params.height,
        volumeM3: Math.PI * torque.radius * torque.radius * torque.height,
        approxDeltaMm: (params.radius * params.radius * torque.theta * torque.theta / (12 * params.height)) * 1000
      };
    }

    const twist = computeTwistResponse(params, state.currentTurns, aParam);
    const zeroTwist = computeTwistResponse(params, 0, aParam);
    return {
      controlX: state.currentTurns,
      turns: state.currentTurns,
      thetaRad: twist.theta,
      torqueNm: twist.requiredTorqueNm,
      heightM: twist.loadedHeight,
      radiusM: twist.loadedRadius,
      deltaMm: (twist.loadedHeight - params.height) * 1000,
      twistDeltaMm: (twist.loadedHeight - zeroTwist.loadedHeight) * 1000,
      relativeHeight: twist.loadedHeight / params.height,
      volumeM3: Math.PI * twist.loadedRadius * twist.loadedRadius * twist.loadedHeight,
      unloadedHeightM: twist.unloadedHeight,
      loadedHeightM: twist.loadedHeight,
      unloadedRadiusM: twist.unloadedRadius,
      loadedRadiusM: twist.loadedRadius,
      approxDeltaMm: twist.approxDeltaMm
    };
  }

  function computeTwistResponse(params, turns, aParam) {
    const theta = turns * TWO_PI;
    const bParam = Math.pow(params.radius * theta, 2) / (4 * params.height * params.height);
    const unloadedHeight = params.height * Math.pow(1 + bParam, 1 / 3);
    const loadedHeight = params.height * solveLoadedLambda(aParam, bParam);
    const unloadedRadius = Math.sqrt(params.height / unloadedHeight) * params.radius;
    const loadedRadius = Math.sqrt(params.height / loadedHeight) * params.radius;

    return {
      theta,
      unloadedHeight,
      loadedHeight,
      unloadedRadius,
      loadedRadius,
      approxDeltaMm: (params.radius * params.radius * theta * theta / (12 * params.height)) * 1000,
      requiredTorqueNm: requiredTorqueFromTwist(params, loadedHeight, theta)
    };
  }

  function computeTorqueResponse(params, torqueNm, aParam) {
    const torqueParam = torqueNm === 0
      ? 0
      : (torqueNm * torqueNm) / (params.muPa * params.muPa * Math.PI * Math.PI * Math.pow(params.radius, 6));
    const height = params.height * solveLoadedLambda(aParam + torqueParam, 0);
    const radius = Math.sqrt(params.height / height) * params.radius;
    const theta = 2 * height * torqueNm / (params.muPa * Math.PI * Math.pow(params.radius, 4));

    return {
      height,
      radius,
      theta,
      turns: theta / TWO_PI
    };
  }

  function forceCoefficient(params) {
    return params.forceN === 0 ? 0 : params.forceN / (params.muPa * Math.PI * params.radius * params.radius);
  }

  function requiredTorqueFromTwist(params, height, theta) {
    if (theta === 0) {
      return 0;
    }
    return theta * params.muPa * Math.PI * Math.pow(params.radius, 4) / (2 * height);
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
    els.twistDeltaReadout.textContent = `${formatNumber(active.twistDeltaMm, 4)} mm`;
    els.relativeHeightReadout.textContent = formatNumber(active.relativeHeight, 4);
    els.initialVolumeReadout.textContent = `${formatExponential(data.initialVolumeM3)} m^3`;
    els.currentVolumeReadout.textContent = `${formatExponential(active.volumeM3)} m^3`;
    els.volumeRatioReadout.textContent = formatNumber(active.volumeM3 / data.initialVolumeM3, 4);
    els.forceReadout.textContent = `${formatNumber(params.forceN, 3)} N`;
    els.torqueReadout.textContent = `${formatNumber(active.torqueNm, 5)} N m`;
  }

  function drawScene(params, active) {
    const canvas = els.sceneCanvas;
    const ctx = canvas.getContext("2d");
    const size = getCanvasSize(canvas);
    ctx.clearRect(0, 0, size.width, size.height);
    drawSceneBackground(ctx, size.width, size.height);

    const radialScale = getSceneRadiusScale(params);
    const frameRadius = getSceneFrameRadius(params);
    const referenceRadius = params.radius * radialScale;
    const activeRadius = active.radiusM * radialScale;
    const projector = makeProjector(size.width, size.height, params, active, radialScale, frameRadius);

    drawGrid(ctx, projector, frameRadius, params.height);

    drawCylinder(ctx, projector, activeRadius, active.heightM, active.thetaRad, [222, 123, 47], 0.88, "#743e14");
    drawHelix(ctx, projector, activeRadius, active.heightM, active.thetaRad);
    drawTwistArc(ctx, projector, activeRadius, active.heightM, active.thetaRad);
    drawRulers(ctx, projector, params.height, active.heightM, Math.max(referenceRadius, activeRadius, frameRadius * 0.42));
    drawSceneOverlay(ctx, params, active, size.width);
  }

  function getSceneRadiusScale(params) {
    const radiusRange = ranges.radiusMm.max - ranges.radiusMm.min;
    const normalizedRadius = radiusRange <= 0
      ? 0
      : clamp((params.radiusMm - ranges.radiusMm.min) / radiusRange, 0, 1);
    const targetRadius = params.height * (0.055 + 0.110 * Math.sqrt(normalizedRadius));
    return targetRadius / Math.max(params.radius, 1e-9);
  }

  function getSceneFrameRadius(params) {
    return params.height * 0.165;
  }

  function drawSceneBackground(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#fffdf7");
    gradient.addColorStop(1, "#f3eadb");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function makeProjector(width, height, params, active, radialScale, frameRadius) {
    const azimuth = state.cameraAzimuth * DEG;
    const elevation = state.cameraElevation * DEG;
    const visualRadius = Math.max(params.radius * radialScale, active.radiusM * radialScale);
    const xyLim = Math.max(frameRadius * 2.45, visualRadius * 1.35, params.height * 0.18);
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

  function drawSceneOverlay(ctx, params, active, width) {
    ctx.save();
    ctx.font = "800 12px Inter, system-ui, sans-serif";
    ctx.textBaseline = "top";
    const modeText = getModeText(params.mode);
    const lines = [
      modeText,
      `theta = ${formatNumber(active.turns * 360, 1)} deg`,
      `M = ${formatNumber(active.torqueNm, 6)} N m`,
      `R_e = ${formatNumber(params.radiusMm, 2)} mm`
    ];
    const boxWidth = 178;
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
    const chartWidth = size.width;
    const chartHeight = (size.height - gap) / 2;
    const torqueMode = params.mode === "torque_control";
    const xValues = torqueMode ? data.torqueNm : data.turns;
    const xMax = torqueMode ? params.maxTorqueNm : params.maxTurns;
    const activeX = torqueMode ? active.torqueNm : active.turns;
    const xLabel = torqueMode ? "토크 M (N m)" : "비틀림 횟수";
    const xDigits = torqueMode ? 4 : 1;
    const totalSeries = torqueMode
      ? [{ values: data.torqueDeltaMm, color: "#2f7b68", dash: [], label: "전체 신장" }]
      : [{ values: data.loadedDeltaMm, color: "#c84a38", dash: [], label: "전체 신장" }];
    const twistSeries = torqueMode
      ? [{ values: data.torqueTwistDeltaMm, color: "#2368a8", dash: [], label: "추가 신장" }]
      : [{ values: data.loadedTwistDeltaMm, color: "#2368a8", dash: [], label: "추가 신장" }];

    drawSingleChart(ctx, {
      x: 0,
      y: 0,
      w: chartWidth,
      h: chartHeight,
      title: "전체 신장: h - H",
      yLabel: "stress-free 기준 (mm)",
      xLabel,
      xDigits,
      xMax,
      series: totalSeries,
      activeY: active.deltaMm,
      activeX,
      xValues,
      activeLabel: `현재 ${formatNumber(active.deltaMm, 3)} mm`
    });

    drawSingleChart(ctx, {
      x: 0,
      y: chartHeight + gap,
      w: chartWidth,
      h: chartHeight,
      title: "비틀림 추가 신장: h(θ) - h(0)",
      yLabel: "하중 후 기준 (mm)",
      xLabel,
      xDigits,
      xMax,
      series: twistSeries,
      activeY: active.twistDeltaMm,
      activeX,
      xValues,
      activeLabel: `추가 ${formatNumber(active.twistDeltaMm, 3)} mm`
    });
  }

  function drawSingleChart(ctx, config) {
    const left = 78;
    const right = 28;
    const top = 46;
    const bottom = 48;
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

    const xMax = Math.max(Math.abs(config.xMax), 1e-9);
    const xToPx = function (x) {
      return plot.x + (x / xMax) * plot.w;
    };
    const yToPx = function (y) {
      return plot.y + plot.h - ((y - yMin) / (yMax - yMin)) * plot.h;
    };

    ctx.save();
    ctx.fillStyle = "#222a2a";
    ctx.font = "900 14px Inter, system-ui, sans-serif";
    ctx.fillText(config.title, config.x + 14, config.y + 23);
    ctx.font = "800 11px Inter, system-ui, sans-serif";
    ctx.fillStyle = "#657070";
    ctx.fillText(config.yLabel, config.x + 14, plot.y + 14);
    ctx.fillText(config.xLabel || "", plot.x + plot.w - 92, config.y + config.h - 14);

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
      const value = xMax * i / 4;
      ctx.beginPath();
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.h);
      ctx.stroke();
      const digits = config.xDigits === undefined ? (value % 1 === 0 ? 0 : 1) : config.xDigits;
      ctx.fillText(formatNumber(value, digits), x - 7, plot.y + plot.h + 18);
    }

    if (yMin < 0 && yMax > 0) {
      const zeroY = yToPx(0);
      ctx.strokeStyle = "rgba(34, 42, 42, 0.42)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(plot.x, zeroY);
      ctx.lineTo(plot.x + plot.w, zeroY);
      ctx.stroke();
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

    if (config.activeLabel) {
      ctx.font = "900 11px Inter, system-ui, sans-serif";
      const labelPadX = 8;
      const labelHeight = 24;
      const labelWidth = ctx.measureText(config.activeLabel).width + labelPadX * 2;
      const labelX = Math.min(Math.max(activeX + 10, plot.x), plot.x + plot.w - labelWidth);
      const labelY = Math.max(plot.y + 8, activeY - labelHeight - 10);
      ctx.fillStyle = "rgba(255, 253, 248, 0.94)";
      ctx.strokeStyle = "rgba(34, 42, 42, 0.28)";
      ctx.lineWidth = 1;
      roundRect(ctx, labelX, labelY, labelWidth, labelHeight, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#222a2a";
      ctx.fillText(config.activeLabel, labelX + labelPadX, labelY + 15);
    }

    if (config.showLegend) {
      const legendStep = config.series.length > 2 ? 98 : 112;
      let x = Math.max(plot.x + 8, plot.x + plot.w - legendStep * config.series.length);
      const y = config.y + 13;
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
        x += legendStep;
      });
    }

    ctx.restore();
  }

  function setStatus(text, playing) {
    void text;
    void playing;
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

  function getModeText(mode) {
    return mode === "torque_control" ? "토크 지정" : "비틀림 각도 지정";
  }
})();
