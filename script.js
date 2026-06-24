/**
 * ==========================================================================
 * 屏東數位大挑戰 - 完整核心邏輯控制 (script.js)
 * ==========================================================================
 * 架構特點：
 * 1. 關卡切換路由控制 (SPA 單頁式路由)
 * 2. 外部 JSON 檔案非同步 Fetch 載入與快取 (pipe_level.json, quiz_data.json)
 * 3. 外部 GeoJSON (pingtung.json) 零依賴麥卡托投影轉換，直接繪製 SVG 陸地
 * 4. Cookie 常駐持久化保存挑戰記錄
 * 5. 觸控/指針端 (Pointer Events) 反應優化與 Vibration API 實體震動回饋
 */

// BGM 撥放
var tag = document.createElement('script'); // 載入 YouTube Iframe API
tag.src = "https://www.youtube.com/iframe_api";
var firstScriptTag = document.getElementsByTagName('script')[0];
firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

var player;
function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '0',
        width: '0',
        videoId: '410pjjdv76c', // 替換成 YouTube 影片 ID
        playerVars: {
            'autoplay': 0, // 先不自動播放，等點擊後再播
            'controls': 0,
            'disablekb': 1,
            'fs': 0,
            'modestbranding': 1,
            'rel': 0,
            'showinfo': 0
        },
        events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange // 狀態改變的監聽事件
        }
    });
}
function onPlayerReady(event) {
    const btn = document.getElementById('start-btn');
    btn.addEventListener('click', () => {
        player.setVolume(10); // 設定音量 (0-100)
        player.playVideo();
        });
    }
function onPlayerStateChange(event) {
    // 當影片狀態變成 YT.PlayerState.ENDED (也就是結束時，數值通常是 0)
    if (event.data === YT.PlayerState.ENDED) { player.playVideo(); } // 重新播放，達到無限循環效果
    }

// ==========================================================================
// 1. 全域狀態與 Cookie 操作輔助函式
// ==========================================================================
function setCookie(name, value, days = 1) { // 預設值天數改為 1
    const maxAge = days * 24 * 60 * 60;     // 計算出來會是 86400 秒
    // 使用 SameSite=Strict 與 Secure 確保現代瀏覽器安全性
    document.cookie = `${name}=${value}; max-age=${maxAge}; path=/; SameSite=Strict`;
}
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}
const screens = {
    lobby: document.getElementById('lobby-screen'),
    pipe: document.getElementById('game-pipe-screen'),
    quiz: document.getElementById('game-quiz-screen')
};
function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
    
    // 每次回到大廳，都必須重新檢測狀態
    if (screenName === 'lobby') {
        updateLobbyStatus();
    }
}
// 綁定各關卡的返回大廳按鈕與進入按鈕
document.querySelectorAll('.back-to-lobby').forEach(btn => {
    btn.addEventListener('click', () => {
        clearInterval(timerInterval); // 離開水管關卡時強行拆除計時器
        switchScreen('lobby');
    });
});
document.getElementById('btn-goto-pipe').addEventListener('click', () => {
    switchScreen('pipe');
    startPipeGameFlow();
});
document.getElementById('btn-goto-quiz').addEventListener('click', () => {
    switchScreen('quiz');
    startQuizGameFlow();
});

// ==========================================================================
// 2. 核心大廳控制：GeoJSON 渲染與通關狀態刷新
// ==========================================================================
/**
 * 讀取並動態將 GeoJSON 座標渲染成 2D 畫布 SVG Path
 */
async function loadAndRenderMap() {
    const svgEl = document.getElementById('pingtung-svg');
    if (!svgEl) return;
    try {
        const response = await fetch('pingtung.json');
        if (!response.ok) throw new Error('無法讀取地圖 GeoJSON 檔案');
        const geoData = await response.json();
        // 取得屏東縣的幾何座標點陣列 (多邊形外框)
        const coordinates = geoData.features[0].geometry.coordinates[0];
        // 1. 找出經緯度的邊界值 (Bounding Box)，用於做視窗對齊映射
        const lons = coordinates.map(c => c[0]);
        const lats = coordinates.map(c => c[1]);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        // SVG 畫布設定的標準寬高 (對應 HTML viewBox="0 0 200 400")
        const svgWidth = 200;
        const svgHeight = 400;
        const padding = 20; // 留安全間距防破版
        // 2. 等比區間映射公式：經緯度 -> 畫布 X/Y 像素坐標
        const points = coordinates.map(coord => {
            const lon = coord[0];
            const lat = coord[1];
            // 經度對應 X 軸
            const x = padding + ((lon - minLon) / (maxLon - minLon)) * (svgWidth - padding * 2);
            // 緯度對應 Y 軸 (注意：網頁座標向下為正，地理座標向上為正，因此需要進行翻轉映射)
            const y = padding + (1 - (lat - minLat) / (maxLat - minLat)) * (svgHeight - padding * 2);
            return `${x},${y}`;
        });
        // 3. 拼接 SVG Path Data 指令 (M=起點, L=連線, Z=關閉圖形)
        const pathData = `M ${points.join(' L ')} Z`;
        // 4. 動態生成 SVG 元素節點並注入
        const pathEl = document.createElementNS("http://www.w3.org/2000/svg", "path");
        pathEl.setAttribute("d", pathData);
        pathEl.setAttribute("class", "pingtung-land");
        svgEl.appendChild(pathEl);
    } catch (error) {
        console.error("地圖載入失敗:", error);
        svgEl.innerHTML = `<text x="30" y="200" fill="#ef4444" font-size="12">圖資載入失敗，請檢查本地伺服器環境</text>`;
    }
}
/**
 * 讀取 Cookie 狀態，動態渲染首頁通關情形
 */
function updateLobbyStatus() {
    const isPipeCleared = getCookie('pipe_cleared') === 'true';
    const isQuizCleared = getCookie('quiz_cleared') === 'true';
    const isRewarded = getCookie('all_clear_rewarded') === 'true';
    // 【新增】新玩家引導判定：如果兩關都還沒通關
    const welcomeOverlay = document.getElementById('welcome-overlay');
    if (!isPipeCleared && !isQuizCleared) {
        welcomeOverlay?.classList.remove('hidden');
    } else {
        welcomeOverlay?.classList.add('hidden'); // 只要過任一關，就永久隱藏引導層
    }
    
    // 1. 更新接水管關卡 UI (這部分程式碼與之前相同)
    const pipeNode = document.getElementById('pin-pipe-node');
    const pipeBadge = document.getElementById('badge-pipe');
    const pipeDesc = document.getElementById('desc-pipe');
    if (isPipeCleared) {
        pipeNode.classList.add('is-cleared');
        pipeBadge.textContent = '✓ 已通關';
        pipeBadge.className = 'status-badge cleared';
        pipeDesc.textContent = '管線已經鋪設完成！';
    } else {
        pipeNode.classList.remove('is-cleared');
        pipeBadge.textContent = '未挑戰';
        pipeBadge.className = 'status-badge not-cleared';
        pipeDesc.textContent = '幫忙完成自來水延管';
    }

    // 2. 更新問答關卡 UI (這部分程式碼與之前相同)
    const quizNode = document.getElementById('pin-quiz-node');
    const quizBadge = document.getElementById('badge-quiz');
    const quizDesc = document.getElementById('desc-quiz');
    if (isQuizCleared) {
        quizNode.classList.add('is-cleared');
        quizBadge.textContent = '✓ 已通關';
        quizBadge.className = 'status-badge cleared';
        quizDesc.textContent = '你是自來水小達人！';
    } else {
        quizNode.classList.remove('is-cleared');
        quizBadge.textContent = '未挑戰';
        quizBadge.className = 'status-badge not-cleared';
        quizDesc.textContent = '挑戰自來水小知識';
    }

    // 3. 終極全通關判定：只要兩關都過了，每次進大廳或重整網頁都直接彈出
    if (isPipeCleared && isQuizCleared) {
        // 如果是網頁剛載入（重整），直接彈出不延遲；如果是剛破關，維持微延遲營造儀式感
        const delay = document.getElementById('all-clear-modal')?.classList.contains('show') ? 0 : 400;
        setTimeout(() => {
            triggerAllClearModal();
        }, delay);
    }
}
document.addEventListener('DOMContentLoaded', () => {
    // 【點擊開始闖關】 -> 加上 hidden 類別來隱藏歡迎畫面
    document.getElementById('btn-start-game')?.addEventListener('click', () => {
        document.getElementById('welcome-overlay')?.classList.add('hidden');
        if (navigator.vibrate) navigator.vibrate(20); // 加上震動回饋
    });
    // 【點擊活動辦法】 -> 跳出說明
    document.getElementById('btn-show-rules')?.addEventListener('click', () => {
        alert("【活動辦法】\n1. 點擊地圖上的關卡卡片進入挑戰。\n2. 關卡 A 需成功串接水管，關卡 B 需答對所有自來水知識題。\n3. 2025@115年水利人員基礎班第5組");
    });
});

// ==========================================================================
// 3. 關卡 A：接水管小遊戲模組
// ==========================================================================
const PIPE_TYPES = { I: [0, 2], L: [0, 1], T: [0, 1, 3] };
const SVG_PATHS = {
    I: '<path class="pipe-line" d="M 50 0 L 50 100" />',
    L: '<path class="pipe-line" d="M 50 0 L 50 50 L 100 50" />',
    T: '<path class="pipe-line" d="M 50 0 L 50 50 L 100 50 M 50 50 L 0 50" />'
};

let cachedPipeLevel = null;
let boardState = [], moves = 0, timerInterval = null, secondsElapsed = 0, pipeActive = true;

async function startPipeGameFlow() {
    const board = document.getElementById('game-board');
    board.innerHTML = '<div style="color: white; text-align:center; padding:50px;">管線地圖加載中...</div>';

    try {
        if (!cachedPipeLevel) {
            const response = await fetch('pipe_level.json');
            if (!response.ok) throw new Error('無法讀取水管關卡檔案');
            cachedPipeLevel = await response.json();
        }
        initPipeGame(cachedPipeLevel);
    } catch (error) {
        console.error(error);
        board.innerHTML = '<div style="color: #ef4444; text-align:center; padding:30px; font-size: 0.9rem;">地圖載入失敗，請確認本地是否開啟 Live Server 伺服器並包含 pipe_level.json 檔案。</div>';
    }
}

function initPipeGame(levelData) {
    const board = document.getElementById('game-board');
    board.innerHTML = ''; boardState = []; moves = 0; secondsElapsed = 0; pipeActive = true;
    document.getElementById('move-count').textContent = moves;
    
    document.getElementById('timer').textContent = "00:00";
    timerInterval = setInterval(() => {
        secondsElapsed++;
        document.getElementById('timer').textContent = `${String(Math.floor(secondsElapsed / 60)).padStart(2,'0')}:${String(secondsElapsed % 60).padStart(2,'0')}`;
    }, 1000);

    levelData.forEach(cellData => {
        const cell = { ...cellData };
        cell.getDirections = function() { return PIPE_TYPES[this.type].map(d => (d + this.rotation) % 4); };
        boardState.push(cell);
        
        const cellEl = document.createElement('div');
        cellEl.classList.add('cell');
        if(cell.isSource) cellEl.classList.add('source');
        if(cell.isSink) cellEl.classList.add('sink');
        
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 100 100");
        svg.innerHTML = SVG_PATHS[cell.type];
        svg.style.transform = `rotate(${cell.rotation * 90}deg)`;
        cellEl.appendChild(svg);
        
        // 使用 pointerdown 事件，消除移動端 300ms 點擊延遲
        cellEl.addEventListener('pointerdown', (e) => {
            if (!pipeActive || cell.isSource || cell.isSink) return;
            e.preventDefault();
            
            cell.rotation = (cell.rotation + 1) % 4;
            svg.style.transform = `rotate(${cell.rotation * 90}deg)`;
            moves++;
            document.getElementById('move-count').textContent = moves;
            
            if (navigator.vibrate) navigator.vibrate(12); // 微震動
            updateWaterFlow();
        });
        cell.el = cellEl;
        board.appendChild(cellEl);
    });
    updateWaterFlow();
}

function updateWaterFlow() {
    boardState.forEach(c => c.el.classList.remove('connected'));
    const source = boardState.find(c => c.isSource);
    if (!source) return;
    
    const queue = [source], visited = new Set([`${source.row},${source.col}`]);
    source.el.classList.add('connected');
    const dr = [-1, 0, 1, 0], dc = [0, 1, 0, -1];

    while (queue.length > 0) {
        const current = queue.shift();
        current.getDirections().forEach(dir => {
            const nextRow = current.row + dr[dir], nextCol = current.col + dc[dir], oppositeDir = (dir + 2) % 4;
            const nextCell = boardState.find(c => c.row === nextRow && c.col === nextCol);
            if (nextCell && !visited.has(`${nextRow},${nextCol}`)) {
                if (nextCell.getDirections().includes(oppositeDir)) {
                    visited.add(`${nextRow},${nextCol}`);
                    nextCell.el.classList.add('connected');
                    queue.push(nextCell);
                }
            }
        });
    }
    
    const sink = boardState.find(c => c.isSink);
    if (sink && sink.el.classList.contains('connected')) {
        pipeActive = false; clearInterval(timerInterval);
        
        // 通關：紀錄進度至 Cookie
        setCookie('pipe_cleared', 'true', 30);
        triggerWinModal("你成功提升了屏東的自來水接管率！");
    }
}

// ==========================================================================
// 4. 關卡 B：自來水知識問答挑戰模組
// ==========================================================================
let cachedQuizData = null;
let currentQuestionIndex = 0;
async function startQuizGameFlow() {
    document.getElementById('quiz-question').textContent = "題目讀取中...";
    document.getElementById('quiz-options').innerHTML = '';
    try {
        if (!cachedQuizData) {
            const response = await fetch('quiz_data.json');
            if (!response.ok) throw new Error('無法讀取問答題庫檔案');
            cachedQuizData = await response.json();
        }
        currentQuestionIndex = 0;
        showQuestion(cachedQuizData); // 將載入的題庫陣列傳進去
    } catch (error) {
        console.error(error);
        document.getElementById('quiz-question').textContent = "題庫加載失敗。";
    }
}
function showQuestion(quizList) {
    // 1. 動態更新進度面板：當前題號 與 自動判斷的總題數
    document.getElementById('quiz-current').textContent = currentQuestionIndex + 1;
    document.getElementById('quiz-total').textContent = quizList.length; // 自動判斷總題數！
    // 2. 渲染題目
    const data = quizList[currentQuestionIndex];
    document.getElementById('quiz-question').textContent = data.q;
    // 3. 渲染選項
    const optionsContainer = document.getElementById('quiz-options');
    optionsContainer.innerHTML = '';
    data.o.forEach((option, idx) => {
        const btn = document.createElement('button');
        btn.classList.add('quiz-opt-btn');
        btn.textContent = option;
        btn.addEventListener('click', () => handleQuizAnswer(idx, quizList));
        optionsContainer.appendChild(btn);
    });
}
function handleQuizAnswer(selectedIndex, quizList) {
    const data = quizList[currentQuestionIndex];
    if (selectedIndex === data.a) {
        if (navigator.vibrate) navigator.vibrate([40, 40]);
        currentQuestionIndex++;
        // 4. 這裡的判斷也自動化了：只要當前索引小於題庫長度，就繼續下一題
        if (currentQuestionIndex < quizList.length) {
            showQuestion(quizList);
        } else {
            setCookie('quiz_cleared', 'true', 30);
            triggerWinModal(`恭喜你！完美答對全部 ${quizList.length} 道自來水知識問題！`);
        }
    } else {
        if (navigator.vibrate) navigator.vibrate(200); 
        alert("答案不對唷，再試一次！");
    }
}
// ==========================================================================
// 5. 全局彈窗控制與應用程式啟動入口
// ==========================================================================
function triggerWinModal(text) {
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]); // 節奏式成功震動
    document.getElementById('win-modal-text').textContent = text;
    document.getElementById('win-modal').classList.add('show');
}
document.getElementById('modal-close-btn').addEventListener('click', () => {
    document.getElementById('win-modal').classList.remove('show');
    switchScreen('lobby'); // 路由彈回大廳，會同步觸發 updateLobbyStatus() 刷新首頁
});
/**
 * 網頁完全載入初始化入口
 */
window.onload = async () => {
    await loadAndRenderMap(); // 1. 先異步非同步抓取並繪製屏東地圖
    updateLobbyStatus();      // 2. 隨後檢查 Cookie 進度更新大廳關卡徽章
};
/**
 * 觸發全通關終極畫面
 */
function triggerAllClearModal() {
    // 震動回饋：長、短、長 的勝利交響樂節奏
    if (navigator.vibrate) {
        navigator.vibrate([300, 100, 100, 100, 300]);
    }
    document.getElementById('all-clear-modal').classList.add('show');
}
// 關閉按鈕
document.getElementById('all-clear-close-btn').addEventListener('click', () => {
    document.getElementById('all-clear-modal').classList.remove('show');
});