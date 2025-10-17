const { Server } = require('socket.io');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3001'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.handshake.auth?.userId || socket.handshake.query?.userId;
    if (userId) socket.join(String(userId));

    socket.on('notifications:join', (id) => {
      if (id) socket.join(String(id));
    });

    socket.on('notifications:leave', (id) => {
      if (id) socket.leave(String(id));
    });
  });

  return io;
};

const getIO = () => io;

const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(String(userId)).emit(event, payload);
};

module.exports = { initSocket, getIO, emitToUser };
