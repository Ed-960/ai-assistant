# Voice AI Cashier

Голосовой кассир с пайплайном симуляции диалогов.

## Структура проекта

```
voiceAI/
├── index.html, style.css, script.js   # Веб-интерфейс (голос)
├── config.js                         # Настройки интерфейса
├── mcd.csv, menu.csv                # Меню ресторана
├── pipeline/                         # Пайплайн симуляции
│   ├── config.js                    # API key, пути
│   ├── profileGenerator.js          # Генератор профилей клиентов
│   ├── menuLoader.js                # Загрузка меню + RAG-поиск
│   ├── agents.js                    # LLM: Client + Cashier
│   ├── orderState.js                # Извлечение заказа из диалога
│   ├── validation.js                # Валидация (аллергены, калории, галлюцинации)
│   ├── dialogLoop.js                # Цикл одного диалога
│   └── run.js                       # Запуск батча
├── data/dialogs/                     # Сохранённые диалоги (JSON)
└── package.json
```

## Запуск веб-интерфейса

```bash
python3 -m http.server 8000
# Открыть http://localhost:8000
```

## Запуск пайплайна

### Ollama (локально, без лимитов)

```bash
# 1. Запустить Ollama
brew services start ollama

# 2. Скачать модель (qwen2.5 — мультиязык, диалоги, 4.7GB)
ollama pull qwen2.5:7b-instruct

# 3. (опционально) Удалить старую модель
ollama rm llama3.2:3b

# 4. Запустить пайплайн
node pipeline/run.js --count 1
```

### Z.ai / Groq (облако)

```bash
# Z.ai (по умолчанию если API_PROVIDER не задан)
API_PROVIDER=zai node pipeline/run.js --count 1

# Groq
API_PROVIDER=groq GROQ_API_KEY=gsk_xxx node pipeline/run.js --count 1
```

## Переменные окружения

- `API_PROVIDER` — `ollama` | `zai` | `groq`
- `API_MODEL` — модель (ollama: `llama3.2:3b`, zai: `glm-4.7-flash`)
- `OLLAMA_URL` — URL Ollama (по умолчанию `http://localhost:11434/v1/chat/completions`)
