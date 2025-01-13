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
const PORT = process.env.PORT || 3000;

// Configure OpenAI
const configuration = new Configuration({
  apiKey: OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);

// Configure Airtable
const base = new Airtable({ apiKey: AIRTABLE_PERSONAL_ACCESS_TOKEN }).base(AIRTABLE_BASE_ID);

//////////////////////////////
// Helper Functions
//////////////////////////////

// 1) Find or create an Interview Session in "interview_sessions"
async function findOrCreateSession(stakeholderID, projectID) {
  try {
    const records = await base('interview_sessions')
      .select({
        filterByFormula: `AND({Stakeholder} = "${stakeholderID}", {ProjectID} = "${projectID}")`,
        maxRecords: 1
      })
      .firstPage();

    if (records.length > 0) {
      // Session already exists
      return records[0].id;
    } else {
      // Create a new session
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

// 2) Create a record in "interview_messages"
async function createMessageRecord(sessionId, sender, text) {
  try {
    await base('interview_messages').create({
      'Interview Session': [sessionId], // Linked field -> array
      'Sender': sender,
      'Message Text': text
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
    const { stakeholderID, projectID, userMessage } = req.body;
    if (!userMessage) {
      return res.status(400).json({ error: 'No userMessage provided' });
    }

    // 1) Find or create the interview session
    const sessionId = await findOrCreateSession(stakeholderID, projectID);

    // 2) Store the user's message
    await createMessageRecord(sessionId, 'User', userMessage);

    // 3) Construct the ChatGPT prompt
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

    // 4) Call OpenAI (non-streaming for now)
    const completion = await openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages
    });
    const aiResponse = completion.data.choices[0].message.content;

    // 5) Store the AI response
    await createMessageRecord(sessionId, 'AI', aiResponse);

    // 6) Return the AI response to the client
    return res.json({ aiResponse });
  } catch (error) {
    console.error('Error in /voice-chat:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

//////////////////////////////
// Example /stream-chat Endpoint
//////////////////////////////
app.post('/stream-chat', async (req, res) => {
  try {
    // If you want a streaming approach, implement it here
    // For now, it's just a placeholder
    return res.json({ message: 'stream-chat endpoint is not fully implemented yet.' });
  } catch (error) {
    console.error('Error in /stream-chat:', error);
    res.status(500).send('Server error');
  }
});

//////////////////////////////
// Test route to verify
//////////////////////////////
app.get('/test', (req, res) => {
  res.send("Test route is working!");
});

//////////////////////////////
// Start the Express server
//////////////////////////////
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
