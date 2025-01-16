//////////////////////////////
// Imports and setup
//////////////////////////////
const express = require('express');
const cors = require('cors');
const { Configuration, OpenAIApi } = require('openai');
const Airtable = require('airtable');

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AIRTABLE_PERSONAL_ACCESS_TOKEN = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const PORT = process.env.PORT || 8080;

//////////////////////////////
// Configure OpenAI and Airtable
//////////////////////////////
const configuration = new Configuration({
  apiKey: OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);
const base = new Airtable({ apiKey: AIRTABLE_PERSONAL_ACCESS_TOKEN }).base(AIRTABLE_BASE_ID);

//////////////////////////////
// Helper Functions
//////////////////////////////
async function findOrCreateSession(stakeholderID, projectID) {
  try {
    const records = await base('interview_sessions')
      .select({
        filterByFormula: `AND({Stakeholder} = "${stakeholderID}", {ProjectID} = "${projectID}")`,
        maxRecords: 1
      })
      .firstPage();

    if (records.length > 0) {
      return records[0].id;
    } else {
      const newRec = await base('interview_sessions').create({
        'Stakeholder': stakeholderID, 
        'ProjectID': projectID,
        'Session_Status': 'In Progress'
      });
      return newRec.id;
    }
  } catch (error) {
    console.error('Error in findOrCreateSession:', error);
    throw error;
  }
}

async function createMessageRecord(sessionId, sender, text) {
  try {
    console.log(`Creating message record: Session=${sessionId}, Sender=${sender}, Text=${text}`);
    const record = await base('interview_messages').create({
      'interview_session': [sessionId],
      'Sender': sender,
      'Message_text': text
    });
    console.log(`Message record created: ${record.id}`);
  } catch (error) {
    console.error('Error in createMessageRecord:', error);
    throw error;
  }
}

//////////////////////////////
// The /voice-chat Endpoint
//////////////////////////////
app.post('/voice-chat', async (req, res) => {
  try {
    console.log("Received body:", req.body);
    const { stakeholderID, projectID, userMessage } = req.body;
    if (!userMessage) {
      return res.status(400).json({ error: 'No userMessage provided' });
    }

    const sessionId = await findOrCreateSession(stakeholderID, projectID);
    await createMessageRecord(sessionId, 'User', userMessage);

    const messages = [
      {
        role: 'system',
        content: `You are an AI that interviews stakeholders about project requirements. 
                  This session is for ProjectID: ${projectID}.`
      },
      {
        role: 'user',
        content: userMessage
      }
    ];

    const completion = await openai.createChatCompletion({
      model: 'gpt-4o-realtime-preview',
      messages
    });
    const aiResponse = completion.data.choices[0].message.content;

    await createMessageRecord(sessionId, 'AI', aiResponse);
    return res.json({ aiResponse });
  } catch (error) {
    console.error('Error in /voice-chat:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

//////////////////////////////
// Test route to verify server
//////////////////////////////
app.get('/test', (req, res) => {
  res.send("Test route is working!");
});

app.get('/model-info', async (req, res) => {
  try {
    const modelResponse = await openai.retrieveModel('gpt-4o-realtime-preview');
    console.log('Retrieved model data:', modelResponse.data);
    res.json({ model: modelResponse.data });
  } catch (error) {
    console.error('Error retrieving model info:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: 'Could not retrieve model info' });
  }
});

app.get('/list-models', async (req, res) => {
  try {
    const modelsResponse = await openai.listModels();
    res.json(modelsResponse.data);
  } catch (error) {
    console.error('Error listing models:', error);
    res.status(500).json({ error: 'Could not list models' });
  }
});

app.post('/stream-chat', async (req, res) => {
  try {
    const { stakeholderID, projectID, userMessage } = req.body;
    if (!userMessage) return res.status(400).send('No userMessage provided');

    // Create/find session and store user message in Airtable
    const sessionId = await findOrCreateSession(stakeholderID, projectID);
    await createMessageRecord(sessionId, 'User', userMessage);

    // Set up Server-Sent Events (SSE) headers for streaming
    res.set({
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive'
    });
    res.flushHeaders();

    // Call OpenAI with streaming enabled
    const completion = await openai.createChatCompletion({
      model: 'gpt-4o',  // or another model of choice
      stream: true,
      messages: [
        { role: 'system', content: "You are a helpful assistant." },
        { role: 'user', content: userMessage }
      ]
    }, { responseType: 'stream' });

    let aiResponseFull = '';

    completion.data.on('data', (chunk) => {
      const payloads = chunk.toString().split('\n\n');
      payloads.forEach((payload) => {
        if (payload.includes('[DONE]')) return;
        if (payload.trim() !== '') {
          try {
            const dataStr = payload.replace(/^data: /, '');
            const dataObj = JSON.parse(dataStr);
            const content = dataObj.choices?.[0]?.delta?.content;
            if (content) {
              aiResponseFull += content;
              res.write(`data: ${content}\n\n`);
            }
          } catch (err) {
            console.error('Error parsing chunk:', err);
          }
        }
      });
    });

    completion.data.on('end', async () => {
      // Save the complete AI response to Airtable
      await createMessageRecord(sessionId, 'AI', aiResponseFull);
      res.write('data: [STREAM_DONE]\n\n');
      res.end();
    });

    completion.data.on('error', (error) => {
      console.error('OpenAI stream error:', error);
      res.end();
    });

  } catch (error) {
    console.error('Error in /stream-chat:', error);
    res.status(500).send('Server error');
  }
});
app.post('/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;
    if (!text) return res.status(400).json({ error: "No text provided" });

    const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({ text, voice: voice || "nova" })
    });

    if (!ttsResponse.ok) {
      console.error("TTS API response error:", ttsResponse.status, ttsResponse.statusText);
      return res.status(ttsResponse.status).send("TTS API error");
    }

    const audioData = await ttsResponse.arrayBuffer();
    res.set({ "Content-Type": "audio/mpeg" });
    res.send(Buffer.from(audioData));
  } catch (error) {
    console.error("Error in /tts endpoint:", error);
    res.status(500).send("Server error in TTS");
  }
});


//////////////////////////////
// Start the Express server
//////////////////////////////
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
