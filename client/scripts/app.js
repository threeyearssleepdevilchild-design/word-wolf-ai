/**
 * ワードウルフ オンライン - メインアプリケーション
 */

// Socket.io 接続
const socket = io();

// セッションIDの生成・取得
function getSessionId() {
    let sessionId = localStorage.getItem('wordwolf_session_id');
    if (!sessionId) {
        sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        localStorage.setItem('wordwolf_session_id', sessionId);
    }
    return sessionId;
}

// セッションデータの保存
function saveSession() {
    if (state.roomId && state.playerName) {
        localStorage.setItem('wordwolf_room_id', state.roomId);
        localStorage.setItem('wordwolf_player_name', state.playerName);
        console.log('セッション保存:', state.roomId, state.playerName);
    }
}

// セッションデータのクリア
function clearSession() {
    localStorage.removeItem('wordwolf_room_id');
    localStorage.removeItem('wordwolf_player_name');
    console.log('セッションクリア');
}

// セッションデータの取得
function getSavedSession() {
    return {
        roomId: localStorage.getItem('wordwolf_room_id'),
        playerName: localStorage.getItem('wordwolf_player_name'),
        sessionId: getSessionId()
    };
}

// 状態管理
const state = {
    roomId: null,
    playerId: null,
    playerName: null,
    sessionId: getSessionId(),
    isHost: false,
    role: null,
    word: null,
    wolfCount: 1,
    players: [],
    topicRevealed: false,
    isReconnecting: false
};

// DOM要素
const screens = {
    lobby: document.getElementById('lobby-screen'),
    waiting: document.getElementById('waiting-screen'),
    game: document.getElementById('game-screen'),
    voting: document.getElementById('voting-screen'),
    result: document.getElementById('result-screen')
};

// 画像アイコン
const playerIcons = [
    'images/icon-wolf.png',
    'images/icon-fox.png',
    'images/icon-rabbit.png',
    'images/icon-dog.png',
    'images/icon-tiger.png',
    'images/icon-lion.png',
    'images/icon-panda.png',
    'images/icon-koala.png',
    'images/icon-cow.png',
    'images/icon-bear.png'
];

// ... (途中略) ...

// 進捗状況の更新（ゲーム画面）
function updateProgress(players) {
    const container = document.getElementById('progress-list');
    container.innerHTML = players.map((p, i) => `
    <div class="progress-player">
      <div class="progress-info">
        <img src="${playerIcons[i % playerIcons.length]}" class="player-icon-img small" alt="icon">
        <p class="progress-name">${escapeHtml(p.name)}</p>
      </div>
      <div class="progress-checks">
        <span class="check-badge ${p.hasAsked ? 'done' : ''}">質問</span>
        <span class="check-badge ${p.hasAnswered ? 'done' : ''}">回答</span>
      </div>
    </div>
  `).join('');
}

// ... (途中略) ...

// 投票画面の表示更新
function updateVotingPlayers(players) {
    const container = document.getElementById('voting-grid');
    // ... (自分以外のプレイヤーを表示) ...
    const targets = players.filter(p => p.id !== socket.id);

    container.innerHTML = targets.map((p, i) => `
    <div class="vote-card" data-id="${p.id}">
      <img src="${playerIcons[i % playerIcons.length]}" class="player-icon-img large" alt="icon">
      <p>${escapeHtml(p.name)}</p>
    </div>
  `).join('');

    // ...
}

// ... (途中略) ...

// リザルト画面の描画
function renderResult(data) {
    // ...
    // 役職ごとの表示
    // ...

    // プレイヤーリスト生成ヘルパー
    const createPlayerList = (rolePlayers) => {
        return rolePlayers.map((p, i) => `
      <div class="result-player">
        <div class="result-player-info">
          <img src="${playerIcons[i % playerIcons.length]}" class="player-icon-img" alt="icon">
          <span class="player-name">${escapeHtml(p.name)}</span>
        </div>
        <div class="result-player-word">「${escapeHtml(p.word)}」</div>
      </div>
    `).join('');
    };

    // ...
}

// ========================================
// 画面切り替え
// ========================================

function showScreen(screenName) {
    Object.values(screens).forEach(screen => screen.classList.remove('active'));
    screens[screenName].classList.add('active');

    // 背景画像の切り替え
    document.body.classList.remove('bg-lobby', 'bg-game', 'bg-result');

    if (screenName === 'lobby' || screenName === 'waiting') {
        document.body.classList.add('bg-lobby');
    } else if (screenName === 'game' || screenName === 'voting') {
        document.body.classList.add('bg-game');
    } else if (screenName === 'result') {
        document.body.classList.add('bg-result');
    }
}

// ========================================
// ロビー画面
// ========================================

// 狼人数選択
document.querySelectorAll('.wolf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.wolf-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.wolfCount = parseInt(btn.dataset.count);
    });
});

// ルーム作成
document.getElementById('create-room-btn').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    if (!name) {
        alert('名前を入力してください');
        return;
    }
    state.playerName = name;
    socket.emit('createRoom', {
        playerName: name,
        wolfCount: state.wolfCount,
        sessionId: state.sessionId
    });
});

// ルーム参加
document.getElementById('join-room-btn').addEventListener('click', () => {
    const name = document.getElementById('player-name').value.trim();
    const roomId = document.getElementById('room-id-input').value.trim();

    if (!name) {
        alert('名前を入力してください');
        return;
    }
    if (!roomId) {
        alert('ルームIDを入力してください');
        return;
    }

    state.playerName = name;
    state.roomId = roomId;
    socket.emit('joinRoom', {
        roomId,
        playerName: name,
        sessionId: state.sessionId
    });
});

// ========================================
// 待機画面
// ========================================

// タイマー設定（秒/人）
let selectedSecondsPerPlayer = 90; // デフォルト: 人数×1分30秒

document.querySelectorAll('.timer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedSecondsPerPlayer = parseInt(btn.dataset.seconds);

        // ヒントを更新
        updateTimerHint();
    });
});

function updateTimerHint() {
    const playerCount = state.players.length || 4;
    const totalSeconds = playerCount * selectedSecondsPerPlayer;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timeStr = seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分`;
    document.getElementById('timer-hint').textContent = `${playerCount}人 → ${timeStr}`;
}

function updateWaitingPlayers(players) {
    const container = document.getElementById('waiting-players');
    container.innerHTML = players.map((p, i) => `
    <div class="player-item">
      <img src="${playerIcons[i % playerIcons.length]}" class="player-icon-img" alt="icon">
      <span class="player-name">${escapeHtml(p.name)}</span>
      ${p.id === state.players[0]?.id ? '<span class="host-badge">ホスト</span>' : ''}
    </div>
  `).join('');

    document.getElementById('player-count').textContent = players.length;

    const startBtn = document.getElementById('start-game-btn');
    if (players.length >= 4) {
        startBtn.disabled = false;
        startBtn.textContent = 'ゲーム開始';
    } else {
        startBtn.disabled = true;
        startBtn.textContent = `ゲーム開始 (あと${4 - players.length}人必要)`;
    }

    // タイマーヒントを更新
    updateTimerHint();
}

document.getElementById('start-game-btn').addEventListener('click', () => {
    showLoading('お題を生成中...');
    socket.emit('startGame', { secondsPerPlayer: selectedSecondsPerPlayer });
});

// ローディング表示関数
function showLoading(message = 'お題を生成中...') {
    document.getElementById('loading-text').textContent = message;
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

// ========================================
// ゲーム画面
// ========================================

// タイマー表示更新
function updateTimer(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const timerEl = document.getElementById('timer');
    timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    if (seconds <= 30) {
        timerEl.classList.add('warning');
    } else {
        timerEl.classList.remove('warning');
    }
}

// プレイヤー進捗リスト更新
function updateProgressList(players) {
    const container = document.getElementById('progress-list');
    container.innerHTML = players.map((p, i) => `
    <div class="progress-player">
      <div class="progress-name">
        <img src="${playerIcons[i % playerIcons.length]}" class="player-icon-img small" alt="icon">
        <span>${escapeHtml(p.name)}</span>
      </div>
      <div class="progress-checks">
        <button class="check-btn ${p.hasAsked ? 'checked' : ''}" 
                data-player-id="${p.id}" 
                data-type="asked">
          🎤 質問
        </button>
        <button class="check-btn ${p.hasAnswered ? 'checked' : ''}" 
                data-player-id="${p.id}" 
                data-type="answered">
          💬 回答
        </button>
      </div>
    </div>
  `).join('');

    // チェックボタンのイベント
    container.querySelectorAll('.check-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const playerId = btn.dataset.playerId;
            const type = btn.dataset.type;
            const checked = !btn.classList.contains('checked');
            socket.emit('updateCheck', { playerId, type, checked });
        });
    });
}

// お題カード
const topicCard = document.getElementById('topic-card');
topicCard.addEventListener('click', () => {
    state.topicRevealed = !state.topicRevealed;
    topicCard.classList.toggle('revealed', state.topicRevealed);
});

// リロールボタン
document.getElementById('reroll-btn').addEventListener('click', () => {
    console.log('リロールボタンがクリックされました');
    const doReroll = confirm('お題をリロールしますか？全員のお題が変わります。');
    console.log('confirm結果:', doReroll);
    if (doReroll) {
        console.log('rerollTopicsイベントを送信します');
        showLoading('お題をリロール中...');
        socket.emit('rerollTopics');
    }
});

// ナイス/怪しいボタン
document.getElementById('nice-btn').addEventListener('click', () => {
    socket.emit('reaction', { type: 'nice' });
});

document.getElementById('suspicious-btn').addEventListener('click', () => {
    socket.emit('reaction', { type: 'suspicious' });
});

// 質問案ボタン
document.getElementById('ask-ai-btn').addEventListener('click', () => {
    socket.emit('requestQuestions');
});

// 質問者指名
document.getElementById('select-questioner-btn').addEventListener('click', () => {
    socket.emit('selectQuestioner');
});

// 回答者指名
document.getElementById('select-answerer-btn').addEventListener('click', () => {
    socket.emit('selectAnswerer');
});

// 投票へ移行
document.getElementById('go-voting-btn').addEventListener('click', () => {
    console.log('投票ボタンがクリックされました');
    const goVote = confirm('議論を終了して投票に進みますか？');
    console.log('confirm結果:', goVote);
    if (goVote) {
        console.log('goToVotingイベントを送信します');
        socket.emit('goToVoting');
    }
});

// 質問モーダル閉じる
document.querySelector('#questions-modal .modal-close').addEventListener('click', () => {
    document.getElementById('questions-modal').classList.add('hidden');
});

// ========================================
// 投票画面
// ========================================

let currentVotePhase = null;
let selectedVote = null;

function renderVotingPlayers(players) {
    const container = document.getElementById('voting-players');
    container.innerHTML = players.map((p, i) => `
    <div class="vote-card" data-player-id="${p.id}">
      <img src="${playerIcons[i % playerIcons.length]}" class="player-icon-img large" alt="icon">
      <p>${escapeHtml(p.name)}</p>
    </div>
  `).join('');

    container.querySelectorAll('.vote-card').forEach(card => {
        card.addEventListener('click', () => {
            const targetId = card.dataset.playerId;

            // 自分には投票できない
            if (targetId === socket.id) {
                alert('自分には投票できません');
                return;
            }

            // 選択状態を更新
            container.querySelectorAll('.vote-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            selectedVote = targetId;

            // 投票送信
            socket.emit('vote', { phase: currentVotePhase, targetId });

            // 待機表示
            document.getElementById('vote-waiting').classList.remove('hidden');
        });
    });
}

// ========================================
// リザルト画面
// ========================================

function renderResult(data) {
    // 勝者バナー
    const banner = document.getElementById('winner-banner');
    banner.className = 'winner-banner ' + data.winner;

    const winnerTexts = {
        village: { emoji: '🏠', text: '村人の勝利！' },
        wolf: { emoji: '🐺', text: '人狼の勝利！' },
        fox: { emoji: '🦊', text: '狐の勝利！' }
    };

    banner.innerHTML = `
    <h2>${winnerTexts[data.winner].emoji} ${winnerTexts[data.winner].text}</h2>
  `;

    // プレイヤー結果
    const playersContainer = document.getElementById('result-players');
    playersContainer.innerHTML = data.players.map((p, i) => `
    <div class="result-player">
      <div class="result-player-info">
        <img src="${playerIcons[i % playerIcons.length]}" class="player-icon-img" alt="icon">
        <span class="name">${escapeHtml(p.name)}</span>
      </div>
      <span class="role ${p.role}">${getRoleName(p.role)}</span>
      <span class="word">「${escapeHtml(p.word)}」</span>
    </div>
  `).join('');

    // お題一覧
    const topicsContainer = document.getElementById('result-topics');
    topicsContainer.innerHTML = `
    <div class="topic-item">
      <span class="label">🏠 村人</span>
      <span class="word">${escapeHtml(data.topics.village)}</span>
    </div>
    <div class="topic-item">
      <span class="label">🐺 人狼</span>
      <span class="word">${escapeHtml(data.topics.wolf)}</span>
    </div>
    <div class="topic-item">
      <span class="label">🦊 狐</span>
      <span class="word">${escapeHtml(data.topics.fox)}</span>
    </div>
  `;

    // 投票結果
    const votesContainer = document.getElementById('result-votes');
    let votesHtml = '';

    // 狐投票結果
    if (Object.keys(data.votes.fox).length > 0) {
        votesHtml += `
            <div class="vote-result-section">
                <div class="vote-result-header">
                    <span class="vote-phase-icon">🦊</span>
                    <span class="vote-phase-title">狐投票</span>
                </div>
                <div class="vote-result-grid">`;

        Object.entries(data.votes.fox).forEach(([voterId, targetId]) => {
            const voter = data.players.find(p => p.id === voterId);
            const target = data.players.find(p => p.id === targetId);
            const voterIndex = data.players.findIndex(p => p.id === voterId);
            const targetIndex = data.players.findIndex(p => p.id === targetId);
            if (voter && target) {
                votesHtml += `
                    <div class="vote-result-item">
                        <div class="voter">
                            <img src="${playerIcons[voterIndex % playerIcons.length]}" class="voter-icon" alt="icon">
                            <span class="voter-name">${escapeHtml(voter.name)}</span>
                        </div>
                        <span class="vote-arrow">→</span>
                        <div class="votee">
                            <img src="${playerIcons[targetIndex % playerIcons.length]}" class="votee-icon" alt="icon">
                            <span class="votee-name">${escapeHtml(target.name)}</span>
                        </div>
                    </div>`;
            }
        });
        votesHtml += '</div></div>';
    }

    // 狼投票結果
    if (Object.keys(data.votes.wolf).length > 0) {
        votesHtml += `
            <div class="vote-result-section">
                <div class="vote-result-header">
                    <span class="vote-phase-icon">🐺</span>
                    <span class="vote-phase-title">狼投票</span>
                </div>
                <div class="vote-result-grid">`;

        Object.entries(data.votes.wolf).forEach(([voterId, targetId]) => {
            const voter = data.players.find(p => p.id === voterId);
            const target = data.players.find(p => p.id === targetId);
            const voterIndex = data.players.findIndex(p => p.id === voterId);
            const targetIndex = data.players.findIndex(p => p.id === targetId);
            if (voter && target) {
                votesHtml += `
                    <div class="vote-result-item">
                        <div class="voter">
                            <img src="${playerIcons[voterIndex % playerIcons.length]}" class="voter-icon" alt="icon">
                            <span class="voter-name">${escapeHtml(voter.name)}</span>
                        </div>
                        <span class="vote-arrow">→</span>
                        <div class="votee">
                            <img src="${playerIcons[targetIndex % playerIcons.length]}" class="votee-icon" alt="icon">
                            <span class="votee-name">${escapeHtml(target.name)}</span>
                        </div>
                    </div>`;
            }
        });
        votesHtml += '</div></div>';
    }

    if (!votesHtml) {
        votesHtml = '<p class="no-votes">投票データがありません</p>';
    }

    votesContainer.innerHTML = votesHtml;
}

document.getElementById('play-again-btn').addEventListener('click', () => {
    socket.emit('playAgain');
});

// ========================================
// Socket イベントハンドラ
// ========================================

socket.on('connect', () => {
    state.playerId = socket.id;
    console.log('接続しました:', socket.id);

    // 再接続試行
    if (!state.isReconnecting) {
        const saved = getSavedSession();
        if (saved.roomId && saved.playerName) {
            state.isReconnecting = true;
            console.log('再接続試行:', saved.roomId, saved.playerName);
            socket.emit('rejoinRoom', {
                roomId: saved.roomId,
                sessionId: saved.sessionId,
                playerName: saved.playerName
            });
        }
    }
});

// 再接続成功
socket.on('rejoinSuccess', ({ roomId, gameState, role, word, timerSeconds, players, topics, votes }) => {
    state.isReconnecting = false;
    state.roomId = roomId;
    state.players = players;
    state.role = role;
    state.word = word;
    state.playerName = getSavedSession().playerName;

    console.log('再接続成功:', roomId, gameState);

    // ゲーム状態に応じた画面表示
    if (gameState === 'waiting') {
        document.getElementById('room-id-display').textContent = roomId;
        updateWaitingPlayers(players);
        showScreen('waiting');
    } else if (gameState === 'playing') {
        document.getElementById('topic-text').textContent = word;
        document.getElementById('topic-card').classList.remove('revealed');
        state.topicRevealed = false;
        updateTimer(timerSeconds);
        updateProgressList(players);
        showScreen('game');
    } else if (gameState === 'voting-fox') {
        renderVotingPlayers(players);
        document.getElementById('voting-title').textContent = '🦊 狐だと思う人を選んでください';
        showScreen('voting');
    } else if (gameState === 'voting-wolf') {
        const nonFoxPlayers = players.filter(p => p.role !== 'fox');
        renderVotingPlayers(nonFoxPlayers);
        document.getElementById('voting-title').textContent = '🐺 狼だと思う人を選んでください';
        showScreen('voting');
    } else if (gameState === 'result' && topics && votes) {
        renderResult({ winner: 'unknown', players, topics, votes });
        showScreen('result');
    }

    alert('ルームに再接続しました！');
});

// 再接続失敗
socket.on('rejoinFailed', ({ message }) => {
    state.isReconnecting = false;
    clearSession();
    console.log('再接続失敗:', message);
    // ロビー画面のまま（既にロビーにいる）
});

// プレイヤー再接続通知
socket.on('playerReconnected', ({ playerName, players }) => {
    state.players = players;
    console.log(`${playerName} が再接続しました`);

    // 現在の画面に応じて更新
    if (screens.waiting.classList.contains('active')) {
        updateWaitingPlayers(players);
    } else if (screens.game.classList.contains('active')) {
        updateProgressList(players);
    }
});

// プレイヤー切断通知
socket.on('playerDisconnected', ({ playerName, players }) => {
    state.players = players;
    console.log(`${playerName} が切断されました（60秒間再接続を待機）`);

    // 現在の画面に応じて更新
    if (screens.game.classList.contains('active')) {
        updateProgressList(players);
    }
});

socket.on('roomCreated', ({ roomId, players, sessionId }) => {
    state.roomId = roomId;
    state.players = players;
    state.isHost = true;
    if (sessionId) state.sessionId = sessionId;

    saveSession();

    document.getElementById('room-id-display').textContent = roomId;
    updateWaitingPlayers(players);
    showScreen('waiting');
});

socket.on('playerJoined', ({ players }) => {
    state.players = players;

    // 自分が参加した場合
    const me = players.find(p => p.id === socket.id);
    if (me && !screens.waiting.classList.contains('active')) {
        state.isHost = players[0].id === socket.id;
        document.getElementById('room-id-display').textContent = state.roomId || '';
        saveSession();
        updateWaitingPlayers(players);
        showScreen('waiting');
    } else if (screens.waiting.classList.contains('active')) {
        updateWaitingPlayers(players);
    }
});

socket.on('gameStarted', ({ role, word, timerSeconds, players }) => {
    hideLoading();
    state.role = role;
    state.word = word;
    state.players = players;
    state.topicRevealed = false;

    document.getElementById('topic-text').textContent = word;
    document.getElementById('topic-card').classList.remove('revealed');
    updateTimer(timerSeconds);
    updateProgressList(players);
    showScreen('game');
});

socket.on('timerUpdate', ({ seconds }) => {
    updateTimer(seconds);
});

socket.on('topicsRerolled', ({ role, word }) => {
    hideLoading();
    state.role = role;
    state.word = word;
    state.topicRevealed = false;

    document.getElementById('topic-text').textContent = word;
    document.getElementById('topic-card').classList.remove('revealed');
});

socket.on('showReaction', ({ type, playerName }) => {
    const overlay = document.getElementById('reaction-overlay');
    const img = document.getElementById('reaction-image');
    const audio = document.getElementById('reaction-audio');

    if (type === 'nice') {
        img.src = 'assets/images/nice.png';
        audio.src = 'assets/sounds/nice.mp3';
    } else {
        img.src = 'assets/images/ayasii.png';
        audio.src = 'assets/sounds/ayasii.mp3';
    }

    overlay.classList.remove('hidden');
    audio.play().catch(() => { });

    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 2000);
});

socket.on('questionsGenerated', ({ questions }) => {
    const list = document.getElementById('questions-list');
    list.innerHTML = questions.map(q => `<li>${escapeHtml(q)}</li>`).join('');
    document.getElementById('questions-modal').classList.remove('hidden');
});

// 質問者指名結果
socket.on('questionerSelected', ({ questioner, isAllAnswerMode }) => {
    const overlay = document.getElementById('selection-overlay');
    const text = document.getElementById('selection-text');

    if (isAllAnswerMode) {
        text.innerHTML = `⚡ 全員回答タイム！<br>質問者: ${escapeHtml(questioner.name)}`;
        overlay.classList.remove('hidden');

        setTimeout(() => {
            overlay.classList.add('hidden');
            document.getElementById('all-answer-modal').classList.remove('hidden');
        }, 2000);
    } else {
        text.innerHTML = `🎯 質問者指名！<br>${escapeHtml(questioner.name)}`;
        overlay.classList.remove('hidden');

        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 3000);
    }
});

// 回答者指名結果
socket.on('answererSelected', ({ answerer, isAllAnswerMode }) => {
    const overlay = document.getElementById('selection-overlay');
    const text = document.getElementById('selection-text');

    if (isAllAnswerMode) {
        text.innerHTML = `⚡ 全員回答タイム！`;
        overlay.classList.remove('hidden');

        setTimeout(() => {
            overlay.classList.add('hidden');
            document.getElementById('all-answer-modal').classList.remove('hidden');
        }, 2000);
    } else {
        text.innerHTML = `🎯 回答者指名！<br>${escapeHtml(answerer.name)}`;
        overlay.classList.remove('hidden');

        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 3000);
    }
});

// 全員回答結果表示
let allAnswers = [];
socket.on('allAnswerSubmitted', ({ playerId, playerName, answer }) => {
    allAnswers.push({ playerName, answer });
    showAllAnswersResult();
});

function showAllAnswersResult() {
    let resultsDiv = document.getElementById('all-answers-result');
    if (!resultsDiv) {
        resultsDiv = document.createElement('div');
        resultsDiv.id = 'all-answers-result';
        resultsDiv.className = 'all-answers-result';
        document.getElementById('game-screen').querySelector('.container').appendChild(resultsDiv);
    }

    resultsDiv.innerHTML = `
        <div class="all-answers-header">
            <span class="all-answers-icon">⚡</span>
            <h4>全員回答結果</h4>
        </div>
        <div class="all-answers-grid">
            ${allAnswers.map((a, i) => `
                <div class="answer-card">
                    <div class="answer-player">
                        <span class="answer-player-icon">${playerIcons[i % playerIcons.length]}</span>
                        <span class="answer-player-name">${escapeHtml(a.playerName)}</span>
                    </div>
                    <div class="answer-text">${escapeHtml(a.answer)}</div>
                </div>
            `).join('')}
        </div>
        <button class="btn btn-secondary all-answers-close" onclick="this.closest('.all-answers-result').remove(); allAnswers = [];">× 閉じる</button>
    `;
}

socket.on('checkUpdated', ({ playerId, type, checked }) => {
    const player = state.players.find(p => p.id === playerId);
    if (player) {
        if (type === 'asked') player.hasAsked = checked;
        if (type === 'answered') player.hasAnswered = checked;
        updateProgressList(state.players);
    }
});

socket.on('votingStarted', ({ phase, players }) => {
    currentVotePhase = phase;
    selectedVote = null;

    const title = document.getElementById('voting-title');
    const info = document.getElementById('voting-info');

    if (phase === 'fox') {
        title.textContent = '🦊 狐だと思う人を選んでください';
        info.textContent = '最も怪しいと思う人に投票してください';
    } else {
        title.textContent = '🐺 狼だと思う人を選んでください';
        info.textContent = '狐以外で最も怪しい人に投票してください';
    }

    document.getElementById('vote-waiting').classList.add('hidden');
    renderVotingPlayers(players);
    showScreen('voting');
});

socket.on('foxVoteResult', ({ foxCaught, foxId, foxName }) => {
    if (foxCaught) {
        alert(`🦊 ${foxName} は狐でした！次は狼を探しましょう！`);
    }
});

socket.on('gameResult', (data) => {
    renderResult(data);
    showScreen('result');
});

socket.on('gameReset', ({ players }) => {
    state.players = players;
    state.role = null;
    state.word = null;
    updateWaitingPlayers(players);
    showScreen('waiting');
});

socket.on('playerLeft', ({ players, newHost }) => {
    state.players = players;
    state.isHost = newHost === socket.id;

    if (screens.waiting.classList.contains('active')) {
        updateWaitingPlayers(players);
    }
});

socket.on('error', ({ message }) => {
    alert(message);
});

// ========================================
// ユーティリティ関数
// ========================================

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getRoleName(role) {
    const names = {
        village: '村人',
        wolf: '人狼',
        fox: '狐'
    };
    return names[role] || role;
}

// 全員回答モーダル送信
document.getElementById('submit-answer-btn').addEventListener('click', () => {
    const input = document.getElementById('all-answer-input');
    const answer = input.value.trim();
    if (answer) {
        socket.emit('submitAllAnswer', { answer });
        document.getElementById('all-answer-modal').classList.add('hidden');
        input.value = '';
    }
});
