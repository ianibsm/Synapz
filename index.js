// index.js
const express = require('express');
const app = express();

app.get('/test', (req, res) => {
  res.send('Test route is working!');
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
