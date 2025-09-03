
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let x = mouseX, y = mouseY;
let vx = 0, vy = 0, scale = 1, angle = 0;
let score = 0;
let gameOver = false;

let heliSpeedStart = 2.5;
let spawnRateStart = 1800;

let heliSpeed = heliSpeedStart;
let spawnRate = spawnRateStart;
let lastSpawnTime = 0;
let lastDifficultyIncrease = 0;

const wrapper = document.getElementById("wrapper");
const scoreDisplay = document.getElementById("score");
const gameoverScreen = document.getElementById("gameover");
const finalScoreText = document.getElementById("finalScoreText");
const heliList = [];
const helis = ["heli-yellow.webp", "heli-blue.webp", "heli-white.webp"];

let highscore = localStorage.getItem("highscore") || 0;
document.getElementById("highscore").innerText = "Highscore: " + highscore;

document.addEventListener("mousemove", e => {
  mouseX = e.clientX;
  mouseY = Math.min(e.clientY, window.innerHeight * 0.8);
});

document.addEventListener("touchmove", e => {
  if (e.touches.length > 0) {
    mouseX = e.touches[0].clientX;
    mouseY = Math.min(e.touches[0].clientY, window.innerHeight * 0.8);
  }
}, { passive: false });

function updatePlayer() {
  if (gameOver) return;
  vx = (mouseX - x) * 0.1;
  vy = (mouseY - y) * 0.1;
  x += vx;
  y += vy;
  angle = Math.max(-20, Math.min(20, vx * 10));
  scale = 1 + Math.min(0.3, Math.abs(vx) / 10);
  wrapper.style.left = x + "px";
  wrapper.style.top = y + "px";
  wrapper.style.transform = `rotate(${angle}deg) scale(${scale})`;
}

function spawnHeli() {
  const img = document.createElement("img");
  img.src = helis[Math.floor(Math.random() * helis.length)];
  img.className = "heli";
  img.style.top = Math.random() * (window.innerHeight * 0.9 - 100) + "px";
  img.style.left = window.innerWidth + "px";
  img.speed = heliSpeed + Math.random();
  img.counted = false;
  document.body.appendChild(img);
  heliList.push(img);
}

function handleHelis(hitRect) {
  for (let i = heliList.length - 1; i >= 0; i--) {
    const heli = heliList[i];
    if (!heli) continue;
    let left = parseFloat(heli.style.left) - heli.speed;
    heli.style.left = left + "px";

    const rect = heli.getBoundingClientRect();

    if (!heli.counted && rect.right < hitRect.left) {
      score++;
      scoreDisplay.innerText = "Score: " + score;
      heli.counted = true;
    }

    const collided = hitRect.right > rect.left + rect.width * 0.2 &&
                     hitRect.left < rect.right - rect.width * 0.2 &&
                     hitRect.bottom > rect.top + rect.height * 0.2 &&
                     hitRect.top < rect.bottom - rect.height * 0.2;

    if (!gameOver && collided) {
      triggerGameOver(heli, hitRect);
    }

    if (left < -250) {
      heli.remove();
      heliList.splice(i, 1);
    }
  }
}

function triggerGameOver(heli, hitRect) {
  gameOver = true;

  const explosion = document.createElement("img");
  explosion.src = "explosion.gif";
  explosion.style.position = "absolute";
  explosion.style.left = ((hitRect.left + heli.getBoundingClientRect().left) / 2) + "px";
  explosion.style.top = ((hitRect.top + heli.getBoundingClientRect().top) / 2) + "px";
  explosion.style.width = "128px";
  explosion.style.height = "128px";
  explosion.style.zIndex = 99;
  document.getElementById("backgroundIcon").style.backgroundImage = "url('gif_bg2.webp')";
  document.body.appendChild(explosion);
  setTimeout(() => explosion.remove(), 1000);

  document.getElementById("background-base").style.animationPlayState = "paused";
  document.getElementById("background-overlay").style.animationPlayState = "paused";

  wrapper.style.transition = "top 1.5s ease-in";
  heli.style.transition = "top 1.5s ease-in";
  const fallY = window.innerHeight * 0.8;
  wrapper.style.top = fallY + "px";
  heli.style.top = fallY + "px";

  setTimeout(() => {
    const fire = document.createElement("img");
    fire.src = "fire.gif";
    fire.style.position = "absolute";
    fire.style.left = (hitRect.left + hitRect.width / 2 - 50) + "px";
    fire.style.top = fallY + "px";
    fire.style.width = "100px";
    fire.style.height = "100px";
    fire.style.zIndex = 9;
    document.body.appendChild(fire);
  }, 1500);

  setTimeout(() => {
    finalScoreText.innerText = "Score: " + score;
    if (score > highscore) {
      localStorage.setItem("highscore", score);
      highscore = score;
    }
    document.getElementById("highscore").innerText = "Highscore: " + highscore;

    const scoreBox = scoreDisplay.getBoundingClientRect();
    const kon = document.createElement("img");
    kon.src = "kon.gif";
    kon.style.position = "absolute";
    kon.style.left = (scoreBox.left + scoreBox.width / 2 - 150) + "px";
    kon.style.top = (scoreBox.top - 180) + "px";
    kon.style.width = "300px";
    kon.style.zIndex = "19";
    document.body.appendChild(kon);

    gameoverScreen.style.display = "block";
  }, 1200);
}

function gameLoop(timestamp) {
  if (gameOver) return;

  updatePlayer();

  const hitRect = wrapper.getBoundingClientRect();
  handleHelis(hitRect);

  if (timestamp - lastSpawnTime > spawnRate) {
    spawnHeli();
    lastSpawnTime = timestamp;
  }

  if (timestamp - lastDifficultyIncrease > 5000) {
    heliSpeed += 0.1;
    if (spawnRate > 400) spawnRate -= 100;
    lastDifficultyIncrease = timestamp;
  }

  requestAnimationFrame(gameLoop);
}

function startGame() {
  document.getElementById("startscreen").style.display = "none";
  document.getElementById("exit-btn").style.display = "block";
  restartGame();
}

function exitGame() {
  location.reload();
}

function restartGame() {
  gameOver = false;
  score = 0;
  heliSpeed = heliSpeedStart;
  spawnRate = spawnRateStart;
  lastSpawnTime = 0;
  lastDifficultyIncrease = 0;
  document.getElementById("gameover").style.display = "none";
  scoreDisplay.innerText = "Score: 0";

  heliList.forEach(h => h.remove());
  heliList.length = 0;

  document.getElementById("background-base").style.animationPlayState = "running";
  document.getElementById("background-overlay").style.animationPlayState = "running";
  document.getElementById("backgroundIcon").style.backgroundImage = "url('gif_bg.webp')";
  wrapper.style.transition = "none";
  document.querySelectorAll('img[src="fire.gif"], img[src="kon.gif"]').forEach(e => e.remove());

  updatePlayer();
  requestAnimationFrame(gameLoop);
}
