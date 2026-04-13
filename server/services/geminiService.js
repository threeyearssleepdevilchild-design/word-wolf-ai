const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// セーフティ設定（コンテンツフィルタによるブロックを防止）
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// 履歴ファイルのパス
const HISTORY_FILE = path.join(__dirname, '../../data/word_history.json');

/**
 * 過去に使用したワードの履歴を取得
 * @returns {string[]}
 */
function getWordHistory() {
    try {
        // データディレクトリが存在しない場合は作成
        const dataDir = path.dirname(HISTORY_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        if (fs.existsSync(HISTORY_FILE)) {
            const data = fs.readFileSync(HISTORY_FILE, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('履歴読み込みエラー:', error);
    }
    return [];
}

/**
 * 新しいワードを履歴に追加（最大50件保持）
 * @param {string[]} newWords 
 */
function addToWordHistory(newWords) {
    try {
        let history = getWordHistory();

        // 新しいワードを追加
        history = [...newWords, ...history];

        // 50件を超えたら古いものを削除
        if (history.length > 50) {
            history = history.slice(0, 50);
        }

        // データディレクトリが存在しない場合は作成
        const dataDir = path.dirname(HISTORY_FILE);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error('履歴保存エラー:', error);
    }
}

/**
 * ワードウルフのお題を生成する
 * @param {string} wordMode 'adult' または 'safe'
 * @returns {Promise<{village: string, wolf: string, fox: string}>}
 */
async function generateTopics(wordMode = 'adult') {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', safetySettings });

    // 過去の履歴を取得
    const wordHistory = getWordHistory();
    const historyList = wordHistory.length > 0
        ? `\n\n【使用禁止ワード - 過去に使用済み】\n${wordHistory.join('、')}`
        : '';

    let prompt;

    if (wordMode === 'safe') {
        // 一般モード: 全て安全なワード
        prompt = `あなたはワードウルフゲームのお題を生成するAIです。
全年齢対応の一般的なお題を生成してください。

【ルール】
- village と wolf は同じジャンルの似た一般的な言葉にする
- fox は全く違うジャンルの一般的な言葉にする
- 3つ全てが同じジャンルにならないようにする（これが最重要）
- R-18、セクシー、アダルトな内容は絶対に含めないこと

【絶対に守るべきルール】
1. villageとwolfは同じジャンルの似た言葉にする（例：コーヒーと紅茶、どちらも飲み物）
2. foxは全く違うジャンルで、かすりもしない言葉にする（例：消防車）
3. 3つ全てが同じジャンルにならないようにする
4. 【重要】villageとwolfは「意味が重複しない」こと！
   - NG例: 「リンゴ」と「果物」（リンゴは果物の一種なのでNG）
   - NG例: 「犬」と「動物」（犬は動物の一種なのでNG）
   - OK例: 「コーヒー」と「紅茶」（同じカテゴリだが別物なのでOK）

【参考カテゴリ】
- 食べ物・飲み物（ラーメンとうどん、コーラとサイダー）
- 動物（犬と猫、ライオンとトラ）
- スポーツ（野球とサッカー、テニスとバドミントン）
- 乗り物（電車とバス、飛行機とヘリコプター）
- 場所・建物（東京タワーとスカイツリー、学校と塾）
- 季節・行事（クリスマスとハロウィン、花火と盆踊り）
- 楽器・音楽（ギターとベース、ピアノとオルガン）
- ゲーム・遊び（将棋とチェス、トランプとUNO）
- 文房具（鉛筆とシャーペン、ノートとルーズリーフ）
- 家電・道具（掃除機とほうき、冷蔵庫と冷凍庫）

【良い例】
village: "コーヒー"
wolf: "紅茶"
fox: "消防車"

【他の良い例】
village: "ピアノ"
wolf: "ギター"
fox: "カレーライス"${historyList}

【出力形式】
以下のJSON形式のみで出力してください。説明は不要です。
{"village": "xxx", "wolf": "xxx", "fox": "xxx"}`;
    } else {
        // 大人向けモード: 既存のパターンA/B
        // ランダムにパターンを選択（50%ずつ）
        const isPatternA = Math.random() < 0.5;

        if (isPatternA) {
            // パターンA: 村/狼が大人向け、狐が一般ワード
            prompt = `あなたはワードウルフゲームのお題を生成するAIです。
今回は【パターンA】で生成してください。

【パターンA - 村人と狼が大人向け、狐が一般ワード】
- village と wolf は同じジャンルの似た「セクシーな大人向け(R-18)」の言葉にする
- fox は全く違うジャンルの「一般的な」言葉にする

【セクシーテーマの参考カテゴリ（これらから選んでください）】
- 下着・ランジェリー・勝負服
- 大人の道具・おもちゃ（バイブ・ローター・電マなど）
- 夜のテクニック・体位（騎乗位・バック・対面座位など）
- 興奮するシチュエーション・場所
- 身体の部位（胸・尻など）・フェチ（匂いなど）
- コスプレ・ロールプレイ
- Sっ気・Mっ気・攻めと受け・痴女
- ギリギリのライン（露出・スリル）
- 浮気・不倫・修羅場・寝取られ（NTR）
- 挿入する道具（バイブ・ディルド・張形）
- 責める道具（ローター・電マ・クリップ・鞭・蝋燭・手錠）
- SM・拘束・責め苦
- 口や舌を使う行為（フェラ・クンニ・69）
- 汁・分泌液（精液・潮・愛液・唾液）
- アナル・浣腸・放尿

【絶対に守るべきルール】
1. villageとwolfは同じジャンルの似た言葉にする（例：バイブとローター、どちらも性具）
2. foxは全く違うジャンルで、かすりもしない一般的な言葉にする（例：原子力発電所）
3. 3つ全てが同じジャンルにならないようにする（これが最重要）
4. 【重要】villageとwolfは「意味が重複しない」こと！
   - NG例: 「コンドーム」と「避妊具」（コンドームは避妊具の一種なのでNG）
   - NG例: 「リンゴ」と「果物」（リンゴは果物の一種なのでNG）
   - OK例: 「バイブ」と「ローター」（同じカテゴリだが別物なのでOK）

【良い例】
village: "バイブ"（大人向け）
wolf: "ローター"（大人向け）
fox: "原子力発電所"（一般ワード、全く違うジャンル）${historyList}

【出力形式】
以下のJSON形式のみで出力してください。説明は不要です。
{"village": "xxx", "wolf": "xxx", "fox": "xxx"}`;
        } else {
            // パターンB: 狐が大人向け、村/狼が一般ワード
            prompt = `あなたはワードウルフゲームのお題を生成するAIです。
今回は【パターンB】で生成してください。

【パターンB - 狐が大人向け、村人と狼が一般ワード】
- village と wolf は同じジャンルの似た「一般的な」言葉にする
- fox は全く違うジャンルの「セクシーな大人向け(R-18)」の言葉にする

【セクシーテーマの参考カテゴリ（foxはこれらから選んでください）】
- 下着・ランジェリー・勝負服
- 大人の道具・おもちゃ（バイブ・ローター・電マなど）
- 夜のテクニック・体位（騎乗位・バック・対面座位など）
- 興奮するシチュエーション・場所
- 身体の部位（胸・尻など）・フェチ（匂いなど）
- コスプレ・ロールプレイ
- Sっ気・Mっ気・攻めと受け・痴女
- ギリギリのライン（露出・スリル）
- 浮気・不倫・修羅場・寝取られ（NTR）
- 挿入する道具（バイブ・ディルド・張形）
- 責める道具（ローター・電マ・クリップ・鞭・蝋燭・手錠）
- SM・拘束・責め苦
- 口や舌を使う行為（フェラ・クンニ・69）
- 汁・分泌液（精液・潮・愛液・唾液）
- アナル・浣腸・放尿

【絶対に守るべきルール】
1. villageとwolfは同じジャンルの似た一般的な言葉にする（例：コーヒーと紅茶、どちらも飲み物）
2. foxは全く違うジャンルで、かすりもしない大人向けの言葉にする（例：バイブ）
3. 3つ全てが同じジャンルにならないようにする（これが最重要）
4. 【重要】villageとwolfは「意味が重複しない」こと！
   - NG例: 「リンゴ」と「果物」（リンゴは果物の一種なのでNG）
   - NG例: 「犬」と「動物」（犬は動物の一種なのでNG）
   - OK例: 「コーヒー」と「紅茶」（同じカテゴリだが別物なのでOK）

【良い例】
village: "コーヒー"（一般ワード）
wolf: "紅茶"（一般ワード）
fox: "バイブ"（大人向け、全く違うジャンル）

【他の良い例】
village: "東京タワー"（一般ワード）
wolf: "スカイツリー"（一般ワード）
fox: "ローター"（大人向け、全く違うジャンル）${historyList}

【出力形式】
以下のJSON形式のみで出力してください。説明は不要です。
{"village": "xxx", "wolf": "xxx", "fox": "xxx"}`;
        }
    }

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        // JSON部分を抽出
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const topics = JSON.parse(jsonMatch[0]);

            // 新しいワードを履歴に追加
            addToWordHistory([topics.village, topics.wolf, topics.fox]);

            console.log(`🎯 お題生成 (${wordMode === 'safe' ? '一般モード' : '大人向けモード'}):`, topics);

            return topics;
        }
        throw new Error('Invalid response format');
    } catch (error) {
        console.error('お題生成エラー:', error.message || error);
        // フォールバック（ランダムに選択）
        const safeFallbacks = [
            { village: "コーヒー", wolf: "紅茶", fox: "消防車" },
            { village: "野球", wolf: "サッカー", fox: "たこ焼き" },
            { village: "犬", wolf: "猫", fox: "新幹線" },
            { village: "ピアノ", wolf: "ギター", fox: "カレーライス" },
            { village: "東京タワー", wolf: "スカイツリー", fox: "すき焼き" },
            { village: "将棋", wolf: "チェス", fox: "冷蔵庫" },
            { village: "ラーメン", wolf: "うどん", fox: "パンダ" },
            { village: "電車", wolf: "バス", fox: "ケーキ" },
            { village: "鉛筆", wolf: "シャーペン", fox: "イルカ" },
            { village: "クリスマス", wolf: "ハロウィン", fox: "掃除機" },
        ];
        const adultFallbacks = [
            { village: "コーヒー", wolf: "紅茶", fox: "バイブ" },
            { village: "バイブ", wolf: "ローター", fox: "原子力発電所" },
            { village: "騎乗位", wolf: "バック", fox: "回転寿司" },
            { village: "コスプレ", wolf: "メイド服", fox: "掃除機" },
            { village: "手錠", wolf: "鞭", fox: "東京タワー" },
        ];
        const pool = wordMode === 'safe' ? safeFallbacks : adultFallbacks;
        return pool[Math.floor(Math.random() * pool.length)];
    }
}

/**
 * お題に対する質問案を5個生成する
 * @param {string} topic お題
 * @returns {Promise<string[]>}
 */
async function generateQuestions(topic) {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash', safetySettings });

    const prompt = `ワードウルフゲームで「${topic}」というお題が出ています。
このお題について他の参加者に質問する内容を5個、簡潔に提案してください。
質問は相手が村人か狼かを見極めるのに役立つものにしてください。

【出力形式】
以下のJSON配列形式のみで出力してください。
["質問1", "質問2", "質問3", "質問4", "質問5"]`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error('Invalid response format');
    } catch (error) {
        console.error('質問生成エラー:', error);
        return [
            "それを最後に使ったのはいつですか？",
            "それの色は何色ですか？",
            "それはどこで買えますか？",
            "それを使うときの気持ちは？",
            "それの値段はどれくらいですか？"
        ];
    }
}

module.exports = { generateTopics, generateQuestions };
