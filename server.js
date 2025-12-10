require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// APIキーの確認
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

// AIリクエスト関数
async function callGemini(prompt) {
    // ★修正: 最も安定している gemini-1.5-flash-001 を指定
    const model = "gemini-1.5-flash-001";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { 
                    temperature: 1.2,
                    responseMimeType: "application/json"
                },
                safetySettings: SAFETY_SETTINGS
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`🚨 API Error (${model}): ${response.status} - ${errText}`);
            return null;
        }

        const data = await response.json();
        if (!data.candidates || !data.candidates[0].content) return null;
        return data.candidates[0].content.parts[0].text;

    } catch (e) {
        console.error("🚨 Network/Fetch Error:", e);
        return null;
    }
}

async function generateWords(difficulty) {
    const fallback = { village: "バイブ", wolf: "ローター", fox: "指", reason: "予備データ(生成失敗)" };
    if (!apiKey) return fallback;

    const pivotRoll = Math.random();
    let pivotRole = 'village'; 
    if (pivotRoll < 0.3) pivotRole = 'wolf'; 
    else if (pivotRoll < 0.45) pivotRole = 'fox'; 

    let subTheme = "";
    let difficultyPrompt = "";

    if (difficulty === 'sexy') {
        const sexySubThemes = ["下着", "おもちゃ", "体位", "シチュエーション", "フェチ", "コスプレ", "SM", "露出", "不倫"];
        subTheme = sexySubThemes[Math.floor(Math.random() * sexySubThemes.length)];
        difficultyPrompt = `ターゲット: R-18。サブテーマ:【${subTheme}】。具体的で露骨な単語を選ぶこと。`;
    } else {
        difficultyPrompt = "ターゲット: 一般向け。";
    }

    const prompt = `
        ワードウルフのお題を作成してください。
        生成手順: まず【${pivotRole}】の単語を決め、それを基準に他を決める。
        ${difficultyPrompt}
        【条件】
        1. village(多数)とwolf(少数)は機能・形状が酷似した単語。
        2. fox(第三勢力)はカテゴリーが全く違う単語。
        出力: JSON { "village":"...", "wolf":"...", "fox":"...", "reason":"..." }
    `;

    console.log(`🤖 Generating words (Mode: ${difficulty})...`);
    const jsonText = await callGemini(prompt);
    
    if (!jsonText) return fallback;

    try {
        const cleanText = jsonText.replace(/```json/g, '').replace(/```/g, '').trim();
        const json = JSON.parse(cleanText);
        if (!json.village || !json.wolf || !json.fox) return fallback;
        return { village: json.village, wolf: json.wolf, fox: json.fox, reason: json.reason || "" };
    } catch (e) {
        console.error("JSON Parse Error:", e);
        return fallback;
    }
}

async function generateAiQuestions(word) {
    if (!apiKey) return ["質問案1", "質問案2", "質問案3"];
    const prompt = `ワードウルフ「${word}」について、バレないような簡素な質問を3つ。出力: JSON配列 ["質問1", "質問2", "質問3"]`;
    const jsonText = await callGemini(prompt);
    if(!jsonText) return ["質問できませんでした"];
    try {
        return JSON.parse(jsonText.replace(/```json/g, '').replace(/```/g, '').trim());
    } catch(e) { return ["エラー"]; }
}

async function generateWordMeaning(word) {
    if (!apiKey) return "APIキーなし";
    const prompt = `単語「${word}」の意味を簡潔に説明して。`;
    const text = await callGemini(prompt);
    return text ? text.trim() : "解説を取得できませんでした。";
}

// ゲーム進行ロジック
function checkVotingCompletion() {
    let eligibleVoters = players.length;
    if (deadFoxId) eligibleVoters -= 1;
    io.emit('update_vote_progress', { current: votesReceived, total: eligibleVoters });

    if (votesReceived >= eligibleVoters) {
        const sorted = [...players.filter(p => p.id !== deadFoxId)].sort((a, b) => b.voteCount - a.voteCount);
        const maxVotes = sorted[0].voteCount;
        const candidates = sorted.filter(p => p.voteCount === maxVotes);
        const victim = candidates[Math.floor(Math.random() * candidates.length)]; // 同数ならランダム

        if (gameState === 'VOTING_FOX') {
            if (victim.role === 'fox') {
                deadFoxId = victim.id; 
                io.emit('fox_caught', { victimName: victim.name });
                setTimeout(() => {
                    gameState = 'VOTING_WOLF';
                    votesReceived = 0;
                    players.forEach(p => { p.voteCount = 0; p.voters = []; p.status.hasVoted = false; });
                    io.emit('show_voting_screen', { players, phase: 'WOLF', deadFoxId: deadFoxId });
                    io.emit('update_vote_progress', { current: 0, total: eligibleVoters });
                }, 4000); 
            } else {
                gameState = 'RESULT';
                io.emit('game_result', { players, winner: 'FOX', victimName: victim.name, reason: currentWords.reason });
            }
        } 
        else if (gameState === 'VOTING_WOLF') {
            gameState = 'RESULT';
            const winner = (victim.role === 'wolf') ? 'VILLAGE' : 'WOLF';
            io.emit('game_result', { players, winner: winner, victimName: victim.name, reason: currentWords.reason });
        }
    }
}

let simultaneousAnswers = [];

io.on('connection', (socket) => {
    socket.emit('timer_update', timer.timeLeft);

    socket.on('join_game', (playerName) => {
        const existing = players.find(p => p.name === playerName);
        const newPlayer = { id: socket.id, name: playerName, role: '', word: '', voteCount: 0, status: { question: false, answer: false, hasVoted: false }, voters: [] };
        if (gameState === 'WAITING') {
            if (existing) existing.id = socket.id; else players.push(newPlayer);
            io.emit('update_players', players);
        } else {
            if (existing) {
                existing.id = socket.id;
                socket.emit('game_started', { word: existing.word, difficulty: currentDifficulty });
                socket.emit('update_game_status', players);
                if(gameState.startsWith('VOTING')) socket.emit('show_voting_screen', { players, phase: gameState.includes('WOLF')?'WOLF':'FOX', deadFoxId });
            } else socket.emit('error_msg', '進行中です');
        }
    });

    socket.on('start_game', async ({ diff, wolfCount }) => {
        if (players.length < 3) return;
        currentDifficulty = diff;
        currentWolfCount = parseInt(wolfCount) || 1;
        gameState = 'PLAYING';
        votesReceived = 0; deadFoxId = null; simultaneousAnswers = [];
        io.emit('loading_start');

        if(timer.intervalId) clearInterval(timer.intervalId);
        timer.timeLeft = players.length * 150;
        timer.isRunning = true;
        
        timer.intervalId = setInterval(() => {
            if(timer.timeLeft > 0) { timer.timeLeft--; io.emit('timer_update', timer.timeLeft); }
            else { 
                clearInterval(timer.intervalId); timer.isRunning = false; 
                io.emit('play_sound_effect', 'vote');
                if(gameState==='PLAYING') {
                    gameState = 'VOTING_FOX';
                    votesReceived = 0;
                    players.forEach(p => p.status.hasVoted = false);
                    io.emit('show_voting_screen', { players, phase: 'FOX', deadFoxId: null });
                    io.emit('update_vote_progress', { current: 0, total: players.length });
                }
            }
        }, 1000);

        const words = await generateWords(diff);
        currentWords = words;
        
        // 配役
        const shuffled = shuffleArray([...players]);
        shuffled.forEach((p, i) => {
            p.voteCount=0; p.voters=[]; p.status={question:false, answer:false, hasVoted:false};
            if (i < currentWolfCount) { p.role = 'wolf'; p.word = words.wolf; } 
            else if (i === currentWolfCount) { p.role = 'fox'; p.word = words.fox; } 
            else { p.role = 'villager'; p.word = words.village; }
            io.to(p.id).emit('game_started', { word: p.word, difficulty: diff });
        });
        players = shuffled;
        io.emit('update_game_status', players);
    });

    socket.on('submit_vote', ({ targetId, voterId }) => {
        const target = players.find(p => p.id === targetId);
        const voter = players.find(p => p.id === voterId);
        if (voterId === deadFoxId || !voter || voter.status.hasVoted) return;
        if(target) { target.voteCount++; target.voters.push(voter.name); voter.status.hasVoted = true; votesReceived++; }
        checkVotingCompletion();
    });

    socket.on('trigger_next_game', () => {
        gameState = 'WAITING'; votesReceived = 0; deadFoxId = null;
        if (timer.intervalId) clearInterval(timer.intervalId);
        players.forEach(p => { p.role=''; p.word=''; p.voteCount=0; p.voters=[]; p.status={question:false, answer:false, hasVoted:false}; });
        io.emit('reset_game'); io.emit('update_players', players);
    });

    socket.on('force_reset', () => {
        players = []; gameState = 'WAITING'; votesReceived = 0; deadFoxId = null;
        if (timer.intervalId) clearInterval(timer.intervalId);
        io.emit('reset_to_login'); 
    });

    socket.on('request_ai_questions', async () => {
        const p = players.find(x => x.id === socket.id);
        if(p) socket.emit('ai_questions_result', await generateAiQuestions(p.word));
    });
    socket.on('request_word_meaning', async () => {
        const p = players.find(x => x.id === socket.id);
        if(p) socket.emit('word_meaning_result', await generateWordMeaning(p.word));
    });
    
    // 他のアクション系
    socket.on('toggle_action', ({ targetId, type }) => {
        const t = players.find(p => p.id === targetId);
        if (t) { t.status[type] = !t.status[type]; io.emit('update_game_status', players); }
    });
    socket.on('trigger_random_pick', ({ type }) => {
        if(players.length===0)return;
        const c = players.filter(p => !p.status[type]);
        const cand = c.length ? c : players;
        const r = cand[Math.floor(Math.random() * cand.length)];
        io.emit('random_pick_result', { name: r.name, type });
    });
    socket.on('submit_simultaneous_answer', (text) => {
        const p = players.find(x=>x.id===socket.id);
        if(!p) return;
        const ex = simultaneousAnswers.find(a=>a.id===socket.id);
        if(ex) ex.text=text; else simultaneousAnswers.push({id:socket.id, name:p.name, text});
        const active = players.filter(pl => io.sockets.sockets.has(pl.id)).length;
        io.emit('update_simultaneous_progress', simultaneousAnswers.length, active);
        if(simultaneousAnswers.length >= active) io.emit('reveal_simultaneous_answers', simultaneousAnswers);
    });
    socket.on('start_voting', () => { 
        if(gameState === 'PLAYING') {
            if (timer.intervalId) clearInterval(timer.intervalId);
            gameState = 'VOTING_FOX'; votesReceived=0;
            players.forEach(p => p.status.hasVoted = false);
            io.emit('show_voting_screen', { players, phase: 'FOX', deadFoxId: null });
            io.emit('update_vote_progress', { current: 0, total: players.length });
        }
    });
    socket.on('trigger_sound_effect', (t) => io.emit('play_sound_effect', t));
    
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