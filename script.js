const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const videoCanvas = document.getElementById("video-canvas");
const videoCtx = videoCanvas.getContext("2d");
const letterCanvas = document.getElementById("letter-canvas");
const letterCtx = letterCanvas.getContext("2d");
const output = document.getElementById("ascii-output");
const content = document.querySelector(".content");
const status = document.getElementById("status");

const state = {
  mirror: true,
  invert: false,
  color: "#8bb5ad",
  charSet: "@%#*+=-:. ",
  threshold: 0.5,
  contrast: 1,
  sizeScale: 1,
  videoLayer: false,
  videoOpacity: 0.3,
  letterMode: false,
};

// ── render loop ──────────────────────────────────────────────────────────────

// reusable canvas for measuring actual rendered char width
const measureCtx = document.createElement("canvas").getContext("2d");
let videoAspect = 0;

// ── letter mode ───────────────────────────────────────────────────────────────

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const JAPANESE = "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん日月火水木金土山川田人口目耳手足";
const BINARY = "01";
const BUCKETS = 8; // number of font-size steps (= number of font changes per frame)
let outputFontFamily = ""; // cached after first render
let canvasChars = LETTERS;
let canvasFontScale = 1;
let letterGrid = [];
let lgCols = 0;
let lgRows = 0;

function updateLetterGrid(cols, rows) {
  const total = cols * rows;
  if (lgCols !== cols || lgRows !== rows) {
    // full rebuild on size change
    letterGrid = Array.from({ length: total }, () =>
      canvasChars[Math.floor(Math.random() * canvasChars.length)],
    );
    lgCols = cols;
    lgRows = rows;
  } else {
    // randomly shift ~2% of letters per frame for subtle drift
    const n = Math.ceil(total * 0.02);
    for (let i = 0; i < n; i++) {
      letterGrid[Math.floor(Math.random() * total)] =
        canvasChars[Math.floor(Math.random() * canvasChars.length)];
    }
  }
}

function render() {
  if (!videoAspect && video.videoWidth) {
    videoAspect = video.videoWidth / video.videoHeight;
  }

  // measure the real rendered character width — avoids the hard-coded estimate
  const style = getComputedStyle(output);
  measureCtx.font = `${style.fontSize} ${style.fontFamily}`;
  const charW = measureCtx.measureText("M").width;
  const lineH = parseFloat(style.fontSize) * 1.25;

  const maxCols = Math.max(1, Math.floor(content.offsetWidth / charW));
  const maxRows = Math.max(1, Math.floor(content.offsetHeight / lineH));

  let cols = maxCols;
  let rows = maxRows;

  if (videoAspect) {
    const rowsIfFitByWidth = Math.round(
      (maxCols * charW) / (lineH * videoAspect),
    );
    if (rowsIfFitByWidth <= maxRows) {
      rows = rowsIfFitByWidth;
    } else {
      cols = Math.round((maxRows * lineH * videoAspect) / charW);
    }
  }

  // keep video-canvas exactly over the ASCII art area, at full pixel resolution
  const asciiW = cols * charW;
  const asciiH = rows * lineH;
  const vcW = Math.round(asciiW);
  const vcH = Math.round(asciiH);
  videoCanvas.style.left   = Math.round((content.offsetWidth  - asciiW) / 2) + "px";
  videoCanvas.style.top    = Math.round((content.offsetHeight - asciiH) / 2) + "px";
  videoCanvas.style.width  = vcW + "px";
  videoCanvas.style.height = vcH + "px";
  if (videoCanvas.width !== vcW || videoCanvas.height !== vcH) {
    videoCanvas.width  = vcW;
    videoCanvas.height = vcH;
  }

  // sample canvas (tiny, for ASCII mapping)
  canvas.width  = cols;
  canvas.height = rows;

  ctx.save();
  if (state.mirror) {
    ctx.scale(-1, 1);
    ctx.drawImage(video, -cols, 0, cols, rows);
  } else {
    ctx.drawImage(video, 0, 0, cols, rows);
  }
  ctx.restore();

  const { data } = ctx.getImageData(0, 0, cols, rows);

  if (state.letterMode) {
    if (!outputFontFamily) outputFontFamily = getComputedStyle(output).fontFamily;

    // sync letter-canvas bounds to match the ASCII grid
    if (letterCanvas.width !== vcW || letterCanvas.height !== vcH) {
      letterCanvas.width  = vcW;
      letterCanvas.height = vcH;
    }
    letterCanvas.style.left = videoCanvas.style.left;
    letterCanvas.style.top  = videoCanvas.style.top;

    updateLetterGrid(cols, rows);
    letterCtx.clearRect(0, 0, vcW, vcH);
    letterCtx.fillStyle = state.color;
    letterCtx.textAlign = "center";
    letterCtx.textBaseline = "middle";

    // pass 1: bucket each cell by brightness (avoids per-cell font changes)
    const buckets = Array.from({ length: BUCKETS }, () => []);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        let b =
          (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        b = (b - 0.5) * state.contrast + 0.5;
        b = Math.max(0, Math.min(1, b));
        const t = state.threshold;
        b = b < t ? (b / t) * 0.5 : 0.5 + ((b - t) / (1 - t)) * 0.5;
        if (state.invert) b = 1 - b;
        const s = 1 - b;
        if (s < 1 / BUCKETS) continue;
        buckets[Math.min(BUCKETS - 1, Math.floor(s * BUCKETS))].push(x, y);
      }
    }

    // pass 2: one font-size set per bucket, then draw all cells in it
    for (let bk = 0; bk < BUCKETS; bk++) {
      const cells = buckets[bk];
      if (!cells.length) continue;
      letterCtx.font = `${(lineH * (bk + 1)) / BUCKETS * canvasFontScale}px ${outputFontFamily}`;
      for (let p = 0; p < cells.length; p += 2) {
        letterCtx.fillText(
          letterGrid[cells[p + 1] * cols + cells[p]],
          (cells[p] + 0.5) * charW,
          (cells[p + 1] + 0.5) * lineH,
        );
      }
    }

    output.style.display = "none";
    letterCanvas.style.display = "block";
  } else {
    output.style.display = "";
    letterCanvas.style.display = "none";
    const chars = state.charSet;
    const last = chars.length - 1;
    let text = "";
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        let b =
          (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
        b = (b - 0.5) * state.contrast + 0.5;
        b = Math.max(0, Math.min(1, b));
        const t = state.threshold;
        b = b < t ? (b / t) * 0.5 : 0.5 + ((b - t) / (1 - t)) * 0.5;
        if (state.invert) b = 1 - b;
        text += chars[Math.floor(b * last)];
      }
      if (y < rows - 1) text += "\n";
    }
    output.textContent = text;
  }

  if (state.videoLayer) {
    videoCtx.save();
    if (state.mirror) {
      videoCtx.scale(-1, 1);
      videoCtx.drawImage(video, -vcW, 0, vcW, vcH);
    } else {
      videoCtx.drawImage(video, 0, 0, vcW, vcH);
    }
    videoCtx.restore();
  }

  requestAnimationFrame(render);
}

// ── sidebar controls ──────────────────────────────────────────────────────────

function setAccent(color) {
  document.documentElement.style.setProperty("--accent", color);
}

// color buttons
document.querySelectorAll(".color-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".color-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.color = btn.dataset.color;
    output.style.color = state.color;
    setAccent(state.color);
  });
});

// char set buttons
document.querySelectorAll(".char-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".char-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (btn.dataset.mode === "letters") {
      canvasChars = LETTERS;
      canvasFontScale = 1;
      lgCols = lgRows = 0;
      state.letterMode = true;
    } else if (btn.dataset.mode === "japanese") {
      canvasChars = JAPANESE;
      canvasFontScale = 0.6;
      lgCols = lgRows = 0;
      state.letterMode = true;
    } else if (btn.dataset.mode === "binary") {
      canvasChars = BINARY;
      canvasFontScale = 1;
      lgCols = lgRows = 0;
      state.letterMode = true;
    } else {
      state.letterMode = false;
      state.charSet = btn.dataset.chars;
    }
  });
});

// threshold
document.getElementById("threshold").addEventListener("input", (e) => {
  state.threshold = parseFloat(e.target.value);
  document.getElementById("threshold-val").textContent =
    Math.round(state.threshold * 100) + "%";
});

// contrast
document.getElementById("contrast").addEventListener("input", (e) => {
  state.contrast = parseFloat(e.target.value);
  document.getElementById("contrast-val").textContent =
    state.contrast.toFixed(1) + "x";
});

// density / size
document.getElementById("size").addEventListener("input", (e) => {
  state.sizeScale = parseFloat(e.target.value);
  output.style.setProperty("--scale", state.sizeScale);
  document.getElementById("size-val").textContent =
    state.sizeScale.toFixed(1) + "x";
});

// video layer toggle
document.getElementById("videoLayer").addEventListener("change", (e) => {
  state.videoLayer = e.target.checked;
  const sub = document.getElementById("videoOpacityControl");
  sub.classList.toggle("open", state.videoLayer);
  videoCanvas.style.opacity = state.videoLayer ? state.videoOpacity : 0;
});

// video opacity
document.getElementById("videoOpacity").addEventListener("input", (e) => {
  state.videoOpacity = parseFloat(e.target.value);
  document.getElementById("video-opacity-val").textContent =
    Math.round(state.videoOpacity * 100) + "%";
  if (state.videoLayer) videoCanvas.style.opacity = state.videoOpacity;
});

// mirror
document.getElementById("mirror").addEventListener("change", (e) => {
  state.mirror = e.target.checked;
});

// invert
document.getElementById("invert").addEventListener("change", (e) => {
  state.invert = e.target.checked;
});

// randomize
document.getElementById("randomize").addEventListener("click", () => {
  const colorBtns = [...document.querySelectorAll(".color-btn")];
  colorBtns[Math.floor(Math.random() * colorBtns.length)].click();

  const charBtns = [...document.querySelectorAll(".char-btn")];
  charBtns[Math.floor(Math.random() * charBtns.length)].click();

  const threshold = document.getElementById("threshold");
  threshold.value = (Math.random() * 0.9 + 0.05).toFixed(2);
  threshold.dispatchEvent(new Event("input"));

  const contrast = document.getElementById("contrast");
  contrast.value = (Math.random() * 2 + 1).toFixed(2);
  contrast.dispatchEvent(new Event("input"));

  const size = document.getElementById("size");
  size.value = (Math.random() * 2.1 + 0.4).toFixed(2);
  size.dispatchEvent(new Event("input"));

  const mirror = document.getElementById("mirror");
  mirror.checked = Math.random() > 0.5;
  mirror.dispatchEvent(new Event("change"));

  const invert = document.getElementById("invert");
  invert.checked = Math.random() > 0.5;
  invert.dispatchEvent(new Event("change"));
});

// ── init ──────────────────────────────────────────────────────────────────────

async function init() {
  setAccent(state.color);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    status.textContent = "// live";
    requestAnimationFrame(render);
  } catch (err) {
    console.error(err);
    output.textContent = "camera access denied\nor no camera found.";
    status.textContent = "";
  }
}

init();

