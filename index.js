//////////////////////////////
// Imports and setup
//////////////////////////////
const express = require('express');
const cors = require('cors');
const { Configuration, OpenAIApi } = require('openai');
const Airtable = require('airtable');

// Initialize the Express app
const app = express();
app.use(cors());
app.use(express.json());

// Environment variables (Railway or local .env)
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AIRTABLE_PERSONAL_ACCESS_TOKEN = process.env.AIRTABLE_PERSONAL_ACCESS_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

// Use PORT from environment or default to 8080
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
      'interview_session': [sessionId],  // Use lowercase and underscore as per your schema
      'Sender': sender,
      'Message_text': text               // Use underscore as per your schema
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

    // For non-streaming call with realtime-preview model as an example:
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

//////////////////////////////
// The /stream-chat Endpoint
//////////////////////////////
app.post('/stream-chat', async (req, res) => {
  try {
    const { userMessage } = req.body;
    if (!userMessage) return res.status(400).send('No userMessage provided');

    res.set({
      'Cache-Control': 'no-cache',
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive'
    });
    res.flushHeaders();

    const completion = await openai.createChatCompletion({
      model: 'gpt-4o', 
      stream: true,
      messages: [
        { role: 'system', content: "You are a helpful assistant." },
        { role: 'user', content: userMessage }
      ]
    }, { responseType: 'stream' });

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
              res.write(`data: ${content}\n\n`);
            }
          } catch (err) {
            console.error('Error parsing chunk:', err);
          }
        }
      });
    });

    completion.data.on('end', () => {
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

//////////////////////////////
// Start the Express server
//////////////////////////////

app.get('/test-airtable', async (req, res) => {
  try {
    // Use dummy data for testing record creation
    const testSessionId = 'rec6pyjVRGBKshJto';  // Replace with a valid session ID if needed
    const record = await base('interview_messages').create({
      'interview_session': [testSessionId],
      'Sender': 'Test',
      'Message_text': 'Testing airtable record creation'
    });
    console.log(`Test record created: ${record.id}`);
    res.send(`Test record created: ${record.id}`);
  } catch (error) {
    console.error('Error in /test-airtable:', error);
    res.status(500).send('Test failed');
  }
});


app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
