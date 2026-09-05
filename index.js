const {
  Client,
  GatewayIntentBits,
  Events,
} = require("discord.js");

require("dotenv").config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const TRIGGERS = [
  {
    type: "exact",
    phrases: ["да"],
    chance: 0.30,
    replies: [
      "манда",
      "ага конечно",
      "ну да",
    ],
  },

  {
    type: "contains",
    phrases: ["го дота"],
    chance: 0.30,
    replies: [
      "опять?",
      "погнали",
      "дота до добра не доведёт",
    ],
  },
];

function randomItem(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function triggerMatches(trigger, text) {
  if (trigger.type === "exact") {
    return trigger.phrases.includes(text);
  }

  if (trigger.type === "contains") {
    return trigger.phrases.some((phrase) =>
      text.includes(phrase)
    );
  }

  return false;
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Танюха запущена как ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const text = message.content
    .toLowerCase()
    .trim();

  for (const trigger of TRIGGERS) {
    if (!triggerMatches(trigger, text)) {
      continue;
    }

    if (Math.random() > trigger.chance) {
      continue;
    }

    const reply = randomItem(trigger.replies);

    await message.reply({
      content: reply,
      allowedMentions: {
        repliedUser: false,
      },
    });

    break;
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error("❌ Не найден DISCORD_TOKEN");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
