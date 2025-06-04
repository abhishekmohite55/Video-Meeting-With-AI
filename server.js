const express = require('express');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Explicitly set MIME type for JavaScript files
app.get('*.js', (req, res, next) => {
  res.type('application/javascript');
  next();
});

// Serve Socket.IO client files
app.use('/socket-io', express.static(path.join(__dirname, 'node_modules/socket.io/client-dist')));

// Route for homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Socket.IO setup
const io = socketIO(server);

io.on('connection', (socket) => {
  console.log('New user connected');
  
  // Your existing Socket.IO logic here
  socket.on('join', (roomId) => {
    socket.join(roomId);
    // ... rest of your room handling code
  });
});