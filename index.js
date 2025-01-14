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
        'Session_status': 'In Progress'
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
    await base('interview_messages').create({
      'interview_session': [sessionId],
      'Sender': sender,
      'Message_text': text
    });
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
console.log("Received body:", req.body); // Add this line
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
        stream: true,
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
    // Use the correct method to retrieve model information
    const modelResponse = await openai.retrieveModel('gpt-4o-realtime-preview');
    console.log('Retrieved model data:', modelResponse.data);  // Log for debugging
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

app.post('/stream-chat', (req, res) => {
  console.log('Received POST to /stream-chat');
  res.json({ message: 'stream-chat endpoint is working!' });
});


//////////////////////////////
// Start the Express server
//////////////////////////////
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
