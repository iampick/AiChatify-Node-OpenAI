const axios = require('axios');
const express = require('express');
const bodyParser = require('body-parser');
const { PrismaClient } = require('@prisma/client');
const OpenAI = require('openai');
const getImageBinary = require('../../../utils/getImageBinary');
const { uploadFile } = require('../../../utils/cloudinary');
const waitForStandby = require('./waitForStandby');

const router = express.Router();
const prisma = new PrismaClient();
const openai = new OpenAI();

const config = {
  accessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET_TOKEN,
};

const LineHeader = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${config.accessToken}`,
};

router.get('/', (req, res) => {
  res.status(200).json({ message: 'Hello API from GET' });
});

router.post('/', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  console.log(req.body);

  if (process.env.LINE_BOT !== 'on') {
    return res.status(200).json({ message: 'Hello API' });
  }

    const data_raw = req.body;
    let retrieveMsg = '';
    let imageParts = '';
    let files = [];
    let retrieveImage = '';
    let userId = '';

    const messageType = data_raw.events[0].message.type;
    const lineType = data_raw.events[0].type;
    if (lineType === 'join' || lineType === 'leave') {
      return true;
    }
    if (messageType !== 'text') {
      return true;
    }
    // return res.status(200).json({ message: 'Hello API from GET' });

    const replyToken = data_raw.events[0].replyToken;
    const sourceType = data_raw.events[0].source.type;

    userId = data_raw.events[0].source.userId;
    const messageId = data_raw.events[0].message.id;

    if (sourceType === 'group') {
      userId = data_raw.events[0].source.groupId;
      lineEndpoint = 'https://api.line.me/v2/bot/message/reply';
    } else if (sourceType == 'user') {
      userId = data_raw.events[0].source.userId;
      lineEndpoint = 'https://api.line.me/v2/bot/message/reply';
    }

    let conversionId = '';
    // console.log(messageType);
    if (messageType === 'text') {
      retrieveMsg = data_raw.events[0].message.text;
    } else if (messageType === 'image') {
      res.status(200).json({ message: 'Hello API' });
      return true;
      retrieveImage = await getImageBinary(messageId, LineHeader);
      // const mimeType = 'image/png';
      const ImgBuff = Buffer.from(retrieveImage).toString('base64');
      imageParts = await uploadFile(`data:image/png;base64,${ImgBuff}`, userId);
      retrieveMsg = 'Please wait for question';
      console.log(imageParts.url);
      imageParts = imageParts.url;
      files = [
        {
          type: 'image',
          transfer_method: 'remote_url',
          url: imageParts,
          upload_file_id: '',
        },
      ];
    }
    // console.log(data_raw.events[0].message);
    // console.log(files);

    const last10Chars = process.env.OPENAI_ASSISTANT_ID.slice(-10);

    // Query to get all todos from the "todo" table
    const userInDb = await prisma.UserConv.findFirst({
      where: {
        userId: userId,
        apiId: last10Chars,
      },
      orderBy: {
        id: 'desc',
      },
      take: 1,
    });

  if (userInDb) {
    await waitForStandby(userId, last10Chars);
    await prisma.userConv.updateMany({
      where: { userId, apiId: last10Chars },
      data: { status: 'sending' },
    });
    return userInDb.conversionId;
  }
  return '';
}

async function handleOpenAiResponse(response, userId, replyToken) {
  const rawData = response.message.replace(/\*/g, '');
  const responseConverId = response.converId;
  const last10Chars = process.env.OPENAI_ASSISTANT_ID.slice(-10);

  const checkUserExist = await prisma.userConv.count({
    where: { userId, apiId: last10Chars },
  });

  if (checkUserExist === 0) {
    await prisma.userConv.create({
      data: { userId, conversionId: responseConverId, apiId: last10Chars, status: 'sending' },
    });
  }

  const cleanAnswer = rawData.replace(/Final Answer: /g, '');
  const data = {
    replyToken,
    messages: [{ type: 'text', text: cleanAnswer }],
  };

  await axios.post('https://api.line.me/v2/bot/message/reply', data, { headers: LineHeader });
  await prisma.userConv.updateMany({
    where: { userId, apiId: last10Chars },
    data: { status: 'standby' },
  });
}

async function connectOpenAi(dataAI) {
  const api_key = process.env.DIFY_API_KEY;
  const assistant_id = process.env.OPENAI_ASSISTANT_ID;
  const data_raw = JSON.parse(dataAI);
  let thread_id = data_raw.conversionId || (await openai.beta.threads.create()).id;

  await openai.beta.threads.messages.create(thread_id, {
    role: 'user',
    content: data_raw.message.trim(),
  });

  const run = await openai.beta.threads.runs.createAndPoll(thread_id, {
    assistant_id,
    instructions: data_raw.message.trim(),
  });

  if (run.status === 'completed') {
    const messages = await openai.beta.threads.messages.list(run.thread_id);
    const compleatAnswer = messages.data.reverse().find(
      (msg) => msg.role === 'assistant' && msg.content[0].text.value
    ).content[0].text.value;

    return { message: compleatAnswer, converId: thread_id };
  } else {
    throw new Error(run.status);
  }
}

function logRecursive(obj, depth = 0) {
  const indent = ' '.repeat(depth * 2);

  if (Array.isArray(obj)) {
    console.log(indent + '[');
    obj.forEach((item, index) => {
      console.log(indent + '  ' + index + ':');
      logRecursive(item, depth + 1);
    });
    console.log(indent + ']');
  } else if (obj !== null && typeof obj === 'object') {
    console.log(indent + '{');
    for (let key in obj) {
      if (obj.hasOwnProperty(key)) {
        console.log(indent + '  ' + key + ':');
        logRecursive(obj[key], depth + 1);
      }
    }
    console.log(indent + '}');
  } else {
    console.log(indent + obj);
  }
}

module.exports = router;
