// @ts-nocheck
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, query, orderBy, limit, doc, setDoc, getDoc, onSnapshot, updateDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/9.6.1/firebase-firestore.js";

// 🔥 YOUR KEYS 🔥
const firebaseConfig = {
    apiKey: "AIzaSyBjiGs5JACrWmHqJ94z1p-DrG8IEe8RSo",
    authDomain: "math-b5a67.firebaseapp.com",
    projectId: "math-b5a67",
    storageBucket: "math-b5a67.firebasestorage.app",
    messagingSenderId: "912376971104",
    appId: "1:912376971104:web:4316153df3751060ec2805",
    measurementId: "G-MEENWX8Q10"
};

let db;
try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    console.log("Firebase Connected Successfully");
} catch(e) {
    console.error("Firebase Error:", e);
}

// VARS
window.canvas = null; window.ctx = null; window.inputField = null;
let currentRoomId = null;
let myName = "Agent";
let isHost = false;
let roomUnsub = null; 
let lastScoreSync = 0;

let state = {
    isPlaying: false, isPaused: false, score: 0, level: 1, health: 100,
    meteors: [], particles: [], lasers: [], stars: [], buildings: [], mistakes: [], floatingTexts: [], 
    shockwaves: [], // NEW: Para sa Nuke effect
    lastTime: 0, spawnTimer: 0, spawnRate: 2000, stats: { totalSolved: 0 },
    cityColor: "#2c3e50", ops: ['+'], levelKills: 0, bossSpawned: false, difficulty: 'medium',
    scoreSubmitted: false,
    freezeTimer: 0 
};

// --- SOUND ---
window.Sound = {
    ctx: null, isMuted: false, bgmOsc: null,
    init: function() {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    toggle: function() { this.isMuted = !this.isMuted; return this.isMuted; },
    playTone: function(freq, type, dur) {
        if(!this.ctx || this.isMuted) return;
        try {
            const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
            osc.type = type; osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);
            osc.connect(gain); gain.connect(this.ctx.destination);
            osc.start(); osc.stop(this.ctx.currentTime + dur);
        } catch(e){}
    },
    laser: function() { this.playTone(800, 'sine', 0.15); },
    boom: function() { this.playTone(100, 'square', 0.3); },
    error: function() { this.playTone(150, 'sawtooth', 0.2); },
    bossHit: function() { this.playTone(60, 'square', 0.5); },
    powerup: function() { this.playTone(1200, 'sine', 0.5); }, 
    nuke: function() { this.playTone(50, 'sawtooth', 0.8); }, // Deep boom for nuke
    click: function() { this.init(); this.playTone(400, 'sine', 0.05); },
    startBGM: function() {
        if (!this.ctx || this.isMuted || this.bgmOsc) return;
        try {
            this.bgmOsc = this.ctx.createOscillator(); const gain = this.ctx.createGain();
            this.bgmOsc.type = 'sawtooth'; this.bgmOsc.frequency.value = 50; 
            gain.gain.value = 0.02; 
            const filter = this.ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 400;
            this.bgmOsc.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination);
            this.bgmOsc.start();
        } catch(e) {}
    }
};

// --- MULTIPLAYER FUNCTIONS ---
window.showMultiplayerMenu = function() {
    window.Sound.click();
    const name = document.getElementById("my-name").value;
    if(!name) { alert("Please enter your name first!"); return; }
    myName = name;
    document.getElementById("start-modal").classList.add("hidden");
    document.getElementById("mp-menu-modal").classList.remove("hidden");
}

window.startSolo = function() {
    window.Sound.click();
    const name = document.getElementById("my-name").value;
    if(!name) { alert("Please enter your name first!"); return; }
    myName = name;
    captureSettings();
    startGameLogic();
}

window.createRoom = async function() {
    window.Sound.click();
    if(!db) return alert("Database not loaded. Please refresh.");
    
    try {
        captureSettings();
        const code = Math.random().toString(36).substring(2,6).toUpperCase();
        currentRoomId = code;
        isHost = true;

        await setDoc(doc(db, "rooms", code), {
            host: myName,
            players: [{name: myName, score: 0}],
            gameState: 'waiting',
            settings: { difficulty: state.difficulty, ops: state.ops }
        });
        
        enterLobbyUI(code);
    } catch(e) {
        console.error(e);
        alert("Creation Failed: " + e.message);
    }
}

window.joinRoom = async function() {
    window.Sound.click();
    const name = document.getElementById("my-name").value; 
    if(name) myName = name;
    const code = document.getElementById("join-code-input").value.toUpperCase();
    if(!code || code.length !== 4) return alert("Invalid Code (Must be 4 chars)");
    
    try {
        const roomRef = doc(db, "rooms", code);
        const roomSnap = await getDoc(roomRef);

        if(!roomSnap.exists()) return alert("Room does not exist!");
        const data = roomSnap.data();
        
        if(data.players.length >= 4) return alert("Room is full (Max 4)");
        if(data.gameState === 'playing') return alert("Game already started!");

        // Add self to players
        let players = data.players;
        players.push({name: myName, score: 0});
        
        // Copy settings
        if(data.settings) { state.difficulty = data.settings.difficulty; state.ops = data.settings.ops; }

        await updateDoc(roomRef, { players: players });
        currentRoomId = code;
        isHost = false;
        enterLobbyUI(code);
    } catch(e) {
        alert("Join Failed: " + e.message);
    }
}

function enterLobbyUI(code) {
    document.getElementById("mp-menu-modal").classList.add("hidden");
    document.getElementById("lobby-modal").classList.remove("hidden");
    document.getElementById("room-code-display").innerText = code;

    if(isHost) document.getElementById("host-start-btn").classList.remove("hidden");
    else document.getElementById("client-wait-msg").classList.remove("hidden");

    roomUnsub = onSnapshot(doc(db, "rooms", code), (docSnap) => {
        if(!docSnap.exists()) return;
        const data = docSnap.data();

        // Update Lobby List
        const list = document.getElementById("lobby-players");
        list.innerHTML = "";
        data.players.forEach(p => {
            list.innerHTML += `<div class="lobby-player-row"><span>${p.name}</span><span style="color:gold">${p.score}</span></div>`;
        });

        // Update In-Game Squad List
        const squadDiv = document.getElementById("squad-content");
        let squadHTML = "";
        data.players.forEach(p => {
            squadHTML += `<div class="squad-item"><span>${p.name}</span><span style="color:var(--neon-green)">${p.score}</span></div>`;
        });
        squadDiv.innerHTML = squadHTML;

        // Start Game Trigger
        if(data.gameState === 'playing' && !state.isPlaying) {
            startGameLogic();
        }
    });
}

window.hostStartGame = async function() {
    window.Sound.click();
    await updateDoc(doc(db, "rooms", currentRoomId), { gameState: 'playing' });
}

// --- REAL TIME SCORE SYNC ---
async function syncScore() {
    if(!currentRoomId || !state.isPlaying) return;
    
    const roomRef = doc(db, "rooms", currentRoomId);
    const roomSnap = await getDoc(roomRef);
    if(roomSnap.exists()) {
        let players = roomSnap.data().players;
        let me = players.find(p => p.name === myName);
        if(me) {
            me.score = state.score;
            await updateDoc(roomRef, { players: players });
        }
    }
}

setInterval(() => {
    if(state.isPlaying && currentRoomId && state.score > lastScoreSync) {
        lastScoreSync = state.score;
        syncScore();
    }
}, 3000); 

function captureSettings() {
    let ops = [];
    if(document.getElementById('opt-add').checked) ops.push('+');
    if(document.getElementById('opt-sub').checked) ops.push('-');
    if(document.getElementById('opt-mul').checked) ops.push('x');
    if(document.getElementById('opt-div').checked) ops.push('/');
    if(document.getElementById('opt-alg').checked) ops.push('alg');
    if(ops.length === 0) { alert("Select at least one operator!"); return; }
    state.ops = ops;

    const diffEls = document.getElementsByName('diff');
    for(let el of diffEls) { if(el.checked) state.difficulty = el.value; }
}

window.submitScore = async function() {
    window.Sound.click();
    if(state.scoreSubmitted) return; 
    const nameInput = document.getElementById("username-input");
    const name = nameInput.value;
    if(!name) { alert("Enter Codename!"); return; }
    if(!db) { alert("Database not connected."); return; }

    const btn = document.getElementById("real-submit-btn");
    btn.innerText = "UPLOADING...";

    try {
        await addDoc(collection(db, "scores"), { name: name, score: state.score, date: new Date() });
        state.scoreSubmitted = true;
        btn.innerText = "UPLOADED";
        btn.disabled = true; 
        btn.style.opacity = "0.5";
        alert("Score Uploaded!");
    } catch(e) {
        alert("Error: " + e.message);
        btn.innerText = "TRY AGAIN";
    }
};

window.showLeaderboard = async function() {
    window.Sound.click();
    document.getElementById("start-modal").classList.add("hidden");
    document.getElementById("leaderboard-modal").classList.remove("hidden");
    const list = document.getElementById("leaderboard-list");
    list.innerHTML = "Loading...";
    if(!db) { list.innerHTML = "No DB Connection"; return; }
    try {
        const q = query(collection(db, "scores"), orderBy("score", "desc"), limit(10));
        const snap = await getDocs(q);
        let html = ""; let rank = 1;
        snap.forEach(d => { 
            let data = d.data();
            html += `<div class="lb-row"><span>#${rank} ${data.name}</span><span>${data.score}</span></div>`;
            rank++;
        });
        list.innerHTML = html || "No scores yet.";
    } catch(e) { list.innerHTML = "Error loading."; }
};

// --- GAMEPLAY ---
window.startGame = function() {
    window.Sound.click();
    captureSettings();
    startGameLogic();
};

function startGameLogic() {
    window.Sound.init(); window.Sound.startBGM(); 
    state.isPlaying = true; state.isPaused = false;
    state.score = 0; state.level = 1; state.health = 100;
    state.meteors = []; state.particles = []; state.lasers = []; state.mistakes = []; 
    state.floatingTexts = []; 
    state.shockwaves = []; // Reset shockwaves
    state.stats = { totalSolved: 0 };
    state.freezeTimer = 0; 
    
    if(state.difficulty === 'easy') state.spawnRate = 2500;
    else if(state.difficulty === 'hard') state.spawnRate = 1200;
    else state.spawnRate = 2000;

    state.levelKills = 0; state.bossSpawned = false;
    generateCity();

    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    if(currentRoomId) document.getElementById("squad-list").style.display = "block"; 
    document.getElementById("boss-warning").style.display = 'none';
    document.getElementById("submit-area").style.display = 'block'; 
    
    state.scoreSubmitted = false;
    const btn = document.getElementById("real-submit-btn");
    btn.innerText = "UPLOAD SCORE"; btn.disabled = false; btn.style.opacity = "1";

    inputField.value = ""; inputField.focus();
    updateHUD(); 
    
    state.lastTime = performance.now();
    state.spawnTimer = performance.now(); 

    // Instant Spawn
    spawnMeteor(0, 0, false); 

    requestAnimationFrame(gameLoop);
};

window.togglePause = function() {
    window.Sound.click();
    if(!state.isPlaying) return;
    state.isPaused = !state.isPaused;
    if(state.isPaused) {
        document.getElementById("pause-modal").classList.remove("hidden");
        inputField.blur();
    } else {
        document.getElementById("pause-modal").classList.add("hidden");
        inputField.focus();
        state.lastTime = performance.now();
        requestAnimationFrame(gameLoop);
    }
};

window.goHome = function() {
    window.Sound.click();
    state.isPlaying = false; state.isPaused = false;
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
    document.getElementById("start-modal").classList.remove("hidden");
    document.getElementById("leaderboard-modal").classList.add("hidden");
    document.getElementById("squad-list").style.display = "none";
    currentRoomId = null;
    inputField.blur();
};

window.toggleMute = function() { window.Sound.click(); let m = window.Sound.toggle(); document.getElementById("mute-btn").innerText = m ? "🔇" : "🔊"; };
window.toggleMistakes = function() {
    window.Sound.click();
    const list = document.getElementById("mistakes-log");
    list.style.display = (list.style.display === "none") ? "block" : "none";
};

// --- INITIALIZATION ---
window.onload = function() {
    try {
        window.canvas = document.getElementById("gameCanvas");
        window.ctx = window.canvas.getContext("2d");
        window.inputField = document.getElementById("player-input");
        resize();
        window.addEventListener('resize', resize);
        window.addEventListener('click', (e) => {
            window.Sound.init();
            if(state.isPlaying && !state.isPaused && e.target.tagName !== "BUTTON" && e.target.tagName !== "INPUT") inputField.focus();
        });
        document.getElementById("game-form").addEventListener("submit", function(e) {
            e.preventDefault(); if (!state.isPlaying || state.isPaused) return;
            fireLaser(inputField.value); inputField.value = ""; return false;
        });
    } catch(e) { console.error(e); }
};

function resize() { window.canvas.width = window.innerWidth; window.canvas.height = window.innerHeight; if(state.isPlaying) generateCity(); initStars(); }

// --- GAME LOGIC ---
function generateMath(isBoss) {
    let diff = state.difficulty;
    let availableOps = state.ops;
    if(diff === 'easy' && Math.random() > 0.3) {
        availableOps = state.ops.filter(op => op === '+' || op === '-');
        if(availableOps.length === 0) availableOps = state.ops; 
    }
    
    let type = availableOps[Math.floor(Math.random() * availableOps.length)];
    if (isBoss) type = 'alg';

    let q, a;
    let min = 1;
    let max = 9; 

    if (diff === 'medium') { max = 20; }
    if (diff === 'hard') { max = 50; min = 10; }
    
    max += state.level * 2; 

    if (type === 'alg') {
        let x = Math.floor(Math.random() * max) + min; 
        let subType = Math.floor(Math.random() * 3); 
        if (subType === 0) { let b = Math.floor(Math.random() * max) + 1; q = `x + ${b} = ${x+b}`; a = x; }
        else if (subType === 1) { let c = Math.floor(Math.random() * max) + x + 1; q = `${c} - x = ${c-x}`; a = x; }
        else { let m = Math.floor(Math.random() * 5) + 2; q = `${m}x = ${m*x}`; a = x; }
    } else if (type === 'x') {
        let mMax = (diff === 'easy') ? 5 : (diff === 'hard') ? 12 : 9;
        let n1 = Math.floor(Math.random() * mMax) + 2;
        let n2 = Math.floor(Math.random() * mMax) + 2;
        q = `${n1} x ${n2}`; a = n1 * n2;
    } else if (type === '/') {
        let ans = Math.floor(Math.random() * (diff === 'hard' ? 15 : 9)) + 2;
        let div = Math.floor(Math.random() * (diff === 'hard' ? 12 : 5)) + 2;
        q = `${ans*div} ÷ ${div}`; a = ans;
    } else if (type === '-') {
        let n1 = Math.floor(Math.random() * max) + min;
        let n2 = Math.floor(Math.random() * max) + min;
        if(n1 < n2) [n1, n2] = [n2, n1]; 
        q = `${n1} - ${n2}`; a = n1 - n2;
    } else { 
        let n1 = Math.floor(Math.random() * max) + min;
        let n2 = Math.floor(Math.random() * max) + min;
        q = `${n1} + ${n2}`; a = n1 + n2;
    }
    return { q, a };
}

function spawnMeteor(x, y, isFromBoss) {
    let math, unique = false, attempts = 0;
    while(!unique && attempts < 20) {
        math = generateMath(false);
        if(!state.meteors.some(m => m.answer === math.a)) unique = true;
        attempts++;
    }

    let sx = isFromBoss ? x : Math.random() * (window.canvas.width - 60) + 30;
    let sy = isFromBoss ? y : -40; 
    
    let baseSpeed = 0.5;
    if (state.difficulty === 'medium') baseSpeed = 1.0;
    if (state.difficulty === 'hard') baseSpeed = 1.8;
    
    let levelSpeed = baseSpeed + (state.level * 0.3); 
    let variance = 0.8 + (Math.random() * 0.4); 
    let finalSpeed = levelSpeed * variance;

    let hp = 1;
    let isArmored = false;
    
    if (!isFromBoss && state.difficulty !== 'easy') {
        let chance = state.difficulty === 'hard' ? 0.25 : 0.10;
        if (Math.random() < chance) {
            hp = 2;
            isArmored = true;
        }
    }

    state.meteors.push({
        x: sx, y: sy, 
        question: math.q, answer: math.a, 
        speed: finalSpeed, 
        radius: isArmored ? 50 : 40,
        rot: Math.random(), rotSpeed: 0.02, 
        isBoss: false, 
        hp: hp, maxHp: hp,
        isArmored: isArmored
    });
}

function spawnBoss() {
    let math = generateMath(true);
    let bossTier = Math.floor(state.level / 5); 
    let baseRadius = 90;
    let growth = bossTier * 15; 
    let finalRadius = baseRadius + growth;
    if(finalRadius > 200) finalRadius = 200; 
    let bossHP = 3 + (bossTier * 2);

    state.meteors.push({
        x: window.canvas.width / 2, 
        y: 100, question: math.q, answer: math.a, speed: 0, radius: finalRadius, 
        rot: 0, rotSpeed: 0.01, isBoss: true, hp: bossHP, maxHp: bossHP, 
        nextFire: performance.now() + 2000
    });
}

// --- UPDATED POWERUPS (MINI NUKE / REPAIR / FREEZE) ---
function triggerPowerup(x, y) {
    let type = Math.random();
    window.Sound.powerup();
    
    if (type < 0.4) {
        // REPAIR: +3 HP
        state.health = Math.min(state.health + 3, 100);
        state.floatingTexts.push({x: x, y: y, text: "💚 +3 HP", life: 1.0, color: "#00ff41"});
    } else if (type < 0.7) {
        // FREEZE: 3 Seconds
        state.freezeTimer = 3000; 
        state.floatingTexts.push({x: x, y: y, text: "❄️ 3s FREEZE", life: 1.0, color: "#00f3ff"});
    } else {
        // MINI-NUKE (Blast Radius)
        // Add visual shockwave
        state.shockwaves.push({x: x, y: y, radius: 10, maxRadius: 300, alpha: 1.0});
        window.Sound.nuke();
        
        let blastRadius = 300; // Pixels
        let killedCount = 0;

        // Iterate backwards to safely remove items
        for (let i = state.meteors.length - 1; i >= 0; i--) {
            let m = state.meteors[i];
            // Don't kill Boss or the one that just died (it's already handled)
            if (m.isBoss) continue; 

            // Distance Formula
            let dx = m.x - x;
            let dy = m.y - y;
            let dist = Math.sqrt(dx*dx + dy*dy);

            if (dist < blastRadius) {
                createParticles(m.x, m.y, "orange", 20);
                state.meteors.splice(i, 1);
                state.score += 10;
                killedCount++;
            }
        }
        state.floatingTexts.push({x: x, y: y, text: `💣 BOOM x${killedCount}`, life: 1.0, color: "orange"});
    }
}

function fireLaser(val) {
    if (val === "") return;
    let ans = parseInt(val);
    let idx = state.meteors.findIndex(m => m.answer === ans);

    if (idx !== -1) {
        let m = state.meteors[idx];
        state.lasers.push({x1:window.canvas.width/2, y1:window.canvas.height-50, x2:m.x, y2:m.y, life:1.0});
        window.Sound.laser(); m.hp--;
        
        if(m.hp <= 0) {
            // KILL EVENT
            if(m.isBoss) {
                window.Sound.boom(); createParticles(m.x, m.y, "#bc13fe", 50);
                state.meteors = []; state.level++; state.levelKills = 0; state.bossSpawned = false; state.score += 100;
            } else {
                // POWERUP CHECK
                if (m.isArmored) {
                    triggerPowerup(m.x, m.y);
                }

                window.Sound.boom(); createParticles(m.x, m.y, "#f1c40f", 15);
                state.meteors.splice(idx, 1); state.score += 10; state.stats.totalSolved++;
                if (!state.bossSpawned) {
                    state.levelKills++;
                    if (state.level % 5 !== 0 && state.levelKills >= 10) { state.level++; state.levelKills = 0; }
                }
            }
        } else {
            // HIT BUT NOT DEAD
            window.Sound.bossHit(); createParticles(m.x, m.y, "#fff", 10);
            if(!m.isBoss) {
                 let nm = generateMath(false); m.question = nm.q; m.answer = nm.a;
            } else {
                 let nm = generateMath(true); m.question = nm.q; m.answer = nm.a;
            }
        }
    } else {
        window.Sound.error(); state.health -= 10;
        if(state.health <= 0) gameOver();
        inputField.style.borderColor = "red"; setTimeout(()=>inputField.style.borderColor="#00ff41", 200);
    }
    updateHUD();
}

function gameOver() {
    state.isPlaying = false; inputField.blur(); window.Sound.boom();
    document.getElementById("rep-score").innerText = state.score;
    document.getElementById("rep-solved").innerText = state.stats.totalSolved;
    
    const listLog = document.getElementById("mistakes-log");
    listLog.innerHTML = "";
    if(state.mistakes.length > 0) {
        document.getElementById("view-mistakes-btn").classList.remove("hidden");
        state.mistakes.forEach(m => {
            listLog.innerHTML += `<div class="log-item"><span style="color:var(--neon-red)">${m.q}</span><span style="color:var(--neon-green)">Ans: ${m.a}</span></div>`;
        });
    } else { document.getElementById("view-mistakes-btn").classList.add("hidden"); }
    document.getElementById("report-modal").classList.remove("hidden");
}

function updateHUD() {
    document.getElementById("score-txt").innerText = state.score;
    document.getElementById("level-txt").innerText = state.level;
    document.getElementById("health-txt").innerText = state.health + "%";
}

function createParticles(x, y, color, count) {
    let limit = 15; 
    if(count > limit) count = limit;
    for(let i=0; i<count; i++) state.particles.push({ x:x, y:y, vx:(Math.random()-0.5)*10, vy:(Math.random()-0.5)*10, life:1.0, color:color, size:Math.random()*4+2 });
}

function generateCity() {
    state.buildings = []; 
    let x = 0;
    while(x < window.canvas.width) {
        let w = Math.random() * 60 + 40; 
        let h = Math.random() * 150 + 50; 
        let type = Math.floor(Math.random() * 3); 
        
        let wins = [];
        for(let wx = 5; wx < w - 5; wx += 10) {
            for(let wy = 10; wy < h - 10; wy += 20) {
                if(Math.random() > 0.4) wins.push({rx: wx, ry: wy, lit: Math.random() > 0.8});
            }
        }
        state.buildings.push({x: x, w: w, h: h, type: type, wins: wins}); 
        x += w - 5; 
    }
}

function drawCity() {
    let baseColor = state.health > 50 ? "#2c3e50" : (state.health > 20 ? "#50302c" : "#501010");
    let glowColor = state.health > 50 ? "#4cc9f0" : "#f72585"; 

    state.buildings.forEach(b => {
        let y = window.canvas.height - b.h;
        // Optimized Drawing (No ShadowBlur for city)
        window.ctx.fillStyle = "#0a0a12"; 
        window.ctx.fillRect(b.x, y, b.w, b.h);
        window.ctx.strokeStyle = baseColor;
        window.ctx.lineWidth = 2;
        window.ctx.strokeRect(b.x, y, b.w, b.h);
        
        b.wins.forEach(w => {
            window.ctx.fillStyle = w.lit ? glowColor : "#1a1a2e";
            window.ctx.fillRect(b.x + w.rx, window.canvas.height - b.h + w.ry, 4, 8);
        });
        if(b.type === 1) {
            window.ctx.strokeStyle = glowColor;
            window.ctx.beginPath();
            window.ctx.moveTo(b.x + b.w/2, y);
            window.ctx.lineTo(b.x + b.w/2, y - 30);
            window.ctx.stroke();
            if(Math.floor(Date.now() / 500) % 2 === 0) {
                window.ctx.fillStyle = "red";
                window.ctx.fillRect(b.x + b.w/2 - 2, y - 35, 4, 4);
            }
        }
    });
}

function initStars() {
    state.stars = []; for(let i=0;i<100;i++) state.stars.push({x:Math.random()*window.canvas.width, y:Math.random()*window.canvas.height, size:Math.random()*2, speed:Math.random()*0.8});
}

function gameLoop(time) {
    if(!state.isPlaying || state.isPaused) return;
    let dt = time - state.lastTime; state.lastTime = time;

    if (state.freezeTimer > 0) {
        state.freezeTimer -= dt;
    }

    let bgGrad = window.ctx.createRadialGradient(
        window.canvas.width / 2, window.canvas.height, 0, 
        window.canvas.width / 2, window.canvas.height, window.canvas.height
    );
    bgGrad.addColorStop(0, "#240b36"); 
    bgGrad.addColorStop(1, "#000000"); 

    window.ctx.fillStyle = bgGrad;
    window.ctx.fillRect(0, 0, window.canvas.width, window.canvas.height);

    window.ctx.fillStyle = "white";
    state.stars.forEach(s => {
        window.ctx.globalAlpha = Math.random()*0.5+0.2;
        window.ctx.fillRect(s.x, s.y, s.size, s.size);
        s.y += s.speed; if(s.y > window.canvas.height) s.y=0;
    });
    window.ctx.globalAlpha = 1.0;

    drawCity();

    if(state.level % 5 === 0 && !state.bossSpawned) {
        spawnBoss(); state.bossSpawned = true;
        document.getElementById("boss-warning").style.display = "block";
        setTimeout(()=>document.getElementById("boss-warning").style.display="none", 3000);
    }
    else if(state.level % 5 !== 0 && time - state.spawnTimer > state.spawnRate) {
        spawnMeteor(0, 0, false); state.spawnTimer = time;
    }

    // DRAW TURRET
    let cx = window.canvas.width / 2;
    let cy = window.canvas.height;
    window.ctx.fillStyle = "#222";
    window.ctx.beginPath();
    window.ctx.moveTo(cx - 50, cy);
    window.ctx.lineTo(cx - 30, cy - 40);
    window.ctx.lineTo(cx + 30, cy - 40);
    window.ctx.lineTo(cx + 50, cy);
    window.ctx.fill();
    window.ctx.strokeStyle = "#00ff41";
    window.ctx.lineWidth = 2;
    window.ctx.stroke();
    window.ctx.fillStyle = "#111";
    window.ctx.fillRect(cx - 10, cy - 80, 20, 50);
    let pulse = Math.abs(Math.sin(time / 200));
    window.ctx.fillStyle = `rgba(0, 255, 65, ${pulse})`;
    window.ctx.fillRect(cx - 6, cy - 75, 12, 40);
    window.ctx.save();
    window.ctx.translate(cx, cy - 30);
    window.ctx.rotate(time / 1000);
    window.ctx.strokeStyle = "#444";
    window.ctx.beginPath();
    window.ctx.arc(0, 0, 40, 0, Math.PI + 1); 
    window.ctx.stroke();
    window.ctx.restore();

    // DRAW ENEMIES
    for(let i=state.meteors.length-1; i>=0; i--) {
        let m = state.meteors[i];
        
        if (m.isBoss) {
            m.x += Math.sin(time/500) * 1.5; 
            if (time > m.nextFire) { spawnMeteor(m.x, m.y, true); m.nextFire = time + 2000; }
        } else { 
            if (state.freezeTimer <= 0) {
                m.y += m.speed; 
                m.rot += m.rotSpeed; 
            }
        }

        window.ctx.save(); 
        window.ctx.translate(m.x, m.y);
        if(!m.isBoss) window.ctx.rotate(Math.sin(time / 200) * 0.2); 
        
        let r = m.radius;
        let colorMain = m.isBoss ? "#d000ff" : "#ff0055";

        // OPTIMIZED DRAWING (No heavy glows)
        if (state.freezeTimer <= 0 || m.isBoss) {
            window.ctx.fillStyle = "orange";
            window.ctx.beginPath();
            window.ctx.moveTo(-10, 10);
            window.ctx.lineTo(0, 30 + Math.random() * 10); 
            window.ctx.lineTo(10, 10);
            window.ctx.fill();
        }

        window.ctx.fillStyle = "#aaddff"; 
        window.ctx.beginPath();
        window.ctx.arc(0, -5, r * 0.6, Math.PI, 0);
        window.ctx.fill();

        let grad = window.ctx.createLinearGradient(-r, 0, r, 0);
        if (m.isArmored) {
            grad.addColorStop(0, "#8e44ad");
            grad.addColorStop(0.5, "#f1c40f");
            grad.addColorStop(1, "#8e44ad");
        } else {
            grad.addColorStop(0, "#333");
            grad.addColorStop(0.5, "#888"); 
            grad.addColorStop(1, "#333");
        }
        window.ctx.fillStyle = grad;
        window.ctx.beginPath();
        window.ctx.ellipse(0, 5, r, r * 0.35, 0, 0, Math.PI * 2);
        window.ctx.fill();

        // Lights
        window.ctx.rotate(time / 500); 
        for(let j=0; j<4; j++) {
            window.ctx.rotate(Math.PI/2);
            window.ctx.fillStyle = colorMain;
            window.ctx.beginPath();
            window.ctx.arc(r * 0.7, 0, 5, 0, Math.PI*2);
            window.ctx.fill();
        }
        
        window.ctx.restore();

        // TEXT (Plain white, shadow blur removed for speed)
        window.ctx.fillStyle="white";
        window.ctx.font = m.isBoss ? "bold 32px 'Rajdhani'" : "bold 26px 'Rajdhani'";
        window.ctx.textAlign="center"; window.ctx.textBaseline="middle"; 
        window.ctx.fillText(m.question, m.x, m.y - 30); 
        
        if(m.isBoss) { window.ctx.font="20px 'Rajdhani'"; window.ctx.fillStyle="gold"; window.ctx.fillText(`HP: ${m.hp}/${m.maxHp}`, m.x, m.y + m.radius + 30); }

        // Collision
        if(m.y > window.canvas.height) {
            state.health -= 20; if(state.health < 0) state.health = 0;
            state.mistakes.push({q: m.question, a: m.answer});
            window.Sound.boom(); createParticles(m.x, window.canvas.height, "red", 20);
            state.meteors.splice(i,1); updateHUD();
            if(state.health === 0) gameOver();
        }
    }

    // DRAW LASERS (Optimized)
    window.ctx.globalCompositeOperation = 'lighter'; 
    for(let i=state.lasers.length-1; i>=0; i--){
        let l = state.lasers[i]; 
        l.life -= 0.08;
        
        if(l.life > 0) {
            window.ctx.beginPath();
            window.ctx.moveTo(l.x1, l.y1);
            window.ctx.lineTo(l.x2, l.y2);
            window.ctx.strokeStyle = "white";
            window.ctx.lineWidth = 4;
            window.ctx.stroke();

            window.ctx.strokeStyle = `rgba(0, 255, 65, ${l.life})`;
            window.ctx.lineWidth = 14;
            window.ctx.stroke();
            
            window.ctx.fillStyle = "white";
            window.ctx.beginPath();
            window.ctx.arc(l.x2, l.y2, 15 * l.life, 0, Math.PI*2);
            window.ctx.fill();
        } else { 
            state.lasers.splice(i,1); 
        }
    }
    window.ctx.globalCompositeOperation = 'source-over'; 

    // PARTICLES
    for(let i=state.particles.length-1; i>=0; i--){
        let p=state.particles[i]; p.x+=p.vx; p.y+=p.vy; p.life-=0.03;
        window.ctx.fillStyle=p.color; window.ctx.globalAlpha=p.life;
        window.ctx.beginPath(); window.ctx.arc(p.x,p.y,p.size,0,Math.PI*2); window.ctx.fill();
        if(p.life<=0) state.particles.splice(i,1);
    }
    window.ctx.globalAlpha=1.0;

    // NEW: DRAW SHOCKWAVES (Visual for Nuke)
    for(let i=state.shockwaves.length-1; i>=0; i--){
        let sw = state.shockwaves[i];
        sw.radius += 10; // Expand
        sw.alpha -= 0.05; // Fade
        if(sw.alpha > 0) {
            window.ctx.beginPath();
            window.ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI*2);
            window.ctx.strokeStyle = `rgba(255, 165, 0, ${sw.alpha})`;
            window.ctx.lineWidth = 5;
            window.ctx.stroke();
        } else {
            state.shockwaves.splice(i, 1);
        }
    }

    // DRAW FLOATING TEXTS
    for(let i=state.floatingTexts.length-1; i>=0; i--){
        let ft = state.floatingTexts[i];
        ft.y -= 1; 
        ft.life -= 0.02;
        window.ctx.fillStyle = ft.color;
        window.ctx.font = "bold 24px Arial";
        window.ctx.globalAlpha = ft.life;
        window.ctx.fillText(ft.text, ft.x, ft.y);
        window.ctx.globalAlpha = 1.0;
        if(ft.life <= 0) state.floatingTexts.splice(i,1);
    }

    requestAnimationFrame(gameLoop);
}