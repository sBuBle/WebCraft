// Import required modules
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create an Express application
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files (e.g., client scripts)
app.use(express.static(path.join(__dirname, 'public')));

// Define default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Server state
let worldData = {}; // Store world data here
let clients = {}; // Store connected clients and their states

// Handle socket connections
io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    // Handle joining the game
    socket.on('join', (nickname) => {
        console.log(`${nickname} joined the game.`);
        clients[socket.id] = { nickname, position: { x: 0, y: 0, z: 0 }, angles: { pitch: 0, yaw: 0 } };

        // Send world data to the client
        socket.emit('world', worldData);

        // Notify all clients about the new player
        io.emit('message', `${nickname} has joined the game.`);
    });

    // Handle player updates
    socket.on('updatePlayer', (data) => {
        if (clients[socket.id]) {
            clients[socket.id].position = data.position;
            clients[socket.id].angles = data.angles;
        }
    });

    // Handle chat messages
    socket.on('chat', (message) => {
        const nickname = clients[socket.id]?.nickname || 'Unknown';
        console.log(`Chat from ${nickname}: ${message}`);
        io.emit('chat', nickname, message);
    });

    // Handle disconnects
    socket.on('disconnect', () => {
        const nickname = clients[socket.id]?.nickname || 'Unknown';
        console.log(`${nickname} disconnected.`);
        io.emit('message', `${nickname} has left the game.`);
        delete clients[socket.id];
    });

    // Handle kick events
    socket.on('kick', (reason) => {
        console.log(`Kicking ${socket.id} for: ${reason}`);
        socket.emit('kick', reason);
        socket.disconnect();
    });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
