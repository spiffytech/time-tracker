import { Client as Discord, GatewayIntentBits, Partials } from "discord.js";
import { Temporal } from "temporal-polyfill";

interface TimeRecord {
  key: string; // a unique string identifier for this record. When creating new record, it is the responsibility of the client to generate this key with a good random generator.
  t1: number; // the record start time as an integer Unix timestamp.
  t2: number; // the record stop time as an integer Unix timestamp.
  ds: string; // the record description (can be empty).
  mt: number; // the modified time (set by the client).
  st: number; // the server time (set by the server when storing a record). Clients should set this to 0.0 for new records.
}

const getTimeRecords = async (): Promise<TimeRecord[]> => {
  const url = new URL("https://timetagger.app/api/v2/records");
  url.searchParams.append("timerange", `0-${new Date().getTime() / 1_000}`);
  const response = await fetch(url, {
    headers: {
      authtoken: process.env.timetaggerKey!,
    },
  });

  const records = (await response.json()).records as TimeRecord[];
  // Deleted records begin with HIDDEN. Leaving them in messes up our looking
  // for the most recent record.
  return records.filter((r) => !r.ds.startsWith("HIDDEN"));
};

const getLatestTimeRecord = async (): Promise<TimeRecord> => {
  const records = await getTimeRecords();
  return records.at(-1)!;
};

const stopTimer = async (record: TimeRecord) => {
  record = { ...record, t2: new Date().getTime() / 1_000 };
  const url = new URL("https://timetagger.app/api/v2/records");
  url.searchParams.append("timerange", `0-${new Date().getTime() / 1_000}`);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authtoken: process.env.timetaggerKey!,
    },
    body: JSON.stringify([record]),
  });
};

const createRecord = async (
  latestRecord: TimeRecord | null,
  newRecords: Omit<TimeRecord, "st">[]
) => {
  // Check for and close any active task
  if (latestRecord && latestRecord.t1 === latestRecord.t2) {
    await stopTimer(latestRecord);
  }

  const url = new URL("https://timetagger.app/api/v2/records");
  url.searchParams.append("timerange", `0-${new Date().getTime() / 1_000}`);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      authtoken: process.env.timetaggerKey!,
    },
    body: JSON.stringify(newRecords),
  });
};

function randomSampleTime(mean = 15, stdDev = 2) {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

  // Convert to minutes, centered on mean with given standard deviation
  return mean + z * stdDev;
}

let nextInterrogationTimer: ReturnType<typeof setTimeout> | null = null;

const enqueueNextMessage = () => {
  // Clear any existing timer
  if (nextInterrogationTimer !== null) {
    clearTimeout(nextInterrogationTimer);
    nextInterrogationTimer = null;
  }

  const offsetMinutes = randomSampleTime();
  const offsetMs = offsetMinutes * 60 * 1000;
  console.log(
    `Scheduling next interrogation in ${offsetMinutes.toFixed(2)} minutes`
  );

  nextInterrogationTimer = setTimeout(() => {
    nextInterrogationTimer = null;
    interrogateUser();
  }, offsetMs);
};

const discord = new Discord({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

await discord.login(process.env.discordApiKey!);
const user = await discord.users.fetch(process.env.discordUserId!);

let outstandingMessages = 0;
const interrogateUser = async () => {
  if (outstandingMessages > 3) {
    console.warn(
      "User is idle, skipping interrogation until they start answering messages."
    );
    return;
  }

  const currentActivity = await getLatestTimeRecord();

  const message = await user.send(
    `What have you been working on?\nCurrent activity: ${currentActivity.ds}`
  );
  const reactionCollector = message.createReactionCollector();
  reactionCollector.on("collect", async (reaction) => {
    console.log(reaction.emoji.name);
    switch (reaction.emoji.name) {
      case "🛑":
        await stopTimer(currentActivity);
        await message.reply("Timer stopped.");
        outstandingMessages = 0;
        break;
      case "➡️":
        await message.reply("Continuing current activity.");
        outstandingMessages = 0;
        break;
    }
    enqueueNextMessage();
  });

  outstandingMessages += 1;
  enqueueNextMessage();
};

const extractTimeLogsFromMessage = (
  latestRecord: TimeRecord | null,
  text: string
): Omit<TimeRecord, "st">[] => {
  const lines = text.split("\n");
  const linesWithMinutes = lines.map((line) => {
    const match = line.match(/((?<minutes>\d+)\s+)?(?<description>.*)/);
    return {
      minutes: match!.groups!.minutes,
      description: match!.groups!.description,
    };
  });
  const matchCount = linesWithMinutes.filter(
    (line) => line.minutes !== undefined
  ).length;
  if (matchCount < lines.length - 1) {
    throw new Error("Not enough lines specified their duration");
  }
  const minutesTotal = linesWithMinutes.reduce(
    (acc, item) => acc + parseFloat(item.minutes ?? "0"),
    0
  );
  if (latestRecord && latestRecord.t1 === latestRecord.t2) {
    console.log("Updating last record");
    latestRecord = {
      ...latestRecord,
      t2: Temporal.Now.instant().epochSeconds,
    };
  }
  // For now, just ignore whether this is before or after the start time of the
  // last record. We'll just do overlapping records.
  let recordStart = Temporal.Now.instant().subtract({ minutes: minutesTotal });
  const records: Omit<TimeRecord, "st">[] = linesWithMinutes.map(
    ({ minutes, description }) => {
      const t1 = recordStart.epochSeconds;
      recordStart = recordStart.add({ minutes: parseFloat(minutes ?? "0") });
      const t2 = recordStart.epochSeconds;
      return {
        key: Bun.randomUUIDv7(),
        ds: description,
        t1,
        t2,
        mt: t2,
      };
    }
  );
  if (latestRecord) {
    records.unshift(latestRecord);
  }
  return records;
};

discord.on("messageCreate", async (message) => {
  if (message.author.id === discord.user!.id) return;
  console.log(message.content);
  const wasMessagingDisabled = outstandingMessages >= 3;
  outstandingMessages = 0;
  const content = message.content.replace(/\\#/g, "#");
  const latestRecord = await getLatestTimeRecord();
  try {
    const records = extractTimeLogsFromMessage(latestRecord, content);
    await createRecord(latestRecord, records);
    await message.reply("Record created.");

    // Only schedule a new message if messaging was previously disabled and we don't have one scheduled
    if (wasMessagingDisabled && nextInterrogationTimer === null) {
      console.log("Messaging was disabled, scheduling next interrogation");
      enqueueNextMessage();
    }
  } catch {
    await message.reply("Not enough lines specified their duration.");
  }
});

enqueueNextMessage();
await interrogateUser();
