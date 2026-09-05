const {
  Client,
  GatewayIntentBits,
  Events,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");

// =====================================================
// DISCORD
// =====================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// =====================================================
// TRIGGERS
// =====================================================

const TRIGGERS_FILE = path.join(__dirname, "triggers.json");

let triggers = [];

// =====================================================
// GITHUB BACKUP
// =====================================================

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_BACKUP_REPO = process.env.GITHUB_BACKUP_REPO;

const GITHUB_BACKUP_PATH = "triggers.json";

// =====================================================
// ОБЩИЕ ФУНКЦИИ
// =====================================================

function generateId() {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 6)
  );
}

function defaultTriggers() {
  return [
    {
      id: generateId(),
      phrase: "да",
      type: "exact",
      chance: 30,
      replies: ["манда"],
    },
  ];
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .trim();
}

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function parseReplies(text) {
  return String(text || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function typeName(type) {
  if (type === "exact") {
    return "Точное сообщение";
  }

  if (type === "word") {
    return "Отдельное слово/фраза";
  }

  if (type === "contains") {
    return "Содержит текст";
  }

  return type;
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =====================================================
// ПРОВЕРКА СООБЩЕНИЯ
// =====================================================

function triggerMatches(trigger, messageText) {
  const text = normalizeText(messageText);
  const phrase = normalizeText(trigger.phrase);

  if (!phrase) {
    return false;
  }

  // Сообщение должно быть ровно таким.
  //
  // да        ✅
  // ДА        ✅
  //   да      ✅
  // дабы      ❌
  // ну да     ❌
  // да пошли  ❌
  if (trigger.type === "exact") {
    return text === phrase;
  }

  // Фраза должна быть отдельным словом.
  //
  // ну да конечно ✅
  // дабы           ❌
  if (trigger.type === "word") {
    const escaped = escapeRegex(phrase);

    const regex = new RegExp(
      `(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`,
      "iu"
    );

    return regex.test(text);
  }

  // Просто ищет текст внутри сообщения.
  if (trigger.type === "contains") {
    return text.includes(phrase);
  }

  return false;
}

// =====================================================
// ЛОКАЛЬНЫЙ triggers.json
// =====================================================

function saveLocalTriggers() {
  fs.writeFileSync(
    TRIGGERS_FILE,
    JSON.stringify(triggers, null, 2),
    "utf8"
  );
}

function loadLocalTriggers() {
  try {
    if (!fs.existsSync(TRIGGERS_FILE)) {
      return null;
    }

    const raw = fs.readFileSync(TRIGGERS_FILE, "utf8");
    const data = JSON.parse(raw);

    if (!Array.isArray(data)) {
      throw new Error("triggers.json должен содержать массив");
    }

    return data;
  } catch (error) {
    console.error(
      "❌ Ошибка локального triggers.json:",
      error.message
    );

    return null;
  }
}

// =====================================================
// GITHUB API
// =====================================================

function githubConfigured() {
  return Boolean(
    GITHUB_TOKEN &&
    GITHUB_OWNER &&
    GITHUB_BACKUP_REPO
  );
}

function githubUrl() {
  return (
    `https://api.github.com/repos/` +
    `${GITHUB_OWNER}/` +
    `${GITHUB_BACKUP_REPO}/contents/` +
    `${GITHUB_BACKUP_PATH}`
  );
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Liza-Discord-Bot",
  };
}

async function getGitHubFile() {
  if (!githubConfigured()) {
    return null;
  }

  const response = await fetch(githubUrl(), {
    headers: githubHeaders(),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `GitHub GET вернул ${response.status}`
    );
  }

  return response.json();
}

// =====================================================
// СКАЧАТЬ triggers.json ИЗ BACKUP
// =====================================================

async function downloadTriggersFromGitHub() {
  const file = await getGitHubFile();

  if (!file?.content) {
    return null;
  }

  const base64 = file.content.replace(/\n/g, "");

  const text = Buffer.from(
    base64,
    "base64"
  ).toString("utf8");

  const data = JSON.parse(text);

  if (!Array.isArray(data)) {
    throw new Error(
      "triggers.json в GitHub имеет неверный формат"
    );
  }

  return data;
}

// =====================================================
// ЗАГРУЗИТЬ triggers.json В BACKUP
// =====================================================

async function backupTriggersToGitHub() {
  if (!githubConfigured()) {
    throw new Error(
      "GitHub backup не настроен"
    );
  }

  const currentFile = await getGitHubFile();

  const content = Buffer.from(
    JSON.stringify(triggers, null, 2),
    "utf8"
  ).toString("base64");

  const body = {
    message: "Automatic Liza triggers backup",
    content,
  };

  // Если triggers.json уже существует,
  // GitHub требует SHA текущей версии.
  if (currentFile?.sha) {
    body.sha = currentFile.sha;
  }

  const response = await fetch(githubUrl(), {
    method: "PUT",

    headers: {
      ...githubHeaders(),
      "Content-Type": "application/json",
    },

    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `GitHub PUT ${response.status}: ${errorText}`
    );
  }

  console.log(
    `☁️ GitHub backup обновлён. Триггеров: ${triggers.length}`
  );
}

// =====================================================
// СОХРАНИТЬ
// =====================================================

async function saveEverything() {
  // Сначала ВСЕГДА сохраняем на VPS.
  saveLocalTriggers();

  // Потом пытаемся сделать GitHub backup.
  try {
    await backupTriggersToGitHub();

    return true;
  } catch (error) {
    console.error(
      "⚠️ GitHub backup не удался:",
      error.message
    );

    return false;
  }
}

// =====================================================
// ЗАГРУЗКА ТРИГГЕРОВ ПРИ СТАРТЕ
// =====================================================

async function initializeTriggers() {
  // ВАЖНО:
  // если на VPS уже есть triggers.json,
  // берём именно его.
  //
  // Это защищает нас, если GitHub временно не работал,
  // а локальная версия новее.

  const local = loadLocalTriggers();

  if (local !== null) {
    triggers = local;

    console.log(
      `💾 С VPS загружено триггеров: ${triggers.length}`
    );

    return;
  }

  // Локального файла нет.
  // Например это абсолютно новый VPS.
  //
  // Тогда пробуем восстановить из GitHub.

  if (githubConfigured()) {
    try {
      const cloud = await downloadTriggersFromGitHub();

      if (cloud !== null) {
        triggers = cloud;

        saveLocalTriggers();

        console.log(
          `☁️ Из GitHub восстановлено триггеров: ${triggers.length}`
        );

        return;
      }
    } catch (error) {
      console.error(
        "⚠️ Не удалось восстановить GitHub backup:",
        error.message
      );
    }
  }

  // Нет ни локального файла,
  // ни GitHub backup.
  //
  // Создаём первоначальный триггер.

  triggers = defaultTriggers();

  saveLocalTriggers();

  console.log(
    `🆕 Создан первоначальный triggers.json`
  );

  // Сразу пытаемся создать первый backup.
  if (githubConfigured()) {
    try {
      await backupTriggersToGitHub();
    } catch (error) {
      console.error(
        "⚠️ Первый GitHub backup не удался:",
        error.message
      );
    }
  }
}

// =====================================================
// SLASH: /триггер
// =====================================================

const triggerCommand = new SlashCommandBuilder()
  .setName("триггер")
  .setDescription("Управление триггерами Лизы")
  .setDefaultMemberPermissions(
    PermissionFlagsBits.Administrator
  )

  // ---------------------------------
  // ДОБАВИТЬ
  // ---------------------------------

  .addSubcommand((sub) =>
    sub
      .setName("добавить")
      .setDescription("Добавить новый триггер")

      .addStringOption((option) =>
        option
          .setName("фраза")
          .setDescription("На какую фразу реагировать")
          .setRequired(true)
      )

      .addStringOption((option) =>
        option
          .setName("тип")
          .setDescription("Как искать фразу")
          .setRequired(true)
          .addChoices(
            {
              name: "Точное сообщение",
              value: "exact",
            },
            {
              name: "Отдельное слово/фраза",
              value: "word",
            },
            {
              name: "Содержит текст",
              value: "contains",
            }
          )
      )

      .addIntegerOption((option) =>
        option
          .setName("шанс")
          .setDescription("Шанс ответа от 1 до 100%")
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true)
      )

      .addStringOption((option) =>
        option
          .setName("ответы")
          .setDescription(
            "Через | Например: манда | ага | понял"
          )
          .setRequired(true)
      )
  )

  // ---------------------------------
  // ИЗМЕНИТЬ
  // ---------------------------------

  .addSubcommand((sub) =>
    sub
      .setName("изменить")
      .setDescription("Изменить существующий триггер")

      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("ID из команды /триггеры")
          .setRequired(true)
      )

      .addStringOption((option) =>
        option
          .setName("фраза")
          .setDescription("Новая фраза")
      )

      .addStringOption((option) =>
        option
          .setName("тип")
          .setDescription("Новый тип")
          .addChoices(
            {
              name: "Точное сообщение",
              value: "exact",
            },
            {
              name: "Отдельное слово/фраза",
              value: "word",
            },
            {
              name: "Содержит текст",
              value: "contains",
            }
          )
      )

      .addIntegerOption((option) =>
        option
          .setName("шанс")
          .setDescription("Новый шанс")
          .setMinValue(1)
          .setMaxValue(100)
      )

      .addStringOption((option) =>
        option
          .setName("ответы")
          .setDescription("Новые ответы через |")
      )
  )

  // ---------------------------------
  // УДАЛИТЬ
  // ---------------------------------

  .addSubcommand((sub) =>
    sub
      .setName("удалить")
      .setDescription("Удалить триггер")

      .addStringOption((option) =>
        option
          .setName("id")
          .setDescription("ID из команды /триггеры")
          .setRequired(true)
      )
  )

  // ---------------------------------
  // РУЧНОЙ BACKUP
  // ---------------------------------

  .addSubcommand((sub) =>
    sub
      .setName("бэкап")
      .setDescription(
        "Принудительно сохранить триггеры в GitHub"
      )
  )

  // ---------------------------------
  // RESTORE
  // ---------------------------------

  .addSubcommand((sub) =>
    sub
      .setName("восстановить")
      .setDescription(
        "Восстановить триггеры из GitHub"
      )
  );

// =====================================================
// SLASH: /триггеры
// =====================================================

const listCommand = new SlashCommandBuilder()
  .setName("триггеры")
  .setDescription("Показать все триггеры Лизы")
  .setDefaultMemberPermissions(
    PermissionFlagsBits.Administrator
  );

const commands = [
  triggerCommand,
  listCommand,
];

// =====================================================
// READY
// =====================================================

client.once(Events.ClientReady, async (readyClient) => {
  console.log(
    `✅ Лиза запущена как ${readyClient.user.tag}`
  );

  try {
    for (const guild of readyClient.guilds.cache.values()) {
      await guild.commands.set(
        commands.map((command) => command.toJSON())
      );

      console.log(
        `✅ Slash-команды зарегистрированы: ${guild.name}`
      );
    }
  } catch (error) {
    console.error(
      "❌ Ошибка регистрации slash-команд:",
      error
    );
  }
});

// =====================================================
// ОБЫЧНЫЕ СООБЩЕНИЯ
// =====================================================

client.on(Events.MessageCreate, async (message) => {
  // Не отвечаем ботам.
  if (message.author.bot) {
    return;
  }

  // Только сообщения на Discord-сервере.
  if (!message.guild) {
    return;
  }

  const text = normalizeText(message.content);

  for (const trigger of triggers) {
    if (!triggerMatches(trigger, text)) {
      continue;
    }

    const roll = Math.random() * 100;

    if (roll >= trigger.chance) {
      continue;
    }

    if (
      !Array.isArray(trigger.replies) ||
      trigger.replies.length === 0
    ) {
      continue;
    }

    const reply = randomItem(trigger.replies);

    try {
      await message.reply({
        content: reply,

        allowedMentions: {
          repliedUser: false,
        },
      });
    } catch (error) {
      console.error(
        "❌ Ошибка ответа на триггер:",
        error
      );
    }

    // На одно сообщение максимум один ответ.
    break;
  }
});

// =====================================================
// SLASH COMMAND HANDLER
// =====================================================

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  // Только админы сервера.
  if (
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return interaction.reply({
      content:
        "❌ Только администраторы могут управлять триггерами.",

      flags: MessageFlags.Ephemeral,
    });
  }

  // ===================================================
  // /триггеры
  // ===================================================

  if (interaction.commandName === "триггеры") {
    if (triggers.length === 0) {
      return interaction.reply({
        content: "Триггеров пока нет.",
        flags: MessageFlags.Ephemeral,
      });
    }

    let text = "## 🧠 Триггеры Лизы\n\n";

    for (let i = 0; i < triggers.length; i++) {
      const trigger = triggers[i];

      const block =
        `**${i + 1}. "${trigger.phrase}"**\n` +
        `ID: \`${trigger.id}\`\n` +
        `Тип: ${typeName(trigger.type)}\n` +
        `Шанс: ${trigger.chance}%\n` +
        `Ответы: ${trigger.replies.join(" | ")}\n\n`;

      if ((text + block).length > 1900) {
        text +=
          "\n...остальные триггеры не поместились.";

        break;
      }

      text += block;
    }

    return interaction.reply({
      content: text,
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.commandName !== "триггер") {
    return;
  }

  const sub = interaction.options.getSubcommand();

  // ===================================================
  // /триггер добавить
  // ===================================================

  if (sub === "добавить") {
    const phrase =
      interaction.options.getString("фраза");

    const type =
      interaction.options.getString("тип");

    const chance =
      interaction.options.getInteger("шанс");

    const replies = parseReplies(
      interaction.options.getString("ответы")
    );

    if (replies.length === 0) {
      return interaction.reply({
        content:
          "❌ Нужно указать хотя бы один ответ.",

        flags: MessageFlags.Ephemeral,
      });
    }

    const newTrigger = {
      id: generateId(),
      phrase: phrase.trim(),
      type,
      chance,
      replies,
    };

    triggers.push(newTrigger);

    const cloudSaved =
      await saveEverything();

    return interaction.reply({
      content:
        `✅ Триггер добавлен.\n\n` +
        `Фраза: **${newTrigger.phrase}**\n` +
        `Тип: **${typeName(newTrigger.type)}**\n` +
        `Шанс: **${newTrigger.chance}%**\n` +
        `Ответы: **${newTrigger.replies.join(" | ")}**\n` +
        `ID: \`${newTrigger.id}\`\n\n` +
        (
          cloudSaved
            ? "☁️ GitHub backup обновлён."
            : "⚠️ На VPS сохранено, но GitHub backup не обновился."
        ),

      flags: MessageFlags.Ephemeral,
    });
  }

  // ===================================================
  // /триггер изменить
  // ===================================================

  if (sub === "изменить") {
    const id =
      interaction.options.getString("id");

    const trigger = triggers.find(
      (item) => item.id === id
    );

    if (!trigger) {
      return interaction.reply({
        content:
          "❌ Триггер с таким ID не найден.",

        flags: MessageFlags.Ephemeral,
      });
    }

    const phrase =
      interaction.options.getString("фраза");

    const type =
      interaction.options.getString("тип");

    const chance =
      interaction.options.getInteger("шанс");

    const repliesRaw =
      interaction.options.getString("ответы");

    if (phrase !== null) {
      trigger.phrase = phrase.trim();
    }

    if (type !== null) {
      trigger.type = type;
    }

    if (chance !== null) {
      trigger.chance = chance;
    }

    if (repliesRaw !== null) {
      const replies = parseReplies(repliesRaw);

      if (replies.length === 0) {
        return interaction.reply({
          content:
            "❌ Ответы не могут быть пустыми.",

          flags: MessageFlags.Ephemeral,
        });
      }

      trigger.replies = replies;
    }

    const cloudSaved =
      await saveEverything();

    return interaction.reply({
      content:
        `✅ Триггер изменён.\n\n` +
        `Фраза: **${trigger.phrase}**\n` +
        `Тип: **${typeName(trigger.type)}**\n` +
        `Шанс: **${trigger.chance}%**\n` +
        `Ответы: **${trigger.replies.join(" | ")}**\n\n` +
        (
          cloudSaved
            ? "☁️ GitHub backup обновлён."
            : "⚠️ На VPS сохранено, но GitHub backup не обновился."
        ),

      flags: MessageFlags.Ephemeral,
    });
  }

  // ===================================================
  // /триггер удалить
  // ===================================================

  if (sub === "удалить") {
    const id =
      interaction.options.getString("id");

    const index = triggers.findIndex(
      (item) => item.id === id
    );

    if (index === -1) {
      return interaction.reply({
        content:
          "❌ Триггер с таким ID не найден.",

        flags: MessageFlags.Ephemeral,
      });
    }

    const removed =
      triggers.splice(index, 1)[0];

    const cloudSaved =
      await saveEverything();

    return interaction.reply({
      content:
        `🗑️ Триггер **"${removed.phrase}"** удалён.\n\n` +
        (
          cloudSaved
            ? "☁️ GitHub backup обновлён."
            : "⚠️ На VPS сохранено, но GitHub backup не обновился."
        ),

      flags: MessageFlags.Ephemeral,
    });
  }

  // ===================================================
  // /триггер бэкап
  // ===================================================

  if (sub === "бэкап") {
    try {
      saveLocalTriggers();

      await backupTriggersToGitHub();

      return interaction.reply({
        content:
          "☁️ Бэкап успешно сохранён в GitHub.",

        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error(error);

      return interaction.reply({
        content:
          `❌ Не удалось сделать backup:\n\`${error.message}\``,

        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ===================================================
  // /триггер восстановить
  // ===================================================

  if (sub === "восстановить") {
    try {
      const restored =
        await downloadTriggersFromGitHub();

      if (restored === null) {
        return interaction.reply({
          content:
            "❌ В GitHub пока нет triggers.json.",

          flags: MessageFlags.Ephemeral,
        });
      }

      triggers = restored;

      saveLocalTriggers();

      return interaction.reply({
        content:
          `♻️ Восстановлено триггеров: **${triggers.length}**`,

        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error(error);

      return interaction.reply({
        content:
          `❌ Ошибка восстановления:\n\`${error.message}\``,

        flags: MessageFlags.Ephemeral,
      });
    }
  }
});

// =====================================================
// START
// =====================================================

async function main() {
  if (!process.env.DISCORD_TOKEN) {
    console.error(
      "❌ Не найден DISCORD_TOKEN"
    );

    process.exit(1);
  }

  await initializeTriggers();

  await client.login(
    process.env.DISCORD_TOKEN
  );
}

main().catch((error) => {
  console.error(
    "❌ Ошибка запуска Лизы:",
    error
  );

  process.exit(1);
});
