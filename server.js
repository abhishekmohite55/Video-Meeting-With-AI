const express = require('express');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// Start express server
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Initialize Socket.IO
const io = socketIO(server);

// Handle socket connections
io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // When a user wants to join a room
  socket.on('join', (roomId) => {
    const roomClients = io.sockets.adapter.rooms.get(roomId) || new Set();
    if (roomClients.size >= 2) {
      socket.emit('room-full');
      return;
    }

    socket.join(roomId);
    console.log(`Socket ${socket.id} joined room ${roomId}`);

    // Notify other users in room about new user
    socket.to(roomId).emit('user-joined', socket.id);

    // Send existing users to the new user
    const clients = Array.from(roomClients);
    if (clients.length > 0) {
      socket.emit('existing-users', clients);
    }
  });

  // Relay signaling data between peers
  socket.on('signal', (data) => {
    io.to(data.target).emit('signal', {
      sender: socket.id,
      signal: data.signal
    });
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Notify room members about the disconnection
    const rooms = Array.from(socket.rooms);
    rooms.forEach(roomId => {
      if (roomId !== socket.id) { // Skip the default room
        socket.to(roomId).emit('user-disconnected', socket.id);
      }
    });
  });

  // Add this new handler
  socket.on('leave', (roomId) => {
    socket.leave(roomId);
    console.log(`Socket ${socket.id} left room ${roomId}`);
  });
});