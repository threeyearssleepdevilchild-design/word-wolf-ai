require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

const rawApiKey = process.env.GEMINI_API_KEY || "";
const apiKey = rawApiKey.trim(); 
if(apiKey) console.log(`API Key set: ${apiKey.substring(0,3)}...`);

app.use(express.static('public'));

let players = []; 
let gameState = 'WAITING'; 
let votesReceived = 0; 
let usedWordsHistory = []; 
let currentWords = { village: "", wolf: "", fox: "", reason: "" };
let deadFoxId = null;
let currentDifficulty = 'sexy';

// ★追加1: AI質問のクールダウン管理（プレイヤーID -> 最後に押した時刻）
const aiCooldowns = new Map();

// ★追加2: 共有タイマー管理用
let timer = {
    timeLeft: 180, // デフォルト3分
    isRunning: false,
    intervalId: null
};

const SAFETY_SETTINGS = [
    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
];

// シャッフル関数
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function generateWords(difficulty) {
    const fallback = { village: "おにぎり", wolf: "サンドイッチ", fox: "ハンバーガー", reason: "予備データ" };
    if (!apiKey) return fallback;

    let subTheme = "";
    if (difficulty === 'sexy') {
        const sexySubThemes = [
            "下着・ランジェリー・勝負服",
            "大人の道具・おもちゃ",
            "夜のテクニック・体位",
            "興奮するシチュエーション・場所",
            "身体の部位（胸・尻など）・フェチ（匂いなど）",
            "コスプレ・ロールプレイ",
            "Sっ気・Mっ気・攻めと受け・痴女",
            "ギリギリのライン（露出・スリル）",
            "浮気・不倫・修羅場・寝取られ",
        ];
        subTheme = sexySubThemes[Math.floor(Math.random() * sexySubThemes.length)];
    }

    let diffText = "一般向け";
    let themeText = "一般的な単語";
    if (difficulty === 'easy') { diffText = "子供向け"; themeText = "具体的"; }
    else if (difficulty === 'hard') { diffText = "大人向け"; themeText = "抽象的"; }
    else if (difficulty === 'sexy') { diffText = "R-18 (成人向け)"; themeText = `セクシー、下ネタ。サブテーマ:【${subTheme}】`; }

    const bannedWords = usedWordsHistory.join(", ");

    const prompt = `
        ワードウルフのお題を作成。
        ターゲット: ${diffText}, テーマ: ${themeText}
        
        【重要：禁止ワード】
        以下の単語は過去に使用したため、今回は**絶対に使用しないでください**:
        [ ${bannedWords} ]
        
        【ワードの3すくみ関係（絶対厳守）】
        1. "village" (多数派) と "wolf" (少数派) :
           - **非常に似ている単語**（用途、形、ジャンルがほぼ同じ）。
           - 議論しないと見分けがつかないレベル。（例：うどん vs そば）
           - **ほぼ意味が同じ単語**は使用しないこと（例：**騎乗位**と**女騎乗位**、**おっぱい**と**ぱい**など）。

        2. "fox" (第三勢力) :
           - village/wolfとは**「全く違う」単語**。
           - ただし、会話に参加できる程度の共通点は持たせること。
           - カテゴリーや質感が決定的に違うもの。
        
        【出力形式】
        JSON形式のみ出力(マークダウン禁止)。
        { "village":"...", "wolf":"...", "fox":"...", "reason":"簡単な解説" }
    `;

    try {
        console.log(`AIリクエスト(Mode: ${difficulty})...`);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.0 },
                safetySettings: SAFETY_SETTINGS
            })
        });

        if (!response.ok) throw new Error(response.status);
        const data = await response.json();
        if (!data.candidates || !data.candidates[0]) return fallback;

        let text = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(text);

        const v = json.village || json.Village;
        const w = json.wolf || json.Wolf;
        const f = json.fox || json.Fox;
        const r = json.reason || json.Reason || "";

        if (!v || !w || !f) return fallback;

        usedWordsHistory.push(v, w, f);
        if (usedWordsHistory.length > 150) {
            usedWordsHistory = usedWordsHistory.slice(-150);
        }

        return { village: v, wolf: w, fox: f, reason: r };

    } catch (e) { console.error(e); return fallback; }
}

async function generateAiQuestions(word) {
    if (!apiKey) return ["質問案1", "質問案2", "質問案3"];
    const prompt = `
        ワードウルフ「${word}」について、バレないような当たり障りのない質問を3つ考えて。
        出力: JSON配列 ["質問1", "質問2", "質問3"]
    `;
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], safetySettings: SAFETY_SETTINGS })
        });
        const data = await response.json();
        let text = data.candidates[0].content.parts[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e) { return ["好きな色は？", "コンビニで買える？", "家にありますか？"]; }
}

function calculateVoteResult() {
    const sorted = [...players].sort((a, b) => b.voteCount - a.voteCount);
    const maxVotes = sorted[0].voteCount;
    const candidates = sorted.filter(p => p.voteCount === maxVotes);
    return candidates[Math.floor(Math.random() * candidates.length)];
}

io.on('connection', (socket) => {
    // 接続時に現在のタイマー状態を送る
    socket.emit('timer_update', timer.timeLeft);

    socket.on('join_game', (playerName) => {
        const existing = players.find(p => p.name === playerName);
        const newPlayer = { 
            id: socket.id, name: playerName, role: '', word: '', voteCount: 0, 
            status: { question: false, answer: false }, voters: [] 
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
                    socket.emit('show_voting_screen', { players, phase: gameState, deadFoxId });
                }
                if(gameState === 'RESULT') socket.emit('game_result', { players, winner: 'unknown', reason: currentWords.reason });
                
                if(existing.id === deadFoxId && gameState === 'VOTING_WOLF') {
                    socket.emit('start_fox_challenge');
                }
                io.emit('update_players', players);
            } else {
                socket.emit('error_msg', 'ゲーム進行中です');
            }
        }
    });

    // ★タイマー制御
    socket.on('timer_control', (action) => {
        if (action === 'start' && !timer.isRunning) {
            timer.isRunning = true;
            timer.intervalId = setInterval(() => {
                if (timer.timeLeft > 0) {
                    timer.timeLeft--;
                    io.emit('timer_update', timer.timeLeft);
                } else {
                    clearInterval(timer.intervalId);
                    timer.isRunning = false;
                    // 時間切れの音を鳴らすなどの処理が可能
                }
            }, 1000);
        } else if (action === 'stop') {
            if (timer.intervalId) clearInterval(timer.intervalId);
            timer.isRunning = false;
        } else if (action === 'reset') {
            if (timer.intervalId) clearInterval(timer.intervalId);
            timer.isRunning = false;
            timer.timeLeft = 180; // 3分にリセット
            io.emit('timer_update', timer.timeLeft);
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

        players.forEach(p => {
            if (p.role === 'wolf') p.word = words.wolf;
            else if (p.role === 'fox') p.word = words.fox;
            else p.word = words.village;
            io.to(p.id).emit('game_started', { word: p.word, difficulty: currentDifficulty });
        });
    });

    socket.on('start_game', async (diff) => {
        if (players.length < 3) return;
        currentDifficulty = diff;
        io.emit('loading_start');

        gameState = 'PLAYING';
        votesReceived = 0;
        deadFoxId = null; 
        
        // ゲーム開始時にタイマーリセット＆自動スタート
        if (timer.intervalId) clearInterval(timer.intervalId);
        timer.timeLeft = 180;
        timer.isRunning = true;
        timer.intervalId = setInterval(() => {
            if (timer.timeLeft > 0) {
                timer.timeLeft--;
                io.emit('timer_update', timer.timeLeft);
            } else {
                clearInterval(timer.intervalId);
                timer.isRunning = false;
            }
        }, 1000);

        players.forEach(p => { 
            p.voteCount = 0; p.status = { question: false, answer: false }; p.voters = []; 
        });

        const words = await generateWords(diff);
        currentWords = words;

        const shuffled = shuffleArray([...players]);
        
        shuffled.forEach((p, i) => {
            if (i === 0) { p.role = 'wolf'; p.word = words.wolf; }
            else if (i === 1) { p.role = 'fox'; p.word = words.fox; }
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

        // ★追加: クールダウンチェック（90秒）
        const lastTime = aiCooldowns.get(socket.id) || 0;
        const now = Date.now();
        if (now - lastTime < 90000) {
            // 90秒経過していなければ何もしない
            return;
        }
        aiCooldowns.set(socket.id, now);

        const questions = await generateAiQuestions(player.word);
        socket.emit('ai_questions_result', questions);
    });

    socket.on('submit_fox_guess', ({ vGuess, wGuess }) => {
        if (socket.id !== deadFoxId) return;
        const isHitVillage = currentWords.village.includes(vGuess) || vGuess.includes(currentWords.village);
        const isHitWolf = currentWords.wolf.includes(wGuess) || wGuess.includes(currentWords.wolf);

        if (isHitVillage && isHitWolf) {
            gameState = 'RESULT';
            const winnerName = players.find(p => p.id === deadFoxId).name;
            io.emit('game_result', { players, winner: 'FOX_REVERSE', victimName: winnerName, guessWord: `${vGuess} & ${wGuess}`, reason: currentWords.reason });
        } else {
            socket.emit('fox_challenge_failed');
        }
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
        const randomPlayer = candidates[Math.floor(Math.random() * candidates.length)];
        io.emit('random_pick_result', { name: randomPlayer.name, type: type });
    });

    socket.on('start_voting', () => {
        // 投票開始でタイマーストップ
        if (timer.intervalId) clearInterval(timer.intervalId);
        timer.isRunning = false;

        gameState = 'VOTING_FOX';
        io.emit('show_voting_screen', { players, phase: 'FOX', deadFoxId: null });
    });

    socket.on('submit_vote', ({ targetId, voterId }) => {
        const target = players.find(p => p.id === targetId);
        const voter = players.find(p => p.id === voterId);
        if (voterId === deadFoxId) return;

        if(target && voter) { 
            target.voteCount++; 
            target.voters.push(voter.name);
            votesReceived++; 
        }

        let requiredVotes = players.length;
        if (deadFoxId) requiredVotes -= 1;

        if(votesReceived >= requiredVotes) {
            const victim = calculateVoteResult();
            
            if (gameState === 'VOTING_FOX') {
                if (victim.role === 'fox') {
                    deadFoxId = victim.id; 
                    io.emit('fox_caught', { victimName: victim.name });
                    io.to(deadFoxId).emit('start_fox_challenge');
                    setTimeout(() => {
                        gameState = 'VOTING_WOLF';
                        votesReceived = 0;
                        players.forEach(p => { p.voteCount = 0; p.voters = []; });
                        io.emit('show_voting_screen', { players, phase: 'WOLF', deadFoxId: deadFoxId });
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
    });

    socket.on('trigger_next_game', () => {
        gameState = 'WAITING';
        votesReceived = 0; deadFoxId = null;
        players.forEach(p => { 
            p.role=''; p.word=''; p.voteCount=0; p.voters=[]; p.status = { question: false, answer: false }; 
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
        }
    });
});

server.listen(port, () => console.log(`Server running on port ${port}`));