require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// APIキーの読み込みチェック
const rawApiKey = process.env.GEMINI_API_KEY || "";
const apiKey = rawApiKey.trim(); 
if(apiKey) {
    console.log(`✅ API Key is set (Length: ${apiKey.length})`);
} else {
    console.error(`❌ API Key is MISSING! Please set GEMINI_API_KEY in environment variables.`);
}

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; 
let currentWords = { village: "", wolf: "", fox: "", reason: "" };
let deadFoxId = null;
let currentDifficulty = 'sexy';
let currentWolfCount = 1;

const aiCooldowns = new Map();

let timer = {
    timeLeft: 0, 
    isRunning: false,
    intervalId: null
};

// 安全設定
const SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function generateWords(difficulty) {
    const fallback = { village: "バイブ", wolf: "ローター", fox: "指", reason: "予備データ(APIエラー)" };
    
    if (!apiKey) {
        console.error("Attempted to generate words but API Key is missing.");
        return fallback;
    }

    // 起点をランダムにする
    const pivotRoll = Math.random();
    let pivotRole = 'village'; 
    if (pivotRoll < 0.3) pivotRole = 'wolf'; 
    else if (pivotRoll < 0.45) pivotRole = 'fox'; 

    let subTheme = "";
    let difficultyPrompt = "";

    if (difficulty === 'sexy') {
        const sexySubThemes = [
            "下着・ランジェリー", "大人の道具・おもちゃ", "夜のテクニック・体位",
            "シチュエーション・場所", "身体の部位・フェチ",
            "コスプレ・ロールプレイ", "SとM・攻めと受け", "スリル・露出",
            "浮気・不倫", "挿入する道具", "責める道具", "SM・拘束",
            "具体的なプレイ", "口や舌を使う行為", "汁・分泌液", "NTR・寝取られ",
            "排泄関連", "ハプニング・のぞき"
        ];
        subTheme = sexySubThemes[Math.floor(Math.random() * sexySubThemes.length)];
        
        difficultyPrompt = `
            ターゲット: R-18 (成人向け)。
            サブテーマ: 【${subTheme}】
            条件: 恥ずかしがらず、具体的で露骨な単語を選ぶこと。抽象的な言葉は禁止。
        `;
    } else {
        let diffText = "一般向け";
        if (difficulty === 'easy') diffText = "子供向け（具体的）";
        if (difficulty === 'hard') diffText = "大人向け（抽象的）";
        difficultyPrompt = `ターゲット: ${diffText}`;
    }

    const prompt = `
        あなたはワードウルフのゲームマスターです。お題を作成してください。
        
        生成手順:
        1. まず【${pivotRole}】の単語を最初に決めてください。
        2. その単語を基準にして、残りの役割の単語を決めてください。

        ${difficultyPrompt}
        
        【ワードの3すくみ関係（絶対厳守）】
        1. "village" (多数派) と "wolf" (少数派) :
           - **機能・形状・ジャンルが30%一致する酷似した単語**。
           - 議論しないと見分けがつかないレベル。
           - 包含関係（例：ビールと生ビール）は禁止。

        2. "fox" (第三勢力) :
           - village/wolfとは**「カテゴリー」や「用途」が決定的に違う単語**。
           - 絶対にvillage/wolfと同ジャンルにしてはいけない。
        
        【出力形式】
        JSON形式のみ出力。余計なマークダウンや会話は不要。
        { "village":"...", "wolf":"...", "fox":"...", "reason":"選定理由" }
    `;

    try {
        console.log(`🤖 AI Request (Mode: ${difficulty}, Pivot: ${pivotRole}) sending...`);
        
        // ★修正ポイント: 制限の緩い gemini-1.5-flash-002 を指定
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { 
                    temperature: 1.2,
                    responseMimeType: "application/json" // JSON強制
                },
                safetySettings: SAFETY_SETTINGS
            })
        });

        if (!response.ok) {
            console.error(`🚨 API HTTP Error: ${response.status} ${response.statusText}`);
            const errorText = await response.text();
            console.error(`Error Body: ${errorText}`);
            throw new Error(response.status);
        }
        
        const data = await response.json();
        
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            console.error("🚨 API blocked the content (Safety Filter or No Candidates).");
            console.log("Full Response:", JSON.stringify(data));
            return fallback;
        }

        let text = data.candidates[0].content.parts[0].text;
        console.log(`🤖 AI Response received: ${text.substring(0, 50)}...`);

        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(text);

        const v = json.village || json.Village;
        const w = json.wolf || json.Wolf;
        const f = json.fox || json.Fox;
        const r = json.reason || json.Reason || "";

        if (!v || !w || !f) {
            console.error("🚨 JSON parsed but missing fields:", json);
            return fallback;
        }

        return { village: v, wolf: w, fox: f, reason: r };

    } catch (e) { 
        console.error("🚨 Generate Words EXCEPTION:", e); 
        return fallback; 
    }
}

async function generateAiQuestions(word) {
    if (!apiKey) return ["質問案1", "質問案2", "質問案3"];
    const prompt = `
        ワードウルフ「${word}」について、バレないような当たり障りのない簡素な質問を3つ考えて。
        出力: JSON配列 ["質問1", "質問2", "質問3"]
    `;
    try {
        // ★修正ポイント: gemini-1.5-flash-002
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }, 
                safetySettings: SAFETY_SETTINGS
            })
        });
        const data = await response.json();
        let text = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) { return ["好きな色は？", "コンビニで買える？", "家にありますか？"]; }
}

async function generateWordMeaning(word) {
    if (!apiKey) return "APIキー設定なし";
    const prompt = `
        単語「${word}」の意味を、ワードウルフのゲーム中にプレイヤーがこっそり確認できるよう、簡潔に説明してください。
    `;
    try {
        // ★修正ポイント: gemini-1.5-flash-002
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-002:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], safetySettings: SAFETY_SETTINGS })
        });
        const data = await response.json();
        return data.candidates[0].content.parts[0].text.trim();
    } catch (e) { return "解説を取得できませんでした。"; }
}

function calculateVoteResult() {
    const validPlayers = players.filter(p => p.id !== deadFoxId);
    if(validPlayers.length === 0) return { role: 'none', name: 'none' };
    
    const sorted = [...validPlayers].sort((a, b) => b.voteCount - a.voteCount);
    const maxVotes = sorted[0].voteCount;
    const candidates = sorted.filter(p => p.voteCount === maxVotes);
    return candidates[Math.floor(Math.random() * candidates.length)];
}

function startServerTimer(duration, autoStart = true) {
    if (timer.intervalId) clearInterval(timer.intervalId);
    timer.timeLeft = duration;
    timer.isRunning = autoStart;
    io.emit('timer_update', timer.timeLeft);

    if (autoStart) {
        timer.intervalId = setInterval(() => {
            if (timer.timeLeft > 0) {
                timer.timeLeft--;
                io.emit('timer_update', timer.timeLeft);
            } else {
                clearInterval(timer.intervalId);
                timer.isRunning = false;
                io.emit('play_sound_effect', 'vote'); 
                if (gameState === 'PLAYING') initiateVotingPhase();
            }
        }, 1000);
    }
}

function broadcastVoteProgress() {
    let eligibleVoters = players.length;
    if (deadFoxId) eligibleVoters -= 1;
    io.emit('update_vote_progress', { current: votesReceived, total: eligibleVoters });
}

function initiateVotingPhase() {
    if (timer.intervalId) clearInterval(timer.intervalId);
    timer.isRunning = false;
    players.forEach(p => p.status.hasVoted = false);
    votesReceived = 0;
    gameState = 'VOTING_FOX';
    io.emit('show_voting_screen', { players, phase: 'FOX', deadFoxId: null });
    broadcastVoteProgress();
}

function checkVotingCompletion() {
    let eligibleVoters = players.length;
    if (deadFoxId) eligibleVoters -= 1;

    broadcastVoteProgress();

    if (votesReceived >= eligibleVoters) {
        const victim = calculateVoteResult();
        
        if (gameState === 'VOTING_FOX') {
            if (victim.role === 'fox') {
                deadFoxId = victim.id; 
                io.emit('fox_caught', { victimName: victim.name });
                setTimeout(() => {
                    gameState = 'VOTING_WOLF';
                    votesReceived = 0;
                    players.forEach(p => { 
                        p.voteCount = 0; 
                        p.voters = []; 
                        p.status.hasVoted = false; 
                    });
                    io.emit('show_voting_screen', { players, phase: 'WOLF', deadFoxId: deadFoxId });
                    broadcastVoteProgress(); 
                }, 4000); 
            } else {
                gameState = 'RESULT';
                io.emit('game_result', { players, winner: 'FOX', victimName: victim.name, reason: currentWords.reason });
            }
        } 
        else if (gameState === 'VOTING_WOLF') {
            gameState = 'RESULT';
            if (victim.role === 'wolf') {
                io.emit('game_result', { players, winner: 'VILLAGE', victimName: victim.name, reason: currentWords.reason });
            } else {
                io.emit('game_result', { players, winner: 'WOLF', victimName: victim.name, reason: currentWords.reason });
            }
        }
    }
}

let simultaneousAnswers = [];

io.on('connection', (socket) => {
    socket.emit('timer_update', timer.timeLeft);

    socket.on('join_game', (playerName) => {
        const existing = players.find(p => p.name === playerName);
        const newPlayer = { 
            id: socket.id, name: playerName, role: '', word: '', voteCount: 0, 
            status: { question: false, answer: false, hasVoted: false }, voters: [] 
        };

        if (gameState === 'WAITING') {
            if (existing) existing.id = socket.id;
            else players.push(newPlayer);
            io.emit('update_players', players);
        } else {
            if (existing) {
                existing.id = socket.id;
                socket.emit('game_started', { word: existing.word, difficulty: currentDifficulty });
                socket.emit('update_game_status', players); 
                if(gameState.startsWith('VOTING')) {
                    socket.emit('show_voting_screen', { players, phase: gameState.includes('WOLF') ? 'WOLF' : 'FOX', deadFoxId });
                    broadcastVoteProgress();
                }
                if(gameState === 'RESULT') socket.emit('game_result', { players, winner: 'unknown', reason: currentWords.reason });
                io.emit('update_players', players);
            } else {
                socket.emit('error_msg', 'ゲーム進行中です');
            }
        }
    });

    socket.on('trigger_sound_effect', (soundType) => {
        io.emit('play_sound_effect', soundType);
    });

    socket.on('reroll_words', async () => {
        if (gameState !== 'PLAYING') return;
        io.emit('loading_start'); 
        const words = await generateWords(currentDifficulty);
        currentWords = words;

        const shuffled = shuffleArray([...players]);
        shuffled.forEach((p, i) => {
            if (i < currentWolfCount) { p.role = 'wolf'; p.word = words.wolf; } 
            else if (i === currentWolfCount) { p.role = 'fox'; p.word = words.fox; } 
            else { p.role = 'villager'; p.word = words.village; }
            io.to(p.id).emit('game_started', { word: p.word, difficulty: currentDifficulty });
        });
        players = shuffled;
        io.emit('update_game_status', players);
    });

    socket.on('start_game', async ({ diff, wolfCount }) => {
        if (players.length < 3) return;
        currentDifficulty = diff;
        currentWolfCount = parseInt(wolfCount) || 1;
        if (currentWolfCount >= players.length - 1) currentWolfCount = 1;

        io.emit('loading_start');

        gameState = 'PLAYING';
        votesReceived = 0;
        deadFoxId = null;
        simultaneousAnswers = [];
        
        const discussionTime = players.length * 150; 
        startServerTimer(discussionTime, true);

        players.forEach(p => { 
            p.voteCount = 0; p.status = { question: false, answer: false, hasVoted: false }; p.voters = []; 
        });

        const words = await generateWords(diff);
        currentWords = words;

        const shuffled = shuffleArray([...players]);
        shuffled.forEach((p, i) => {
            if (i < currentWolfCount) { p.role = 'wolf'; p.word = words.wolf; } 
            else if (i === currentWolfCount) { p.role = 'fox'; p.word = words.fox; } 
            else { p.role = 'villager'; p.word = words.village; }
            if (!p.word) p.word = "エラー";
            io.to(p.id).emit('game_started', { word: p.word, difficulty: diff });
        });
        
        players = shuffled;
        io.emit('update_game_status', players);
    });

    socket.on('request_ai_questions', async () => {
        const player = players.find(p => p.id === socket.id);
        if (!player) return;
        const lastTime = aiCooldowns.get(socket.id) || 0;
        const now = Date.now();
        if (now - lastTime < 90000) return;
        aiCooldowns.set(socket.id, now);
        const questions = await generateAiQuestions(player.word);
        socket.emit('ai_questions_result', questions);
    });

    socket.on('request_word_meaning', async () => {
        const player = players.find(p => p.id === socket.id);
        if (!player) return;
        const meaning = await generateWordMeaning(player.word);
        socket.emit('word_meaning_result', meaning);
    });

    socket.on('toggle_action', ({ targetId, type }) => {
        const target = players.find(p => p.id === targetId);
        if (target) {
            if (type === 'question') target.status.question = !target.status.question;
            if (type === 'answer') target.status.answer = !target.status.answer;
            io.emit('update_game_status', players);
        }
    });

    socket.on('trigger_random_pick', ({ type }) => {
        if (players.length === 0) return;
        let candidates = [];
        if (type === 'question') candidates = players.filter(p => !p.status.question);
        else if (type === 'answer') candidates = players.filter(p => !p.status.answer);
        if (candidates.length === 0) candidates = players;
        
        if (type === 'answer') {
            const options = [...candidates, { id: 'ALL_SIMULTANEOUS', name: '一斉回答' }];
            const result = options[Math.floor(Math.random() * options.length)];
            if (result.id === 'ALL_SIMULTANEOUS') {
                simultaneousAnswers = [];
                io.emit('start_simultaneous_mode');
            } else {
                io.emit('random_pick_result', { name: result.name, type: type });
            }
        } else {
            const randomPlayer = candidates[Math.floor(Math.random() * candidates.length)];
            io.emit('random_pick_result', { name: randomPlayer.name, type: type });
        }
    });

    socket.on('submit_simultaneous_answer', (answerText) => {
        const player = players.find(p => p.id === socket.id);
        if (!player) return;
        const existing = simultaneousAnswers.find(a => a.id === socket.id);
        if (existing) { existing.text = answerText; } 
        else { simultaneousAnswers.push({ id: socket.id, name: player.name, text: answerText }); }
        
        const activePlayers = players.filter(p => io.sockets.sockets.has(p.id));
        const activeCount = activePlayers.length;

        io.emit('update_simultaneous_progress', simultaneousAnswers.length, activeCount);
        
        if (simultaneousAnswers.length >= activeCount) {
            io.emit('reveal_simultaneous_answers', simultaneousAnswers);
        }
    });

    socket.on('start_voting', () => {
        initiateVotingPhase();
    });

    socket.on('submit_vote', ({ targetId, voterId }) => {
        const target = players.find(p => p.id === targetId);
        const voter = players.find(p => p.id === voterId);
        if (voterId === deadFoxId) return;
        if (!voter || voter.status.hasVoted) return; 

        if(target) { 
            target.voteCount++; 
            target.voters.push(voter.name);
            voter.status.hasVoted = true; 
            votesReceived++; 
        }
        checkVotingCompletion();
    });

    socket.on('trigger_next_game', () => {
        gameState = 'WAITING';
        votesReceived = 0; deadFoxId = null;
        if (timer.intervalId) clearInterval(timer.intervalId);
        simultaneousAnswers = [];
        players.forEach(p => { 
            p.role=''; p.word=''; p.voteCount=0; p.voters=[]; p.status = { question: false, answer: false, hasVoted: false }; 
        });
        io.emit('reset_game'); 
        io.emit('update_players', players);
    });

    socket.on('force_reset', () => {
        players = []; gameState = 'WAITING'; votesReceived = 0; deadFoxId = null;
        if (timer.intervalId) clearInterval(timer.intervalId);
        io.emit('reset_to_login'); 
    });

    socket.on('disconnect', () => {
        if (gameState === 'WAITING') {
            players = players.filter(p => p.id !== socket.id);
            io.emit('update_players', players);
        } else if (gameState.startsWith('VOTING')) {
            const leaver = players.find(p => p.id === socket.id);
            if(leaver && !leaver.status.hasVoted && leaver.id !== deadFoxId) {
                players = players.filter(p => p.id !== socket.id);
                checkVotingCompletion();
            }
        }
    });
});

server.listen(port, () => console.log(`Server running on port ${port}`));