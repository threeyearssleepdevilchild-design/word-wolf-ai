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

const aiCooldowns = new Map();

// タイマー管理（議論のみ使用）
let timer = {
    timeLeft: 0, 
    isRunning: false,
    intervalId: null
};

// 制限全解除
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
    const fallback = { village: "バイブ", wolf: "ローター", fox: "指", reason: "予備データ" };
    if (!apiKey) return fallback;

    let subTheme = "";
    let difficultyPrompt = "";
    let examples = "";

    if (difficulty === 'sexy') {
        // ★復旧: 過激で具体的なサブテーマ
        const sexySubThemes = [
            "挿入する道具（バイブ・ディルド・張形）",
            "責める道具（ローター・電マ・クリップ）",
            "SM・拘束・責め苦（鞭・蝋燭・手錠）",
            "具体的な体位・プレイ（騎乗位・バック・対面座位）",
            "口や舌を使う行為（フェラ・クンニ・69）",
            "汁・分泌液（精液・潮・愛液・唾液）",
            "場所・シチュエーション（野外・車・風呂・鏡前）",
            "コスプレ・ロールプレイ（ナース・教師・近親）",
            "フェチ・部位（足コキ・パイズリ・脇・匂い）",
            "NTR・不倫・寝取られ・竿姉妹",
            "排泄・スカトロ・浣腸・放尿",
            "露出・痴漢・のぞき・ハプニング"
        ];
        subTheme = sexySubThemes[Math.floor(Math.random() * sexySubThemes.length)];
        
        difficultyPrompt = `
            ターゲット: R-18 (成人向け)。
            サブテーマ: 【${subTheme}】
            条件: 恥ずかしがらず、具体的で露骨な単語を選ぶこと。抽象的な言葉は禁止。
        `;

        // ★復旧: 良い例・悪い例（Few-Shot）
        examples = `
            【良い生成例】
            village: "バイブ" (振動して挿れる)
            wolf: "ディルド" (振動せず挿れる)
            fox: "ローター" (挿れずに当てる) ※似ているが用途が違う

            【悪い生成例 (避けること)】
            village: "騎乗位", wolf: "女騎乗位" 
            (※言葉がほぼ同じ（包含関係）なのでNG)
        `;

    } else {
        let diffText = "一般向け";
        if (difficulty === 'easy') diffText = "子供向け（具体的）";
        if (difficulty === 'hard') diffText = "大人向け（抽象的）";
        difficultyPrompt = `ターゲット: ${diffText}`;
    }

    const bannedWords = usedWordsHistory.join(", ");

    const prompt = `
        あなたはアダルトコンテンツに精通したゲームマスターです。
        ワードウルフのお題を作成してください。
        
        ${difficultyPrompt}
        
        【重要：禁止ワード】
        [ ${bannedWords} ]
        
        【ワードの3すくみ関係（絶対厳守）】
        1. "village" (多数派) と "wolf" (少数派) :
           - **機能・形状・ジャンルが90%一致する酷似した単語**。
           - 議論しないと見分けがつかないレベル。
           - 包含関係（例：ビールと生ビール）は禁止。

        2. "fox" (第三勢力) :
           - village/wolfとは**「カテゴリー」や「用途」が決定的に違う単語**。
           - ただし、会話に参加できる「大きな共通点」は必ず持たせること。
           - **絶対にvillage/wolfと同ジャンル（例：全員食べ物、全員性具）にしてはいけない。**

        ${examples}
        
        【出力形式】
        JSON形式のみ出力(マークダウン禁止)。
        { "village":"...", "wolf":"...", "fox":"...", "reason":"選定理由の解説" }
    `;

    try {
        console.log(`AIリクエスト(Mode: ${difficulty})...`);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 1.2 }, // 創造性UP
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
        ワードウルフ「${word}」について、バレないような当たり障りのない質問を7つ考えて。
        出力: JSON配列 ["質問1", "質問2", "質問3"]
    `;
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
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

// 投票フェーズへの移行処理
function initiateVotingPhase() {
    if (timer.intervalId) clearInterval(timer.intervalId);
    timer.isRunning = false;

    // 投票フラグをリセット
    players.forEach(p => p.status.hasVoted = false);
    votesReceived = 0;

    gameState = 'VOTING_FOX';
    io.emit('show_voting_screen', { players, phase: 'FOX', deadFoxId: null });
}

// タイマー開始処理（議論用）
function startDiscussionTimer(duration) {
    if (timer.intervalId) clearInterval(timer.intervalId);
    timer.timeLeft = duration;
    timer.isRunning = true;
    
    io.emit('timer_update', timer.timeLeft);

    timer.intervalId = setInterval(() => {
        if (timer.timeLeft > 0) {
            timer.timeLeft--;
            io.emit('timer_update', timer.timeLeft);
        } else {
            // 時間切れ -> 強制的に投票へ
            clearInterval(timer.intervalId);
            timer.isRunning = false;
            io.emit('play_sound_effect', 'vote'); // 終了音
            
            if (gameState === 'PLAYING') {
                initiateVotingPhase();
            }
        }
    }, 1000);
}

// ★復旧: 投票完了判定（バグ修正済みロジック）
function checkVotingCompletion() {
    let eligibleVoters = players.length;
    if (deadFoxId) eligibleVoters -= 1;

    if (votesReceived >= eligibleVoters) {
        const victim = calculateVoteResult();
        
        if (gameState === 'VOTING_FOX') {
            if (victim.role === 'fox') {
                deadFoxId = victim.id; 
                io.emit('fox_caught', { victimName: victim.name });
                io.to(deadFoxId).emit('start_fox_challenge');
                setTimeout(() => {
                    gameState = 'VOTING_WOLF';
                    votesReceived = 0;
                    players.forEach(p => { 
                        p.voteCount = 0; 
                        p.voters = []; 
                        p.status.hasVoted = false; 
                    });
                    // ★重要: 第2フェーズ開始（タイマーなし）
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
}

// 一斉回答管理
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

    socket.on('start_game', async ({ diff, wolfCount }) => {
        if (players.length < 3) return;
        currentDifficulty = diff;
        io.emit('loading_start');

        gameState = 'PLAYING';
        votesReceived = 0;
        deadFoxId = null;
        simultaneousAnswers = [];
        
        // 議論タイマー: 参加人数 × 3分 (180秒)
        const discussionTime = players.length * 180;
        startDiscussionTimer(discussionTime);

        players.forEach(p => { 
            p.voteCount = 0; p.status = { question: false, answer: false, hasVoted: false }; p.voters = []; 
        });

        const words = await generateWords(diff);
        currentWords = words;

        let numWolves = parseInt(wolfCount) || 1;
        if (numWolves >= players.length - 1) numWolves = 1;

        const shuffled = shuffleArray([...players]);
        shuffled.forEach((p, i) => {
            if (i < numWolves) { p.role = 'wolf'; p.word = words.wolf; } 
            else if (i === numWolves) { p.role = 'fox'; p.word = words.fox; } 
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
        io.emit('update_simultaneous_progress', simultaneousAnswers.length, players.length);
        if (simultaneousAnswers.length >= players.length) {
            io.emit('reveal_simultaneous_answers', simultaneousAnswers);
        }
    });

    // 手動で投票へ進む場合
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
            // 切断時も判定を進める
            const leaver = players.find(p => p.id === socket.id);
            if(leaver && !leaver.status.hasVoted) {
                players = players.filter(p => p.id !== socket.id);
                checkVotingCompletion();
            }
        }
    });
});

server.listen(port, () => console.log(`Server running on port ${port}`));