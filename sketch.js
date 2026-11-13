// =====================================
// 調整用パラメータ
// 数値を変更すると作品の動きや見た目が変わります
// =====================================

// -------------------------------------
// 残像の設定
// -------------------------------------
const TRAIL_LENGTH = 20;
let isTrailEnabled = true; // 残像のON/OFF状態


// =====================================
// 描画の滑らかさ調整
// =====================================

const DRAW_SMOOTHING = 0.15;
let smoothX = 0;
let smoothY = 0;


// -------------------------------------
// 選択に関する設定
// -------------------------------------

const SELECT_DISTANCE = 20;
const SELECT_MARKER_SIZE = 12;
const SELECT_MARKER_WEIGHT = 1.5;


// -------------------------------------
// 線の太さ
// -------------------------------------

const DRAWING_STROKE = 3;
const SELECTED_STROKE = 4;


// -------------------------------------
// 球体に関する設定
// -------------------------------------

const SPHERE_RADIUS = 250;

// 正面(z=1)のとき等倍(1.0)になるように設定（描いた位置からズレません）
const SCALE_FAR = 0.3;
const SCALE_NEAR = 1.0;


// -------------------------------------
// 十字キー・速度調整の設定
// -------------------------------------

const ARROW_KEY_SPEED = 0.015;
const SPEED_STEP_UP = 1.25;    // +キーで速度を何倍にするか
const SPEED_STEP_DOWN = 0.8;   // -キーで速度を何倍にするか
const MAX_SPEED_LIMIT = 0.15;  // 速度の上限


// -------------------------------------
// 手前・奥による速度の変化
// -------------------------------------

const FAR_SPEED_MULTIPLIER = 0.5;
const NEAR_SPEED_MULTIPLIER = 1.5;


// -------------------------------------
// 右ドラッグで投げる強さ
// -------------------------------------

const THROW_POWER = 0.00015;
const MAX_THROW_SPEED = 0.08;


// -------------------------------------
// 線の色の設定
// -------------------------------------

const COLOR_CHANGE_SPEED = 0.15;
const COLOR_SATURATION = 75;
const COLOR_BRIGHTNESS_FAR = 35;
const COLOR_BRIGHTNESS_NEAR = 100;


// =====================================
// 変数
// =====================================

let copiedDrawing = null;
let drawings = [];

let currentDrawing = [];
let currentStrokes = [];

let selectedDrawing = null;
let isDragging = false;
let isRightDragging = false; // キャンバス外での右クリックメニュー防止用フラグ

let throwStartX = 0;
let throwStartY = 0;


// =====================================
// setup
// =====================================

function setup() {
  let canvas = createCanvas(800, 600);
  canvas.parent("p5");

  colorMode(HSB, 360, 100, 100, 255);

  // キャンバス上の右クリックメニューを無効化
  canvas.elt.addEventListener("contextmenu", e => e.preventDefault());

  // キャンバス外で右クリックを離したときもメニューが出ないようにする
  window.addEventListener("contextmenu", e => {
    if (isRightDragging) {
      e.preventDefault();
      isRightDragging = false;
    }
  });

  // キャンバス外でマウスボタンを離した場合のリリース処理も受け取る
  window.addEventListener("mouseup", e => {
    if (e.button === 2 && isRightDragging) {
      handleRightRelease(e.clientX, e.clientY, canvas.elt);
      // contextmenuイベントが発火し終えるまでわずかに待ってからフラグを解除する
      setTimeout(() => {
        isRightDragging = false;
      }, 50);
    }
  });

  // HTMLボタンとの連携
  const btnTrail = document.getElementById("btn-trail");
  if (btnTrail) {
    btnTrail.addEventListener("click", () => {
      toggleTrail();
      btnTrail.blur(); // ボタンを押した後にスペースキー等で誤作動しないようフォーカスを外す
    });
  }

  const btnReset = document.getElementById("btn-reset");
  if (btnReset) {
    btnReset.addEventListener("click", () => {
      resetCanvas();
      btnReset.blur();
    });
  }
}


// =====================================
// 残像の ON / OFF 切り替え関数
// =====================================

function toggleTrail() {
  isTrailEnabled = !isTrailEnabled;

  // OFFにした瞬間、溜まっている古い残像履歴を消す
  if (!isTrailEnabled) {
    for (let drawing of drawings) {
      drawing.history = [];
    }
  }

  // HTMLボタンの表示を更新
  const btnTrail = document.getElementById("btn-trail");
  if (btnTrail) {
    btnTrail.textContent = isTrailEnabled ? "Trail: ON" : "Trail: OFF";
    btnTrail.classList.toggle("active", isTrailEnabled);
  }
}


// =====================================
// リセット関数
// =====================================

function resetCanvas() {
  drawings = [];
  currentDrawing = [];
  currentStrokes = [];
  selectedDrawing = null;
}


// =====================================
// 描画データを確定して追加（または選択中の線に統合）する関数
// =====================================

function finalizeDrawing(strokesArray, mergeToSelected = false) {
  if (strokesArray.length === 0) return;

  // 選択中の線があり、Shift統合モードの場合はそのグループに統合する
  if (mergeToSelected && selectedDrawing !== null) {
    let sphereX = width / 2;
    let sphereY = height / 2;

    let orbitX = sphereX + cos(selectedDrawing.angle) * cos(selectedDrawing.verticalAngle) * SPHERE_RADIUS;
    let orbitY = sphereY + sin(selectedDrawing.verticalAngle) * SPHERE_RADIUS;
    let z = sin(selectedDrawing.angle) * cos(selectedDrawing.verticalAngle);
    let scaleValue = map(z, -1, 1, SCALE_FAR, SCALE_NEAR);

    // 選択中の線の現在の回転位置・拡大率に合わせて座標を逆算し、見た目の位置がズレないように統合する
    for (let s of strokesArray) {
      let convertedStroke = s.map(p => ({
        x: (p.x - orbitX) / scaleValue + 400,
        y: (p.y - orbitY) / scaleValue + 300
      }));
      selectedDrawing.strokes.push(convertedStroke);
    }
    return;
  }

  // 新しい線（グループ）として作成
  let newDrawing = {
    strokes: strokesArray,
    angle: HALF_PI,
    verticalAngle: 0,
    orbitSpeed: 0,
    verticalSpeed: 0,
    colorOffset: random(360),
    history: []
  };

  drawings.push(newDrawing);
  selectedDrawing = newDrawing;
}


// =====================================
// draw
// =====================================

function draw() {
  background(0, 0, 12);

  let sphereX = width / 2;
  let sphereY = height / 2;

  // =====================================
  // 保存済みの線
  // =====================================

  for (let drawing of drawings) {
    let currentZ = sin(drawing.angle) * cos(drawing.verticalAngle);
    let speedMultiplier = map(
      currentZ,
      -1,
      1,
      FAR_SPEED_MULTIPLIER,
      NEAR_SPEED_MULTIPLIER
    );

    drawing.angle += drawing.orbitSpeed * speedMultiplier;
    drawing.verticalAngle += drawing.verticalSpeed * speedMultiplier;

    let orbitX = sphereX + cos(drawing.angle) * cos(drawing.verticalAngle) * SPHERE_RADIUS;
    let orbitY = sphereY + sin(drawing.verticalAngle) * SPHERE_RADIUS;
    let z = sin(drawing.angle) * cos(drawing.verticalAngle);

    let scaleValue = map(z, -1, 1, SCALE_FAR, SCALE_NEAR);
    let lineBrightness = map(z, -1, 1, COLOR_BRIGHTNESS_FAR, COLOR_BRIGHTNESS_NEAR);
    let hue = (frameCount * COLOR_CHANGE_SPEED + drawing.colorOffset) % 360;

    if (!drawing.history) {
      drawing.history = [];
    }

    drawing.history.push({
      x: orbitX,
      y: orbitY,
      scale: scaleValue,
      hue: hue,
      brightness: lineBrightness
    });

    // 残像ONなら指定フレーム分、OFFなら最新の1フレーム分だけ保持する
    let maxHistory = isTrailEnabled ? TRAIL_LENGTH : 1;
    while (drawing.history.length > maxHistory) {
      drawing.history.shift();
    }

    noFill();
    let strokeW = (drawing === selectedDrawing) ? SELECTED_STROKE : DRAWING_STROKE;
    strokeWeight(strokeW);

    for (let i = 0; i < drawing.history.length; i++) {
      let h = drawing.history[i];
      let alpha = map(i, 0, drawing.history.length - 1, 0, 255);
      if (drawing.history.length === 1) alpha = 255;

      push();
      translate(h.x, h.y);
      scale(h.scale);
      stroke(h.hue, COLOR_SATURATION, h.brightness, alpha);

      for (let s of drawing.strokes) {
        beginShape();
        for (let p of s) {
          vertex(p.x - 400, p.y - 300);
        }
        endShape();
      }

      pop();
    }
  }

  // =====================================
  // 選択マーカーの描画
  // =====================================

  if (selectedDrawing !== null) {
    let drawing = selectedDrawing;

    let orbitX = sphereX + cos(drawing.angle) * cos(drawing.verticalAngle) * SPHERE_RADIUS;
    let orbitY = sphereY + sin(drawing.verticalAngle) * SPHERE_RADIUS;
    let z = sin(drawing.angle) * cos(drawing.verticalAngle);
    let scaleValue = map(z, -1, 1, SCALE_FAR, SCALE_NEAR);

    let centerX = 0;
    let centerY = 0;
    let totalPoints = 0;

    for (let s of drawing.strokes) {
      for (let p of s) {
        centerX += p.x;
        centerY += p.y;
        totalPoints++;
      }
    }

    if (totalPoints > 0) {
      centerX = orbitX + (centerX / totalPoints - 400) * scaleValue;
      centerY = orbitY + (centerY / totalPoints - 300) * scaleValue;

      noFill();
      stroke(0, 0, 100);
      strokeWeight(SELECT_MARKER_WEIGHT);
      circle(centerX, centerY, SELECT_MARKER_SIZE);
    }
  }

  // =====================================
  // 描画中の線
  // =====================================

  stroke(180, 100, 100);
  strokeWeight(DRAWING_STROKE);
  noFill();

  for (let s of currentStrokes) {
    beginShape();
    for (let p of s) {
      vertex(p.x, p.y);
    }
    endShape();
  }

  beginShape();
  for (let p of currentDrawing) {
    vertex(p.x, p.y);
  }
  endShape();
}


// =====================================
// マウスを押したとき
// =====================================

function mousePressed(event) {
  // キャンバス外でのクリックは無視する
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;

  if (event.button === 0) {
    isDragging = false;
    currentDrawing = [];
    smoothX = mouseX;
    smoothY = mouseY;
    currentDrawing.push({ x: smoothX, y: smoothY });
  }

  if (event.button === 2) {
    isRightDragging = true;
    throwStartX = mouseX;
    throwStartY = mouseY;
  }
}


// =====================================
// マウスを動かしたとき
// =====================================

function mouseDragged(event) {
  if (event.buttons & 1) {
    isDragging = true;
    smoothX = lerp(smoothX, mouseX, DRAW_SMOOTHING);
    smoothY = lerp(smoothY, mouseY, DRAW_SMOOTHING);
    currentDrawing.push({ x: smoothX, y: smoothY });
  }
}


// =====================================
// 右ドラッグを離したときの共通処理（キャンバス内外対応）
// =====================================

function handleRightRelease(clientX, clientY, canvasElt) {
  if (!selectedDrawing) return;

  // 画面上のマウス座標をキャンバス内の座標に変換
  let rect = canvasElt.getBoundingClientRect();
  let scaleX = width / rect.width;
  let scaleY = height / rect.height;
  let releaseX = (clientX - rect.left) * scaleX;
  let releaseY = (clientY - rect.top) * scaleY;

  let dx = releaseX - throwStartX;
  let dy = releaseY - throwStartY;

  let speedX = constrain(dx * THROW_POWER, -MAX_THROW_SPEED, MAX_THROW_SPEED);
  let speedY = constrain(-dy * THROW_POWER, -MAX_THROW_SPEED, MAX_THROW_SPEED);

  selectedDrawing.orbitSpeed = speedX;
  selectedDrawing.verticalSpeed = speedY;
}


// =====================================
// マウスを離したとき
// =====================================

function mouseReleased(event) {
  if (event.button === 0) {
    if (currentDrawing.length > 1) {
      currentStrokes.push([...currentDrawing]);
    }
    currentDrawing = [];

    if (!keyIsDown(SHIFT)) {
      finalizeDrawing(currentStrokes, false);
      currentStrokes = [];
    }
  }
}


// =====================================
// 選択
// =====================================

function mouseClicked(event) {
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  if (event.button !== 0) return;
  if (keyIsDown(SHIFT)) return;

  if (isDragging) {
    isDragging = false;
    return;
  }

  selectedDrawing = null;
  let sphereX = width / 2;
  let sphereY = height / 2;

  for (let drawing of drawings) {
    let orbitX = sphereX + cos(drawing.angle) * cos(drawing.verticalAngle) * SPHERE_RADIUS;
    let orbitY = sphereY + sin(drawing.verticalAngle) * SPHERE_RADIUS;
    let z = sin(drawing.angle) * cos(drawing.verticalAngle);
    let scaleValue = map(z, -1, 1, SCALE_FAR, SCALE_NEAR);

    for (let s of drawing.strokes) {
      for (let p of s) {
        let px = orbitX + (p.x - 400) * scaleValue;
        let py = orbitY + (p.y - 300) * scaleValue;
        let d = dist(mouseX, mouseY, px, py);

        if (d < SELECT_DISTANCE) {
          selectedDrawing = drawing;
          return;
        }
      }
    }
  }
}


// =====================================
// キーボード操作（押したとき）
// =====================================

function keyPressed(event) {
  // T キー：残像の ON / OFF
  if (event.key.toLowerCase() === "t" && !event.ctrlKey && !event.metaKey) {
    toggleTrail();
    return false;
  }

  // R キー：リセット（全消去）
  if (event.key.toLowerCase() === "r" && !event.ctrlKey && !event.metaKey) {
    resetCanvas();
    return false;
  }

  // Backspace / Delete：選択中の線を消去し、一つ前の線を選択する
  if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    if (selectedDrawing !== null) {
      let index = drawings.indexOf(selectedDrawing);
      if (index !== -1) {
        drawings.splice(index, 1);

        if (drawings.length > 0) {
          // 消した線の1つ前（0番目を消した場合は最後の線）を選択
          let prevIndex = (index - 1 + drawings.length) % drawings.length;
          selectedDrawing = drawings[prevIndex];
        } else {
          selectedDrawing = null;
        }
      } else {
        selectedDrawing = null;
      }
    }
    return false;
  }

  // 選択中の線に対する操作（十字キー・速度調整）
  if (selectedDrawing !== null) {
    // 十字キー：上下左右に移動
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectedDrawing.orbitSpeed = 0;
      selectedDrawing.verticalSpeed = -ARROW_KEY_SPEED;
      return false;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectedDrawing.orbitSpeed = 0;
      selectedDrawing.verticalSpeed = ARROW_KEY_SPEED;
      return false;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectedDrawing.orbitSpeed = ARROW_KEY_SPEED;
      selectedDrawing.verticalSpeed = 0;
      return false;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectedDrawing.orbitSpeed = -ARROW_KEY_SPEED;
      selectedDrawing.verticalSpeed = 0;
      return false;
    }

    // + / = キー：速度を上げる
    if (event.key === "+" || event.key === "=" || event.key === ";") {
      event.preventDefault();
      // 静止している場合はデフォルト速度で右方向へ動かし始める
      if (selectedDrawing.orbitSpeed === 0 && selectedDrawing.verticalSpeed === 0) {
        selectedDrawing.orbitSpeed = -ARROW_KEY_SPEED;
      } else {
        selectedDrawing.orbitSpeed = constrain(
          selectedDrawing.orbitSpeed * SPEED_STEP_UP,
          -MAX_SPEED_LIMIT,
          MAX_SPEED_LIMIT
        );
        selectedDrawing.verticalSpeed = constrain(
          selectedDrawing.verticalSpeed * SPEED_STEP_UP,
          -MAX_SPEED_LIMIT,
          MAX_SPEED_LIMIT
        );
      }
      return false;
    }

    // - キー：速度を下げる
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      selectedDrawing.orbitSpeed *= SPEED_STEP_DOWN;
      selectedDrawing.verticalSpeed *= SPEED_STEP_DOWN;
      return false;
    }
  }

  // ] キー：次の線を選択
  if (event.key === "]") {
    event.preventDefault();
    if (drawings.length === 0) return false;
    let nextIndex = (drawings.indexOf(selectedDrawing) + 1) % drawings.length;
    selectedDrawing = drawings[nextIndex];
    return false;
  }

  // [ キー：前の線を選択
  if (event.key === "[") {
    event.preventDefault();
    if (drawings.length === 0) return false;
    let previousIndex = (drawings.indexOf(selectedDrawing) - 1 + drawings.length) % drawings.length;
    selectedDrawing = drawings[previousIndex];
    return false;
  }

  // Ctrl + C：線をコピー
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
    if (selectedDrawing !== null) {
      copiedDrawing = {
        strokes: selectedDrawing.strokes.map(s => s.map(p => ({ x: p.x, y: p.y }))),
        angle: selectedDrawing.angle,
        orbitSpeed: selectedDrawing.orbitSpeed,
        verticalAngle: selectedDrawing.verticalAngle,
        verticalSpeed: selectedDrawing.verticalSpeed,
        colorOffset: selectedDrawing.colorOffset
      };
    }
    event.preventDefault();
    return false;
  }

  // Ctrl + V：線を貼り付け
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    if (copiedDrawing !== null) {
      let newDrawing = {
        strokes: copiedDrawing.strokes.map(s => s.map(p => ({ x: p.x, y: p.y }))),
        angle: HALF_PI,
        orbitSpeed: copiedDrawing.orbitSpeed,
        verticalAngle: 0,
        verticalSpeed: copiedDrawing.verticalSpeed,
        colorOffset: random(360),
        history: []
      };
      drawings.push(newDrawing);
      selectedDrawing = newDrawing;
    }
    event.preventDefault();
    return false;
  }
}


// =====================================
// キーボード操作（離したとき）
// =====================================

function keyReleased(event) {
  if (event.key === "Shift") {
    if (currentStrokes.length > 0) {
      // すでに選択中の線があればそこに統合(true)、なければ新規作成(false)
      let shouldMerge = (selectedDrawing !== null);
      finalizeDrawing(currentStrokes, shouldMerge);
      currentStrokes = [];
    }
  }
}