const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// NEU: Offscreen Canvas für das dynamische Licht (Sichtfeld & Feuer)
const lightCanvas = document.createElement('canvas');
const lightCtx = lightCanvas.getContext('2d');

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    lightCanvas.width = window.innerWidth;
    lightCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// --- SPIELER & STATUS ---
const player = {
    worldX: 2000, worldY: 0, size: 40, speed: 8,
    hitbox: { w: 24, h: 16, offsetX: -12, offsetY: -8 },
    facingX: 0, facingY: 1
};

let inventoryOpen = false;
let selectedSlot = 0; 
const inventorySlots = new Array(20).fill(null);
const itemNames = { 'wood': 'Holz', 'stone': 'Stein', 'crystal': 'Kristall' };

const keys = {};
const droppedItems = [];
const worldObjects = [];
const groundDetails = [];
const lakes = [];
const particles = []; // NEU: Partikelsystem für Staubwolke
let nearbyItemIndex = -1;

const baseBoundaries = [6000, 14000];
const rangeX = [-10000, 30000];
const rangeY = [-20000, 20000];

// --- INPUT HANDLING ---
window.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'r' && !e.repeat) inventoryOpen = !inventoryOpen;
    if (e.key.toLowerCase() === 'e' && !e.repeat) pickupItem();
    if (e.key.toLowerCase() === 'q' && !e.repeat) dropItem();
    if (e.key >= '1' && e.key <= '5') selectedSlot = parseInt(e.key) - 1;
    keys[e.key] = true;
});
window.addEventListener('keyup', e => keys[e.key] = false);

window.addEventListener('mousedown', e => {
    const invBtnX = canvas.width - 150, pickBtnY = canvas.height - 110, invY = canvas.height - 60;
    if (e.clientX >= invBtnX && e.clientX <= invBtnX + 130 && e.clientY >= invY && e.clientY <= invY + 40) {
        inventoryOpen = !inventoryOpen; return;
    }
    if (nearbyItemIndex !== -1 && !inventoryOpen && e.clientX >= invBtnX && e.clientX <= invBtnX + 130 && e.clientY >= pickBtnY && e.clientY <= pickBtnY + 40) {
        pickupItem();
    }
});

// --- LOGIK ---

function isPointInLake(x, y) {
    for (let lake of lakes) {
        if (Math.abs(x - lake.x) > 600 || Math.abs(y - lake.y) > 600) continue;
        const dx = x - lake.x, dy = y - lake.y;
        const cos = Math.cos(-lake.rotation), sin = Math.sin(-lake.rotation);
        if (((dx*cos - dy*sin)**2) / (lake.radiusX**2) + ((dx*sin + dy*cos)**2) / (lake.radiusY**2) <= 1) return true;
    }
    return false;
}

function pickupItem() {
    if (nearbyItemIndex !== -1) {
        const item = droppedItems[nearbyItemIndex];
        let exSlot = inventorySlots.find(s => s && s.type === item.type);
        if (exSlot) { exSlot.count++; droppedItems.splice(nearbyItemIndex, 1); } 
        else {
            const empty = inventorySlots.indexOf(null);
            if (empty !== -1) { inventorySlots[empty] = { type: item.type, count: 1 }; droppedItems.splice(nearbyItemIndex, 1); }
        }
        nearbyItemIndex = -1;
    }
}

function dropItem() {
    if (inventoryOpen) return;
    const slot = inventorySlots[selectedSlot];
    if (slot && slot.count > 0) {
        let tX = player.worldX + player.facingX * 70, tY = player.worldY + player.facingY * 70;
        if (isPointInLake(tX, tY)) { tX = player.worldX; tY = player.worldY; }
        
        droppedItems.push({
            type: slot.type, x: player.worldX, y: player.worldY, z: 0,
            isAnim: true, sX: player.worldX, sY: player.worldY,
            tX: tX, tY: tY, timer: 0
        });

        slot.count--;
        if (slot.count <= 0) inventorySlots[selectedSlot] = null;
    }
}

// NEU: Partikel für Staubwolke spawnen
function spawnDustCloud(x, y) {
    for (let i = 0; i < 15; i++) {
        particles.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5 - 1,
            life: 1.0,
            size: 4 + Math.random() * 8
        });
    }
}

// NEU: In-World Crafting Logik
function checkInWorldCrafting(newItem) {
    for (let i = droppedItems.length - 1; i >= 0; i--) {
        const other = droppedItems[i];
        if (other === newItem || other.isAnim) continue; // Nichts craften was noch fliegt
        
        // Prüfen, ob nah genug dran (40 Pixel Radius)
        const dist = Math.hypot(newItem.x - other.x, newItem.y - other.y);
        if (dist < 40) {
            // Rezept: Holz + Stein = Lagerfeuer
            if ((newItem.type === 'stone' && other.type === 'wood') || 
                (newItem.type === 'wood' && other.type === 'stone')) {
                
                // 1. Anderes Item löschen (das geworfene wird in update() gelöscht)
                droppedItems.splice(i, 1);
                
                // 2. Lagerfeuer in die Welt setzen
                worldObjects.push({
                    type: 'campfire',
                    x: (newItem.x + other.x) / 2, // Mitte zwischen beiden Items
                    y: (newItem.y + other.y) / 2,
                    hitbox: { w: 20, h: 20, offsetX: -10, offsetY: -10 }
                });

                // 3. Effekt abspielen
                spawnDustCloud(newItem.x, newItem.y);
                return true;
            }
        }
    }
    return false;
}

function getBoundaryX(idx, y) {
    const b = baseBoundaries[idx];
    return b + Math.sin(y / 12000) * 400 + Math.sin(y / 5000) * 150 + Math.sin(y / 1500) * 30;
}

function generateWorld() {
    for (let i = 0; i < 400; i++) {
        const x = Math.random() * (rangeX[1] - rangeX[0]) + rangeX[0], y = Math.random() * (rangeY[1] - rangeY[0]) + rangeY[0];
        if (Math.random() < ((x < getBoundaryX(0, y)) ? 0.5 : (x < getBoundaryX(1, y) ? 0.08 : 0.25))) {
            const inDes = (x >= getBoundaryX(0, y) && x < getBoundaryX(1, y));
            lakes.push({ x, y, radiusX: 120 + Math.random() * 350, radiusY: 100 + Math.random() * 200, rotation: Math.random() * Math.PI, color: inDes ? "#0077be" : (x >= getBoundaryX(1, y) ? "#add8e6" : "#1e90ff"), isOasis: inDes });
        }
    }
    for (let i = 0; i < 12000; i++) {
        const x = Math.random() * (rangeX[1] - rangeX[0]) + rangeX[0], y = Math.random() * (rangeY[1] - rangeY[0]) + rangeY[0];
        if (isPointInLake(x, y)) continue;
        const inW = x < getBoundaryX(0, y), inD = x >= getBoundaryX(0, y) && x < getBoundaryX(1, y);
        let p = null;
        if (inW) { if (Math.random() > 0.15) p = { type: 'tree', leafColor: getVariationColor("#1b3d1b", 40), trunkColor: "#4d2a1b", trunkHeight: 60 + Math.random()*50, size: 30 + Math.random()*25, hitbox: {w:16, h:16, offsetX:-8, offsetY:-8} }; }
        else if (inD) {
            let nO = false; lakes.forEach(l => { if (l.isOasis && Math.hypot(x - l.x, y - l.y) < l.radiusX + 150) nO = true; });
            if (nO && Math.random() > 0.4) p = { type: 'palm', size: 45, hitbox: {w:15, h:15, offsetX:-7, offsetY:-7} };
            else if (!nO && Math.random() < 0.2) p = { type: 'cactus', color: "#27ae60", size: 20+Math.random()*20, hitbox: {w:12, h:12, offsetX:-6, offsetY:-6} };
        } else { if (Math.random() < 0.2) p = { type: 'ice', color: "#d1f2eb", size: 25, hitbox: {w:20, h:15, offsetX:-10, offsetY:-5} }; }
        if (p) worldObjects.push({ x, y, ...p });
    }
    for (let i = 0; i < 20000; i++) {
        const x = Math.random() * (rangeX[1] - rangeX[0]) + rangeX[0], y = Math.random() * (rangeY[1] - rangeY[0]) + rangeY[0];
        if (isPointInLake(x, y)) continue;
        let nO = false; if (x >= getBoundaryX(0,y) && x < getBoundaryX(1,y)) lakes.forEach(l => { if (l.isOasis && Math.hypot(x-l.x, y-l.y) < l.radiusX + 100) nO = true; });
        groundDetails.push({ x, y, color: nO ? getVariationColor("#4d7821", 30) : (x < getBoundaryX(0, y) ? getVariationColor("#2d5a27", 40) : (x < getBoundaryX(1, y) ? getVariationColor("#edc9af", 30) : getVariationColor("#ffffff", 20))), size: 2 + Math.random() * 4 });
    }
    for (let i = 0; i < 1500; i++) {
        const x = Math.random() * (rangeX[1] - rangeX[0]) + rangeX[0], y = Math.random() * (rangeY[1] - rangeY[0]) + rangeY[0];
        if (!isPointInLake(x, y)) droppedItems.push({ x, y, type: (x < getBoundaryX(0, y) ? 'wood' : (x < getBoundaryX(1, y) ? 'stone' : 'crystal')) });
    }
}

function update() {
    if (inventoryOpen) return;
    let nX = player.worldX, nY = player.worldY;
    if (keys['ArrowUp']) { nY -= player.speed; player.facingX = 0; player.facingY = -1; }
    if (keys['ArrowDown']) { nY += player.speed; player.facingX = 0; player.facingY = 1; }
    if (keys['ArrowLeft']) { nX -= player.speed; player.facingX = -1; player.facingY = 0; }
    if (keys['ArrowRight']) { nX += player.speed; player.facingX = 1; player.facingY = 0; }

    const checkC = (tx, ty) => {
        if (isPointInLake(tx, ty)) return true;
        const pB = { x: tx - 12, y: ty - 8, w: 24, h: 16 };
        for (let o of worldObjects) {
            if (Math.abs(o.x - tx) > 100 || Math.abs(o.y - ty) > 100) continue;
            const oB = { x: o.x + o.hitbox.offsetX, y: o.y + o.hitbox.offsetY, w: o.hitbox.w, h: o.hitbox.h };
            if (pB.x < oB.x + oB.w && pB.x + pB.w > oB.x && pB.y < oB.y + oB.h && pB.y + pB.h > oB.y) return true;
        }
        return false;
    };

    if (!checkC(nX, player.worldY)) player.worldX = nX;
    if (!checkC(player.worldX, nY)) player.worldY = nY;

    // Items animieren & Crafting prüfen
    for (let i = droppedItems.length - 1; i >= 0; i--) {
        const it = droppedItems[i];
        if (it.isAnim) {
            it.timer += 1;
            const prog = it.timer / 20;
            if (prog >= 1) { 
                it.isAnim = false; it.x = it.tX; it.y = it.tY; it.z = 0; 
                // Wenn Item gelandet ist -> Prüfen ob es mit etwas in der Nähe reagiert
                if (checkInWorldCrafting(it)) {
                    droppedItems.splice(i, 1); // Geworfenes Item löschen, weil es jetzt ein Lagerfeuer ist
                }
            }
            else { it.x = it.sX + (it.tX - it.sX) * prog; it.y = it.sY + (it.tY - it.sY) * prog; it.z = Math.sin(prog * Math.PI) * 40; }
        }
    }

    // Partikel aktualisieren
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.04;
        if (p.life <= 0) particles.splice(i, 1);
    }

    nearbyItemIndex = -1;
    for (let i = 0; i < droppedItems.length; i++) {
        if (!droppedItems[i].isAnim && Math.hypot(player.worldX - droppedItems[i].x, player.worldY - droppedItems[i].y) < 70) {
            nearbyItemIndex = i; break;
        }
    }
}

// --- RENDERING ---

function drawItemIcon(type, x, y, scale) {
    if (type === 'wood') { ctx.fillStyle = "#8B4513"; ctx.fillRect(x-15*scale, y-5*scale, 30*scale, 10*scale); }
    else if (type === 'stone') { ctx.fillStyle = "#7f8c8d"; ctx.beginPath(); ctx.arc(x, y, 12*scale, 0, Math.PI*2); ctx.fill(); }
    else if (type === 'crystal') { ctx.fillStyle = "#afeeee"; ctx.beginPath(); ctx.moveTo(x, y-15*scale); ctx.lineTo(x+10*scale, y); ctx.lineTo(x, y+15*scale); ctx.lineTo(x-10*scale, y); ctx.closePath(); ctx.fill(); }
}

function drawUI() {
    const hbS = 5, sS = 60, m = 10, hbW = (sS + m) * hbS - m, hbX = canvas.width / 2 - hbW / 2, hbY = canvas.height - 80;
    for (let i = 0; i < hbS; i++) {
        const x = hbX + i * (sS + m);
        ctx.fillStyle = (i === selectedSlot) ? "rgba(255, 255, 255, 0.3)" : "rgba(0, 0, 0, 0.6)"; ctx.fillRect(x, hbY, sS, sS);
        ctx.strokeStyle = (i === selectedSlot) ? "#f1c40f" : "rgba(255, 255, 255, 0.3)"; ctx.lineWidth = (i === selectedSlot) ? 3 : 1; ctx.strokeRect(x, hbY, sS, sS);
        const sl = inventorySlots[i];
        if (sl) { drawItemIcon(sl.type, x + sS/2, hbY + sS/2, 0.8); ctx.fillStyle = "white"; ctx.font = "bold 14px Arial"; ctx.fillText("x" + sl.count, x + sS - 25, hbY + sS - 5); }
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "10px Arial"; ctx.fillText(i+1, x+5, hbY+15);
    }
    const bX = canvas.width - 150, iY = canvas.height - 60, pY = canvas.height - 110;
    if (nearbyItemIndex !== -1 && !inventoryOpen) { ctx.fillStyle = "#2ecc71"; ctx.fillRect(bX, pY, 130, 40); ctx.fillStyle = "white"; ctx.font = "bold 14px Arial"; ctx.fillText("Aufheben (E)", bX + 20, pY + 25); }
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bX, iY, 130, 40); ctx.fillStyle = "white"; ctx.font = "14px Arial"; ctx.fillText("Inventar (R)", bX + 25, iY + 25);
    if (inventoryOpen) {
        const iW = 420, iH = 350, x = canvas.width/2 - iW/2, y = canvas.height/2 - iH/2;
        ctx.fillStyle = "rgba(20, 20, 20, 0.95)"; ctx.fillRect(x, y, iW, iH); ctx.strokeStyle = "white"; ctx.strokeRect(x, y, iW, iH);
        ctx.fillStyle = "white"; ctx.font = "bold 18px Arial"; ctx.fillText("Inventar", x + 20, y + 35);
        for(let i=0; i<20; i++) {
            let sx=x+25+(i%5)*75, sy=y+60+Math.floor(i/5)*75;
            ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(sx, sy, 60, 60);
            const sl = inventorySlots[i];
            if (sl) { drawItemIcon(sl.type, sx+30, sy+30, 1); ctx.fillStyle = "white"; ctx.font = "12px Arial"; ctx.fillText("x" + sl.count, sx + 35, sy + 55); }
        }
    }
}

// NEU: Verbessertes, dynamisches Lichtsystem
function drawDynamicLighting(camX, camY) {
    // 1. Licht-Canvas komplett schwarz machen
    lightCtx.globalCompositeOperation = "source-over";
    lightCtx.fillStyle = "black";
    lightCtx.fillRect(0, 0, lightCanvas.width, lightCanvas.height);

    // 2. Modus auf "Löschen" stellen (Transparenz stanzt Löcher ins Schwarz)
    lightCtx.globalCompositeOperation = "destination-out";

    // Hilfsfunktion für Lichtkreise
    const drawLight = (x, y, radius, intensity) => {
        const grad = lightCtx.createRadialGradient(x, y, radius * 0.1, x, y, radius);
        grad.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        lightCtx.fillStyle = grad;
        lightCtx.beginPath();
        lightCtx.arc(x, y, radius, 0, Math.PI * 2);
        lightCtx.fill();
    };

    // Licht des Spielers
    drawLight(canvas.width / 2, canvas.height / 2, 220, 1.0);

    // Licht von Lagerfeuern
    worldObjects.forEach(o => {
        if (o.type === 'campfire') {
            const sX = o.x + camX;
            const sY = o.y + camY;
            // Nur zeichnen, wenn es auf/nah am Bildschirm ist
            if (sX > -300 && sX < canvas.width + 300 && sY > -300 && sY < canvas.height + 300) {
                const flicker = Math.sin(Date.now() / 120) * 15; // Flackern für Atmosphäre
                drawLight(sX, sY, 300 + flicker, 0.9);
            }
        }
    });

    // 3. Licht-Canvas über das Haupt-Canvas legen
    ctx.drawImage(lightCanvas, 0, 0);
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const camX = canvas.width / 2 - player.worldX, camY = canvas.height / 2 - player.worldY;
    
    ctx.fillStyle = "#2d5a27"; ctx.fillRect(0,0,canvas.width,canvas.height);
    const drawBP = (idx, col, isL) => {
        ctx.beginPath(); const sY = -200, eY = canvas.height+200;
        ctx.moveTo(getBoundaryX(idx, sY-camY)+camX, sY);
        for(let y=sY; y<=eY; y+=30) ctx.lineTo(getBoundaryX(idx, y-camY)+camX, y);
        if(isL){ ctx.lineWidth=6; ctx.strokeStyle=col; ctx.stroke(); }
        else { ctx.lineTo(canvas.width+100, eY); ctx.lineTo(canvas.width+100, sY); ctx.fillStyle=col; ctx.fill(); }
    };
    drawBP(0, "#edc9af", false); drawBP(1, "#ffffff", false);
    lakes.forEach(l => { const sX = l.x + camX, sY = l.y + camY; if (sX > -600 && sX < canvas.width + 600) { ctx.fillStyle = l.color; ctx.beginPath(); ctx.ellipse(sX, sY, l.radiusX, l.radiusY, l.rotation, 0, Math.PI*2); ctx.fill(); } });
    groundDetails.forEach(d => { const sX = d.x + camX, sY = d.y + camY; if (sX > -10 && sX < canvas.width+10) { ctx.fillStyle = d.color; ctx.fillRect(sX, sY, d.size, d.size); } });

    // Items
    const isGlow = (Date.now() % 3000) < 400;
    droppedItems.forEach((it, i) => {
        const sX = it.x + camX, sY = it.y + camY, z = it.z || 0;
        if (sX > -20 && sX < canvas.width+20) {
            if (it.isAnim) { ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(sX, sY, Math.max(2, 12-z/4), Math.max(1, 6-z/8), 0, 0, Math.PI*2); ctx.fill(); }
            if (isGlow || (!it.isAnim && i === nearbyItemIndex)) { ctx.shadowBlur = 15; ctx.shadowColor = "white"; }
            drawItemIcon(it.type, sX, sY - z, 0.6); ctx.shadowBlur = 0;
        }
    });

    // Weltobjekte & Spieler (Sortiert nach Y für saubere Überlappung)
    const rList = [{isP: true, y: player.worldY, x: player.worldX}];
    worldObjects.forEach(o => { if (o.x+camX > -100 && o.x+camX < canvas.width+100) rList.push({isP:false, ...o}); });
    rList.sort((a,b)=>a.y-b.y).forEach(o => {
        const sX = o.x+camX, sY = o.y+camY;
        if (o.isP) { ctx.fillStyle = 'red'; ctx.fillRect(sX-20, sY-30, 40, 40); }
        else {
            if (o.type === 'tree') { ctx.fillStyle = o.trunkColor; ctx.fillRect(sX-6, sY-o.trunkHeight, 12, o.trunkHeight); ctx.fillStyle = o.leafColor; ctx.beginPath(); ctx.arc(sX, sY-o.trunkHeight, o.size, 0, Math.PI*2); ctx.fill(); }
            else if (o.type === 'palm') { ctx.fillStyle = "#63422b"; ctx.fillRect(sX-5, sY-80, 10, 80); ctx.fillStyle = "#2d5a27"; for(let i=0;i<5;i++){ ctx.beginPath(); ctx.ellipse(sX, sY-80, 40, 10, i*0.8, 0, Math.PI*2); ctx.fill(); } }
            else if (o.type === 'cactus') { ctx.fillStyle = o.color; ctx.fillRect(sX-6, sY-o.size*2, 12, o.size*2); ctx.fillRect(sX-20, sY-o.size-5, 40, 10); }
            else if (o.type === 'ice') { ctx.fillStyle = o.color; ctx.beginPath(); ctx.moveTo(sX, sY-40); ctx.lineTo(sX+20, sY); ctx.lineTo(sX, sY+10); ctx.lineTo(sX-20, sY); ctx.closePath(); ctx.fill(); }
            // NEU: Lagerfeuer zeichnen
            else if (o.type === 'campfire') {
                ctx.fillStyle = "#3e2723"; // Holzscheite
                ctx.fillRect(sX - 12, sY - 5, 24, 6); ctx.fillRect(sX - 5, sY - 12, 6, 24);
                ctx.fillStyle = (Date.now() % 200 < 100) ? "#ff9800" : "#ffc107"; // Feuerflackern
                ctx.beginPath(); ctx.moveTo(sX, sY - 20 - Math.random()*5); ctx.lineTo(sX+8, sY); ctx.lineTo(sX-8, sY); ctx.closePath(); ctx.fill();
            }
        }
    });

    // NEU: Staub-Partikel zeichnen
    particles.forEach(p => {
        ctx.fillStyle = `rgba(180, 170, 150, ${p.life})`;
        ctx.beginPath(); ctx.arc(p.x + camX, p.y + camY, p.size, 0, Math.PI*2); ctx.fill();
    });

    // Sichtfeld & Licht anwenden
    drawDynamicLighting(camX, camY);

    // UI (wird nach dem Licht gezeichnet, bleibt immer hell)
    drawUI();
}

function getVariationColor(h, a) {
    let r = parseInt(h.slice(1,3),16), g = parseInt(h.slice(3,5),16), b = parseInt(h.slice(5,7),16);
    r = Math.max(0, Math.min(255, r+(Math.random()-0.5)*a)); g = Math.max(0, Math.min(255, g+(Math.random()-0.5)*a)); b = Math.max(0, Math.min(255, b+(Math.random()-0.5)*a));
    return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`;
}

function gameLoop() { update(); draw(); requestAnimationFrame(gameLoop); }
generateWorld();
gameLoop();