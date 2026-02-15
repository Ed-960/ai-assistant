const GROQ_API_KEY = (typeof CONFIG !== "undefined" && CONFIG.groqApiKey) || "";

let MENU = [];
let cart = [];
let history = [];
let nextItemId = 1;
let isListening = false;
let finalTranscript = "";

const t = CONFIG.translations[CONFIG.lang];

function initBranding() {
    // Тексты из конфига
    document.getElementById("restaurantName").textContent = "🍔 " + CONFIG.name[CONFIG.lang];
    document.getElementById("restaurantSubtitle").textContent = CONFIG.subtitle[CONFIG.lang];

    // Переводы интерфейса
    document.getElementById("startBtn").textContent = t.startBtn;
    document.getElementById("stopBtn").textContent = t.stopBtn;
    document.getElementById("clearBtn").textContent = t.clearBtn;
    document.getElementById("status").textContent = t.statusIdle;
    document.getElementById("transcript").textContent = t.transcriptIdle;
    document.getElementById("response").textContent = t.responseGreeting;
    document.getElementById("cartTitle").textContent = t.cartTitle;

    updateCartUI();

    // Цвета
    document.documentElement.style.setProperty('--primary-color', CONFIG.primaryColor);
    document.documentElement.style.setProperty('--secondary-color', CONFIG.secondaryColor);
}

async function loadMenu() {
    try {
        const response = await fetch(CONFIG.csvPath);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const csvText = await response.text();

        return new Promise((resolve, reject) => {
            Papa.parse(csvText, {
                header: true,
                skipEmptyLines: true,
                complete: (results) => {
                    MENU = results.data.filter(item => item.name);
                    console.log("Menu loaded successfully:", MENU);
                    resolve();
                },
                error: (err) => {
                    console.error("PapaParse error:", err);
                    reject(err);
                }
            });
        });
    } catch (err) {
        console.error("Detailed load error:", err);
        throw err;
    }
}

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;

if (recognition) {
    recognition.lang = CONFIG.lang === "ru" ? "ru-RU" : "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (e) => {
        let interimTranscript = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const transcript = e.results[i][0].transcript;
            if (e.results[i].isFinal) finalTranscript += transcript + " ";
            else interimTranscript += transcript;
        }
        document.getElementById("transcript").textContent = finalTranscript + interimTranscript;
    };
}

async function sendToGroq(userText) {
    document.getElementById("status").textContent = t.statusProcessing;
    const menuContext = MENU.map(i => `${i.name} (${i.description || ''}) - ${i.energy} kcal`).join('\n');
    const cartContext = `Current cart: ${JSON.stringify(cart, null, 2)}`;

    try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "llama-3.3-70b-versatile",
                messages: [
                    { role: "system", content: CONFIG.systemPrompt(menuContext, CONFIG.lang) },
                    { role: "system", content: cartContext },
                    ...history.slice(-6),
                    { role: "user", content: userText }
                ],
                temperature: 0.2
            })
        });

        const data = await res.json();
        let content = data.choices[0].message.content.trim();
        const start = content.indexOf('[');
        const end = content.lastIndexOf(']') + 1;
        const parsed = JSON.parse(content.substring(start, end));

        parsed.forEach(cmd => {
            if (cmd.action === "add_item" && cmd.item) {
                const original = MENU.find(m => m.name === cmd.item.name) || {};
                cart.push({
                    id: nextItemId++,
                    name: cmd.item.name,
                    price: Number(cmd.item.price) || 200,
                    quantity: Number(cmd.item.quantity) || 1,
                    for: cmd.item.for || (CONFIG.lang === "ru" ? "я" : "me"),
                    info: cmd.item.info || original.description || ""
                });
            }
            else if (cmd.action === "remove_item" && cmd.identifier != null) {
                cart = cart.filter(i => i.id !== Number(cmd.identifier));
            }
            else if (cmd.action === "update_item" && cmd.identifier != null && cmd.changes) {
                const item = cart.find(i => i.id === Number(cmd.identifier));
                if (item) {
                    if (cmd.changes.quantity != null) item.quantity = Number(cmd.changes.quantity);
                    if (cmd.changes.for != null) item.for = String(cmd.changes.for);
                }
            }
        });

        const assistantText = parsed.find(m => m.role === "assistant")?.content || "OK!";
        document.getElementById("response").textContent = assistantText;
        speak(assistantText);

        history.push({ role: "user", content: userText }, { role: "assistant", content: JSON.stringify(parsed) });
        updateCartUI();
        document.getElementById("status").textContent = t.statusWaiting;
    } catch (err) {
        console.error(err);
        document.getElementById("status").textContent = t.statusError;
    }
}

function updateCartUI() {
    const list = document.getElementById("cartList");
    const totalEl = document.getElementById("totalSum");
    if (cart.length === 0) {
        list.innerHTML = `<i>${t.cartEmpty}</i>`;
        totalEl.textContent = `${t.cartTotal} 0 ₽`;
        return;
    }
    let total = 0;
    list.innerHTML = cart.map(item => {
        const sum = item.price * item.quantity;
        total += sum;
        return `
            <div class="cart-item">
                <div class="cart-item-header">
                    <span><b>#${item.id}</b> ${item.name} (${item.for})</span>
                    <span>${sum.toLocaleString()} ₽</span>
                </div>
                <div class="cart-item-info">${item.quantity} ${t.cartQuantity} ${item.info ? '— ' + item.info : ''}</div>
            </div>`;
    }).join("");
    totalEl.textContent = `${t.cartTotal} ${total.toLocaleString()} ₽`;
}

function speak(text) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = CONFIG.lang === "ru" ? "ru-RU" : "en-US";
    window.speechSynthesis.speak(u);
}

document.getElementById("startBtn").onclick = () => {
    if (!recognition) return alert("Browser does not support speech recognition");
    isListening = true;
    finalTranscript = "";
    recognition.start();
    document.getElementById("startBtn").disabled = true;
    document.getElementById("stopBtn").disabled = false;
    document.getElementById("status").textContent = t.statusListening;
};

document.getElementById("stopBtn").onclick = () => {
    isListening = false;
    recognition.stop();
    document.getElementById("startBtn").disabled = false;
    document.getElementById("stopBtn").disabled = true;
    const fullText = document.getElementById("transcript").textContent.trim();
    if (fullText.length > 2) sendToGroq(fullText);
};

document.getElementById("clearBtn").onclick = () => {
    cart = []; history = []; nextItemId = 1; finalTranscript = "";
    updateCartUI();
    document.getElementById("transcript").textContent = t.transcriptIdle;
    document.getElementById("response").textContent = t.responseCleared;
};

initBranding();
loadMenu().catch(() => {
    document.getElementById("status").textContent = t.statusMenuError;
});
